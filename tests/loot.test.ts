import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import { withAutomation } from './automation';
import itemsJson from '../data/items.json';
import xpTableJson from '../data/xp-table.json';
import { createGameData, type GameData } from '../src/data/game-data';
import { stepCharacter, type StepContext } from '../src/engine/character';
import type { EngineEvent } from '../src/engine/events';
import { startFight } from '../src/engine/fight';
import { createCharacterStreams } from '../src/engine/streams';
import { enemyMoneyRange } from '../src/game/enemies';
import {
  addToBag,
  bagCells,
  bagMaxStack,
  freeCells,
  matchesLootFilter,
  usedCells,
  type BagStackLike,
} from '../src/game/inventory';
import { createCharacterState } from '../src/state/factory';
import type { CharacterState, ItemRule, ItemStack } from '../src/state/types';

const TICK = constants.combat.tickMs;

const items = itemsJson as unknown as {
  id: string;
  size: number;
  stackable: boolean;
  category?: string;
  requiredLevel?: number;
}[];
const itemOf = (id: string): (typeof items)[number] => {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};
const stack = (itemId: string, qty = 1, bonuses: BagStackLike['bonuses'] = []): ItemStack => ({
  itemId,
  bonuses,
  upgradeLevel: 0,
  qty,
});

const SWORD = 'rusty-sword'; // size 3
const SCRAP = 'hide-scrap'; // stackable, size 1
const CAP = 'leather-cap'; // size 1, not stackable

describe('bag cells (L7)', () => {
  it('the real items: a sword is 3 cells, a stackable item 1', () => {
    expect(itemOf(SWORD).size).toBe(3);
    expect(itemOf(SCRAP)).toMatchObject({ size: 1, stackable: true });
  });

  it('a stack uses its size once, whatever its quantity', () => {
    const bag = [stack(SWORD), stack(SCRAP, 20), stack(SCRAP, 5)];
    expect(usedCells(bag, itemOf)).toBe(5);
    expect(freeCells(bag, 36, itemOf)).toBe(31);
    expect(freeCells(bag, 4, itemOf)).toBe(0);
  });
});

