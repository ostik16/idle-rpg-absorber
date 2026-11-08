import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import itemsJson from '../data/items.json';
import xpTableJson from '../data/xp-table.json';
import { createGameData, loadGameData, type GameData } from '../src/data/game-data';
import { stepCharacter, type StepContext } from '../src/engine/character';
import { loseXpOnDeath } from '../src/engine/death';
import { createEngine } from '../src/engine/engine';
import type { EngineEvent } from '../src/engine/events';
import { startFight, startFleeing } from '../src/engine/fight';
import { createCharacterStreams } from '../src/engine/streams';
import { chooseCityPotion, cityPotionTarget } from '../src/game/potions';
import { createStream } from '../src/game/rng';
import { createCharacterState, createGameState } from '../src/state/factory';
import { derivedStats } from '../src/state/selectors';
import type { CharacterState, CityHealingMode, GameState } from '../src/state/types';

const TICK = constants.combat.tickMs;
const MINOR = 'minor-health-potion';

const PLAIN = {
  id: 'plain',
  levelRange: { min: 1, max: 1 },
  distanceFromCity: 2,
  movementSecondsBetweenEnemies: 1,
  enemies: [{ enemyId: 'wall', spawnWeight: 1 }],
  miniBossSpawnChance: 0,
  bossSpawnChance: 0,
};

/** Dies to one blow on the first enemy attack. */
const WALL = { id: 'wall', level: 1, health: 1_000_000, damage: 1000, attackSpeed: 1, defence: 0 };
/** Falls to one blow: worth 10 XP by the formula. */
const SOFT = { id: 'soft', level: 1, health: 1, damage: 0, attackSpeed: 0.01, defence: 0 };
const RAT = { ...SOFT, id: 'rat', xpReward: 9 };
const GIANT = { ...SOFT, id: 'giant', xpReward: 500 };

function fixture(regen = true): GameData {
  const stats = {
    ...constants.stats,
    critChance: { base: 0, perDexterity: 0, cap: 0 },
    ...(regen ? {} : { healthRegen: { fractionOfMaxPerSecond: 0 } }),
  };
  return createGameData({
    constants: {
      ...constants,
      stats,
      proficiency: { ...constants.proficiency, gainPerAction: { unarmed: 0, 'one-handed': 0, 'two-handed': 0, toughness: 0, speed: 0, combat: 0 } },
    },
    items: itemsJson,
    enemies: [WALL, SOFT, RAT, GIANT],
    areas: [PLAIN],
    xpTable: xpTableJson,
  });
}

const DATA = fixture();

function harness(data: GameData = DATA, id = 'c1') {
  const character = createCharacterState(id, 'Ysolde', data);
  const events: EngineEvent[] = [];
  const ctx: StepContext = {
    data,
    tickMs: TICK,
    streams: createCharacterStreams(7, id),
    emit: (event) => void events.push(event),
  };
  const run = (steps: number): void => {
    for (let i = 0; i < steps; i++) stepCharacter(character, ctx);
  };
  const runWhile = (phase: CharacterState['phase']): number => {
    let steps = 0;
    while (character.phase === phase && steps < 1_000_000) {
      stepCharacter(character, ctx);
      steps++;
    }
    return steps;
  };
  const kill = (enemyId = 'soft', times = 1): void => {
    for (let i = 0; i < times; i++) {
      startFight(character, enemyId, ctx);
      runWhile('fighting');
    }
  };
  const die = (): void => {
    startFight(character, 'wall', ctx);
    runWhile('fighting');
  };
  return { character, ctx, events, run, runWhile, kill, die };
}

/** A context whose death stream always rolls `r`, so the XP loss is exact. */
function withRoll(ctx: StepContext, r: number): StepContext {
  return { ...ctx, streams: { ...ctx.streams, death: { ...ctx.streams.death, nextFloat: () => r } } };
}

