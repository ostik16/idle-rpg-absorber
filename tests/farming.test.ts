import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import areasJson from '../data/areas.json';
import enemiesJson from '../data/enemies.json';
import itemsJson from '../data/items.json';
import { createGameData, loadGameData, type GameData } from '../src/data/game-data';
import { applyCommand } from '../src/engine/commands';
import { createEngine, type Engine } from '../src/engine/engine';
import type { EngineEvent } from '../src/engine/events';
import { createCharacterStreams } from '../src/engine/streams';
import { baseMovementSeconds, rollSpawn, spawnsInArea, targetingMultiplier } from '../src/game/farming';
import { createRng, createStream } from '../src/game/rng';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { CharacterState, GameState } from '../src/state/types';
import { buildPlayer, defaultBuild, enemyFromData, meanFightSeconds, type PlayerBuild } from '../tools/balance/combat';
import { areaReport } from '../tools/balance/drops';
import { loadBalanceData } from '../tools/balance/load-data';

const SEED = 7;
const T0 = 1_000_000;
const TICK = constants.combat.tickMs;
const AREA = 'mossfang-glade';
const RAT = 'glade-rat';
const WISP = 'ember-wisp'; // the one normal enemy of the slice with a targeting multiplier of 3
const MINI_BOSS = 'old-mossfang';
const BOSS = 'mossfang-matriarch';
const [AREA_ROW] = areasJson;

/** Real data with the area changed, and health back in a second, so nobody dies during a measurement. */
function fixture(area: Record<string, unknown> = {}): GameData {
  return createGameData({
    constants: { ...constants, stats: { ...constants.stats, healthRegen: { fractionOfMaxPerSecond: 1 } } },
    items: itemsJson,
    enemies: enemiesJson,
    areas: [{ ...AREA_ROW, ...area } as (typeof areasJson)[number]],
  });
}

/** The balance tool leaves bosses and mini-bosses out of its model, so this is the area as it models it. */
const NO_SPECIALS = { miniBossSpawnChance: 0, bossSpawnChance: 0 };

function freshState(data: GameData): GameState {
  return createGameState(SEED, T0, data);
}

/** An engine with one new character, created on the first step. */
function setup(data: GameData = fixture()) {
  const engine = createEngine({ data, state: freshState(data) });
  engine.dispatch({ type: 'createCharacter', name: 'Ysolde' });
  engine.advanceTo(T0 + TICK);
  const character = engine.state.roster[0] as CharacterState;
  let now = T0 + TICK;
  /** Moves the clock on, a step at a time as far as the engine is concerned. */
  const advance = (ms: number): void => {
    for (let left = ms; left > 0; left -= 60_000) {
      now += Math.min(left, 60_000);
      engine.advanceTo(now);
    }
  };
  return { engine, character, advance, id: character.id };
}

function rejections(engine: Engine): string[] {
  return engine.drainEvents().flatMap((e) => (e.type === 'commandRejected' ? [e.reason] : []));
}

