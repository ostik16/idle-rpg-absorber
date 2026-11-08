import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import enemiesJson from '../data/enemies.json';
import dropTablesJson from '../data/drop-tables.json';
import itemsJson from '../data/items.json';
import xpTableJson from '../data/xp-table.json';
import { createGameData, loadGameData, requireRow, type GameData } from '../src/data/game-data';
import { stepCharacter, type StepContext } from '../src/engine/character';
import { createEngine } from '../src/engine/engine';
import type { EngineEvent } from '../src/engine/events';
import { fleeDurationMs, startFight, startFleeing } from '../src/engine/fight';
import { drinkPotion } from '../src/engine/healing';
import { createCharacterStreams } from '../src/engine/streams';
import { enemyCombatant, fightTick, type Combatant } from '../src/game/combat';
import { quantiseToSteps } from '../src/game/formulas';
import { chooseAutoPotion, pendingHeal } from '../src/game/potions';
import { createRng, createStream } from '../src/game/rng';
import { createCharacterState, createGameState } from '../src/state/factory';
import { derivedStats } from '../src/state/selectors';
import type { CharacterState, GameState } from '../src/state/types';
import { buildPlayer, defaultBuild, enemyFromData, runFights } from '../tools/balance/combat';

const TICK = constants.combat.tickMs;
const SEED = 7;
const MINOR = 'minor-health-potion';
const LESSER = 'lesser-health-potion';

const DUMMY = { id: 'dummy', level: 1, health: 24, damage: 5, attackSpeed: 1, defence: 0 };
const WALL = { id: 'wall', level: 1, health: 1_000_000, damage: 5, attackSpeed: 1, defence: 0 };
const HARMLESS = { id: 'harmless', level: 1, health: 1_000_000, damage: 0, attackSpeed: 0.01, defence: 1_000_000 };

/** The real constants and items with made-up enemies. `crit` and `regen` off make the numbers exact. */
function fixture(o: { crit?: boolean; regen?: boolean } = {}): GameData {
  const stats = {
    ...constants.stats,
    ...(o.crit === false ? { critChance: { base: 0, perDexterity: 0, cap: 0 } } : {}),
    ...(o.regen === false ? { healthRegen: { fractionOfMaxPerSecond: 0 } } : {}),
  };
  return createGameData({
    constants: {
      ...constants,
      stats,
      progression: { ...constants.progression, attributesPerLevel: { strength: 0, dexterity: 0, vitality: 0, intelligence: 0 } },
      proficiency: { ...constants.proficiency, gainPerAction: { unarmed: 0, 'one-handed': 0, 'two-handed': 0, toughness: 0, speed: 0, combat: 0 } },
    },
    items: itemsJson,
    dropTables: dropTablesJson,
    enemies: [DUMMY, WALL, HARMLESS, ...enemiesJson],
    xpTable: xpTableJson,
  });
}

const EXACT = fixture({ crit: false, regen: false });

function harness(data: GameData = EXACT, id = 'c1') {
  const character = createCharacterState(id, 'Ysolde', data);
  const events: EngineEvent[] = [];
  const ctx: StepContext = {
    data,
    tickMs: TICK,
    streams: createCharacterStreams(SEED, id),
    emit: (event) => void events.push(event),
  };
  const run = (steps: number): void => {
    for (let i = 0; i < steps; i++) stepCharacter(character, ctx);
  };
  return { character, ctx, events, run };
}

function setBag(character: CharacterState, ...stacks: [string, number][]): void {
  character.bag = stacks.map(([itemId, qty]) => ({ itemId, bonuses: [], upgradeLevel: 0, qty }));
}

function potionCount(character: CharacterState, itemId: string): number {
  return character.bag.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.qty, 0);
}

describe('quantiseToSteps (ADR 0002)', () => {
  it('rounds to the nearest whole step, at least one', () => {
    expect(quantiseToSteps(1000, 100)).toBe(1000);
    expect(quantiseToSteps(1049, 100)).toBe(1000);
    expect(quantiseToSteps(1050, 100)).toBe(1100);
    expect(quantiseToSteps(1, 100)).toBe(100);
    expect(quantiseToSteps(0, 100)).toBe(100);
  });
});