describe('XP from a kill (3.5, 4.3)', () => {
  it("gives the enemy's own reward, or the formula when it has none", () => {
    const { character, events, kill } = harness();
    kill('rat');
    expect(character.xpInLevel).toBe(9);
    kill('soft');
    expect(character.xpInLevel).toBe(19);
    expect(events).toContainEqual({ type: 'xpGained', characterId: 'c1', amount: 9 });
    expect(events).toContainEqual({ type: 'xpGained', characterId: 'c1', amount: 10 });
  });

  it('reports the kill before the XP, and the level after it', () => {
    const { character, events, kill } = harness();
    character.xpInLevel = 95;
    kill();
    const kinds = events.map((e) => e.type).filter((t) => ['enemyKilled', 'xpGained', 'levelUp'].includes(t));
    expect(kinds).toEqual(['enemyKilled', 'xpGained', 'levelUp']);
    expect(events).toContainEqual({ type: 'levelUp', characterId: 'c1', level: 2 });
  });

  it('a level 1 character has 3 points before level 2 (4.4)', () => {
    const { character, kill } = harness();
    kill('soft', 2); // 20 XP
    expect(character.points.characterUnspent).toBe(0);
    kill(); // 30 XP, past 25
    expect(character.points.characterUnspent).toBe(1);
    kill('soft', 2); // 50 XP, on the mark
    expect(character.points.characterUnspent).toBe(2);
    kill('soft', 3); // 80 XP, past 75
    expect(character.points.characterUnspent).toBe(3);
    expect(character).toMatchObject({ level: 1, xpInLevel: 80, highestMarkReached: 3 });
    expect(character.points.skillUnspent).toBe(0);
  });

  it('a level pays 1 skill point, and the marks start again', () => {
    const { character, kill } = harness();
    kill('soft', 10);
    expect(character).toMatchObject({ level: 2, xpInLevel: 0, highestMarkReached: 0 });
    expect(character.points).toMatchObject({ characterUnspent: 3, skillUnspent: 1 });
  });

  it('each level gained adds the base stats from constants.progression.attributesPerLevel (4.3)', () => {
    const { character, kill } = harness();
    kill('soft', 10); // level 2
    expect(character.attributes).toEqual({ strength: 6, dexterity: 6, vitality: 6, intelligence: 6 });
  });

  it('one kill can pass several levels, with an event for each', () => {
    const { character, events, kill } = harness();
    kill('giant'); // 100 + 311 + 89 into level 3
    expect(character).toMatchObject({ level: 3, xpInLevel: 89 });
    expect(character.points.skillUnspent).toBe(2);
    expect(character.attributes).toEqual({ strength: 7, dexterity: 7, vitality: 7, intelligence: 7 });
    expect(events.filter((e) => e.type === 'levelUp').map((e) => (e as { level: number }).level)).toEqual([2, 3]);
  });

  it('reports only the XP that counted when a kill reaches the level cap', () => {
    const { character, events, kill } = harness();
    character.level = constants.levelCap - 1;
    character.xpInLevel = xpTableJson[constants.levelCap - 2]!.xpToNext - 4;
    kill(); // worth 10, and 4 of it reach the cap
    expect(character).toMatchObject({ level: 30, xpInLevel: 0 });
    expect(events).toContainEqual({ type: 'xpGained', characterId: 'c1', amount: 4 });
  });

  it('at the level cap a kill gives nothing', () => {
    const { character, events, kill } = harness();
    character.level = constants.levelCap;
    kill();
    expect(character).toMatchObject({ level: 30, xpInLevel: 0 });
    expect(events.some((e) => e.type === 'xpGained')).toBe(false);
  });
});