describe('movement and spawn rules (3.1, 3.3)', () => {
  it('uses the area own movement time, else the default', () => {
    expect(baseMovementSeconds({})).toBe(6);
    expect(baseMovementSeconds({ movementSecondsBetweenEnemies: 4 })).toBe(4);
  });

  it('reads the targeting multiplier of the enemy, else the common one', () => {
    expect(targetingMultiplier({})).toBe(2);
    expect(targetingMultiplier({ targetingMultiplier: 10 })).toBe(10);
  });

  it('knows who can be met in an area', () => {
    const area = { enemies: [{ enemyId: 'a', spawnWeight: 1 }], miniBossId: 'b', bossId: 'c' };
    expect(['a', 'b', 'c', 'd'].map((id) => spawnsInArea(area, id))).toEqual([true, true, true, false]);
  });

  it('rolls enemies by spawn weight, and specials at their own chance', () => {
    const rng = createRng(1);
    const area = {
      enemies: [
        { enemyId: 'common', spawnWeight: 3 },
        { enemyId: 'rare', spawnWeight: 1 },
      ],
      miniBossId: 'mini',
      miniBossSpawnChance: 0.02,
      bossId: 'boss',
      bossSpawnChance: 0.005,
    };
    const rolls = 200_000;
    const seen: Record<string, number> = {};
    for (let i = 0; i < rolls; i++) {
      const id = rollSpawn(area, rng);
      seen[id] = (seen[id] ?? 0) + 1;
    }
    expect(Math.abs((seen['boss'] ?? 0) / rolls - 0.005)).toBeLessThan(0.0005);
    expect(Math.abs((seen['mini'] ?? 0) / rolls - 0.02)).toBeLessThan(0.001);
    expect((seen['common'] ?? 0) / rolls).toBeCloseTo(0.975 * 0.75, 2);
    expect((seen['rare'] ?? 0) / rolls).toBeCloseTo(0.975 * 0.25, 2);
  });

  it('never rolls a special the area does not have, and always takes two draws', () => {
    const enemies = [{ enemyId: 'only', spawnWeight: 1 }];
    const noIds = { enemies, miniBossSpawnChance: 1, bossSpawnChance: 1 };
    const noChance = { enemies, miniBossId: 'mini', bossId: 'boss' };
    const certain = { enemies, bossId: 'boss', bossSpawnChance: 1 };
    const several = { enemies: [...enemies, { enemyId: 'other', spawnWeight: 1 }] };
    const a = createRng(5);
    const b = createRng(5);
    const c = createRng(5);
    const twoDraws = createRng(5);
    for (let i = 0; i < 50; i++) {
      expect(rollSpawn(i % 2 === 0 ? noIds : noChance, a)).toBe('only');
      expect(rollSpawn(certain, b)).toBe('boss');
      rollSpawn(several, c);
      twoDraws.nextFloat();
      twoDraws.nextFloat();
    }
    expect(a.getState()).toEqual(twoDraws.getState());
    expect(b.getState()).toEqual(twoDraws.getState());
    expect(c.getState()).toEqual(twoDraws.getState());
  });
});

describe('travelling (3.2)', () => {
  it('reaches Area 1 in 10 s at speed 0', () => {
    const { engine, character, advance, id } = setup();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(10_000 - TICK);
    expect(character).toMatchObject({ phase: 'travelling', areaId: AREA });
    advance(TICK);
    expect(character.phase).toBe('searching');
  });

  it('is shortened by the speed skill, in whole steps', () => {
    const { engine, character, advance, id } = setup();
    character.proficiency.speed = 100; // 10 s / 1.5 = 6.67 s
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(6600);
    expect(character.phase).toBe('travelling');
    advance(TICK);
    expect(character.phase).toBe('searching');
  });

  it('regenerates on the way', () => {
    const { engine, character, advance, id } = setup(fixture());
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(TICK);
    character.health = 1;
    advance(TICK);
    expect(character.health).toBeGreaterThan(1);
  });
});

