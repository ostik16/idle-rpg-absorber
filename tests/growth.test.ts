import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import itemsJson from '../data/items.json';
import slotsJson from '../data/equipment-slots.json';
import thresholds from '../data/bestiary-thresholds.json';
import traitsJson from '../data/traits.json';
import xpTableJson from '../data/xp-table.json';
import { createGameData, type GameData } from '../src/data/game-data';
import { stepCharacter, type StepContext } from '../src/engine/character';
import { createEngine } from '../src/engine/engine';
import type { EngineEvent } from '../src/engine/events';
import { startFight } from '../src/engine/fight';
import { createCharacterStreams } from '../src/engine/streams';
import { bestiaryTier } from '../src/game/bestiary';
import { lifeStealHeal, regenerationHeal } from '../src/game/traits';
import { createCharacterState, createGameState } from '../src/state/factory';
import { derivedStats } from '../src/state/selectors';

const TICK = constants.combat.tickMs;

const AREA = {
  id: 'glade',
  levelRange: { min: 1, max: 5 },
  distanceFromCity: 2,
  movementSecondsBetweenEnemies: 1,
  enemies: [{ enemyId: 'rat', spawnWeight: 1 }],
  miniBossSpawnChance: 0,
  bossSpawnChance: 0,
};
const rat = (id: string, over: object = {}) => ({
  id,
  level: 1,
  type: 'normal',
  health: 1,
  damage: 0,
  attackSpeed: 0.01,
  defence: 0,
  xpReward: 1,
  traits: [
    { id: 'life-steal', value: 10, magical: true },
    { id: 'keen-fangs', value: 5, magical: false },
  ],
  ...over,
});
const ENEMIES = [
  rat('rat'),
  rat('boss', { type: 'boss' }),
  rat('mini', { type: 'mini-boss' }),
  rat('old', { level: 11 }),
  rat('biter', { damage: 1, attackSpeed: 1, health: 1_000_000 }),
];

function fixture(): GameData {
  return createGameData({
    constants: { ...constants, stats: { ...constants.stats, critChance: { base: 0, perDexterity: 0, cap: 0 } } },
    items: itemsJson,
    enemies: ENEMIES,
    areas: [AREA],
    xpTable: xpTableJson,
    traits: traitsJson,
    equipmentSlots: slotsJson,
    bestiaryThresholds: thresholds,
  });
}
const DATA = fixture();

function harness() {
  const character = createCharacterState('c1', 'Ysolde', DATA);
  const events: EngineEvent[] = [];
  const ctx: StepContext = {
    data: DATA,
    tickMs: TICK,
    streams: createCharacterStreams(7, 'c1'),
    emit: (e) => void events.push(e),
  };
  const kill = (enemyId = 'rat', times = 1): void => {
    for (let i = 0; i < times; i++) {
      startFight(character, enemyId, ctx);
      for (let n = 0; character.phase === 'fighting' && n < 10_000; n++) stepCharacter(character, ctx);
    }
  };
  return { character, ctx, events, kill };
}

describe('proficiency from actions (4.6, L11)', () => {
  it('trains unarmed and combat on a hit, and nothing else', () => {
    const { character, kill } = harness();
    kill('rat');
    expect(character.proficiency.unarmed).toBeCloseTo(0.003);
    expect(character.proficiency.combat).toBeCloseTo(0.0015);
    expect(character.proficiency['one-handed']).toBe(0);
    expect(character.proficiency.toughness).toBe(0);
  });

  it('trains the style of the weapon in the main hand', () => {
    const { character, kill } = harness();
    character.equipment['main-hand'] = { itemId: 'rusty-sword', bonuses: [], upgradeLevel: 0, qty: 1 };
    kill('rat');
    expect(character.proficiency['one-handed']).toBeCloseTo(0.003);
    expect(character.proficiency.unarmed).toBe(0);
    character.equipment['main-hand'] = { itemId: 'oak-greatclub', bonuses: [], upgradeLevel: 0, qty: 1 };
    kill('rat');
    expect(character.proficiency['two-handed']).toBeCloseTo(0.003);
  });

  it('trains toughness on hits taken', () => {
    const { character, ctx } = harness();
    startFight(character, 'biter', ctx);
    for (let i = 0; i < 100; i++) stepCharacter(character, ctx); // 10 s, one hit a second
    expect(character.proficiency.toughness).toBeCloseTo(10 * 0.003);
  });

  it('trains speed by the seconds moved, at the area level', () => {
    const { character, ctx } = harness();
    character.areaId = 'glade';
    character.phase = 'travelling';
    for (let i = 0; i < 10; i++) stepCharacter(character, ctx); // 1 s
    expect(character.proficiency.speed).toBeCloseTo(0.001);
  });
});