describe('XP lost on death (3.7, T6)', () => {
  const NEARLY_ONE = 1 - 2 ** -32;

  it.each([
    { xp: 74, after: 50, lost: 24 },
    { xp: 76, after: 75, lost: 1 },
    { xp: 20, after: 0, lost: 20 },
  ])('the largest roll at $xp of 100 XP loses $lost', ({ xp, after, lost }) => {
    const { character, ctx, events } = harness();
    character.xpInLevel = xp;
    loseXpOnDeath(character, withRoll(ctx, NEARLY_ONE));
    expect(character.xpInLevel).toBe(after);
    expect(events).toEqual([{ type: 'xpLost', characterId: 'c1', amount: lost }]);
  });

  it('a smaller roll loses its share of the level, and a roll of 0 loses nothing', () => {
    const { character, ctx, events } = harness();
    character.xpInLevel = 74;
    loseXpOnDeath(character, withRoll(ctx, 0));
    expect(character.xpInLevel).toBe(74);
    expect(events).toEqual([]);
    loseXpOnDeath(character, withRoll(ctx, 0.4)); // 10% of 100
    expect(character.xpInLevel).toBe(64);
  });

  it.each([
    { xp: 74, floor: 50 },
    { xp: 76, floor: 75 },
    { xp: 20, floor: 0 },
    { xp: 0, floor: 0 },
  ])('over many real rolls, $xp XP never falls below $floor', ({ xp, floor }) => {
    const { character, ctx } = harness();
    for (let i = 0; i < 500; i++) {
      character.xpInLevel = xp;
      loseXpOnDeath(character, ctx);
      expect(character.xpInLevel).toBeGreaterThanOrEqual(floor);
      expect(character.xpInLevel).toBeGreaterThanOrEqual(xp - 25);
      expect(character.xpInLevel).toBeLessThanOrEqual(xp);
    }
  });

  it('over many real rolls XP stays whole, and the largest loss at 74 is reached', () => {
    const { character, ctx } = harness();
    const after = new Set<number>();
    for (let i = 0; i < 500; i++) {
      character.xpInLevel = 74;
      loseXpOnDeath(character, ctx);
      expect(Number.isInteger(character.xpInLevel)).toBe(true);
      after.add(character.xpInLevel);
    }
    expect(Math.min(...after)).toBe(50);
  });

  it('a death while fleeing costs XP like any other', () => {
    const { character, ctx, events } = harness();
    const rolled = withRoll(ctx, NEARLY_ONE);
    character.xpInLevel = 74;
    character.bag = [];
    startFight(character, 'wall', rolled);
    stepCharacter(character, rolled);
    startFleeing(character, rolled);
    while (character.phase === 'fleeing') stepCharacter(character, rolled);

    expect(character.phase).toBe('dead');
    expect(character.xpInLevel).toBe(50);
    expect(events).toContainEqual({ type: 'xpLost', characterId: 'c1', amount: 24 });
  });

  it('a death does not shift the combat rolls that come after it', () => {
    const { character, ctx } = harness();
    const before = ctx.streams.combat.getState();
    const deathBefore = ctx.streams.death.getState();
    loseXpOnDeath(character, ctx);
    expect(ctx.streams.combat.getState()).toEqual(before);
    expect(ctx.streams.death.getState()).not.toEqual(deathBefore);
  });

  it('never loses a level: at the start of a level there is nothing to lose', () => {
    const { character, die } = harness();
    character.level = 5;
    die();
    expect(character).toMatchObject({ level: 5, xpInLevel: 0 });
  });

  it('a character at the level cap has no XP to lose', () => {
    const { character, die } = harness();
    character.level = constants.levelCap;
    die();
    expect(character).toMatchObject({ phase: 'dead', level: 30, xpInLevel: 0 });
  });

  it('dying in a real fight takes the XP and keeps the bag, the gear and the area', () => {
    const { character, ctx, events } = harness();
    const rolled = withRoll(ctx, 0.5); // 12.5% of 100, limited by the floor at 50
    character.xpInLevel = 60;
    character.areaId = 'mossfang-glade';
    character.targetEnemyId = 'glade-rat';
    character.equipment.chest = { itemId: 'rusty-sword', bonuses: [], upgradeLevel: 0, qty: 1 };
    const bag = structuredClone(character.bag);
    const equipment = structuredClone(character.equipment);
    startFight(character, 'wall', rolled);
    while (character.phase === 'fighting') stepCharacter(character, rolled);

    expect(character.phase).toBe('dead');
    expect(character.xpInLevel).toBe(50);
    expect(events).toContainEqual({ type: 'xpLost', characterId: 'c1', amount: 10 });
    expect(character.bag).toEqual(bag);
    expect(character.equipment).toEqual(equipment);
    expect(character).toMatchObject({ areaId: 'mossfang-glade', targetEnemyId: 'glade-rat', fight: null });
  });
});