describe('searching (3.3)', () => {
  function atArea(data: GameData = fixture()) {
    const s = setup(data);
    s.engine.dispatch({ type: 'sendToArea', characterId: s.id, areaId: AREA });
    s.advance(10_000);
    return s;
  }

  it('takes 6 s to find an enemy, then fights it', () => {
    const { character, advance } = atArea();
    advance(6000 - TICK);
    expect(character.phase).toBe('searching');
    advance(TICK);
    expect(character.phase).toBe('fighting');
    expect(character.fight?.enemyId).toBeDefined();
  });

  it('an area can override the movement time', () => {
    const { character, advance } = atArea(fixture({ movementSecondsBetweenEnemies: 2 }));
    advance(1900);
    expect(character.phase).toBe('searching');
    advance(TICK);
    expect(character.phase).toBe('fighting');
  });

  it('reads the movement time and the common multiplier from the game data', () => {
    const data = createGameData({
      constants: {
        ...constants,
        farming: { ...constants.farming, movementSecondsBetweenEnemies: 2, targeting: { commonMultiplier: 3, maxMultiplier: 10 } },
      },
      items: itemsJson,
      enemies: enemiesJson.map(({ targetingMultiplier: _unused, ...enemy }) => enemy),
      areas: areasJson,
    });
    const untargeted = atArea(data);
    untargeted.advance(1900);
    expect(untargeted.character.phase).toBe('searching');
    untargeted.advance(TICK);
    expect(untargeted.character.phase).toBe('fighting');

    const targeted = atArea(data);
    targeted.engine.dispatch({ type: 'setTarget', characterId: targeted.id, enemyId: RAT });
    targeted.advance(5900);
    expect(targeted.character.phase).toBe('searching');
    targeted.advance(TICK);
    expect(targeted.character.fight?.enemyId).toBe(RAT);
  });

  it('the speed skill shortens it', () => {
    const { character, advance } = atArea();
    character.proficiency.speed = 100;
    advance(4000 - TICK);
    expect(character.phase).toBe('searching');
    advance(TICK);
    expect(character.phase).toBe('fighting');
  });

  it('targeting multiplies the movement by the enemy own multiplier, and fights only that enemy', () => {
    const { engine, character, advance, id } = atArea();
    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: WISP });
    advance(18_000 - TICK);
    expect(character.phase).toBe('searching');
    advance(TICK);
    expect(character.fight?.enemyId).toBe(WISP);
  });

  it('targeting does not touch the fight: a rat takes as long, targeted or not', () => {
    const fightTicks = (target: string | null): number => {
      const { engine, character, advance, id } = atArea(fixture({ enemies: [{ enemyId: RAT, spawnWeight: 1 }], ...NO_SPECIALS }));
      engine.dispatch({ type: 'setTarget', characterId: id, enemyId: target });
      advance((target === null ? 6000 : 12_000) + TICK);
      let ticks = 0;
      while (character.phase === 'fighting') {
        advance(TICK);
        ticks++;
      }
      return ticks;
    };
    expect(fightTicks(RAT)).toBe(fightTicks(null));
  });

  it('goes from looting straight back to searching, and the whole gap between fights is the movement time', () => {
    const { engine, character, advance } = atArea(fixture({ enemies: [{ enemyId: RAT, spawnWeight: 1 }], ...NO_SPECIALS }));
    advance(6000 + TICK);
    while (character.phase === 'fighting') advance(TICK);
    expect(character.phase).toBe('looting');
    engine.drainEvents();

    advance(TICK);
    expect(character.phase).toBe('searching');
    advance(6000 - 2 * TICK);
    expect(character.phase).toBe('searching');
    advance(TICK);
    expect(character.phase).toBe('fighting');
    expect(engine.drainEvents().flatMap((e) => (e.type === 'phaseChanged' ? [e.to] : []))).toEqual(['searching', 'fighting']);
  });

  it('runs the phases in order, with no help', () => {
    const { engine, advance, id } = setup(fixture({ enemies: [{ enemyId: RAT, spawnWeight: 1 }], ...NO_SPECIALS }));
    engine.drainEvents();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(60_000);
    const phases = engine.drainEvents().flatMap((e) => (e.type === 'phaseChanged' ? [e.to] : []));
    expect(phases.slice(0, 6)).toEqual(['travelling', 'searching', 'fighting', 'looting', 'searching', 'fighting']);
  });
});

