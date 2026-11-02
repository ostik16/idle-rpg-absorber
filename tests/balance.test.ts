import { describe, expect, it } from 'vitest';
import { parseFlags } from '../tools/balance/args';
import {
  baselineEnemy,
  buildPlayer,
  defaultBuild,
  enemyFromData,
  percentile,
  referenceBuild,
  resolveFight,
  runFights,
  summarise,
  type Combatant,
  type FightResult,
} from '../tools/balance/combat';
import { levelCurve } from '../tools/balance/curve';
import { areaAverageXp, areaReport, type AreaReportData } from '../tools/balance/drops';
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

  it('applies proficiency bonuses', () => {
    const build = {
      ...defaultBuild(5),
      attributes: { strength: 10, dexterity: 10, vitality: 10, intelligence: 10 },
      weaponDamage: 4,
      weaponProficiency: 50, // +15% damage
      toughnessProficiency: 100, // +30% health
      speedProficiency: 50, // +10% attack speed: 1.1 per second -> 909 ms -> 9 ticks
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
    const l1 = referenceBuild(1); // 25 attribute points at 45/20/25/10, weapon 3, armour 1
    expect(l1.attributes.strength).toBeCloseTo(11.25);
    expect(l1.attributes.dexterity).toBeCloseTo(5);
    expect(l1.attributes.vitality).toBeCloseTo(6.25);
    expect(l1.attributes.intelligence).toBeCloseTo(2.5);
    expect(l1.weaponDamage).toBeCloseTo(3);
    expect(l1.armourDefence).toBeCloseTo(1);
    const l11 = referenceBuild(11); // 25 + 3 x 10 = 55 points; weapon 3 + 18; armour 1 + 9
    expect(l11.attributes.strength).toBeCloseTo(24.75);
    expect(l11.weaponDamage).toBeCloseTo(21);
    expect(l11.armourDefence).toBeCloseTo(10);
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

  it('a crit multiplies the damage after defence by 1.5 and the player acts first on a shared tick', () => {
    const r = resolveFight({ ...player, critChance: 1 }, enemy, createRng(1));
    expect(r.outcome).toBe('win');
    expect(r.timeMs).toBe(3000); // 10.5 x 3 = 31.5 >= 25
    expect(r.playerCrits).toBe(3);
    expect(r.enemyHits).toBe(1); // 1500 ms only: the enemy is dead before it acts at 3000 ms
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
    // 50% crit: hits of 7 or 10.5. Not every fight is the same length, so some fights end at 3000 ms and some at 4000 ms.
    const s = runFights({ ...player, critChance: 0.5 }, enemy, 4000, createRng(5));
    expect(s.timeToKill?.min).toBeCloseTo(3);
    expect(s.timeToKill?.max).toBeCloseTo(4);
    expect(s.timeToKill?.mean).toBeGreaterThan(3.2);
    expect(s.timeToKill?.mean).toBeLessThan(3.8);
  });
});

// Area: e1 (level 3, weight 3) and e2 (level 8, weight 1). Character level 5, 12 s per kill = 300 kills per hour.
const data: AreaReportData = {
  areas: [{ id: 'a1', name: 'Test area', enemies: [{ enemyId: 'e1', spawnWeight: 3 }, { enemyId: 'e2', spawnWeight: 1 }] }],
  enemies: [
    {
      id: 'e1', level: 3, type: 'normal', xpReward: 20, moneyRange: { min: 10, max: 20 }, dropTableId: 't1',
      traits: [{ id: 'life-steal', value: 10, magical: true }, { id: 'thorns', value: 5, magical: false }],
    },
    { id: 'e2', level: 8, type: 'normal', dropTableId: 't2' },
  ],
  dropTables: [
    { id: 't1', entries: [{ itemId: 'gem', baseChance: 0.1, minQuantity: 1, maxQuantity: 3 }] },
    { id: 't2', entries: [{ itemId: 'gem', baseChance: 0.5 }, { itemId: 'bone', baseChance: 0.2 }] },
  ],
  items: [{ id: 'gem', name: 'Gem', sellPrice: 10 }, { id: 'bone' }],
};

describe('area report (3.8, 4.7)', () => {
  const report = areaReport(data, 'a1', 5, 12);
  const e1 = report.enemies[0]!;
  const e2 = report.enemies[1]!;

  it('splits kills by spawn weight', () => {
    expect(report.killsPerHour).toBeCloseTo(300);
    expect(e1.share).toBeCloseTo(0.75);
    expect(e1.killsPerHour).toBeCloseTo(225);
    expect(e2.killsPerHour).toBeCloseTo(75);
  });

  it('applies the drop level modifier to the base chance', () => {
    expect(e1.dropModifier).toBeCloseTo(0.8); // 2 levels above: 1 - 0.1 x 2
    const gem1 = e1.drops[0]!;
    expect(gem1.finalChance).toBeCloseTo(0.08);
    expect(gem1.avgQuantity).toBeCloseTo(2);
    expect(gem1.dropsPerKill).toBeCloseTo(0.16);
    expect(gem1.dropsPerHour).toBeCloseTo(36); // 225 x 0.16
    expect(e2.dropModifier).toBeCloseTo(1); // enemy above the character
    expect(e2.drops[0]!.dropsPerHour).toBeCloseTo(37.5); // 75 x 0.5
    expect(e2.drops[1]!.dropsPerHour).toBeCloseTo(15); // 75 x 0.2
  });

  it('totals an item over all enemies and prices it when it can be sold', () => {
    const gem = report.items.find((i) => i.itemId === 'gem')!;
    expect(gem.dropsPerHour).toBeCloseTo(73.5);
    expect(gem.sellValuePerHour).toBeCloseTo(735);
    expect(report.items.find((i) => i.itemId === 'bone')!.sellValuePerHour).toBeNull();
    expect(report.dropValuePerHour).toBeCloseTo(735);
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

  it('a character far above the enemy gets no drops but still absorbs', () => {
    const high = areaReport(data, 'a1', 15, 12);
    expect(high.enemies[0]!.dropModifier).toBe(0); // 12 levels above: max(0, 1 - 1.2)
    expect(high.enemies[0]!.drops[0]!.dropsPerHour).toBe(0);
    expect(high.enemies[0]!.absorptionModifier).toBeGreaterThan(0);
  });

  it('targeting one enemy doubles the time per kill (3.3)', () => {
    const t = areaReport(data, 'a1', 5, 12, { targetEnemyId: 'e1' });
    expect(t.enemies).toHaveLength(1);
    expect(t.killsPerHour).toBeCloseTo(150);
    expect(t.enemies[0]!.drops[0]!.dropsPerHour).toBeCloseTo(24); // 150 x 0.16
    expect(() => areaReport(data, 'a1', 5, 12, { targetEnemyId: 'nope' })).toThrow();
  });

  it('rejects unknown areas and bad pace', () => {
    expect(() => areaReport(data, 'nope', 5, 12)).toThrow();
    expect(() => areaReport(data, 'a1', 5, 0)).toThrow();
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