describe('a point mark never pays out twice after a death (4.4, T6)', () => {
  it('dying and earning the XP back pays nothing new, however often it happens', () => {
    const { character, ctx, kill } = harness();
    kill('soft', 8); // 80 XP: all three marks
    expect(character.points.characterUnspent).toBe(3);
    const loseMost = withRoll(ctx, 1 - 2 ** -32);
    for (let i = 0; i < 20; i++) {
      loseXpOnDeath(character, loseMost);
      expect(character.xpInLevel).toBe(75);
      kill(); // back past 75, without reaching the level
      expect(character.points.characterUnspent).toBe(3);
    }
  });

  it('a mark below the floor pays once, and the next mark still pays', () => {
    const { character, ctx, kill } = harness();
    kill('soft', 3); // 30 XP: one mark
    expect(character.points.characterUnspent).toBe(1);
    loseXpOnDeath(character, withRoll(ctx, 1 - 2 ** -32));
    expect(character.xpInLevel).toBe(25);
    kill();
    expect(character.points.characterUnspent).toBe(1);
    kill('soft', 2); // 55 XP
    expect(character.points.characterUnspent).toBe(2);
  });

  it('the saved marks counter decides, not the XP, so a mark already paid stays paid', () => {
    const { character, kill } = harness();
    character.xpInLevel = 10;
    character.highestMarkReached = 3;
    kill('soft', 7); // 80 XP
    expect(character.points.characterUnspent).toBe(0);
  });

  it('a whole level with real rolls and many deaths pays exactly 3 points', () => {
    const { character, ctx, kill } = harness();
    let deaths = 0;
    while (character.level === 1) {
      kill();
      expect(character.points.characterUnspent).toBeLessThanOrEqual(3);
      if (character.level === 1) {
        loseXpOnDeath(character, ctx);
        deaths++;
      }
      if (deaths > 100_000) throw new Error('never finished the level');
    }
    expect(deaths).toBeGreaterThan(0);
    expect(character.points).toMatchObject({ characterUnspent: 3, skillUnspent: 1 });
  });
});

describe('the respawn timer (3.7, T11)', () => {
  it('level 30 waits 120 s, and level 1 waits 4 s', () => {
    for (const [level, seconds] of [
      [30, 120],
      [1, 4],
    ] as const) {
      const exact = fixture(false);
      const { character, die, run } = harness(exact);
      character.level = level;
      die();
      expect(character.phase).toBe('dead');
      run((seconds * 1000) / TICK - 1);
      expect(character).toMatchObject({ phase: 'dead', health: 0 });
      run(1);
      expect(character).toMatchObject({ phase: 'restocking', health: 7 });
    }
  });

  it('comes back with 10% of its maximum health, rounded up', () => {
    const exact = fixture(false);
    const { character, die, runWhile } = harness(exact);
    character.attributes.vitality = 9; // 30 + 8 x 9 = 102, so 10.2 rounds up to 11
    die();
    runWhile('dead');
    expect(character.health).toBe(11);
  });

  it('a dead character does not heal or drink', () => {
    const { character, die, run } = harness();
    die();
    run(30);
    expect(character.health).toBe(0);
    expect(character.potions.queue).toEqual([]);
    expect(character.bag[0]?.qty).toBe(10);
  });

  it('emits the phase changes in order', () => {
    const { events, die, runWhile, character } = harness();
    character.settings.cityHealing = 'fast';
    die();
    runWhile('dead');
    runWhile('restocking');
    const phases = events.flatMap((e) => (e.type === 'phaseChanged' ? [e.to] : []));
    expect(phases).toEqual(['fighting', 'dead', 'restocking', 'idle']);
  });
});

