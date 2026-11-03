import { describe, expect, it } from 'vitest';
import { parseFlags } from '../tools/balance/args';
import {
  baselineEnemy,
  buildPlayer,
  defaultBuild,
  enemyFromData,
  enemyOrBaseline,
  meanFightSeconds,
  referenceFightSeconds,
  percentile,
  referenceBuild,
  regenReport,
  resolveFight,
  runFights,
  summarise,
  type Combatant,
  type FightResult,
} from '../tools/balance/combat';
import { levelCurve } from '../tools/balance/curve';
import { areaAverageXp, areaReport, areaSecondsPerKill, unfarmableItems, type AreaReportData, type Pace } from '../tools/balance/drops';
import { BalanceError, baseMovementSeconds, targetingMultiplier } from '../tools/balance/load-data';
import { duration } from '../tools/balance/format';
import { createRng } from '../src/game/rng';

// Worked by hand from the design formulas (4.2, 3.6, 3.8, 4.7), with synthetic data. No data/*.json content is used.

const player: Combatant = { maxHp: 100, damage: 10, defence: 2, critChance: 0, intervalMs: 1000 };
const enemy: Combatant = { maxHp: 25, damage: 7, defence: 3, critChance: 0, intervalMs: 1500 };

describe('building fighters (4.2, 4.6)', () => {
  it('derives player stats from attributes and gear', () => {
    const build = { ...defaultBuild(5), attributes: { strength: 10, dexterity: 10, vitality: 10, intelligence: 10 }, weaponDamage: 4, armourDefence: 3 };
    const p = buildPlayer(build);
    expect(p.damage).toBeCloseTo(11); // 1 + 0.6 x 10 + 4
    expect(p.maxHp).toBeCloseTo(110); // 30 + 8 x 10
    expect(p.defence).toBeCloseTo(5.5); // 0.25 x 10 + 3
    expect(p.critChance).toBeCloseTo(0.04); // 0.02 + 0.002 x 10
    expect(p.intervalMs).toBe(1000); // 0.8 + 0.02 x 10 = 1 attack per second
  });

  it('the default build is unarmed with 5 in each attribute', () => {
    const p = buildPlayer(defaultBuild());
    expect(p.damage).toBeCloseTo(6); // 1 + 0.6 x 5 + unarmed 2
    expect(p.maxHp).toBeCloseTo(70);
    expect(p.defence).toBeCloseTo(1.25);
    expect(p.intervalMs).toBe(1100); // 0.9 attacks per second
  });

  it('applies the weapon penalty to the weapon damage only', () => {
    const attributes = { strength: 10, dexterity: 10, vitality: 10, intelligence: 10 };
    const armed = { ...defaultBuild(5), attributes, weaponDamage: 4, weaponScaling: [{ attribute: 'strength' as const, requiredValue: 14 }] };
    expect(buildPlayer(armed).damage).toBeCloseTo(10.84); // 1 + 6 + 4 x (1 - 4 x 0.01)
    const unarmed = { ...armed, weaponDamage: null };
    expect(buildPlayer(unarmed).damage).toBeCloseTo(9); // 1 + 6 + 2, no penalty
  });

  it('applies proficiency bonuses', () => {
    const build = {
      ...defaultBuild(5),
      attributes: { strength: 10, dexterity: 10, vitality: 10, intelligence: 10 },
      weaponDamage: 4,
      weaponType: 'one-handed' as const,
      weaponProficiency: 50, // +15% damage, +5% attack speed
      toughnessProficiency: 100, // +30% health
      combatProficiency: 50, // +5% attack speed: 1 x 1.1 per second -> 909 ms -> 9 ticks
    };
    const p = buildPlayer(build);
    expect(p.damage).toBeCloseTo(12.65); // 11 x 1.15
    expect(p.maxHp).toBeCloseTo(143); // 110 x 1.3
    expect(p.intervalMs).toBe(900);
  });

  it('level 1 baseline enemy is the base values (3.5)', () => {
    const e = baselineEnemy(1);
    expect(e.maxHp).toBe(24);
    expect(e.damage).toBe(5);
    expect(e.defence).toBe(0);
    expect(e.critChance).toBe(0);
  });

  it('reference build follows the decision log numbers (N6)', () => {
    const l1 = referenceBuild(1); // 20 attribute points at 45/20/25/10, weapon 3, armour 1
    expect(l1.attributes.strength).toBeCloseTo(9);
    expect(l1.attributes.dexterity).toBeCloseTo(4);
    expect(l1.attributes.vitality).toBeCloseTo(5);
    expect(l1.attributes.intelligence).toBeCloseTo(2);
    expect(l1.weaponDamage).toBeCloseTo(3);
    expect(l1.armourDefence).toBeCloseTo(1);
    const l11 = referenceBuild(11); // 20 + 3 x 10 = 50 points; weapon 3 + 18; armour 1 + 9
    expect(l11.attributes.strength).toBeCloseTo(22.5);
    expect(l11.weaponDamage).toBeCloseTo(21);
    expect(l11.armourDefence).toBeCloseTo(10);
  });

  it('uses baseline stats for an enemy entry without stats', () => {
    const full = { id: 'x', level: 3, health: 50, damage: 8, attackSpeed: 2, defence: 4 };
    expect(enemyOrBaseline(full)).toEqual(enemyFromData(full));
    expect(enemyOrBaseline({ id: 'y', level: 1 })).toEqual(baselineEnemy(1));
  });

  it('builds an enemy from data and rejects incomplete entries', () => {
    const e = enemyFromData({ id: 'x', level: 3, health: 50, damage: 8, attackSpeed: 2, defence: 4 });
    expect(e.maxHp).toBe(50);
    expect(e.intervalMs).toBe(500);
    expect(() => enemyFromData({ id: 'y', level: 3 })).toThrow();
  });
});

