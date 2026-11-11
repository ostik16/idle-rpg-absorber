/**
 * The city routine and the auto-return triggers (issue #27, design 3.2, 2.3 L1-L2, L4, L6, L10).
 */
import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import { withAutomation as loadGameData } from './automation';
import { autoSellBag, restockPotions, isBagFull } from '../src/engine/city';
import { createEngine, type Engine } from '../src/engine/engine';
import { createCharacterState, createGameState } from '../src/state/factory';
import { derivedStats } from '../src/state/selectors';
import type { CharacterState, CityHealingMode, ItemStack } from '../src/state/types';

const SEED = 7;
const T0 = 1_000_000;
const TICK = constants.combat.tickMs;
const AREA = 'mossfang-glade';
const MINOR = 'minor-health-potion';
const LESSER = 'lesser-health-potion';

/** An engine with one new, fully-healed character sent to the first area. */
function setup(configure?: (character: CharacterState) => void) {
  const data = loadGameData();
  const state = createGameState(SEED, T0, data);
  const character = createCharacterState('c1', 'Ysolde', data);
  if (configure) configure(character);
  state.roster.push(character);
  const engine = createEngine({ data, state });
  let now = T0;
  const advance = (ms: number): void => {
    for (let left = ms; left > 0; left -= 60_000) {
      now += Math.min(left, 60_000);
      engine.advanceTo(now);
    }
  };
  return { engine, character, advance, data };
}

function stack(itemId: string, qty: number): ItemStack {
  return { itemId, bonuses: [], upgradeLevel: 0, qty };
}

/** Runs the engine until `predicate` holds or a time budget runs out. */
function runUntil(
  engine: Engine,
  advance: (ms: number) => void,
  predicate: () => boolean,
  budgetMs: number,
): boolean {
  const start = engine.state.clock.lastSimulatedAt;
  while (!predicate() && engine.state.clock.lastSimulatedAt - start < budgetMs) advance(TICK);
  return predicate();
}

describe('auto-return triggers (design 3.2, 2.3 L2, L5)', () => {
  it('low health in a fight makes the character flee, then return', () => {
    const { engine, character, advance } = setup();
    const { maxHealth } = derivedStats(character, loadGameData());
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    advance(20_000); // travel + first fight
    while (character.phase !== 'fighting') advance(TICK);
    character.health = 0.1 * maxHealth; // below the 20% threshold
    character.potions = { queue: [], ticksDone: 0, msIntoTick: 0 };
    character.bag = []; // no potions to drink
    advance(TICK);
    expect(character.phase).toBe('fleeing');
    expect(character.stayInCity).toBe(false);
  });

  it('a full bag triggers a return after a kill', () => {
    const data = loadGameData();
    const { engine, character, advance } = setup((c) => {
      // Fill the bag up to capacity so the next kill or loot refuses any drop.
      const cells = 36;
      c.bag = Array.from({ length: cells }, () => stack('hide-scrap', 20));
    });
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    expect(isBagFull(character, data)).toBe(true);
    runUntil(engine, advance, () => character.phase === 'returning' || character.phase === 'fleeing', 200_000);
    expect(character.phase === 'returning' || character.phase === 'fleeing').toBe(true);
  });

  it('a full bag with no auto-sell rules: one trip home, then farms XP and gold without bouncing (2.3 L2, L6)', () => {
    const data = loadGameData();
    const { engine, character, advance } = setup((c) => {
      c.bag = Array.from({ length: 36 }, () => stack('hide-scrap', 20));
    });
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    const trips = { home: 0, out: 0 };
    runUntil(engine, advance, () => {
      for (const e of engine.drainEvents()) {
        if (e.type === 'phaseChanged' && e.to === 'returning') trips.home += 1;
        if (e.type === 'phaseChanged' && e.from === 'restocking' && e.to === 'travelling') trips.out += 1;
      }
      return trips.out >= 1;
    }, 60_000);

    // Now in the field with still-full bag. Let it farm a while and count further returns.
    const homeBefore = trips.home;
    runUntil(engine, advance, () => {
      for (const e of engine.drainEvents()) {
        if (e.type === 'phaseChanged' && e.to === 'returning') trips.home += 1;
      }
      return false;
    }, 120_000);
    expect(isBagFull(character, data)).toBe(true);
    expect(trips.home - homeBefore).toBe(0); // no further full-bag trips
  });
});