describe('fightTick (3.6)', () => {
  const player: Combatant = { maxHp: 70, damage: 6, defence: 1.25, critChance: 0, intervalMs: 1000 };
  const enemy: Combatant = { maxHp: 24, damage: 5, defence: 0, critChance: 0, intervalMs: 500 };
  const at = (tick: number, o: { playerHp?: number; enemyHp?: number; playerAttacks?: boolean } = {}) =>
    fightTick({ tick, playerHp: 70, enemyHp: 24, player, enemy, rng: createRng(1), tickMs: 100, playerAttacks: true, ...o });

  it('attacks only on whole intervals', () => {
    expect(at(4)).toMatchObject({ playerHit: false, enemyHit: false, playerHp: 70, enemyHp: 24, outcome: null });
    expect(at(5)).toMatchObject({ playerHit: false, enemyHit: true, playerHp: 66.25, enemyHp: 24 });
    expect(at(10)).toMatchObject({ playerHit: true, enemyHit: true, playerHp: 66.25, enemyHp: 18 });
  });

  it('the player acts first, so an enemy killed on the tick does not strike back', () => {
    expect(at(10, { enemyHp: 6 })).toMatchObject({ outcome: 'win', enemyHit: false, playerHp: 70, enemyHp: 0 });
  });

  it('reports a loss when the blow takes the last health', () => {
    expect(at(5, { playerHp: 2 })).toMatchObject({ outcome: 'loss', playerHp: -1.75 });
  });

  it('a fleeing player does not attack, and the enemy still does', () => {
    expect(at(10, { playerAttacks: false })).toMatchObject({ playerHit: false, enemyHit: true, enemyHp: 24 });
  });

  it('a critical hit doubles the damage after defence (N3)', () => {
    const r = fightTick({
      tick: 10,
      playerHp: 70,
      enemyHp: 24,
      player: { ...player, critChance: 1 },
      enemy: { ...enemy, defence: 2 },
      rng: createRng(1),
      tickMs: 100,
      playerAttacks: true,
    });
    expect(r).toMatchObject({ playerCrit: true, enemyHp: 24 - (6 - 2) * 2 });
  });

  it('builds an enemy from its table row', () => {
    expect(enemyCombatant(DUMMY, 100)).toEqual({ maxHp: 24, damage: 5, defence: 0, critChance: 0, intervalMs: 1000 });
  });
});

describe('a fight on engine steps (3.5, 3.6)', () => {
  it('the 3.5 check: a new character hits for 6 and kills a 24-health enemy in 4 hits', () => {
    const { character, ctx, events, run } = harness();
    startFight(character, 'dummy', ctx);
    const interval = derivedStats(character, EXACT).attackIntervalMs / TICK; // 0.9 per second: 11 ticks

    run(interval);
    expect(character.fight?.enemyHp).toBe(18);
    run(interval * 2);
    expect(character.fight?.enemyHp).toBe(6);
    expect(character.phase).toBe('fighting');

    run(interval);
    expect(character.fight).toBeNull();
    expect(character.phase).toBe('looting');
    expect(events).toContainEqual({ type: 'enemyKilled', characterId: 'c1', enemyId: 'dummy' });
    expect(interval * 4 * TICK).toBe(4400); // about 4 seconds, as 3.5 says
  });

  it('takes the 3.5 damage: about 3.75 per enemy hit after 1.25 defence', () => {
    const { character, ctx, run } = harness();
    startFight(character, 'dummy', ctx);
    run(10); // the enemy attacks once per second
    expect(character.health).toBeCloseTo(70 - 3.75);
  });

  it('mean time to kill matches the balance tools for the same build and seed', () => {
    const data = fixture({ regen: false });
    const enemyId = 'glade-rat';
    const fights = 500;
    const { character, ctx } = harness(data);

    const times: number[] = [];
    for (let i = 0; i < fights; i++) {
      character.health = derivedStats(character, data).maxHealth;
      startFight(character, enemyId, ctx);
      let steps = 0;
      while (character.phase === 'fighting') {
        stepCharacter(character, ctx);
        steps++;
      }
      expect(character.phase).toBe('looting');
      times.push((steps * TICK) / 1000);
    }

    const tool = runFights(
      buildPlayer(defaultBuild()),
      enemyFromData(requireRow(data, 'enemies', enemyId) as never),
      fights,
      createStream(SEED, 'c1', 'combat'),
    );
    expect(times.reduce((a, b) => a + b, 0) / fights).toBeCloseTo(tool.timeToKill?.mean ?? NaN, 10);
    expect(Math.max(...times)).toBe(tool.timeToKill?.max);
  });

  it('a character whose health runs out dies, with no reward', () => {
    const { character, ctx, events, run } = harness();
    setBag(character);
    character.health = 3;
    startFight(character, 'wall', ctx);
    run(10);

    expect(character).toMatchObject({ phase: 'dead', health: 0, fight: null });
    expect(events).toContainEqual({ type: 'characterDied', characterId: 'c1', enemyId: 'wall' });
    expect(events.some((e) => e.type === 'enemyKilled')).toBe(false);
  });

  it('dying clears the running and queued potions, and a dead character does not heal', () => {
    const { character, ctx, run } = harness(fixture({ crit: false }));
    setBag(character);
    character.health = 1;
    drinkPotion(character, MINOR);
    drinkPotion(character, MINOR);
    startFight(character, 'wall', ctx);
    run(10);

    expect(character.phase).toBe('dead');
    expect(character.potions).toEqual({ queue: [], ticksDone: 0, msIntoTick: 0 });
    run(39); // level 1 respawns after 4 s
    expect(character.health).toBe(0);
  });

  it('names an enemy that is not in the table', () => {
    const { character, ctx } = harness();
    expect(() => startFight(character, 'nobody', ctx)).toThrow(/"nobody" in the enemies table/);
  });
});