describe('commands (3.2, 3.3, L5)', () => {
  it('rejects a send to an unknown area, or from outside the city, and changes nothing', () => {
    const { engine, character, advance, id } = setup();
    engine.drainEvents();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: 'nowhere' });
    advance(TICK);
    expect(rejections(engine)).toEqual(['No area "nowhere".']);
    expect(character).toMatchObject({ phase: 'idle', areaId: null });

    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(TICK);
    engine.drainEvents();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(TICK);
    expect(rejections(engine)).toEqual(['Ysolde has to be in the city first.']);
    expect(character.timeInPhaseMs).toBe(2 * TICK);
  });

  it('says why a send is refused while dead, or while busy in the city', () => {
    const { engine, character, advance, id } = setup();
    engine.drainEvents();
    character.phase = 'dead';
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(TICK);
    expect(rejections(engine)).toEqual(['Ysolde is dead.']);

    character.phase = 'restocking';
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(TICK);
    expect(rejections(engine)).toEqual(['Ysolde is busy in the city.']);
  });

  it('publishes each command in order: its phase change, then the next command', () => {
    const { engine, advance, id } = setup();
    engine.drainEvents();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(TICK);
    expect(engine.drainEvents().map((e) => e.type)).toEqual(['phaseChanged', 'commandRejected']);
  });

  it('never throws on a saved area or character that the data no longer knows, and changes nothing', () => {
    const data = fixture();
    const state = freshState(data);
    const character = createCharacterState('c1', 'Ysolde', data);
    character.phase = 'travelling';
    character.areaId = 'gone';
    character.timeInPhaseMs = 500;
    state.roster.push(character);
    const ctx = { data, tickMs: TICK, streams: createCharacterStreams(SEED, 'c1'), emit: () => {} };
    const before = JSON.parse(JSON.stringify(character)) as CharacterState;

    const event = applyCommand(state, { type: 'returnToCity', characterId: 'c1' }, data, () => ctx);

    expect(event).toMatchObject({ type: 'commandRejected', reason: 'Ysolde has no area to return from.' });
    expect(character).toEqual(before);
    const missing = applyCommand(state, { type: 'returnToCity', characterId: 'c1' }, data, () => undefined);
    expect(missing).toMatchObject({ type: 'commandRejected', reason: 'No character "c1".' });
  });

  it('needs full health to set out (3.2), and goes once healed', () => {
    const { engine, character, advance, id } = setup();
    engine.drainEvents();
    character.health = 69;
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(TICK);
    expect(rejections(engine)).toEqual(['Ysolde needs full health to set out.']);
    expect(character).toMatchObject({ phase: 'idle', areaId: null });

    character.health = 70;
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(TICK);
    expect(character.phase).toBe('travelling');
  });

  it('refuses a target on the way back, because arriving would drop it, but can clear one', () => {
    const { engine, character, advance, id } = setup();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: RAT });
    advance(1000);
    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(TICK);
    expect(character.phase).toBe('returning');
    engine.drainEvents();

    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: WISP });
    advance(TICK);
    expect(rejections(engine)).toEqual(['Ysolde is on the way back.']);
    expect(character.targetEnemyId).toBe(RAT);

    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: null });
    advance(TICK);
    expect(character.targetEnemyId).toBeNull();
  });

  it('refuses a target while fleeing, and keeps one set while dead', () => {
    const data = fixture({ enemies: [{ enemyId: BOSS, spawnWeight: 1 }], ...NO_SPECIALS });
    const { engine, character, advance, id } = setup(data);
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(16_000 + TICK);
    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(TICK);
    expect(character.phase).toBe('fleeing');
    engine.drainEvents();
    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: BOSS });
    advance(TICK);
    expect(rejections(engine)).toEqual(['Ysolde is on the way back.']);

    const dead = setup(data);
    dead.character.areaId = AREA;
    dead.character.phase = 'dead';
    dead.engine.dispatch({ type: 'setTarget', characterId: dead.id, enemyId: BOSS });
    dead.advance(TICK);
    expect(dead.character.targetEnemyId).toBe(BOSS);
  });

  it('a return while dead or healing marks it to stay, and a second one is refused', () => {
    for (const phase of ['dead', 'restocking'] as const) {
      const { engine, character, advance, id } = setup();
      character.areaId = AREA;
      character.phase = phase;
      engine.drainEvents();
      engine.dispatch({ type: 'returnToCity', characterId: id });
      advance(TICK);
      expect(rejections(engine)).toEqual([]);
      expect(character).toMatchObject({ phase, stayInCity: true });

      engine.dispatch({ type: 'returnToCity', characterId: id });
      advance(TICK);
      expect(rejections(engine)).toEqual(['Ysolde is already staying in the city.']);
    }
  });

  it('marks the return in a fight, so it holds if the character dies fleeing, and arriving clears it', () => {
    const data = fixture({ enemies: [{ enemyId: BOSS, spawnWeight: 1 }], ...NO_SPECIALS });
    const { engine, character, advance, id } = setup(data);
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(16_000 + TICK);
    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(TICK);
    expect(character).toMatchObject({ phase: 'fleeing', stayInCity: true });
    advance(11_000);
    expect(character).toMatchObject({ phase: 'idle', stayInCity: false, areaId: null });
  });

  it('rejects a command for a character that does not exist', () => {
    const { engine, advance } = setup();
    engine.drainEvents();
    engine.dispatch({ type: 'returnToCity', characterId: 'nobody' });
    advance(TICK);
    expect(rejections(engine)).toEqual(['No character "nobody".']);
  });

  it('a command in the same batch can act on a character created just before it', () => {
    const data = fixture();
    const engine = createEngine({ data, state: freshState(data) });
    engine.dispatch({ type: 'createCharacter', name: 'Ysolde' });
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    engine.advanceTo(T0 + TICK);
    expect(engine.state.roster[0]?.phase).toBe('travelling');
  });

  it('a target needs an area, and an enemy that can be met there', () => {
    const { engine, character, advance, id } = setup();
    engine.drainEvents();
    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: RAT });
    advance(TICK);
    expect(rejections(engine)).toEqual(['Ysolde has no area to search.']);

    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: 'nobody' });
    advance(TICK);
    expect(rejections(engine)).toEqual(['No "nobody" in this area.']);
    expect(character.targetEnemyId).toBeNull();
  });

  it('can target the mini-boss and the boss, at their own multiplier, and clear the target', () => {
    const { engine, character, advance, id } = setup();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: MINI_BOSS });
    advance(TICK);
    expect(character.targetEnemyId).toBe(MINI_BOSS);
    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: BOSS });
    advance(10_000 + 60_000 - 2 * TICK);
    expect(character.phase).toBe('searching');
    advance(TICK);
    expect(character.fight?.enemyId).toBe(BOSS);
    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: null });
    advance(TICK);
    expect(character.targetEnemyId).toBeNull();
  });

  it('returning from the area takes the same 10 s, then the character stops in the city', () => {
    const { engine, character, advance, id } = setup();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(12_000);
    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(10_000 - TICK);
    expect(character.phase).toBe('returning');
    advance(TICK);
    expect(character).toMatchObject({ phase: 'idle', areaId: null, targetEnemyId: null });
    advance(30_000);
    expect(character.phase).toBe('idle');
  });

  it('on the way out, it turns round: the way back takes as long as it has walked', () => {
    const { engine, character, advance, id } = setup();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(3000);
    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(3000 - TICK);
    expect(character.phase).toBe('returning');
    advance(TICK);
    expect(character.phase).toBe('idle');
  });

  it('can leave while looting, and walks the whole way back', () => {
    const data = fixture({ enemies: [{ enemyId: RAT, spawnWeight: 1 }], ...NO_SPECIALS });
    const { engine, character, advance, id } = setup(data);
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(16_000 + TICK);
    while (character.phase === 'fighting') advance(TICK);
    expect(character.phase).toBe('looting');

    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(10_000 - TICK);
    expect(character.phase).toBe('returning');
    advance(TICK);
    expect(character.phase).toBe('idle');
  });

  it('in a fight, it leaves through fleeing, shortened by movement speed (L5)', () => {
    const data = fixture({ enemies: [{ enemyId: BOSS, spawnWeight: 1 }], ...NO_SPECIALS });
    const { engine, character, advance, id } = setup(data);
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(16_000 + TICK);
    expect(character.phase).toBe('fighting');

    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(TICK);
    expect(character.phase).toBe('fleeing');
    expect(character.fight).not.toBeNull();
    advance(800);
    expect(character.phase).toBe('fleeing');
    advance(TICK);
    expect(character).toMatchObject({ phase: 'returning', fight: null });
    advance(10_000 - TICK);
    expect(character.phase).toBe('returning');
    advance(TICK);
    expect(character.phase).toBe('idle');
  });

  it('rejects a return when it is already leaving, or is home', () => {
    const { engine, character, advance, id } = setup();
    engine.drainEvents();
    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(TICK);
    expect(rejections(engine)).toEqual(['Ysolde is already in the city.']);

    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    engine.dispatch({ type: 'returnToCity', characterId: id });
    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(TICK);
    expect(rejections(engine)).toEqual(['Ysolde is already on the way back.']);
    expect(character.phase === 'returning' || character.phase === 'idle').toBe(true);
  });

  it('can go out again after coming home, and the target stays behind', () => {
    const { engine, character, advance, id } = setup();
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    engine.dispatch({ type: 'setTarget', characterId: id, enemyId: RAT });
    advance(1000);
    engine.dispatch({ type: 'returnToCity', characterId: id });
    advance(2000);
    expect(character.phase).toBe('idle');
    engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
    advance(TICK);
    expect(character).toMatchObject({ phase: 'travelling', areaId: AREA, targetEnemyId: null });
  });
});