describe('healing after death (3.7, T11, L10)', () => {
  function respawned(mode: CityHealingMode, data: GameData = DATA) {
    const h = harness(data);
    h.character.settings.cityHealing = mode;
    h.die();
    h.runWhile('dead');
    return h;
  }

  it('from 10% health regeneration alone takes 180 s', () => {
    const { character, runWhile } = respawned('slow');
    const steps = runWhile('restocking');
    expect((steps * TICK) / 1000).toBeCloseTo(180, 0);
    expect(character.health).toBe(70);
    expect(character.bag[0]?.qty).toBe(10);
  });

  it('never leaves before it is at full health', () => {
    for (const mode of ['fast', 'balanced', 'slow'] as const) {
      const { character, ctx } = respawned(mode);
      while (character.phase === 'restocking') {
        const before = character.health;
        stepCharacter(character, ctx);
        if (character.phase !== 'restocking') expect(before).toBe(70);
      }
      expect(character.health).toBe(70);
    }
  });

  it('fast drinks while health is short, so it is back much sooner', () => {
    const { character, runWhile } = respawned('fast');
    const steps = runWhile('restocking');
    expect(character.bag[0]?.qty).toBe(8); // 7 + 40 + regen, then one more
    expect((steps * TICK) / 1000).toBeLessThan(20);
  });

  it('balanced drinks up to 65%, then regeneration does the rest', () => {
    const { character, run, runWhile } = respawned('balanced');
    run(1);
    expect(character.bag[0]?.qty).toBe(9);
    run(120); // the potion is done and health is past 65% (45.5)
    expect(character.health).toBeGreaterThan(45.5);
    expect(character.bag[0]?.qty).toBe(9);
    runWhile('restocking');
    expect(character.bag[0]?.qty).toBe(9);
    expect(character.health).toBe(70);
  });

  it('a character with no potions heals by regeneration, whatever it chose', () => {
    const h = harness();
    h.character.bag = [];
    h.character.settings.cityHealing = 'fast';
    h.die();
    h.runWhile('dead');
    expect((h.runWhile('restocking') * TICK) / 1000).toBeCloseTo(180, 0);
    expect(h.character.health).toBe(70);
  });

  it('a character already at full health leaves the city on the next step', () => {
    const { character, run } = harness();
    character.phase = 'restocking';
    run(1);
    expect(character.phase).toBe('idle');
  });
});

describe('going back after healing (3.2, 3.7)', () => {
  const T0 = 1_000_000;

  /** A character on its way to the plain, where the wall kills it, played through the engine. */
  function farming() {
    const state = createGameState(7, T0, DATA);
    const character = createCharacterState('c1', 'Ysolde', DATA);
    character.settings.cityHealing = 'fast';
    character.bag = [{ itemId: MINOR, bonuses: [], upgradeLevel: 0, qty: 10 }];
    state.roster.push(character);
    const engine = createEngine({ data: DATA, state });
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: 'plain' });
    let now = T0;
    const stepUntil = (done: () => boolean): void => {
      for (let i = 0; i < 100_000 && !done(); i++) {
        now += TICK;
        engine.advanceTo(now);
      }
      expect(done()).toBe(true);
    };
    return { engine, character, stepUntil };
  }

  it('dying with no command, it walks back to its area once healed, target kept', () => {
    const { engine, character, stepUntil } = farming();
    engine.dispatch({ type: 'setTarget', characterId: 'c1', enemyId: 'wall' });
    stepUntil(() => character.phase === 'dead');
    expect(character).toMatchObject({ areaId: 'plain', targetEnemyId: 'wall', stayInCity: false });

    stepUntil(() => character.phase === 'restocking');
    stepUntil(() => character.phase !== 'restocking');
    expect(character).toMatchObject({
      phase: 'travelling',
      timeInPhaseMs: 0,
      health: 70,
      areaId: 'plain',
      targetEnemyId: 'wall',
      stayInCity: false,
    });

    stepUntil(() => character.phase === 'fighting');
    expect(character.fight?.enemyId).toBe('wall');
  });

  it('dying while fleeing after a return command, it stays in the city with no area', () => {
    const { engine, character, stepUntil } = farming();
    stepUntil(() => character.phase === 'fighting');
    engine.dispatch({ type: 'returnToCity', characterId: 'c1' });
    stepUntil(() => character.phase === 'fleeing');
    expect(character.stayInCity).toBe(true);
    stepUntil(() => character.phase === 'dead');

    stepUntil(() => character.phase === 'restocking');
    stepUntil(() => character.phase !== 'restocking');
    expect(character).toMatchObject({
      phase: 'idle',
      health: 70,
      areaId: null,
      targetEnemyId: null,
      stayInCity: false,
    });
  });

  it('a return while healing also keeps it in the city', () => {
    const { engine, character, stepUntil } = farming();
    stepUntil(() => character.phase === 'restocking');
    engine.dispatch({ type: 'returnToCity', characterId: 'c1' });
    stepUntil(() => character.phase !== 'restocking');
    expect(character).toMatchObject({ phase: 'idle', areaId: null, stayInCity: false });
  });

  it('a character with no area has nowhere to go back to', () => {
    const { character, die, runWhile } = harness();
    character.settings.cityHealing = 'fast';
    die();
    runWhile('dead');
    runWhile('restocking');
    expect(character).toMatchObject({ phase: 'idle', areaId: null });
  });
});