describe('fight resolution (3.6)', () => {
  it('player needs 4 hits of 7 on 25 health; the enemy lands 2 hits of 5 first', () => {
    const r = resolveFight(player, enemy, createRng(1));
    expect(r.outcome).toBe('win');
    expect(r.timeMs).toBe(4000);
    expect(r.playerHits).toBe(4);
    expect(r.enemyHits).toBe(2); // at 1500 ms and 3000 ms; the next would be 4500 ms
    expect(r.damageTaken).toBeCloseTo(10);
  });

  it('a crit multiplies the damage after defence by 2 and the player acts first on a shared tick', () => {
    const r = resolveFight({ ...player, critChance: 1 }, enemy, createRng(1));
    expect(r.outcome).toBe('win');
    expect(r.timeMs).toBe(2000); // 14 x 2 = 28 >= 25
    expect(r.playerCrits).toBe(2);
    expect(r.enemyHits).toBe(1); // 1500 ms only: the enemy is dead before it acts at 2000 ms
    expect(r.damageTaken).toBeCloseTo(5);
  });

  it('a hit does at least the minimum damage', () => {
    const r = resolveFight({ ...player, damage: 3 }, { ...enemy, maxHp: 3 }, createRng(1));
    expect(r.timeMs).toBe(3000); // 3 - 3 = 0, raised to 1, so three hits for 3 health
  });

  it('the player loses when health reaches 0', () => {
    const r = resolveFight({ ...player, maxHp: 8 }, enemy, createRng(1));
    expect(r.outcome).toBe('loss');
    expect(r.timeMs).toBe(3000); // 5 at 1500 ms, 5 more at 3000 ms; the player hit 3 times for 21 of 25 first
    expect(r.playerHits).toBe(3);
    expect(r.damageTaken).toBeCloseTo(10);
  });

  it('gives up after the time limit', () => {
    const wall: Combatant = { maxHp: 1000, damage: 1, defence: 50, critChance: 0, intervalMs: 1000 };
    const harmless: Combatant = { ...player, maxHp: 100000, damage: 1, defence: 0 };
    const r = resolveFight(harmless, wall, createRng(1), { maxSeconds: 10 });
    expect(r.outcome).toBe('timeout');
    expect(r.timeMs).toBe(10000);
    expect(r.playerHits).toBe(10);
  });
});

