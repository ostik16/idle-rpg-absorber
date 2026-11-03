import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import { constantSection, createGameData, loadGameData, type GameData } from '../src/data/game-data';
import { createEngine, type Engine } from '../src/engine/engine';
import { createCharacterState, createGameState } from '../src/state/factory';
import { derivedStats } from '../src/state/selectors';
import type { CharacterState, GameState } from '../src/state/types';

const T0 = 1_000_000;
const TICK = constants.combat.tickMs;
const data = loadGameData();

function newEngine(fixture: GameData = data): Engine {
  return createEngine({ data: fixture, state: createGameState(7, T0, fixture) });
}

/** Runs one step, so the queued commands are applied. Returns the events. */
function step(engine: Engine) {
  engine.advanceTo(engine.state.clock.lastSimulatedAt + TICK);
  return engine.drainEvents();
}

function create(engine: Engine, name: string) {
  engine.dispatch({ type: 'createCharacter', name });
  return step(engine);
}

describe('a new character (design 4.1)', () => {
  const character = createCharacterState('c1', 'Ysolde', data);

  it('has the 4.1 example stats: 6 damage unarmed, 0.9 attacks per second, 70 health', () => {
    const stats = derivedStats(character, data);
    expect(stats.damage).toBeCloseTo(6);
    expect(stats.attacksPerSecond).toBeCloseTo(0.9);
    expect(stats.maxHealth).toBeCloseTo(70);
  });

  it('has the rest of the 4.2 stats at attributes of 5', () => {
    const stats = derivedStats(character, data);
    expect(stats.defence).toBeCloseTo(1.25);
    expect(stats.critChance).toBeCloseTo(0.03);
    expect(stats.maxMana).toBeCloseTo(40);
    expect(stats.spellDamageMultiplier).toBeCloseTo(1.1);
    expect(stats.movementSpeed).toBe(1);
    expect(stats.attackIntervalMs).toBe(1100);
  });

  it('starts at full health and mana', () => {
    const stats = derivedStats(character, data);
    expect(character.health).toBe(stats.maxHealth);
    expect(character.mana).toBe(stats.maxMana);
  });

  it('is level 1 with 0 gold, attributes of 5, no gear, and only 10 minor health potions', () => {
    expect(character).toMatchObject({
      gold: 0,
      level: 1,
      xpInLevel: 0,
      attributes: { strength: 5, dexterity: 5, vitality: 5, intelligence: 5 },
      equipment: {},
      phase: 'idle',
      areaId: null,
      targetEnemyId: null,
    });
    expect(character.bag).toEqual([{ itemId: 'minor-health-potion', bonuses: [], upgradeLevel: 0, qty: 10 }]);
  });

  it('has every proficiency at 0 and nothing absorbed', () => {
    expect(character.proficiency).toEqual({
      unarmed: 0,
      'one-handed': 0,
      'two-handed': 0,
      toughness: 0,
      speed: 0,
      combat: 0,
    });
    expect(character.absorption).toEqual({});
  });

  it('has the default settings (decisions L1, L4, L6, L8, L10)', () => {
    expect(character.settings).toEqual({
      returnHealthThreshold: 0.2,
      restockList: [{ itemId: 'minor-health-potion', quantity: 10 }],
      cityHealing: 'balanced',
      potionThresholds: {},
      lootFilter: { enabled: false, rules: [] },
      autoSell: { enabled: false, rules: [] },
    });
  });

  it('does not share its restock list with the data or another character', () => {
    const other = createCharacterState('c2', 'Brann', data);
    other.settings.restockList[0]!.quantity = 1;
    expect(character.settings.restockList[0]?.quantity).toBe(10);
  });
});