describe('adding to the bag', () => {
  const noPack = { capacity: bagCells(null), maxStack: bagMaxStack(null) };

  it('stacks split at the bag max stack: 45 scraps are 20, 20 and 5 without a backpack', () => {
    const result = addToBag([], stack(SCRAP, 45), itemOf(SCRAP), noPack, itemOf);
    expect(result.bag.map((s) => s.qty)).toEqual([20, 20, 5]);
    expect(result).toMatchObject({ added: 45, refused: 0 });
  });

  it('stacks split at the backpack max stack: 45 scraps are 40 and 5 with a canvas pack', () => {
    const pack = itemOf('canvas-pack') as unknown as { bagCells: number; maxStack: number };
    const limits = { capacity: bagCells(pack), maxStack: bagMaxStack(pack) };
    expect(limits).toEqual({ capacity: 40, maxStack: 40 });
    const result = addToBag([], stack(SCRAP, 45), itemOf(SCRAP), limits, itemOf);
    expect(result.bag.map((s) => s.qty)).toEqual([40, 5]);
  });

  it('tops up a partial stack before opening a new one, and does not touch the bag passed in', () => {
    const bag = [stack(SCRAP, 18)];
    const result = addToBag(bag, stack(SCRAP, 5), itemOf(SCRAP), noPack, itemOf);
    expect(result.bag.map((s) => s.qty)).toEqual([20, 3]);
    expect(bag[0]?.qty).toBe(18);
  });

  it('a full stack is left alone, and different bonuses or upgrade levels never merge', () => {
    const bag = [
      stack(SCRAP, 20),
      { ...stack(SCRAP, 1), upgradeLevel: 1 },
      stack(SCRAP, 1, [{ attribute: 'strength', value: 1 }]),
    ];
    const result = addToBag(bag, stack(SCRAP, 2), itemOf(SCRAP), noPack, itemOf);
    expect(result.bag.map((s) => s.qty)).toEqual([20, 1, 1, 2]);
  });

  it('a stack that already holds more than the limit takes nothing more', () => {
    const result = addToBag([stack(SCRAP, 30)], stack(SCRAP, 1), itemOf(SCRAP), noPack, itemOf);
    expect(result.bag.map((s) => s.qty)).toEqual([30, 1]);
  });

  it('a sword takes 3 cells', () => {
    const result = addToBag([], stack(SWORD), itemOf(SWORD), noPack, itemOf);
    expect(usedCells(result.bag, itemOf)).toBe(3);
    expect(freeCells(result.bag, 36, itemOf)).toBe(33);
  });

  it('a bag with 3 free cells takes a sword, with 2 it refuses it wherever the free cells are', () => {
    const eleven = Array.from({ length: 11 }, () => stack(SWORD)); // 33 cells
    const threeFree = addToBag(eleven, stack(SWORD), itemOf(SWORD), noPack, itemOf);
    expect(threeFree).toMatchObject({ added: 1, refused: 0 });
    expect(freeCells(threeFree.bag, 36, itemOf)).toBe(0);

    const twoFree = [...eleven, stack(CAP)]; // 34 cells
    const refused = addToBag(twoFree, stack(SWORD), itemOf(SWORD), noPack, itemOf);
    expect(refused).toMatchObject({ added: 0, refused: 1 });
    expect(refused.bag).toHaveLength(twoFree.length);
    // A one cell item still fits in the same bag.
    expect(addToBag(twoFree, stack(CAP), itemOf(CAP), noPack, itemOf).added).toBe(1);
  });

  it('a stack that only partly fits puts in what fits and reports the rest', () => {
    const full = Array.from({ length: 12 }, () => stack(SWORD)); // 36 cells
    expect(addToBag(full, stack(SCRAP, 5), itemOf(SCRAP), noPack, itemOf)).toMatchObject({ added: 0, refused: 5 });
    const oneFree = [...Array.from({ length: 11 }, () => stack(SWORD)), stack(CAP), stack(CAP)];
    expect(addToBag(oneFree, stack(SCRAP, 30), itemOf(SCRAP), noPack, itemOf)).toMatchObject({ added: 20, refused: 10 });
  });

  it('a zero quantity adds nothing', () => {
    expect(addToBag([], stack(SCRAP, 0), itemOf(SCRAP), noPack, itemOf)).toMatchObject({ bag: [], added: 0, refused: 0 });
  });
});

describe('loot filter (2.3, L8)', () => {
  const sword = { category: 'equipment', requiredLevel: 5 };
  const potion = { category: 'consumable', requiredLevel: 1 };
  const filter = (rules: ItemRule[], enabled = true): { enabled: boolean; rules: ItemRule[] } => ({ enabled, rules });

  it('a disabled filter picks up everything, even with rules', () => {
    expect(matchesLootFilter(filter([{ category: 'rare' }], false), sword, [])).toBe(true);
  });

  it('an enabled filter with no rules picks up nothing', () => {
    expect(matchesLootFilter(filter([]), sword, [])).toBe(false);
  });

  it('a rule matches on category', () => {
    expect(matchesLootFilter(filter([{ category: 'equipment' }]), sword, [])).toBe(true);
    expect(matchesLootFilter(filter([{ category: 'equipment' }]), potion, [])).toBe(false);
  });

  it('a rule matches on the required level, at or above the minimum', () => {
    expect(matchesLootFilter(filter([{ minRequiredLevel: 5 }]), sword, [])).toBe(true);
    expect(matchesLootFilter(filter([{ minRequiredLevel: 6 }]), sword, [])).toBe(false);
    expect(matchesLootFilter(filter([{ minRequiredLevel: 2 }]), { category: 'x' }, [])).toBe(false); // no level counts as 1
  });

  it('a rule matches on a rolled bonus attribute', () => {
    const rule = filter([{ bonusAttribute: 'strength' }]);
    expect(matchesLootFilter(rule, sword, [{ attribute: 'dexterity' }, { attribute: 'strength' }])).toBe(true);
    expect(matchesLootFilter(rule, sword, [{ attribute: 'dexterity' }])).toBe(false);
    expect(matchesLootFilter(rule, sword, [])).toBe(false);
  });

  it('all the fields of one rule must match; any one rule is enough', () => {
    const both = filter([{ category: 'equipment', minRequiredLevel: 6 }]);
    expect(matchesLootFilter(both, sword, [])).toBe(false);
    const either = filter([{ category: 'equipment', minRequiredLevel: 6 }, { category: 'consumable' }]);
    expect(matchesLootFilter(either, potion, [])).toBe(true);
    expect(matchesLootFilter(either, sword, [])).toBe(false);
  });

  it('a rule with no fields matches every item', () => {
    expect(matchesLootFilter(filter([{}]), potion, [])).toBe(true);
  });
});