describe('regeneration (T10)', () => {
  const data = fixture({ crit: false });

  it('heals 0.5% of maximum health per second, out of combat', () => {
    const { character, run } = harness(data);
    character.health = 10;
    run(10);
    expect(character.health).toBeCloseTo(10 + 0.35);
  });

  it('heals during a fight too', () => {
    const { character, ctx, run } = harness(data);
    setBag(character);
    character.health = 50;
    startFight(character, 'harmless', ctx);
    run(100);
    expect(character.health).toBeCloseTo(50 + 3.5);
  });

  it('stops at maximum health', () => {
    const { character, run } = harness(data);
    character.health = 69.99;
    run(50);
    expect(character.health).toBe(70);
  });

  it('heals from 10% to full in 180 s, as 3.7 says', () => {
    const { character, run } = harness(data);
    character.health = 7;
    run(1799);
    expect(character.health).toBeLessThan(70);
    run(2);
    expect(character.health).toBe(70);
  });
});

describe('potions (2.6, N11)', () => {
  it('heals evenly in 500 ms ticks: a minor potion gives 2 health every 500 ms for 10 s', () => {
    const { character, run } = harness();
    character.health = 10;
    drinkPotion(character, MINOR);

    run(4);
    expect(character.health).toBe(10);
    run(1);
    expect(character.health).toBe(12);
    run(5);
    expect(character.health).toBe(14);
    run(90);
    expect(character.health).toBe(50);
    expect(character.potions.queue).toEqual([]);
    run(50);
    expect(character.health).toBe(50);
  });

  it('a second potion queues: it starts when the first ends, and the effects do not add up', () => {
    const { character, run } = harness();
    character.health = 1;
    drinkPotion(character, MINOR);
    run(50);
    drinkPotion(character, LESSER);
    expect(character.potions.queue).toEqual([MINOR, LESSER]);
    run(50);
    expect(character.health).toBeCloseTo(41); // only the minor potion has healed
    expect(character.potions.queue).toEqual([LESSER]);
    run(5);
    expect(character.health).toBeCloseTo(41 + 120 / 18); // lesser: 120 over 18 ticks
  });

  it('stops at maximum health', () => {
    const { character, run } = harness();
    character.health = 65;
    drinkPotion(character, MINOR);
    run(100);
    expect(character.health).toBe(70);
  });

  it('pendingHeal counts what is left of the running potion and all of the queued ones', () => {
    const minor = { amount: 40, durationSeconds: 10 };
    const lesser = { amount: 120, durationSeconds: 9 };
    expect(pendingHeal([], 0, 500)).toBe(0);
    expect(pendingHeal([minor], 0, 500)).toBe(40);
    expect(pendingHeal([minor], 5, 500)).toBe(30);
    expect(pendingHeal([minor, lesser], 5, 500)).toBe(150);
  });
});

