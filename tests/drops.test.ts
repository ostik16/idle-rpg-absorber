import { describe, expect, it } from 'vitest';
import dropTablesJson from '../data/drop-tables.json';
import { dropSources, quantityRange, rollBonuses, rollDrops, type DropTableLike } from '../src/game/drops';
import { dropChance } from '../src/game/formulas';
import { createStream, type Rng } from '../src/game/rng';
import { areaReport } from '../tools/balance/drops';
import { loadBalanceData } from '../tools/balance/load-data';

const tables = dropTablesJson as unknown as DropTableLike[];
const table = (id: string): DropTableLike => {
  const found = tables.find((t) => t.id === id);
  if (!found) throw new Error(`no table ${id}`);
  return found;
};

/** A stream that answers every draw with the same float, and counts the draws. */
function fixedStream(value: number): Rng & { draws: number } {
  const rng = createStream(1, 'x');
  const stub = {
    draws: 0,
    nextFloat: () => {
      stub.draws++;
      return value;
    },
    nextInt: (min: number, max: number) => {
      stub.draws++;
      return min + Math.floor(value * (max - min + 1));
    },
    chance: (p: number) => {
      stub.draws++;
      return value < p;
    },
    weightedIndex: rng.weightedIndex,
    weightedPick: rng.weightedPick,
    getState: rng.getState,
  };
  return stub as unknown as Rng & { draws: number };
}

describe('quantity range (3.8)', () => {
  it('min defaults to 1 and max defaults to min', () => {
    expect(quantityRange({})).toEqual({ min: 1, max: 1 });
    expect(quantityRange({ minQuantity: 3 })).toEqual({ min: 3, max: 3 });
    expect(quantityRange({ minQuantity: 2, maxQuantity: 5 })).toEqual({ min: 2, max: 5 });
    expect(quantityRange({ maxQuantity: 4 })).toEqual({ min: 1, max: 4 });
  });
});

describe('drop sources', () => {
  it('lists normal entries with the level modifier, then pool entries by weight with none', () => {
    const t: DropTableLike = {
      id: 't',
      entries: [{ itemId: 'a', baseChance: 0.5, minQuantity: 1, maxQuantity: 3 }],
      guaranteedPools: [
        {
          id: 'p',
          entries: [
            { itemId: 'b', weight: 30, minQuantity: 2, maxQuantity: 4 },
            { itemId: 'c', weight: 10 },
          ],
        },
      ],
    };
    // Character 3 levels above the enemy: modifier 0.7 (3.8).
    const rows = dropSources(t, 4, 1);
    expect(rows).toEqual([
      { itemId: 'a', poolId: null, baseChance: 0.5, finalChance: dropChance(0.5, 4, 1), avgQuantity: 2 },
      { itemId: 'b', poolId: 'p', baseChance: 0.75, finalChance: 0.75, avgQuantity: 3 },
      { itemId: 'c', poolId: 'p', baseChance: 0.25, finalChance: 0.25, avgQuantity: 1 },
    ]);
    expect(rows[0]?.finalChance).toBeCloseTo(0.35);
  });

  it('a pool with no weight throws', () => {
    const t: DropTableLike = { id: 't', entries: [], guaranteedPools: [{ id: 'p', entries: [{ itemId: 'b', weight: 0 }] }] };
    expect(() => dropSources(t, 1, 1)).toThrow(RangeError);
  });
});

describe('rolling drops', () => {
  const one: DropTableLike = { id: 't', entries: [{ itemId: 'a', baseChance: 0.5, minQuantity: 2, maxQuantity: 4 }] };

  it('an entry drops when the roll is under its final chance, in its quantity range', () => {
    expect(rollDrops(one, 1, 1, fixedStream(0.49))).toEqual([{ itemId: 'a', qty: 3, bonuses: [], poolId: null }]);
    expect(rollDrops(one, 1, 1, fixedStream(0.5))).toEqual([]);
  });

  it('the level modifier cuts the chance: 10 levels above gives nothing, 5 levels above halves it (3.8)', () => {
    expect(rollDrops(one, 11, 1, fixedStream(0))).toEqual([]);
    expect(rollDrops(one, 6, 1, fixedStream(0.24))).toHaveLength(1); // 0.5 x 0.5 = 0.25
    expect(rollDrops(one, 6, 1, fixedStream(0.26))).toHaveLength(0);
  });

  it('a boost multiplies after the level modifier, so it cannot bring a 0 back (Q5)', () => {
    expect(rollDrops(one, 6, 1, fixedStream(0.4), { boost: 2 })).toHaveLength(1); // 0.5 x 0.5 x 2
    expect(rollDrops(one, 11, 1, fixedStream(0), { boost: 100 })).toEqual([]);
  });

  it('a pool gives exactly one entry per kill, with no level modifier, and the normal entries roll too (T3)', () => {
    const t: DropTableLike = {
      id: 't',
      entries: [{ itemId: 'n', baseChance: 1 }],
      guaranteedPools: [{ id: 'p', entries: [{ itemId: 'b', weight: 1 }, { itemId: 'c', weight: 1, minQuantity: 2, maxQuantity: 3 }] }],
    };
    const rng = createStream(5, 'pool');
    for (let i = 0; i < 200; i++) {
      const drops = rollDrops(t, 30, 1, rng); // far above: the normal entry is 0
      const fromPool = drops.filter((d) => d.poolId === 'p');
      expect(fromPool).toHaveLength(1);
      expect(drops.filter((d) => d.poolId === null)).toHaveLength(0);
    }
    const low = rollDrops(t, 1, 1, createStream(5, 'pool'));
    expect(low.map((d) => d.poolId).sort()).toEqual([null, 'p']);
  });

  it('takes the same draws whatever the level modifier, the boost or the outcome', () => {
    const t = table('drop-mossfang-matriarch');
    const counts = new Set<number>();
    for (const [level, boost, roll] of [[5, 1, 0], [5, 1, 0.99], [30, 1, 0], [5, 3, 0.5]] as const) {
      const rng = fixedStream(roll);
      rollDrops(t, level, 5, rng, { boost });
      counts.add(rng.draws);
    }
    expect(counts.size).toBe(1);
  });
});