// ---- The engine: gold and drops on a kill ----

const PLAIN = {
  id: 'plain',
  distanceFromCity: 2,
  movementSecondsBetweenEnemies: 1,
  enemies: [{ enemyId: 'soft', spawnWeight: 1 }],
  miniBossSpawnChance: 0,
  bossSpawnChance: 0,
};
const base = { level: 1, health: 1, damage: 0, attackSpeed: 0.01, defence: 0, moneyRange: { min: 7, max: 7 } };
const ENEMIES = [
  { ...base, id: 'soft', dropTableId: 'always' },
  { ...base, id: 'nodrops' },
  { ...base, id: 'plainmoney', moneyRange: undefined },
  { ...base, id: 'bundle', dropTableId: 'bundle' },
  { ...base, id: 'mini', type: 'mini-boss', dropTableId: 'pool' },
  { ...base, id: 'lucky', dropTableId: 'lucky' },
];
const ONE = { minQuantity: 1, maxQuantity: 1 };
const TABLES = [
  { id: 'always', entries: [{ itemId: SWORD, baseChance: 1, ...ONE }] },
  { id: 'bundle', entries: [{ itemId: SCRAP, baseChance: 1, minQuantity: 45, maxQuantity: 45 }] },
  {
    id: 'pool',
    entries: [],
    guaranteedPools: [
      {
        id: 'mats',
        entries: [
          { itemId: SCRAP, weight: 3, minQuantity: 2, maxQuantity: 4 },
          { itemId: 'whetstone', weight: 1, minQuantity: 1, maxQuantity: 1 },
        ],
      },
    ],
  },
  { id: 'lucky', entries: [{ itemId: 'lucky-ring', baseChance: 1, ...ONE }] },
];
// Five bonus entries that always hit, to see the cap of 3.
const LUCKY_RING = {
  ...itemOf(CAP),
  id: 'lucky-ring',
  bonusAttributePool: ['strength', 'dexterity', 'vitality', 'intelligence', 'speed'].map((attribute) => ({
    attribute,
    min: 1,
    max: 2,
    chance: 1,
  })),
};

function fixture(): GameData {
  return createGameData({
    constants,
    items: [...itemsJson, LUCKY_RING],
    enemies: ENEMIES,
    dropTables: TABLES,
    areas: [PLAIN],
    xpTable: xpTableJson,
  });
}

function harness(data: GameData = fixture(), seed = 7) {
  const character = createCharacterState('c1', 'Ysolde', data);
  character.bag = []; // a new character starts with potions
  const events: EngineEvent[] = [];
  const streams = createCharacterStreams(seed, 'c1');
  const ctx: StepContext = { data, tickMs: TICK, streams, emit: (event) => void events.push(event) };
  const kill = (enemyId: string, times = 1): void => {
    for (let i = 0; i < times; i++) {
      startFight(character, enemyId, ctx);
      for (let n = 0; character.phase === 'fighting' && n < 100_000; n++) stepCharacter(character, ctx);
    }
  };
  return { character, events, streams, ctx, kill };
}

const fullOfSwords = (character: CharacterState): void => {
  character.bag = Array.from({ length: 12 }, () => stack(SWORD));
};