describe('fight seconds for the tools', () => {
  it('mean fight seconds is the time to kill', () => {
    expect(meanFightSeconds(player, enemy, 5, createRng(1))).toBeCloseTo(4);
  });

  it('is null when the player never wins', () => {
    expect(meanFightSeconds({ ...player, maxHp: 1 }, enemy, 5, createRng(1))).toBeNull();
  });

  it('the reference build beats the baseline enemy of its own level in a few seconds', () => {
    const seconds = referenceFightSeconds(5, baselineEnemy(5), 'test');
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThan(30);
  });

  it('throws a BalanceError when the reference build cannot win', () => {
    const wall: Combatant = { maxHp: 1e9, damage: 1e9, defence: 1e9, critChance: 0, intervalMs: 100 };
    expect(() => referenceFightSeconds(1, wall, 'a wall')).toThrow(BalanceError);
  });
});

describe('fight summary', () => {
  const res = (outcome: FightResult['outcome'], timeMs: number, damageTaken: number): FightResult => ({
    outcome, timeMs, damageTaken, playerHits: 0, playerCrits: 0, enemyHits: 0,
  });

  it('adds up wins, times and damage', () => {
    const s = summarise([res('win', 2000, 10), res('win', 4000, 20), res('win', 6000, 30), res('loss', 3000, 120)], 100);
    expect(s.runs).toBe(4);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(0.75);
    expect(s.timeToKill?.mean).toBeCloseTo(4);
    expect(s.timeToKill?.median).toBeCloseTo(4);
    expect(s.timeToKill?.p95).toBeCloseTo(6); // nearest rank: ceil(0.95 x 3) = 3rd value
    expect(s.timeToKill?.min).toBeCloseTo(2);
    expect(s.timeToKill?.max).toBeCloseTo(6);
    expect(s.meanDamageTaken).toBeCloseTo(45); // (10 + 20 + 30 + 120) / 4
    expect(s.meanHpLostFraction).toBeCloseTo(0.4); // (0.1 + 0.2 + 0.3 + 1) / 4
    expect(s.fightsPerFullHealth).toBeCloseTo(5); // 100 / 20, wins only
  });

  it('has no time to kill without wins', () => {
    expect(summarise([res('loss', 1000, 100)], 100).timeToKill).toBeNull();
  });

  it('percentile uses nearest rank', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(ten, 0.5)).toBe(5);
    expect(percentile(ten, 0.95)).toBe(10);
    expect(percentile(ten, 0.1)).toBe(1);
  });

  it('many seeded fights are repeatable and a fixed matchup always gives the same result', () => {
    const a = runFights(player, enemy, 20, createRng(9));
    const b = runFights(player, enemy, 20, createRng(9));
    expect(a).toEqual(b);
    expect(a.winRate).toBe(1);
    expect(a.timeToKill?.mean).toBeCloseTo(4);
  });

  it('crit rate shows up in the mean time to kill', () => {
    // 50% crit: hits of 7 or 14 against 25 health. 2 s if both hits crit (1/4), 4 s if none of the first 3 do (1/8),
    // else 3 s (5/8): mean 0.5 + 1.875 + 0.5 = 2.875 s.
    const s = runFights({ ...player, critChance: 0.5 }, enemy, 4000, createRng(5));
    expect(s.timeToKill?.min).toBeCloseTo(2);
    expect(s.timeToKill?.max).toBeCloseTo(4);
    expect(s.timeToKill?.mean).toBeGreaterThan(2.775);
    expect(s.timeToKill?.mean).toBeLessThan(2.975);
  });
});

// Area: e1 (level 3, weight 3, fights 6 s) and e2 (level 8, weight 1, fights 10 s), 5 s of movement between enemies.
// Mean fight 0.75 x 6 + 0.25 x 10 = 7 s, so 12 s per kill = 300 kills per hour at character level 5.
const data: AreaReportData = {
  areas: [
    { id: 'a1', name: 'Test area', movementSecondsBetweenEnemies: 5, enemies: [{ enemyId: 'e1', spawnWeight: 3 }, { enemyId: 'e2', spawnWeight: 1 }] },
    { id: 'a2', name: 'Default movement', enemies: [{ enemyId: 'e1', spawnWeight: 1 }] },
  ],
  enemies: [
    {
      id: 'e1', level: 3, type: 'normal', xpReward: 20, moneyRange: { min: 10, max: 20 }, dropTableId: 't1',
      traits: [{ id: 'life-steal', value: 10, magical: true }, { id: 'thorns', value: 5, magical: false }],
    },
    { id: 'e2', level: 8, type: 'normal', dropTableId: 't2', targetingMultiplier: 8 },
  ],
  dropTables: [
    { id: 't1', entries: [{ itemId: 'gem', baseChance: 0.1, minQuantity: 1, maxQuantity: 3 }] },
    {
      id: 't2',
      entries: [{ itemId: 'gem', baseChance: 0.5 }, { itemId: 'bone', baseChance: 0.2 }],
      guaranteedPools: [
        { id: 'bonus', entries: [{ itemId: 'ore', weight: 3, minQuantity: 3, maxQuantity: 5 }, { itemId: 'gem', weight: 1, minQuantity: 1, maxQuantity: 1 }] },
      ],
    },
  ],
  items: [{ id: 'gem', name: 'Gem', sellPrice: 10 }, { id: 'bone' }, { id: 'ore' }],
};
const pace: Pace = { fightSeconds: (e) => (e.id === 'e1' ? 6 : 10) };