describe('bonus attributes (2.1, Q1)', () => {
  const pool = [
    { attribute: 'strength', min: 1, max: 3, chance: 1 },
    { attribute: 'dexterity', min: 1, max: 2, chance: 1 },
    { attribute: 'vitality', min: 2, max: 2, chance: 1 },
    { attribute: 'intelligence', min: 1, max: 1, chance: 1 },
    { attribute: 'speed', min: 1, max: 1, chance: 1 },
  ];

  it('keeps at most 3, the first three hits in listed order', () => {
    const rolled = rollBonuses(pool, 3, createStream(2, 'bonus'));
    expect(rolled.map((b) => b.attribute)).toEqual(['strength', 'dexterity', 'vitality']);
  });

  it('rolls each entry on its own chance, with the value in range', () => {
    const rng = createStream(3, 'bonus');
    const seen = new Set<number>();
    let hits = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const rolled = rollBonuses([{ attribute: 'strength', min: 1, max: 3, chance: 0.25 }], 3, rng);
      if (rolled.length === 1) {
        hits++;
        seen.add(rolled[0]?.value ?? 0);
      }
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
    expect(Math.abs(hits / N - 0.25)).toBeLessThan(0.03);
  });

  it('takes two draws per pool entry, hit or not and capped or not', () => {
    for (const max of [0, 1, 3]) {
      const rng = fixedStream(0.9);
      rollBonuses(pool, max, rng);
      expect(rng.draws).toBe(10);
    }
  });

  it('a cap of 0 rolls nothing', () => {
    expect(rollBonuses(pool, 0, createStream(2, 'bonus'))).toEqual([]);
  });
});

describe('item rates over a long run match the balance report (5.3)', () => {
  const data = loadBalanceData();
  const N = 100_000;

  function observedRates(tableId: string, characterLevel: number, enemyLevel: number, seed: string): Map<string, number> {
    const rng = createStream(11, seed);
    const totals = new Map<string, number>();
    const t = table(tableId);
    for (let i = 0; i < N; i++) {
      for (const d of rollDrops(t, characterLevel, enemyLevel, rng)) {
        const key = `${d.poolId ?? ''}|${d.itemId}`;
        totals.set(key, (totals.get(key) ?? 0) + d.qty);
      }
    }
    return new Map([...totals].map(([k, v]) => [k, v / N]));
  }

  function maxQuantityOf(t: DropTableLike, key: string): number {
    const [poolId, itemId] = key.split('|');
    const entries = poolId ? (t.guaranteedPools?.find((p) => p.id === poolId)?.entries ?? []) : t.entries;
    return Math.max(...entries.filter((e) => e.itemId === itemId).map((e) => quantityRange(e).max));
  }

  function expectMatches(
    rows: { itemId: string; poolId: string | null; dropsPerKill: number }[],
    observed: Map<string, number>,
    t: DropTableLike,
  ): void {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const key = `${row.poolId ?? ''}|${row.itemId}`;
      const maxQ = maxQuantityOf(t, key);
      const tolerance = 6 * Math.sqrt((row.dropsPerKill * maxQ) / N) + 1e-9; // variance is at most p x maxQ^2
      expect(Math.abs((observed.get(key) ?? 0) - row.dropsPerKill), key).toBeLessThanOrEqual(tolerance);
    }
  }

  it('every row of every enemy of the first area, for a level 3 character', () => {
    const report = areaReport(data, 'mossfang-glade', 3, { fightSeconds: 5 });
    for (const e of report.enemies) {
      const enemy = data.enemies.find((x) => x.id === e.enemyId);
      const tableId = enemy?.dropTableId ?? '';
      expectMatches(e.drops, observedRates(tableId, 3, e.level, e.enemyId), table(tableId));
    }
  });

  it('the mini-boss and the boss, with their pools, for a level 7 character', () => {
    for (const [tableId, enemyLevel] of [['drop-old-mossfang', 5], ['drop-mossfang-matriarch', 5]] as const) {
      const t = table(tableId);
      expectMatches(dropSources(t, 7, enemyLevel).map((s) => ({ ...s, dropsPerKill: s.finalChance * s.avgQuantity })), observedRates(tableId, 7, enemyLevel, tableId), t);
    }
  });
});