/** Farms for `hours` and counts the kills per enemy. The first kill counts from when the character arrives. */
function farm(data: GameData, hours: number, target: string | null, attributes?: PlayerBuild['attributes']) {
  const { engine, character, advance, id } = setup(data);
  if (attributes) character.attributes = { ...attributes };
  engine.dispatch({ type: 'sendToArea', characterId: id, areaId: AREA });
  if (target !== null) engine.dispatch({ type: 'setTarget', characterId: id, enemyId: target });
  advance(10_000);
  const kills: Record<string, number> = {};
  const count = (events: readonly EngineEvent[]): void => {
    for (const e of events) if (e.type === 'enemyKilled') kills[e.enemyId] = (kills[e.enemyId] ?? 0) + 1;
  };
  engine.drainEvents();
  for (let minute = 0; minute < hours * 60; minute++) {
    advance(60_000);
    count(engine.drainEvents());
    expect(character.phase).not.toBe('dead');
  }
  const total = Object.values(kills).reduce((a, b) => a + b, 0);
  return { kills, total, perHour: total / hours };
}

/** What `npm run balance:drops` says for this build: same formula, fight seconds from the same combat code. */
function toolKillsPerHour(build: PlayerBuild, target: string | null): number {
  const report = areaReport(
    loadBalanceData(),
    AREA,
    build.level,
    {
      fightSeconds: (enemy) =>
        meanFightSeconds(buildPlayer(build), enemyFromData(enemy), 300, createStream(1, 'fight', enemy.id)) ?? NaN,
    },
    target === null ? {} : { targetEnemyId: target },
  );
  return report.killsPerHour;
}