describe('area report (3.8, 4.7)', () => {
  const report = areaReport(data, 'a1', 5, pace);
  const e1 = report.enemies[0]!;
  const e2 = report.enemies[1]!;

  it('splits kills by spawn weight, with fight and movement making up the time per kill', () => {
    expect(report.fightSeconds).toBeCloseTo(7);
    expect(report.movementSeconds).toBeCloseTo(5);
    expect(report.secondsPerKill).toBeCloseTo(12);
    expect(areaSecondsPerKill(data.areas[0]!, data.enemies, pace)).toBeCloseTo(12);
    expect(report.killsPerHour).toBeCloseTo(300);
    expect(e1.share).toBeCloseTo(0.75);
    expect(e1.killsPerHour).toBeCloseTo(225);
    expect(e2.killsPerHour).toBeCloseTo(75);
    expect(e1.fightSeconds).toBe(6);
  });

  it('applies the drop level modifier to the base chance', () => {
    expect(e1.dropModifier).toBeCloseTo(0.8); // 2 levels above: 1 - 0.1 x 2
    const gem1 = e1.drops[0]!;
    expect(gem1.finalChance).toBeCloseTo(0.08);
    expect(gem1.avgQuantity).toBeCloseTo(2);
    expect(gem1.dropsPerKill).toBeCloseTo(0.16);
    expect(gem1.dropsPerHour).toBeCloseTo(36); // 225 x 0.16
    expect(gem1.poolId).toBeNull();
    expect(e2.dropModifier).toBeCloseTo(1); // enemy above the character
    expect(e2.drops[0]!.dropsPerHour).toBeCloseTo(37.5); // 75 x 0.5
    expect(e2.drops[1]!.dropsPerHour).toBeCloseTo(15); // 75 x 0.2
  });

  it('guaranteed pools give one entry per kill by weight, with a quantity between min and max', () => {
    const ore = e2.drops[2]!;
    expect(ore.itemId).toBe('ore');
    expect(ore.poolId).toBe('bonus');
    expect(ore.finalChance).toBeCloseTo(0.75); // 3 / 4
    expect(ore.avgQuantity).toBeCloseTo(4);
    expect(ore.dropsPerKill).toBeCloseTo(3);
    expect(ore.dropsPerHour).toBeCloseTo(225); // 75 kills x 0.75 x 4
    const poolGem = e2.drops[3]!;
    expect(poolGem.dropsPerHour).toBeCloseTo(18.75); // 75 x 0.25 x 1
    // Per kill the pool yields exactly one entry: weights sum to 1.
    expect(ore.finalChance + poolGem.finalChance).toBeCloseTo(1);
  });

  it('does not apply the level modifier to guaranteed pools', () => {
    for (const level of [15, 25]) {
      const high = areaReport(data, 'a1', level, pace);
      expect(high.enemies[1]!.drops[2]!.dropsPerHour).toBeCloseTo(225);
      expect(high.enemies[1]!.drops[3]!.dropsPerHour).toBeCloseTo(18.75);
    }
    const far = areaReport(data, 'a1', 25, pace); // 17 levels above e2: modifier 0
    expect(far.enemies[1]!.drops[0]!.dropsPerHour).toBe(0);
  });

  it('totals an item over all enemies and pools and prices it when it can be sold', () => {
    const gem = report.items.find((i) => i.itemId === 'gem')!;
    expect(gem.dropsPerHour).toBeCloseTo(92.25); // 36 + 37.5 + 18.75
    expect(gem.sellValuePerHour).toBeCloseTo(922.5);
    expect(report.items.find((i) => i.itemId === 'bone')!.sellValuePerHour).toBeNull();
    expect(report.items.find((i) => i.itemId === 'ore')!.dropsPerHour).toBeCloseTo(225);
    expect(report.dropValuePerHour).toBeCloseTo(922.5);
  });

  it('XP and gold ignore the level gap and fall back to the formulas', () => {
    expect(e1.xpPerHour).toBeCloseTo(4500); // 225 x 20
    expect(e2.xpPerKill).toBe(19); // round(10 x 1.1^7)
    expect(e2.xpPerHour).toBeCloseTo(1425);
    expect(report.xpPerHour).toBeCloseTo(5925);
    expect(e1.goldPerHour).toBeCloseTo(3375); // 225 x 15
    expect(e2.goldPerKill).toBeCloseTo(10); // baseline range 5 to 15
    expect(report.goldPerHour).toBeCloseTo(4125);
  });

  it('absorption rate and kills to reach the enemy value', () => {
    expect(e1.absorptionModifier).toBeCloseTo(0.81); // 0.9^2
    expect(e2.absorptionModifier).toBe(1);
    expect(e1.traits).toHaveLength(1); // thorns is physical
    const t = e1.traits[0]!;
    expect(t.perKill).toBeCloseTo(0.081); // 10 x 1% x 0.81
    expect(t.killsToCap).toBe(124); // ceil(10 / 0.081)
    expect(t.hoursToCap).toBeCloseTo(124 / 225);
  });

  it('a character far above the enemy gets no normal drops but still absorbs', () => {
    const high = areaReport(data, 'a1', 15, pace);
    expect(high.enemies[0]!.dropModifier).toBe(0); // 12 levels above: max(0, 1 - 1.2)
    expect(high.enemies[0]!.drops[0]!.dropsPerHour).toBe(0);
    expect(high.enemies[0]!.absorptionModifier).toBeGreaterThan(0);
  });

  it('targeting multiplies the movement by the targeted enemy\'s own multiplier (3.3)', () => {
    // e1 has no multiplier in data, so the common one (2): 6 + 5 x 2 = 16 s, 225 kills per hour.
    const t1 = areaReport(data, 'a1', 5, pace, { targetEnemyId: 'e1' });
    expect(t1.enemies).toHaveLength(1);
    expect(t1.targetingMultiplier).toBe(2);
    expect(t1.fightSeconds).toBe(6);
    expect(t1.movementSeconds).toBeCloseTo(10);
    expect(t1.secondsPerKill).toBeCloseTo(16);
    expect(t1.killsPerHour).toBeCloseTo(225);
    expect(t1.enemies[0]!.drops[0]!.dropsPerHour).toBeCloseTo(36); // 225 x 0.16
    // e2 has multiplier 8: 10 + 5 x 8 = 50 s, 72 kills per hour.
    const t2 = areaReport(data, 'a1', 5, pace, { targetEnemyId: 'e2' });
    expect(t2.targetingMultiplier).toBe(8);
    expect(t2.secondsPerKill).toBeCloseTo(50);
    expect(t2.killsPerHour).toBeCloseTo(72);
    expect(t2.enemies[0]!.drops[0]!.dropsPerHour).toBeCloseTo(36); // 72 x 0.5
    expect(t2.enemies[0]!.drops[2]!.dropsPerHour).toBeCloseTo(216); // 72 x 3 (pool ore)
    expect(() => areaReport(data, 'a1', 5, pace, { targetEnemyId: 'nope' })).toThrow();
  });

  it('movement comes from the area, then the constants, and can be overridden or shortened by speed', () => {
    expect(baseMovementSeconds(data.areas[0]!)).toBe(5);
    expect(baseMovementSeconds(data.areas[1]!)).toBe(6); // constants.farming.movementSecondsBetweenEnemies
    expect(areaReport(data, 'a2', 5, { fightSeconds: 4 }).secondsPerKill).toBeCloseTo(10);
    expect(areaReport(data, 'a1', 5, { ...pace, movementSeconds: 10 }).secondsPerKill).toBeCloseTo(17);
    // 100 speed points: 5 / 1.5 = 3.333 s of movement. Targeting e1: 6 + 3.333 x 2 = 12.667 s.
    const fast = areaReport(data, 'a1', 5, { ...pace, speedPoints: 100 }, { targetEnemyId: 'e1' });
    expect(fast.movementSeconds).toBeCloseTo(6.6667, 3);
    expect(fast.secondsPerKill).toBeCloseTo(12.6667, 3);
  });

  it('checks the targeting multiplier against the maximum of 10', () => {
    expect(targetingMultiplier({ id: 'a', level: 1 })).toBe(2);
    expect(targetingMultiplier({ id: 'a', level: 1, targetingMultiplier: 10 })).toBe(10);
    expect(() => targetingMultiplier({ id: 'a', level: 1, targetingMultiplier: 11 })).toThrow(BalanceError);
    expect(() => targetingMultiplier({ id: 'a', level: 1, targetingMultiplier: 0.5 })).toThrow(BalanceError);
  });

  it('rejects unknown areas, empty pools and a zero pace', () => {
    expect(() => areaReport(data, 'nope', 5, pace)).toThrow();
    expect(() => areaReport(data, 'a1', 5, { fightSeconds: 0, movementSeconds: 0 })).toThrow();
    expect(() => areaReport(data, 'a1', 5, { fightSeconds: -1 })).toThrow();
    const empty: AreaReportData = {
      ...data,
      dropTables: [{ id: 't1', entries: [], guaranteedPools: [{ id: 'p', entries: [{ itemId: 'gem', weight: 0 }] }] }, ...data.dropTables.slice(1)],
    };
    expect(() => areaReport(empty, 'a2', 5, pace)).toThrow(BalanceError);
  });

  it('averages XP over the spawn mix', () => {
    expect(areaAverageXp(data.areas[0]!, data.enemies)).toBeCloseTo(19.75); // 0.75 x 20 + 0.25 x 19
  });
});