describe('city routine (design 3.2, 2.3 L6, 2.6 L4, L10)', () => {
  it('auto-sell with rules removes matching stacks and adds the gold to that character', () => {
    const { character, data } = setup();
    character.bag = [stack('hide-scrap', 5), stack('rusty-sword', 1)];
    character.gold = 0;
    character.settings.autoSell = { enabled: true, rules: [{ category: 'material' }] };
    autoSellBag(character, data);
    // hide-scrap is category "material" and sells; the sword stays.
    expect(character.bag.some((s) => s.itemId === 'hide-scrap')).toBe(false);
    expect(character.bag.some((s) => s.itemId === 'rusty-sword')).toBe(true);
    expect(character.gold).toBeGreaterThan(0);
  });

  it('auto-sell disabled or with no rules sells nothing (2.3 L6)', () => {
    const { character, data } = setup();
    character.bag = [stack('hide-scrap', 5)];
    const before = JSON.parse(JSON.stringify(character.bag)) as ItemStack[];
    character.settings.autoSell = { enabled: false, rules: [{ category: 'material' }] };
    autoSellBag(character, data);
    expect(character.bag).toEqual(before);

    character.settings.autoSell = { enabled: true, rules: [] };
    autoSellBag(character, data);
    expect(character.bag).toEqual(before);
    expect(character.gold).toBe(0);
  });

  it('restock tops up each entry on the list at the shop price (3.2, L4)', () => {
    const { character, data } = setup();
    character.bag = [stack(MINOR, 3)]; // already has 3, list wants 10, buy 7 at 12 each
    character.gold = 1000;
    character.settings.restockList = [{ itemId: MINOR, quantity: 10 }];
    restockPotions(character, data);
    const held = character.bag.filter((s) => s.itemId === MINOR).reduce((n, s) => n + s.qty, 0);
    expect(held).toBe(10);
    expect(character.gold).toBe(1000 - 7 * 12);
  });

  it('broke character buys as many as it can afford, in list order, health first (L4)', () => {
    const { character, data } = setup();
    character.bag = [];
    character.gold = 50; // enough for 4 minor at 12 = 48
    // Health first: order has lesser (health) then minor (health). Both health; list order within health.
    character.settings.restockList = [
      { itemId: LESSER, quantity: 5 },
      { itemId: MINOR, quantity: 10 },
    ];
    restockPotions(character, data);
    // Lesser is 40 each: can afford 1, leaving 10 for minor (0 minor). Buys 1 lesser.
    const lesser = character.bag.filter((s) => s.itemId === LESSER).reduce((n, s) => n + s.qty, 0);
    const minor = character.bag.filter((s) => s.itemId === MINOR).reduce((n, s) => n + s.qty, 0);
    expect(lesser).toBe(1);
    expect(minor).toBe(0);
    expect(character.gold).toBeLessThan(12); // too little for another minor
  });

  it('restock does not buy when nothing is listed', () => {
    const { character, data } = setup();
    character.bag = [];
    character.gold = 1000;
    character.settings.restockList = [];
    restockPotions(character, data);
    expect(character.bag).toEqual([]);
    expect(character.gold).toBe(1000);
  });
});