describe('gold from a kill (3.5, 3.8)', () => {
  it("is rolled from the enemy's money range and reported", () => {
    const { character, events, kill } = harness();
    const before = character.gold;
    kill('nodrops', 2);
    expect(character.gold).toBe(before + 14);
    expect(events.filter((e) => e.type === 'goldGained')).toEqual([
      { type: 'goldGained', characterId: 'c1', amount: 7 },
      { type: 'goldGained', characterId: 'c1', amount: 7 },
    ]);
  });

  it('comes from the baseline range for the enemy level when it has no money range', () => {
    const range = enemyMoneyRange(1);
    const { character, kill } = harness();
    const before = character.gold;
    kill('plainmoney', 50);
    const gained = character.gold - before;
    expect(gained).toBeGreaterThanOrEqual(50 * range.min);
    expect(gained).toBeLessThanOrEqual(50 * range.max);
  });

  it('arrives after the XP and before the items', () => {
    const { events, kill } = harness();
    kill('soft');
    const kinds = events
      .map((e) => e.type)
      .filter((t) => ['enemyKilled', 'xpGained', 'goldGained', 'itemPickedUp'].includes(t));
    expect(kinds).toEqual(['enemyKilled', 'xpGained', 'goldGained', 'itemPickedUp']);
  });
});