describe('progression curve (4.3)', () => {
  const table = [
    { level: 1, xpToNext: 100 },
    { level: 2, xpToNext: 300 },
    { level: 3, xpToNext: 1000 },
  ];

  it('rounds kills up and adds up time', () => {
    const steps = levelCurve({ fromLevel: 1, toLevel: 4, xpPerKill: () => 30, secondsPerKill: 10, table });
    expect(steps).toHaveLength(3);
    expect(steps[0]!.kills).toBe(4); // 100 / 30 = 3.33
    expect(steps[0]!.seconds).toBe(40);
    expect(steps[1]!.kills).toBe(10); // exactly 300 / 30
    expect(steps[1]!.cumulativeSeconds).toBe(140);
    expect(steps[2]!.kills).toBe(34); // 1000 / 30 = 33.3
    expect(steps[2]!.cumulativeSeconds).toBe(480);
  });

  it('seconds per kill can follow the character level', () => {
    const steps = levelCurve({ fromLevel: 1, toLevel: 3, xpPerKill: () => 30, secondsPerKill: (l) => 10 * l, table });
    expect(steps[0]!.secondsPerKill).toBe(10);
    expect(steps[0]!.seconds).toBe(40); // 4 kills
    expect(steps[1]!.secondsPerKill).toBe(20);
    expect(steps[1]!.seconds).toBe(200); // 10 kills
    expect(() => levelCurve({ fromLevel: 1, toLevel: 2, xpPerKill: () => 30, secondsPerKill: 0, table })).toThrow();
  });

  it('XP per kill can follow the character level', () => {
    const steps = levelCurve({ fromLevel: 1, toLevel: 3, xpPerKill: (l) => 25 * l, secondsPerKill: 1, table });
    expect(steps[0]!.kills).toBe(4); // 100 / 25
    expect(steps[1]!.kills).toBe(6); // 300 / 50
  });

  it('rejects an empty range, a missing table row and zero XP', () => {
    expect(() => levelCurve({ fromLevel: 3, toLevel: 3, xpPerKill: () => 1, secondsPerKill: 1, table })).toThrow();
    expect(() => levelCurve({ fromLevel: 1, toLevel: 6, xpPerKill: () => 1, secondsPerKill: 1, table })).toThrow();
    expect(() => levelCurve({ fromLevel: 1, toLevel: 2, xpPerKill: () => 0, secondsPerKill: 1, table })).toThrow();
  });
});