describe('derived stats follow the state (design 4.2, 4.6)', () => {
  function withChange(change: (character: CharacterState) => void) {
    const character = createCharacterState('c1', 'Ysolde', data);
    change(character);
    return derivedStats(character, data);
  }

  it('strength raises damage, vitality raises health and defence', () => {
    expect(withChange((c) => void (c.attributes.strength = 10)).damage).toBeCloseTo(9);
    const tough = withChange((c) => void (c.attributes.vitality = 10));
    expect(tough.maxHealth).toBeCloseTo(110);
    expect(tough.defence).toBeCloseTo(2.5);
  });

  it('proficiency adds its bonus: unarmed to damage, toughness to health, speed to movement', () => {
    const { effectPerPoint: e } = constants.proficiency;
    expect(withChange((c) => void (c.proficiency.unarmed = 50)).damage).toBeCloseTo(6 * (1 + 50 * e.unarmed));
    expect(withChange((c) => void (c.proficiency.toughness = 50)).maxHealth).toBeCloseTo(70 * (1 + 50 * e.toughness));
    expect(withChange((c) => void (c.proficiency.speed = 50)).movementSpeed).toBeCloseTo(1 + 50 * e.speed);
  });

  it('the unarmed and combat skills add attack speed', () => {
    const { attackSpeedPerPoint: s } = constants.proficiency;
    const stats = withChange((c) => {
      c.proficiency.unarmed = 20;
      c.proficiency.combat = 30;
    });
    expect(stats.attacksPerSecond).toBeCloseTo(0.9 * (1 + 20 * s.unarmed + 30 * s.combat));
  });
});

describe('a new game (design 2.4, 4.1)', () => {
  const state = createGameState(7, T0, data);

  it('has 1 unlocked slot, an empty roster, and no gold on the account', () => {
    expect(state.account.unlockedSlots).toBe(1);
    expect(state.roster).toEqual([]);
    expect(state.account).not.toHaveProperty('gold');
  });

  it('has 1 empty warehouse tab of 56 cells', () => {
    expect(state.account.warehouse.tabs).toEqual([{ cells: 56, items: [] }]);
  });
});

describe('the createCharacter command (design 4.1)', () => {
  function withSlots(engine: Engine, slots: number): Engine {
    engine.state.account.unlockedSlots = slots;
    return engine;
  }

  it('creates a character with an id from the engine', () => {
    const engine = newEngine();
    expect(create(engine, 'Ysolde')).toEqual([{ type: 'characterCreated', characterId: 'c1' }]);
    expect(engine.state.roster.map((c) => [c.id, c.name])).toEqual([['c1', 'Ysolde']]);
  });

  it('trims the name before it stores it', () => {
    const engine = newEngine();
    create(engine, '  Ysolde  ');
    expect(engine.state.roster[0]?.name).toBe('Ysolde');
  });

  it.each([
    ['one character', 'Y'],
    ['16 characters', 'Y'.repeat(16)],
    ['16 characters after trimming', ` ${'Y'.repeat(16)} `],
  ])('accepts a name of %s', (_label, name) => {
    const engine = newEngine();
    create(engine, name);
    expect(engine.state.roster).toHaveLength(1);
  });

  it.each([
    ['empty', '', 'Enter a name.'],
    ['only spaces', '   ', 'Enter a name.'],
    ['17 characters', 'Y'.repeat(17), 'Use 16 characters or fewer.'],
  ])('refuses a name that is %s', (_label, name, reason) => {
    const engine = newEngine();
    const before = structuredClone(engine.state);
    const command = { type: 'createCharacter', name } as const;
    expect(create(engine, name)).toEqual([{ type: 'commandRejected', command, reason }]);
    expect(engine.state.roster).toEqual(before.roster);
    expect(engine.state.account).toEqual(before.account);
  });

  it.each(['Ysolde', 'YSOLDE', 'ysolde', '  ySoLdE '])('refuses %j as a duplicate of Ysolde', (name) => {
    const engine = withSlots(newEngine(), 2);
    create(engine, 'Ysolde');
    const command = { type: 'createCharacter', name } as const;

    expect(create(engine, name)).toEqual([
      { type: 'commandRejected', command, reason: 'Another character already has that name.' },
    ]);
    expect(engine.state.roster).toHaveLength(1);
  });

  it('refuses a character when every unlocked slot is taken, and names the ticket level', () => {
    const engine = newEngine();
    create(engine, 'Ysolde');
    const before = structuredClone(engine.state.account);

    const command = { type: 'createCharacter', name: 'Brann' } as const;
    expect(create(engine, 'Brann')).toEqual([
      { type: 'commandRejected', command, reason: 'No free slot. A character earns a slot ticket at Lv 20.' },
    ]);
    expect(engine.state.roster).toHaveLength(1);
    expect(engine.state.account).toEqual(before);
  });

  it('accepts a character once another slot is unlocked', () => {
    const engine = newEngine();
    create(engine, 'Ysolde');
    withSlots(engine, 2);
    expect(create(engine, 'Brann')).toEqual([{ type: 'characterCreated', characterId: 'c2' }]);
  });

  it('never reuses an id, even after a character leaves the roster', () => {
    const engine = withSlots(newEngine(), 2);
    create(engine, 'Ysolde');
    engine.state.roster.pop();
    expect(create(engine, 'Brann')).toEqual([{ type: 'characterCreated', characterId: 'c2' }]);
  });
});

