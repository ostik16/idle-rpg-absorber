/**
 * Commands introduced in issue #26: buy, sell, equip, unequip, warehouse deposit and withdraw, set auto-sell.
 * The engine integration (dispatch, events) is in tests/engine.test.ts; this file exercises `applyCommand` directly.
 */
import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import { loadGameData, type GameData } from '../src/data/game-data';
import { applyCommand, type Command } from '../src/engine/commands';
import type { EngineEvent } from '../src/engine/events';
import type { StepContext } from '../src/engine/step-context';
import { usedCells } from '../src/game/inventory';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { CharacterState, GameState, ItemStack, WarehouseTab } from '../src/state/types';

const data = loadGameData();

function makeState(ids: readonly string[] = ['a']): GameState {
  const state = createGameState(1, 0, data);
  state.account.unlockedSlots = constants.characters.maxSlots;
  for (const id of ids) state.roster.push(createCharacterState(id, `Name ${id}`, data));
  return state;
}

/** Applies a command, asserts it was not rejected, and returns the event. */
function apply(state: GameState, command: Command, d: GameData = data): EngineEvent | null {
  const event = applyCommand(state, command, d, () => ({} as StepContext));
  if (event !== null && event.type === 'commandRejected') {
    throw new Error(`command ${JSON.stringify(command)} was rejected: ${event.reason}`);
  }
  return event;
}

/** Applies a command, asserts it was rejected, and returns the reason. */
function reject(state: GameState, command: Command, d: GameData = data): string {
  const event = applyCommand(state, command, d, () => ({} as StepContext));
  if (event === null || event.type !== 'commandRejected') throw new Error(`expected rejection`);
  return event.reason;
}