describe('script helpers', () => {
  const spec = {
    level: { kind: 'number', help: '' },
    enemy: { kind: 'string', help: '' },
    reference: { kind: 'boolean', help: '' },
  } as const;

  it('parses flags in both forms and skips a bare --', () => {
    const f = parseFlags(['--', '--level', '5', '--enemy=wolf', '--reference'], spec);
    expect(f.number('level')).toBe(5);
    expect(f.string('enemy')).toBe('wolf');
    expect(f.bool('reference')).toBe(true);
    expect(f.number('enemy')).toBe(undefined);
    expect(parseFlags([], spec).bool('reference')).toBe(false);
  });

  it('accepts a negative number as a value', () => {
    expect(parseFlags(['--level', '-2'], spec).number('level')).toBe(-2);
  });

  it('rejects unknown flags, missing values and bad numbers', () => {
    expect(() => parseFlags(['--nope'], spec)).toThrow();
    expect(() => parseFlags(['--level'], spec)).toThrow();
    expect(() => parseFlags(['--level', 'abc'], spec)).toThrow();
  });

  it('formats durations', () => {
    expect(duration(45)).toBe('45s');
    expect(duration(90)).toBe('1m 30s');
    expect(duration(5400)).toBe('1h 30m');
    expect(duration(200000)).toBe('2d 7h'); // 55 h 33 min
  });
});