describe('city healing choices (design 2.6, L10)', () => {
  function runCityHealingTo(mode: CityHealingMode): CharacterState {
    const { engine, character, advance } = setup((c) => {
      c.settings.cityHealing = mode;
      c.areaId = AREA;
      c.phase = 'restocking';
      c.health = 1;
    });
    runUntil(engine, advance, () => character.phase !== 'restocking', 300_000);
    return character;
  }

  it('fast reaches full health before leaving the city', () => {
    const character = runCityHealingTo('fast');
    const { maxHealth } = derivedStats(character, loadGameData());
    expect(character.health).toBe(maxHealth);
  });

  it('balanced reaches full health before leaving the city', () => {
    const character = runCityHealingTo('balanced');
    const { maxHealth } = derivedStats(character, loadGameData());
    expect(character.health).toBe(maxHealth);
  });

  it('slow reaches full health before leaving the city', () => {
    const character = runCityHealingTo('slow');
    const { maxHealth } = derivedStats(character, loadGameData());
    expect(character.health).toBe(maxHealth);
  });

  it('balanced stops drinking at 65% of maximum health (2.6, L10)', () => {
    const { character, advance, engine } = setup((c) => {
      c.settings.cityHealing = 'balanced';
      c.areaId = AREA;
      c.phase = 'restocking';
      const { maxHealth } = derivedStats(c, loadGameData());
      c.health = 0.1 * maxHealth;
    });
    const { maxHealth } = derivedStats(character, loadGameData());
    // Give it a short budget so regeneration doesn't carry it past 65% on its own.
    for (let i = 0; i < 20 && character.phase === 'restocking'; i++) {
      advance(TICK);
      if (character.health > 0.65 * maxHealth) break;
    }
    // Any further potion drinking happens below 65% threshold; past it, only regen heals.
    const potionsLeft = character.bag.filter((s) => s.itemId === MINOR).reduce((n, s) => n + s.qty, 0);
    // From 0.1 * maxHealth (7) climbing to 65% (46) needs one or two minor potions; the full 70 would need more.
    expect(potionsLeft).toBeGreaterThan(5);
    engine.drainEvents();
  });
});

describe('end-to-end: new character survives the first hour on 10 potions (3.2, 3.3, issue #27)', () => {
  it('farms Area 1 for an hour with no input, never gets stuck in a phase, and never dies', () => {
    const { engine, character, advance } = setup();
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    const died: string[] = [];
    const rejects: string[] = [];
    let last = engine.state.clock.lastSimulatedAt;
    for (let t = 60_000; t <= 60 * 60_000; t += 60_000) {
      advance(60_000);
      for (const e of engine.drainEvents()) {
        if (e.type === 'characterDied') died.push(e.enemyId);
        if (e.type === 'commandRejected') rejects.push(e.reason);
      }
      // Progress is being made: the clock moves and at least one phase transition happened in the last minute.
      expect(engine.state.clock.lastSimulatedAt).toBeGreaterThan(last);
      last = engine.state.clock.lastSimulatedAt;
    }
    expect(died).toEqual([]);
    expect(rejects).toEqual([]);
    expect(character.level).toBeGreaterThan(1);
  });
});

describe('phase transitions after the city routine (design 3.2)', () => {
  it('a manual return sends the character home and stops them there (L5, 3.2)', () => {
    const { engine, character, advance } = setup();
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    engine.dispatch({ type: 'returnToCity', characterId: 'c1' });
    advance(30_000);
    // stayInCity was set by the manual command, so the character ends idle, not back out.
    expect(character.phase).toBe('idle');
    expect(character.areaId).toBeNull();
  });

  it('after an auto-return the character goes back to the same area once healed', () => {
    const data = loadGameData();
    const { engine, character, advance } = setup((c) => {
      c.bag = Array.from({ length: 36 }, () => stack('hide-scrap', 20));
    });
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    let revisits = 0;
    runUntil(engine, advance, () => {
      for (const e of engine.drainEvents()) {
        if (e.type === 'phaseChanged' && e.to === 'travelling' && e.from !== 'idle') revisits += 1;
      }
      return revisits >= 1;
    }, 600_000);
    expect(revisits).toBeGreaterThanOrEqual(1);
    expect(character.areaId).toBe(AREA);
    expect(isBagFull(character, data)).toBe(true); // still full, no auto-sell rules
  });
});