describe('the state is plain data (ADR 0003)', () => {
  function expectRoundTrip(state: GameState): void {
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  }

  it('a new game round-trips through JSON unchanged', () => {
    expectRoundTrip(createGameState(7, T0, data));
  });

  it('a game with a character, after some steps, round-trips through JSON unchanged', () => {
    const engine = newEngine();
    create(engine, 'Ysolde');
    engine.advanceTo(engine.state.clock.lastSimulatedAt + 50 * TICK);
    expectRoundTrip(engine.state);
  });

  it('a restored game carries on the same', () => {
    const first = newEngine();
    create(first, 'Ysolde');
    const saved = JSON.parse(JSON.stringify(first.state)) as GameState;
    const second = createEngine({ data, state: saved });

    const later = first.state.clock.lastSimulatedAt + 20 * TICK;
    first.advanceTo(later);
    second.advanceTo(later);
    expect(second.state).toEqual(first.state);
  });
});

describe('starting values come from the data (design 5.1)', () => {
  const changed = createGameData({
    constants: {
      ...constants,
      creation: {
        ...constants.creation,
        baseAttributes: { strength: 7, dexterity: 8, vitality: 9, intelligence: 10 },
        nameMaxLength: 3,
        startingLevel: 2,
        startingGold: 55,
        startingEquipment: { 'main-hand': 'rusty-sword' },
        startingItems: [{ itemId: 'lesser-health-potion', quantity: 4 }],
      },
      characters: { ...constants.characters, startingUnlockedSlots: 3 },
      storage: { ...constants.storage, startingTabs: 2, cellsPerTab: 11 },
      returnTriggers: { healthThreshold: 0.5 },
      restock: { defaultList: [{ itemId: 'lesser-health-potion', quantity: 2 }] },
      cityHealing: { ...constants.cityHealing, defaultMode: 'slow' },
      stats: { ...constants.stats, health: { base: 100, perVitality: 1 } },
    },
  });

  it('a character takes every starting value from the constants', () => {
    const character = createCharacterState('c1', 'Abe', changed);
    expect(character).toMatchObject({
      gold: 55,
      level: 2,
      attributes: { strength: 7, dexterity: 8, vitality: 9, intelligence: 10 },
      equipment: { 'main-hand': { itemId: 'rusty-sword', bonuses: [], upgradeLevel: 0, qty: 1 } },
      bag: [{ itemId: 'lesser-health-potion', bonuses: [], upgradeLevel: 0, qty: 4 }],
      health: 109,
      settings: {
        returnHealthThreshold: 0.5,
        restockList: [{ itemId: 'lesser-health-potion', quantity: 2 }],
        cityHealing: 'slow',
      },
    });
  });

  it('a new game takes its slots and warehouse from the constants', () => {
    const { account } = createGameState(7, T0, changed);
    expect(account.unlockedSlots).toBe(3);
    expect(account.warehouse.tabs).toEqual([
      { cells: 11, items: [] },
      { cells: 11, items: [] },
    ]);
  });

  it('the command takes the name length and ticket level from the constants', () => {
    const engine = newEngine(changed);
    expect(create(engine, 'Abcd')[0]).toMatchObject({ reason: 'Use 3 characters or fewer.' });
    expect(create(engine, 'Abc')[0]).toMatchObject({ type: 'characterCreated' });
  });
});

describe('constantSection', () => {
  it('returns a section of the constants', () => {
    expect(constantSection(data, 'characters').maxSlots).toBe(constants.characters.maxSlots);
  });

  it('names a missing or undecided section', () => {
    expect(() => constantSection(createGameData({ constants: {} }), 'stats')).toThrow(/"stats" is missing/);
    expect(() => constantSection(createGameData({ constants: { stats: null } }), 'stats')).toThrow(/"stats" is null/);
  });
});