/** Kills most things in a hit or two, so the rare boss hardly moves the kill rate and a long run stays short to test. */
const STRONG: PlayerBuild = { ...defaultBuild(), attributes: { ...defaultBuild().attributes, strength: 100 } };

describe('kill rate against the balance tool, with deaths turned off (3.3, 5.3)', () => {
  const within5Percent = (actual: number, expected: number): void => {
    expect(Math.abs(actual / expected - 1)).toBeLessThan(0.05);
  };

  it('a new character, untargeted, on the tool\'s model of the area', () => {
    const { perHour } = farm(fixture(NO_SPECIALS), 4, null);
    within5Percent(perHour, toolKillsPerHour(defaultBuild(), null));
  });

  it('a new character, targeted', () => {
    const { perHour } = farm(fixture(NO_SPECIALS), 4, WISP);
    within5Percent(perHour, toolKillsPerHour(defaultBuild(), WISP));
  });

  it('a character strong for the area, with the real boss and mini-boss chances', () => {
    const { perHour } = farm(fixture(), 4, null, STRONG.attributes);
    within5Percent(perHour, toolKillsPerHour(STRONG, null));
  });
});

describe('spawn shares over a long seeded run (3.1)', () => {
  it('match the weights, and the boss and mini-boss chances, in the real area', () => {
    const { kills, total } = farm(fixture(), 40, null, STRONG.attributes);
    const area = loadGameData().areas[0] as unknown as (typeof areasJson)[number];
    const weightTotal = area.enemies.reduce((sum, e) => sum + e.spawnWeight, 0);
    const special = area.miniBossSpawnChance + area.bossSpawnChance;

    expect(total).toBeGreaterThan(15_000);
    for (const { enemyId, spawnWeight } of area.enemies) {
      const expected = (spawnWeight / weightTotal) * (1 - special);
      expect(Math.abs((kills[enemyId] ?? 0) / total - expected)).toBeLessThan(0.01);
    }
    expect(Math.abs((kills[MINI_BOSS] ?? 0) / total - area.miniBossSpawnChance)).toBeLessThan(0.004);
    expect(Math.abs((kills[BOSS] ?? 0) / total - area.bossSpawnChance)).toBeLessThan(0.002);
  });
});

describe('determinism (ADR 0002)', () => {
  const run = (cuts: readonly number[]): GameState => {
    const data = fixture();
    const engine = createEngine({ data, state: freshState(data) });
    engine.dispatch({ type: 'createCharacter', name: 'Ysolde' });
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    for (const t of cuts) engine.advanceTo(T0 + t);
    return engine.state;
  };

  it('the same seed farms the same way, however advanceTo calls are split', () => {
    const whole = run([120_000]);
    const parts = run([37, 2500, 2501, 9999, 16_100, 45_000, 80_000, 120_000]);
    expect(parts).toEqual(whole);
    expect(whole.roster[0]?.phase).not.toBe('idle');
  });

  it('a state saved during a search carries on the same after JSON', () => {
    const data = fixture();
    const first = createEngine({ data, state: freshState(data) });
    first.dispatch({ type: 'createCharacter', name: 'Ysolde' });
    first.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    first.advanceTo(T0 + 13_000);
    expect(first.state.roster[0]?.phase).toBe('searching');

    const second = createEngine({ data, state: JSON.parse(JSON.stringify(first.state)) as GameState });
    first.advanceTo(T0 + 200_000);
    second.advanceTo(T0 + 200_000);
    expect(second.state).toEqual(first.state);
  });
});