describe('regeneration report (3.7)', () => {
  it('works out the gap regeneration and the net loss per cycle by hand', () => {
    // 200 max health: 0.5% = 1 HP/s. 6 s gap -> 6 HP = 3% of max. Fight 4 s + gap 6 s = 10 s -> 10 HP regained.
    // 18 damage taken per fight -> net loss 8 HP = 4% of max.
    const r = regenReport(200, 18, 4, 6);
    expect(r.regenPerSecond).toBeCloseTo(1);
    expect(r.gapRegenHp).toBeCloseTo(6);
    expect(r.gapRegenFraction).toBeCloseTo(0.03);
    expect(r.cycleSeconds).toBeCloseTo(10);
    expect(r.cycleRegenHp).toBeCloseTo(10);
    expect(r.netHpLost).toBeCloseTo(8);
    expect(r.netHpLostFraction).toBeCloseTo(0.04);
  });

  it('is a net gain when regeneration beats the damage', () => {
    // 100 max health: 0.5 HP/s, 10 s cycle -> 5 HP; 2 damage -> -3.
    expect(regenReport(100, 2, 4, 6).netHpLost).toBeCloseTo(-3);
  });

  it('rejects bad input', () => {
    expect(() => regenReport(0, 1, 1, 1)).toThrow(BalanceError);
    expect(() => regenReport(100, 1, 1, -1)).toThrow(BalanceError);
  });
});

describe('items a character cannot farm (3.8)', () => {
  // Drop modifier is 1 - 0.1 x (character level - enemy level), 0 from 10 levels above. e1 is level 3, e2 is level 8.
  // Character level 13: e1 gap 10 -> 0 (gem, from e1, 0%); e2 gap 5 -> 0.5. Gem drops from e2 too, so it is farmable.
  // Character level 20: gaps 17 and 12 -> both 0. Bone (e2 only) is 0%. Gem is 0% in both normal entries, but e2's
  // guaranteed pool also holds gem (no level modifier), so gem stays farmable; only bone is listed.
  it('lists only items that every dropping enemy gives at 0%', () => {
    const at13 = areaReport(data, 'a1', 13, pace);
    expect(unfarmableItems(at13)).toEqual([]);
    const at20 = areaReport(data, 'a1', 20, pace);
    expect(unfarmableItems(at20)).toEqual([{ itemId: 'bone', itemName: 'bone', enemyNames: ['e2'] }]);
  });

  it('keeps guaranteed pool items farmable at any level (no level modifier)', () => {
    const at20 = areaReport(data, 'a1', 20, pace);
    expect(unfarmableItems(at20).some((u) => u.itemId === 'ore')).toBe(false);
  });

  it('is empty when the character is not far above the enemies', () => {
    expect(unfarmableItems(areaReport(data, 'a1', 5, pace))).toEqual([]);
  });
});