describe('chooseAutoPotion (L9)', () => {
  const minor = { itemId: 'minor', amount: 40, threshold: 0.4 };
  const lesser = { itemId: 'lesser', amount: 120, threshold: 0.4 };

  it('drinks nothing when the potion would be wasted and health is above the threshold', () => {
    expect(chooseAutoPotion(60, 70, 0, [minor])).toBeNull();
    expect(chooseAutoPotion(30, 70, 0, [minor])).toBeNull(); // missing exactly 40 is not greater than 40
  });

  it('drinks when missing health is greater than what the potion heals', () => {
    expect(chooseAutoPotion(150, 200, 0, [minor])).toBe('minor'); // 75%, far above the threshold
  });

  it('picks the largest potion that fits', () => {
    expect(chooseAutoPotion(50, 200, 0, [minor, lesser])).toBe('lesser');
    expect(chooseAutoPotion(120, 200, 0, [minor, lesser])).toBe('minor');
  });

  it('at or below the threshold it drinks even if the potion overheals, the smallest it holds', () => {
    expect(chooseAutoPotion(28, 70, 0, [lesser])).toBe('lesser');
    expect(chooseAutoPotion(29, 70, 0, [lesser])).toBeNull();
    expect(chooseAutoPotion(28, 70, 0, [lesser, minor])).toBe('minor'); // missing 42 > 40: the fit rule
    expect(chooseAutoPotion(35, 100, 0, [lesser, { ...minor, amount: 70 }])).toBe('minor'); // nothing fits: smallest
  });

  it('counts healing on its way, so potions do not pile up', () => {
    expect(chooseAutoPotion(28, 70, 40, [minor])).toBeNull();
    expect(chooseAutoPotion(10, 200, 40, [minor])).toBe('minor'); // still far short
  });

  it('uses each potion its own threshold', () => {
    expect(chooseAutoPotion(45, 70, 0, [{ ...lesser, threshold: 0.7 }])).toBe('lesser');
    expect(chooseAutoPotion(45, 70, 0, [{ ...lesser, threshold: 0.5 }])).toBeNull();
  });

  it('drinks nothing with an empty bag', () => {
    expect(chooseAutoPotion(1, 70, 0, [])).toBeNull();
  });
});

describe('auto-use in a fight (L9)', () => {
  it('leaves potions alone above the threshold while one would be wasted', () => {
    const { character, ctx, run } = harness();
    startFight(character, 'harmless', ctx);
    character.health = 40; // missing 30, minor heals 40, and 57% is above 40%
    run(10);
    expect(potionCount(character, MINOR)).toBe(10);
    expect(character.potions.queue).toEqual([]);
  });

  it('drinks once missing health is greater than what the potion heals', () => {
    const { character, ctx, run } = harness();
    startFight(character, 'harmless', ctx);
    character.health = 29; // missing 41 is more than 40, and 41% is above the threshold
    run(1);
    expect(potionCount(character, MINOR)).toBe(9);
    expect(character.potions.queue).toEqual([MINOR]);
  });

  it('at or below the threshold it drinks even though the potion overheals', () => {
    const { character, ctx, run } = harness();
    setBag(character, [LESSER, 3]);
    startFight(character, 'harmless', ctx);
    character.health = 28; // 40%; lesser heals 120, missing 42
    run(1);
    expect(potionCount(character, LESSER)).toBe(2);
  });

  it('does not drink a second potion while the first covers the gap', () => {
    const { character, ctx, run } = harness();
    startFight(character, 'harmless', ctx);
    character.health = 20;
    run(30);
    expect(potionCount(character, MINOR)).toBe(9);
  });

  it('follows the threshold the player set', () => {
    const { character, ctx, run } = harness();
    setBag(character, [LESSER, 3]);
    character.settings.potionThresholds[LESSER] = 0.9;
    startFight(character, 'harmless', ctx);
    character.health = 60;
    run(1);
    expect(potionCount(character, LESSER)).toBe(2);
  });

  it('does not drink out of a fight', () => {
    const { character, run } = harness();
    character.health = 5;
    run(20);
    expect(potionCount(character, MINOR)).toBe(10);
  });

  it('removes an emptied stack from the bag, and skips items that are not potions', () => {
    const { character, ctx, run } = harness();
    setBag(character, ['rusty-sword', 1], [MINOR, 1]);
    startFight(character, 'harmless', ctx);
    character.health = 5;
    run(1);
    expect(character.bag.map((s) => s.itemId)).toEqual(['rusty-sword']);
  });
});