describe('cityPotionTarget and chooseCityPotion (L10)', () => {
  const minor = { itemId: 'minor', amount: 40, threshold: 0.4 };
  const lesser = { itemId: 'lesser', amount: 120, threshold: 0.4 };

  it('fast heals to 100%, balanced to 65%, slow drinks nothing', () => {
    const { balancedFraction } = constants.cityHealing;
    expect(balancedFraction).toBe(0.65);
    expect(cityPotionTarget('fast', balancedFraction)).toBe(1);
    expect(cityPotionTarget('balanced', balancedFraction)).toBe(0.65);
    expect(cityPotionTarget('slow', balancedFraction)).toBe(0);
    expect(chooseCityPotion(7, 70, 0, [minor])).toBeNull();
  });

  it('drinks nothing at or above the target', () => {
    expect(chooseCityPotion(65, 100, 0.65, [minor])).toBeNull();
    expect(chooseCityPotion(70, 100, 0.65, [minor])).toBeNull();
    expect(chooseCityPotion(100, 100, 1, [minor])).toBeNull();
  });

  it('picks the largest potion that fits up to the target, not up to full health', () => {
    expect(chooseCityPotion(10, 200, 1, [minor, lesser])).toBe('lesser'); // 190 short of full
    expect(chooseCityPotion(9, 200, 0.65, [minor, lesser])).toBe('lesser'); // 121 short of 130
    expect(chooseCityPotion(20, 200, 0.65, [minor, lesser])).toBe('minor'); // 110 short of 130
  });

  it('picks the smallest when none fits, and nothing from an empty bag', () => {
    expect(chooseCityPotion(50, 70, 1, [lesser, minor])).toBe('minor');
    expect(chooseCityPotion(50, 70, 1, [])).toBeNull();
  });
});

describe('spending character points (4.4)', () => {
  const T0 = 1_000_000;

  function engineWith(unspent: number) {
    const state: GameState = createGameState(7, T0, DATA);
    const character = createCharacterState('c1', 'Ysolde', DATA);
    character.points.characterUnspent = unspent;
    state.roster.push(character);
    const engine = createEngine({ data: DATA, state });
    const send = (command: Parameters<typeof engine.dispatch>[0]): EngineEvent[] => {
      engine.dispatch(command);
      engine.advanceTo(state.clock.lastSimulatedAt + TICK);
      return engine.drainEvents();
    };
    return { engine, character, send };
  }

  it('raises the attribute and moves the points from unspent to spent', () => {
    const { character, send } = engineWith(5);
    const command = { type: 'spendCharacterPoints', characterId: 'c1', attribute: 'strength', amount: 2 } as const;
    expect(send(command)).toEqual([{ type: 'characterPointsSpent', characterId: 'c1', attribute: 'strength', amount: 2 }]);
    expect(character.attributes.strength).toBe(7);
    expect(character.points).toMatchObject({ characterUnspent: 3, characterSpent: 2 });
  });

  it('counts in the stats, and raising vitality does not heal', () => {
    const { character, send } = engineWith(5);
    send({ type: 'spendCharacterPoints', characterId: 'c1', attribute: 'vitality', amount: 5 });
    expect(derivedStats(character, DATA).maxHealth).toBe(110);
    expect(character.health).toBeLessThan(71); // one step of regeneration
  });

  it.each([
    { amount: 4, attribute: 'strength', characterId: 'c1', reason: '3 of 4 character points available.' },
    { amount: 0, attribute: 'strength', characterId: 'c1', reason: 'Spend at least 1 whole point.' },
    { amount: -1, attribute: 'strength', characterId: 'c1', reason: 'Spend at least 1 whole point.' },
    { amount: 1.5, attribute: 'strength', characterId: 'c1', reason: 'Spend at least 1 whole point.' },
    { amount: 1, attribute: 'luck', characterId: 'c1', reason: 'No attribute called luck.' },
    { amount: 1, attribute: 'strength', characterId: 'c9', reason: 'That character no longer exists.' },
  ])('rejects $amount of $attribute for $characterId and changes nothing', ({ amount, attribute, characterId, reason }) => {
    const { character, send } = engineWith(3);
    const before = structuredClone({ attributes: character.attributes, points: character.points });
    const command = { type: 'spendCharacterPoints', characterId, attribute, amount } as never;
    expect(send(command)).toEqual([{ type: 'commandRejected', command, reason }]);
    expect({ attributes: character.attributes, points: character.points }).toEqual(before);
  });

  it('a new character has no points and keeps the marks counter at 0', () => {
    const character = createCharacterState('c1', 'Ysolde', DATA);
    expect(character.points.characterUnspent).toBe(0);
    expect(character.highestMarkReached).toBe(0);
  });
});