describe('drops from a kill (3.8)', () => {
  it('puts a drop in the bag and reports it', () => {
    const { character, events, kill } = harness();
    kill('soft');
    expect(character.bag).toEqual([stack(SWORD)]);
    expect(events).toContainEqual({ type: 'itemPickedUp', characterId: 'c1', itemId: SWORD, qty: 1, bonuses: [] });
  });

  it('a character 10 levels above the enemy gets no drops from the normal table, but keeps XP and gold', () => {
    const { character, events, kill } = harness();
    character.level = 11;
    const goldBefore = character.gold;
    kill('soft', 30);
    expect(character.bag).toEqual([]);
    expect(events.filter((e) => e.type === 'itemPickedUp' || e.type === 'bagFull')).toEqual([]);
    expect(character.gold).toBe(goldBefore + 30 * 7);
    expect(events.filter((e) => e.type === 'xpGained')).toHaveLength(30);
  });

  it('rolls drops at the level the character fought at, not the level the kill earns', () => {
    // Level 10 against a level 1 enemy keeps 10% of the chance. The kill levels it to 11, which would give 0%.
    const { character, events, kill } = harness();
    const xpToNext = (xpTableJson as { level: number; xpToNext: number }[]).find((r) => r.level === 10)!.xpToNext;
    let levelUps = 0;
    let drops = 0;
    for (let i = 0; i < 100; i++) {
      character.level = 10;
      character.xpInLevel = xpToNext - 1;
      kill('soft');
      expect(character.level).toBe(11);
      levelUps += events.filter((e) => e.type === 'levelUp').length;
      drops += events.filter((e) => e.type === 'itemPickedUp' || e.type === 'bagFull').length;
      events.length = 0;
      character.bag = [];
    }
    expect(levelUps).toBe(100);
    expect(drops).toBeGreaterThan(0);
  });

  it('a mini-boss kill always gives exactly one pool item, in its quantity range, whatever the level gap', () => {
    for (const level of [1, 11, 40]) {
      const { character, events, kill } = harness();
      character.level = level;
      const N = 60;
      kill('mini', N);
      const picked = events.filter((e): e is Extract<EngineEvent, { type: 'itemPickedUp' }> => e.type === 'itemPickedUp');
      expect(picked).toHaveLength(N);
      for (const p of picked) {
        if (p.itemId === SCRAP) {
          expect(p.qty).toBeGreaterThanOrEqual(2);
          expect(p.qty).toBeLessThanOrEqual(4);
        } else {
          expect([p.itemId, p.qty]).toEqual(['whetstone', 1]);
        }
      }
      expect(new Set(picked.map((p) => p.itemId))).toEqual(new Set([SCRAP, 'whetstone']));
    }
  });

  it('stacks split at the max stack of the equipped backpack', () => {
    const none = harness();
    none.kill('bundle');
    expect(none.character.bag.map((s) => s.qty)).toEqual([20, 20, 5]);

    const withPack = harness();
    withPack.character.equipment['backpack'] = stack('canvas-pack');
    withPack.kill('bundle');
    expect(withPack.character.bag.map((s) => s.qty)).toEqual([40, 5]);
  });

  it('a full bag refuses a sword, still gives XP and gold, and reports bagFull', () => {
    const { character, events, kill } = harness();
    fullOfSwords(character);
    const goldBefore = character.gold;
    kill('soft');
    expect(character.bag).toHaveLength(12);
    expect(character.gold).toBe(goldBefore + 7);
    expect(events).toContainEqual({ type: 'bagFull', characterId: 'c1', itemId: SWORD, qty: 1 });
    expect(events.some((e) => e.type === 'itemPickedUp')).toBe(false);
    expect(events.some((e) => e.type === 'xpGained')).toBe(true);
    expect(character.phase).toBe('looting'); // no return trip here (#27)
  });

  it('a bag with 2 free cells refuses a sword even though cells are free', () => {
    const { character, events, kill } = harness();
    character.bag = [...Array.from({ length: 11 }, () => stack(SWORD)), stack(CAP)];
    kill('soft');
    expect(character.bag).toHaveLength(12);
    expect(events).toContainEqual({ type: 'bagFull', characterId: 'c1', itemId: SWORD, qty: 1 });
  });

  it('a stack that only partly fits is picked up in part, and the rest reports bagFull', () => {
    const { character, events, kill } = harness();
    character.bag = [...Array.from({ length: 11 }, () => stack(SWORD)), stack(CAP), stack(CAP)]; // 1 cell free
    kill('bundle');
    expect(character.bag.slice(-1)[0]?.qty).toBe(20);
    expect(events).toContainEqual({ type: 'itemPickedUp', characterId: 'c1', itemId: SCRAP, qty: 20, bonuses: [] });
    expect(events).toContainEqual({ type: 'bagFull', characterId: 'c1', itemId: SCRAP, qty: 25 });
  });

  it('a loot filter leaves an item behind without a bagFull', () => {
    const { character, events, kill } = harness(withAutomation(fixture()));
    character.settings.lootFilter = { enabled: true, rules: [{ category: 'consumable' }] };
    kill('soft');
    expect(character.bag).toEqual([]);
    expect(events.some((e) => e.type === 'itemPickedUp' || e.type === 'bagFull')).toBe(false);
    character.settings.lootFilter = { enabled: true, rules: [{ category: 'equipment' }] };
    kill('soft');
    expect(character.bag).toEqual([stack(SWORD)]);
  });

  it('rolls at most 3 bonus attributes, however many the item could give', () => {
    const { character, kill } = harness();
    kill('lucky');
    const ring = character.bag[0];
    expect(ring?.itemId).toBe('lucky-ring');
    expect(ring?.bonuses.map((b) => b.attribute)).toEqual(['strength', 'dexterity', 'vitality']);
    for (const b of ring?.bonuses ?? []) {
      expect(b.value).toBeGreaterThanOrEqual(1);
      expect(b.value).toBeLessThanOrEqual(2);
    }
  });

  it('the drops stream takes the same draws whatever the level, the bag or the filter', () => {
    const variants: ((h: ReturnType<typeof harness>) => void)[] = [
      () => {},
      (h) => {
        h.character.level = 11; // modifier 0
      },
      (h) => fullOfSwords(h.character),
      (h) => {
        h.character.settings.lootFilter = { enabled: true, rules: [] };
      },
    ];
    for (const enemyId of ['soft', 'lucky', 'mini']) {
      const states = new Set<string>();
      for (const prepare of variants) {
        const h = harness(fixture(), 99);
        prepare(h);
        h.kill(enemyId, 3);
        states.add(JSON.stringify(h.streams.drops.getState()));
      }
      expect(states.size, enemyId).toBe(1);
    }
  });

  it('the same seed gives the same loot', () => {
    const run = (): ItemStack[] => {
      const h = harness(fixture(), 5);
      h.kill('lucky', 3);
      h.kill('mini', 5);
      return h.character.bag;
    };
    expect(run()).toEqual(run());
  });
});