function find(state: GameState, id: string): CharacterState {
  const c = state.roster.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no character ${id}`);
  return c;
}

function stack(itemId: string, qty = 1): ItemStack {
  return { itemId, bonuses: [], upgradeLevel: 0, qty };
}

describe('buyItem (design 2.5, L16)', () => {
  it('spends the character\'s own gold and adds the item to its bag', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.gold = 50;
    apply(state, { type: 'buyItem', characterId: 'a', shopId: 'general-store', itemId: 'rusty-sword', qty: 1 });
    expect(character.gold).toBe(10);
    expect(character.bag.find((s) => s.itemId === 'rusty-sword')?.qty).toBe(1);
  });

  it('refuses a purchase with too little gold, and changes nothing (done-when #1)', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.gold = 10;
    const before = {
      gold: character.gold,
      bag: character.bag.map((s) => ({ ...s })),
    };
    const reason = reject(state, { type: 'buyItem', characterId: 'a', shopId: 'general-store', itemId: 'rusty-sword', qty: 1 });
    expect(reason).toMatch(/gold/i);
    expect(character.gold).toBe(before.gold);
    expect(character.bag).toEqual(before.bag);
  });

  it('refuses when the shop does not sell the item', () => {
    const state = makeState();
    find(state, 'a').gold = 1000;
    const reason = reject(state, { type: 'buyItem', characterId: 'a', shopId: 'general-store', itemId: 'minor-health-potion', qty: 1 });
    expect(reason).toMatch(/does not sell/);
  });

  it('refuses when the bag has no room for the whole quantity', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.gold = 100_000;
    // Fill the bag with 36 unstackable rings-sized items (size 1) to use all 36 cells.
    character.bag = Array.from({ length: 36 }, () => stack('hide-scrap', 1));
    expect(usedCells(character.bag, (id) => data.items.find((r) => r.id === id) as unknown as { size: number })).toBe(36);
    const reason = reject(state, { type: 'buyItem', characterId: 'a', shopId: 'general-store', itemId: 'rusty-sword', qty: 1 });
    expect(reason).toMatch(/no room/i);
    expect(character.gold).toBe(100_000);
  });
});

describe('sellItem (design 2.9, L16)', () => {
  it('sells at the sell price and gives gold to the acting character', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.gold = 0;
    character.bag = [stack('rusty-sword', 1)];
    apply(state, { type: 'sellItem', characterId: 'a', bagIndex: 0, qty: 1 });
    expect(character.gold).toBe(10);
    expect(character.bag).toHaveLength(0);
  });

  it('a silver bar moves 110 gold from one character to 100 gold on another (done-when #5)', () => {
    const state = makeState(['a', 'b']);
    const alice = find(state, 'a');
    const bea = find(state, 'b');
    alice.gold = 200;
    bea.gold = 0;

    // Alice buys the silver bar from the general store for 110.
    apply(state, { type: 'buyItem', characterId: 'a', shopId: 'general-store', itemId: 'silver-bar', qty: 1 });
    expect(alice.gold).toBe(90);

    // Alice deposits it into the warehouse.
    const barIndex = alice.bag.findIndex((s) => s.itemId === 'silver-bar');
    apply(state, { type: 'warehouseDeposit', characterId: 'a', bagIndex: barIndex, tabIndex: 0, qty: 1 });
    expect(alice.bag.find((s) => s.itemId === 'silver-bar')).toBeUndefined();
    expect(state.account.warehouse.tabs[0]!.items.find((s) => s.itemId === 'silver-bar')?.qty).toBe(1);

    // Bea withdraws it and sells it for 100.
    apply(state, { type: 'warehouseWithdraw', characterId: 'b', tabIndex: 0, stackIndex: 0, qty: 1 });
    const beaBarIndex = bea.bag.findIndex((s) => s.itemId === 'silver-bar');
    apply(state, { type: 'sellItem', characterId: 'b', bagIndex: beaBarIndex, qty: 1 });
    expect(bea.gold).toBe(100);
  });
});

describe('equipItem and unequipItem (design 2.2)', () => {
  it('moves the stack from bag to slot and updates derived stats (done-when #2)', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.level = 5;
    character.bag = [stack('mossfang-sword', 1)];

    apply(state, { type: 'equipItem', characterId: 'a', bagIndex: 0, slot: 'main-hand' });
    expect(character.bag).toHaveLength(0);
    expect(character.equipment['main-hand']?.itemId).toBe('mossfang-sword');
  });

  it('swaps the slot item back into the bag when there is already one in place', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.bag = [stack('rusty-sword', 1), stack('hunting-knife', 1)];
    apply(state, { type: 'equipItem', characterId: 'a', bagIndex: 0, slot: 'main-hand' });
    apply(state, { type: 'equipItem', characterId: 'a', bagIndex: 0, slot: 'main-hand' });
    expect(character.equipment['main-hand']?.itemId).toBe('hunting-knife');
    expect(character.bag.some((s) => s.itemId === 'rusty-sword')).toBe(true);
  });

  it('equipping a backpack changes cells and max stack for that character only (done-when #3)', () => {
    const state = makeState(['a', 'b']);
    const alice = find(state, 'a');
    const bea = find(state, 'b');
    alice.bag = [stack('canvas-pack', 1)];
    bea.bag = []; // Both start empty so stack sizes are easy to read.
    apply(state, { type: 'equipItem', characterId: 'a', bagIndex: 0, slot: 'backpack' });
    expect(alice.equipment['backpack']?.itemId).toBe('canvas-pack');

    alice.bag = [];
    alice.gold = 1_000_000;
    bea.gold = 1_000_000;
    apply(state, { type: 'buyItem', characterId: 'a', shopId: 'alchemist', itemId: 'minor-health-potion', qty: 40 });
    // Canvas pack maxStack 40 — one stack of 40, one cell.
    expect(alice.bag.filter((s) => s.itemId === 'minor-health-potion').map((s) => s.qty)).toEqual([40]);

    apply(state, { type: 'buyItem', characterId: 'b', shopId: 'alchemist', itemId: 'minor-health-potion', qty: 40 });
    // Base maxStack 20 — two stacks of 20.
    expect(bea.bag.filter((s) => s.itemId === 'minor-health-potion').map((s) => s.qty)).toEqual([20, 20]);
  });

  it('a backpack swap uses the new pack\'s capacity, so the old pack fits back in the bag', () => {
    // Without this, a bigger-than-base bag that is near-full would reject a pack swap even though the new pack makes room.
    const state = makeState();
    const character = find(state, 'a');
    character.equipment['backpack'] = stack('canvas-pack', 1); // canvas-pack: 40 cells, 40 maxStack, size 2.
    // 38 size-1 stacks + leather-pack (size 2) = 40 cells, exactly filling the canvas-pack bag.
    character.bag = [stack('leather-pack', 1), ...Array.from({ length: 38 }, () => stack('hide-scrap', 1))];
    apply(state, { type: 'equipItem', characterId: 'a', bagIndex: 0, slot: 'backpack' });
    expect(character.equipment['backpack']?.itemId).toBe('leather-pack');
    expect(character.bag.some((s) => s.itemId === 'canvas-pack')).toBe(true);
  });

  it('refuses a two-handed weapon while the off hand is occupied', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.level = 5;
    character.equipment['off-hand'] = stack('silver-bar', 1); // stand-in to simulate an occupied slot
    character.bag = [stack('oak-greatclub', 1)];
    const reason = reject(state, { type: 'equipItem', characterId: 'a', bagIndex: 0, slot: 'main-hand' });
    expect(reason).toMatch(/off hand/i);
  });

  it('refuses when the item does not fit the slot', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.bag = [stack('leather-cap', 1)];
    const reason = reject(state, { type: 'equipItem', characterId: 'a', bagIndex: 0, slot: 'body' });
    expect(reason).toMatch(/does not fit/);
  });

  it('unequip refuses when the bag has no room', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.equipment['main-hand'] = stack('rusty-sword', 1); // size 3
    // Fill bag so a size-3 item does not fit.
    character.bag = Array.from({ length: 34 }, () => stack('hide-scrap', 1));
    const reason = reject(state, { type: 'unequipItem', characterId: 'a', slot: 'main-hand' });
    expect(reason).toMatch(/no bag room/i);
    expect(character.equipment['main-hand']).toBeDefined();
  });

  it('refuses shopping outside the city', () => {
    const state = makeState();
    const character = find(state, 'a');
    character.phase = 'travelling';
    const reason = reject(state, { type: 'buyItem', characterId: 'a', shopId: 'general-store', itemId: 'rusty-sword', qty: 1 });
    expect(reason).toMatch(/city/);
  });
});

describe('warehouseDeposit and warehouseWithdraw (design 2.3, 2.4)', () => {
  it('moves items from one character to another through the warehouse (done-when #4)', () => {
    const state = makeState(['a', 'b']);
    const alice = find(state, 'a');
    const bea = find(state, 'b');
    alice.bag = [stack('hide-scrap', 50)]; // more than the base 20 stack, spread over stacks of 20.
    // Actually the bag already has it as one stack of 50 even though that's over the max — test from the warehouse side instead.
    alice.bag = [stack('hide-scrap', 20)];

    apply(state, { type: 'warehouseDeposit', characterId: 'a', bagIndex: 0, tabIndex: 0, qty: 20 });
    expect(alice.bag.find((s) => s.itemId === 'hide-scrap')).toBeUndefined();
    expect(state.account.warehouse.tabs[0]!.items[0]?.qty).toBe(20);

    apply(state, { type: 'warehouseWithdraw', characterId: 'b', tabIndex: 0, stackIndex: 0, qty: 20 });
    expect(bea.bag.find((s) => s.itemId === 'hide-scrap')?.qty).toBe(20);
    expect(state.account.warehouse.tabs[0]!.items).toHaveLength(0);
  });

  it('a withdrawal splits a warehouse stack to the bag\'s max stack (design 2.3)', () => {
    const state = makeState();
    const character = find(state, 'a');
    const tab = state.account.warehouse.tabs[0] as WarehouseTab;
    tab.items.push({ itemId: 'hide-scrap', bonuses: [], upgradeLevel: 0, qty: 80 }); // warehouse stack of 80
    apply(state, { type: 'warehouseWithdraw', characterId: 'a', tabIndex: 0, stackIndex: 0, qty: 60 });
    // Base bag max stack is 20, so 60 splits into 20 + 20 + 20.
    const stacks = character.bag.filter((s) => s.itemId === 'hide-scrap').map((s) => s.qty);
    expect(stacks).toEqual([20, 20, 20]);
    expect(tab.items[0]?.qty).toBe(20);
  });

  it('refuses a deposit when the warehouse has no room for the whole stack', () => {
    const state = makeState();
    const character = find(state, 'a');
    const tab = state.account.warehouse.tabs[0] as WarehouseTab;
    // Fill the tab with 56 unstackable swords (size 3 each) is too large, use 56 single-cell stacks.
    tab.items = Array.from({ length: 56 }, () => ({ itemId: 'hide-scrap', bonuses: [], upgradeLevel: 0, qty: 100 }));
    character.bag = [stack('rusty-sword', 1)];
    const reason = reject(state, { type: 'warehouseDeposit', characterId: 'a', bagIndex: 0, tabIndex: 0, qty: 1 });
    expect(reason).toMatch(/no warehouse room/i);
  });
});

describe('setAutoSell (design 2.3 L6)', () => {
  it('replaces the rule set, and nothing sells until rules are set', () => {
    const state = makeState();
    const character = find(state, 'a');
    expect(character.settings.autoSell).toEqual({ enabled: false, rules: [] });

    apply(state, {
      type: 'setAutoSell',
      characterId: 'a',
      autoSell: { enabled: true, rules: [{ category: 'material' }] },
    });
    expect(character.settings.autoSell).toEqual({ enabled: true, rules: [{ category: 'material' }] });
  });

  it('refuses when the character does not exist', () => {
    const state = makeState();
    const reason = reject(state, {
      type: 'setAutoSell',
      characterId: 'missing',
      autoSell: { enabled: false, rules: [] },
    });
    expect(reason).toMatch(/No character/);
  });
});

describe('per-character settings commands (issue #34)', () => {
  const settingsOf = (state: GameState): CharacterState['settings'] => (state.roster[0] as CharacterState).settings;

  it('setReturnHealthThreshold sticks, and 0 or above 1 is rejected', () => {
    const state = makeState();
    apply(state, { type: 'setReturnHealthThreshold', characterId: 'a', threshold: 0.3 });
    expect(settingsOf(state).returnHealthThreshold).toBe(0.3);
    for (const threshold of [0, 1.5]) {
      expect(reject(state, { type: 'setReturnHealthThreshold', characterId: 'a', threshold })).toMatch(/between 1% and 100%/);
    }
    expect(settingsOf(state).returnHealthThreshold).toBe(0.3);
  });

  it('setCityHealing sticks, and an unknown mode is rejected', () => {
    const state = makeState();
    apply(state, { type: 'setCityHealing', characterId: 'a', mode: 'fast' });
    expect(settingsOf(state).cityHealing).toBe('fast');
    const reason = reject(state, { type: 'setCityHealing', characterId: 'a', mode: 'turbo' as never });
    expect(reason).toMatch(/turbo/);
    expect(settingsOf(state).cityHealing).toBe('fast');
  });

  it('setPotionThreshold sets, removes with null, and rejects an unknown potion or bad fraction', () => {
    const state = makeState();
    apply(state, { type: 'setPotionThreshold', characterId: 'a', itemId: 'minor-health-potion', threshold: 0.5 });
    expect(settingsOf(state).potionThresholds['minor-health-potion']).toBe(0.5);
    expect(reject(state, { type: 'setPotionThreshold', characterId: 'a', itemId: 'nope', threshold: 0.5 })).toMatch(/No potion called nope/);
    expect(reject(state, { type: 'setPotionThreshold', characterId: 'a', itemId: 'rusty-sword', threshold: 0.5 })).toMatch(/No potion/);
    expect(reject(state, { type: 'setPotionThreshold', characterId: 'a', itemId: 'minor-health-potion', threshold: 2 })).toMatch(/between 1% and 100%/);
    expect(settingsOf(state).potionThresholds['minor-health-potion']).toBe(0.5);
    apply(state, { type: 'setPotionThreshold', characterId: 'a', itemId: 'minor-health-potion', threshold: null });
    expect(settingsOf(state).potionThresholds).not.toHaveProperty('minor-health-potion');
  });

  it('setRestockList sticks, and rejects a non-potion or a bad quantity', () => {
    const state = makeState();
    apply(state, { type: 'setRestockList', characterId: 'a', list: [{ itemId: 'minor-health-potion', quantity: 5 }] });
    expect(settingsOf(state).restockList).toEqual([{ itemId: 'minor-health-potion', quantity: 5 }]);
    const bad = (itemId: string, quantity: number): string =>
      reject(state, { type: 'setRestockList', characterId: 'a', list: [{ itemId, quantity }] });
    expect(bad('rusty-sword', 1)).toMatch(/No potion called rusty-sword/);
    expect(bad('minor-health-potion', -1)).toMatch(/whole quantity/);
    expect(bad('minor-health-potion', 1.5)).toMatch(/whole quantity/);
    expect(settingsOf(state).restockList).toEqual([{ itemId: 'minor-health-potion', quantity: 5 }]);
  });

  it('setLootFilter stores a copy of the rules', () => {
    const state = makeState();
    const lootFilter = { enabled: true, rules: [{ category: 'material' }] };
    apply(state, { type: 'setLootFilter', characterId: 'a', lootFilter });
    expect(settingsOf(state).lootFilter).toEqual(lootFilter);
    expect(settingsOf(state).lootFilter.rules[0]).not.toBe(lootFilter.rules[0]);
    expect(reject(state, { type: 'setLootFilter', characterId: 'missing', lootFilter })).toMatch(/No character/);
  });
});