describe('determinism (ADR 0002)', () => {
  const T0 = 1_000_000;

  function dyingState(): GameState {
    const state = createGameState(7, T0, DATA);
    const { character, ctx } = harness();
    character.xpInLevel = 60;
    character.health = 1;
    character.bag = [{ itemId: MINOR, bonuses: [], upgradeLevel: 0, qty: 3 }];
    startFight(character, 'wall', ctx);
    state.roster.push(character);
    return state;
  }

  it('the whole death gives the same result however advanceTo calls are split, and survives JSON', () => {
    const whole = createEngine({ data: DATA, state: dyingState() });
    const parts = createEngine({ data: DATA, state: dyingState() });

    whole.advanceTo(T0 + 200_000);
    parts.advanceTo(T0 + 1500);
    const saved = JSON.parse(JSON.stringify(parts.state)) as GameState;
    const resumed = createEngine({ data: DATA, state: saved });
    for (const t of [3000, 4100, 9000, 60_000, 200_000]) resumed.advanceTo(T0 + t);

    expect(resumed.state).toEqual(whole.state);
    expect(whole.state.roster[0]).toMatchObject({ phase: 'idle', health: 70 });
  });

  /** A character farming the real first area: it dies, heals and walks back over and over. The auto-return
   * trigger is turned off (threshold 0) so the test still exercises the death cycle it was written for. */
  function farmingState(data: GameData): GameState {
    const state = createGameState(7, T0, data);
    const character = createCharacterState('c1', 'Ysolde', data);
    character.settings.returnHealthThreshold = 0;
    state.roster.push(character);
    return state;
  }

  it('the loop of farming, dying and walking back gives the same result however it is split, and survives JSON', () => {
    const data = loadGameData();
    const END = 1_800_000; // 30 minutes: about 5 deaths for a new character
    const whole = createEngine({ data, state: farmingState(data) });
    const parts = createEngine({ data, state: farmingState(data) });
    const send = { type: 'sendToArea', characterId: 'c1', areaId: 'mossfang-glade' } as const;
    whole.dispatch(send);
    parts.dispatch(send);

    const wholeEvents: EngineEvent[] = [];
    for (let t = 200_000; t <= END; t += 200_000) {
      whole.advanceTo(T0 + t);
      wholeEvents.push(...whole.drainEvents());
    }

    let resumed = parts;
    const resumedEvents: EngineEvent[] = [];
    for (let t = 137_300; t < END; t += 137_300) {
      resumed.advanceTo(T0 + t);
      resumedEvents.push(...resumed.drainEvents());
      const saved = JSON.parse(JSON.stringify(resumed.state)) as GameState;
      expect(saved).toStrictEqual(resumed.state);
      resumed = createEngine({ data, state: saved });
    }
    resumed.advanceTo(T0 + END);
    resumedEvents.push(...resumed.drainEvents());

    expect(wholeEvents.filter((e) => e.type === 'characterDied').length).toBeGreaterThan(1);
    expect(wholeEvents.filter((e) => e.type === 'phaseChanged' && e.from === 'restocking' && e.to === 'travelling').length).toBeGreaterThan(0);
    expect(resumed.state).toEqual(whole.state);
    expect(resumedEvents).toEqual(wholeEvents);
  });

  it('a save with no death stream starts one fresh, and the other streams carry on', () => {
    const data = DATA;
    const state = dyingState();
    const first = createEngine({ data, state });
    first.advanceTo(T0 + TICK);
    const character = first.state.roster[0] as CharacterState;
    const { combat, drops, search } = character.rng as NonNullable<CharacterState['rng']>;
    const old = JSON.parse(JSON.stringify(first.state)) as GameState;
    (old.roster[0] as CharacterState).rng = { combat, drops, search } as NonNullable<CharacterState['rng']>;

    createEngine({ data, state: old });
    expect(old.roster[0]?.rng).toEqual({ combat, drops, search, death: createStream(7, 'c1', 'death').getState() });
  });
});