describe('fleeing (L5)', () => {
  it('stops attacking, leaves after the flee time and gives no reward', () => {
    const { character, ctx, events, run } = harness();
    setBag(character);
    startFight(character, 'wall', ctx);
    run(5);
    startFleeing(character, ctx);
    expect(character.phase).toBe('fleeing');
    const enemyHp = character.fight?.enemyHp;

    run(9);
    expect(character.phase).toBe('fleeing');
    expect(character.fight?.enemyHp).toBe(enemyHp);

    run(1);
    expect(character).toMatchObject({ phase: 'returning', fight: null });
    expect(events.some((e) => e.type === 'enemyKilled')).toBe(false);
  });

  it('the enemy keeps its timer and keeps hitting', () => {
    const { character, ctx, run } = harness();
    setBag(character);
    startFight(character, 'wall', ctx);
    run(5);
    startFleeing(character, ctx);
    run(4);
    expect(character.health).toBe(70);
    run(1); // tick 10 of the fight: the enemy's attack lands, 1 s after the fight began
    expect(character.health).toBeCloseTo(70 - 3.75);
  });

  it('can die while fleeing: at 1 health it cannot simply leave', () => {
    const { character, ctx, events, run } = harness();
    setBag(character);
    character.health = 1;
    startFight(character, 'wall', ctx);
    run(1);
    startFleeing(character, ctx);
    run(10);
    expect(character).toMatchObject({ phase: 'dead', health: 0 });
    expect(events).toContainEqual({ type: 'characterDied', characterId: 'c1', enemyId: 'wall' });
  });

  it('potions and regeneration keep ticking, and it still drinks', () => {
    const { character, ctx, run } = harness(fixture({ crit: false }));
    startFight(character, 'harmless', ctx);
    startFleeing(character, ctx);
    character.health = 20;
    run(6); // drinks on the first step, and the first heal tick comes 500 ms later
    expect(potionCount(character, MINOR)).toBe(9);
    expect(character.health).toBeCloseTo(20 + 0.21 + 2);
  });

  it('takes 1 s at speed 0, shortened by the speed skill, in whole steps', () => {
    const { character, ctx } = harness();
    expect(fleeDurationMs(character, ctx)).toBe(1000);
    character.proficiency.speed = 100;
    const expected = 1000 / (1 + 100 * constants.proficiency.effectPerPoint.speed);
    expect(fleeDurationMs(character, ctx)).toBe(Math.round(expected / TICK) * TICK);
    expect(fleeDurationMs(character, ctx)).toBeLessThan(1000);
  });

  it('does nothing unless the character is fighting', () => {
    const { character, ctx, events } = harness();
    startFleeing(character, ctx);
    expect(character.phase).toBe('idle');
    expect(events).toEqual([]);
  });
});

describe('determinism (ADR 0002)', () => {
  const data = loadGameData();
  const T0 = 1_000_000;

  function fightingState(): GameState {
    const state = createGameState(SEED, T0, data);
    const { character, ctx } = harness(data);
    character.areaId = 'mossfang-glade';
    startFight(character, 'glade-rat', ctx);
    character.health = 20;
    state.roster.push(character);
    return state;
  }

  it('the same seed gives the same fight, however advanceTo calls are split', () => {
    const whole = createEngine({ data, state: fightingState() });
    const parts = createEngine({ data, state: fightingState() });

    whole.advanceTo(T0 + 30_000);
    for (const t of [37, 100, 250, 999, 1100, 4321, 7777, 12_345, 20_000, 30_000]) parts.advanceTo(T0 + t);

    expect(parts.state).toEqual(whole.state);
    const events = whole.drainEvents();
    expect(parts.drainEvents()).toEqual(events);
    expect(events.some((e) => e.type === 'enemyKilled')).toBe(true);
  });

  it('different streams can give a different fight', () => {
    const ends = new Set<number>();
    for (let n = 1; n <= 40; n++) {
      const { character, ctx } = harness(data, `c${n}`);
      character.attributes.dexterity = 100; // a higher crit chance, so the rolls show
      startFight(character, 'mossfang-wolf', ctx);
      character.health = 1_000_000;
      let steps = 0;
      while (character.phase === 'fighting' && steps < 100_000) {
        stepCharacter(character, ctx);
        steps++;
      }
      ends.add(steps);
    }
    expect(ends.size).toBeGreaterThan(1);
  });

  it('a mid-fight state with a running potion survives JSON and carries on the same', () => {
    const first = createEngine({ data, state: fightingState() });
    first.advanceTo(T0 + 1300);
    const character = first.state.roster[0] as CharacterState;
    expect(character.phase).toBe('fighting');
    expect(character.potions.queue.length).toBeGreaterThan(0);

    const saved = JSON.parse(JSON.stringify(first.state)) as GameState;
    expect(saved).toStrictEqual(first.state);

    const second = createEngine({ data, state: saved });
    first.advanceTo(T0 + 20_000);
    second.advanceTo(T0 + 20_000);
    expect(second.state).toEqual(first.state);
  });
});