describe('absorption on kill (4.7)', () => {
  it('100 same-level kills of a 10% trait give exactly 10%, and no more', () => {
    const { character, kill } = harness();
    kill('rat', 99);
    expect(character.absorption['life-steal']).toBeCloseTo(9.9);
    kill('rat', 1);
    expect(character.absorption['life-steal']).toBeCloseTo(10);
    kill('rat', 20);
    expect(character.absorption['life-steal']).toBe(10);
  });

  it('gives nothing for physical traits, bosses and mini-bosses', () => {
    const { character, kill } = harness();
    kill('boss');
    kill('mini');
    expect(character.absorption).toEqual({});
    kill('rat');
    expect(character.absorption['keen-fangs']).toBeUndefined();
  });

  it('scales by 0.9 per level the character is above the enemy, and not at all below', () => {
    const above = harness();
    above.character.level = 3;
    above.kill('rat');
    expect(above.character.absorption['life-steal']).toBeCloseTo(0.1 * 0.81);
    const below = harness();
    below.kill('old');
    expect(below.character.absorption['life-steal']).toBeCloseTo(0.1);
  });
});

describe('what absorbed traits do (L12)', () => {
  it('formulas', () => {
    expect(lifeStealHeal(20, 10)).toBe(2);
    expect(regenerationHeal(200, 3)).toBe(6);
  });

  it('life steal heals a share of each hit, up to maximum health', () => {
    const { character, ctx } = harness();
    character.absorption['life-steal'] = 50;
    const max = derivedStats(character, DATA).maxHealth;
    character.health = max - 1000;
    startFight(character, 'biter', ctx);
    const before = character.health;
    for (let i = 0; i < 10; i++) stepCharacter(character, ctx);
    expect(character.health).toBeGreaterThan(before - 2);
    character.health = max;
    for (let i = 0; i < 10; i++) stepCharacter(character, ctx);
    expect(character.health).toBeLessThanOrEqual(max);
  });

  it('regeneration restores its share every 10 seconds', () => {
    const { ctx } = harness();
    const stats = { ...constants.stats, healthRegen: { fractionOfMaxPerSecond: 0 } };
    const data = createGameData({ constants: { ...constants, stats }, traits: traitsJson });
    const c = createCharacterState('c2', 'Mara', data);
    const hctx = { ...ctx, data };
    c.absorption['regeneration'] = 5;
    const max = derivedStats(c, data).maxHealth;
    c.health = 1;
    for (let i = 0; i < 99; i++) stepCharacter(c, hctx);
    expect(c.health).toBe(1);
    stepCharacter(c, hctx);
    expect(c.health).toBeCloseTo(1 + max * 0.05);
  });
});

describe('bestiary (4.8, ADR 0003)', () => {
  it('tiers follow the thresholds', () => {
    expect([0, 1, 9, 10, 25, 50, 99, 100].map((k) => bestiaryTier(k, thresholds))).toEqual([0, 1, 1, 2, 3, 4, 4, 5]);
  });

  it('counts kills per character, reveals for all, and keeps the reveal when the character is gone', () => {
    const state = createGameState(1, 0, DATA);
    const engine = createEngine({ data: DATA, state });
    engine.dispatch({ type: 'createCharacter', name: 'Ysolde' });
    engine.advanceTo(TICK);
    const c = state.roster[0]!;
    c.areaId = 'glade';
    c.phase = 'searching';
    c.timeInPhaseMs = 1_000_000;
    let now = TICK;
    for (let i = 0; i < 20_000 && (state.bestiary.kills[c.id]?.rat ?? 0) < 10; i++) engine.advanceTo((now += TICK));
    expect(state.bestiary.kills[c.id]?.rat).toBe(10);
    expect(state.bestiary.revealed.rat).toBe(2);
    state.roster.length = 0;
    delete state.bestiary.kills[c.id];
    expect(state.bestiary.revealed.rat).toBe(2);
  });
});
