/**
 * Drop tables (design 2.1, 3.8, decisions Q1, Q5, T3). Pure: the one place that reads a drop table, so the engine
 * and the balance tool (`tools/balance/drops.ts`) cannot drift apart.
 *
 * - A normal entry drops with `baseChance x level modifier x boost` (3.8, Q5), in `minQuantity..maxQuantity`
 *   (both default to 1; a missing max is the min).
 * - A guaranteed pool gives exactly one entry per kill, chosen by weight, with no level modifier and no boost (T3).
 *   The normal entries roll as well.
 * - An item with a bonus attribute pool rolls each pool entry on its own chance, up to `maxBonusAttributes` (Q1).
 */
import { dropChance } from './formulas';
import type { Rng } from './rng';

export interface DropEntryLike {
  itemId: string;
  baseChance: number;
  minQuantity?: number;
  maxQuantity?: number;
}

export interface PoolEntryLike {
  itemId: string;
  weight: number;
  minQuantity?: number;
  maxQuantity?: number;
}

/** Every kill yields exactly one entry of each pool, chosen by weight; the level modifier does not apply (3.8). */
export interface GuaranteedPoolLike {
  id: string;
  entries: readonly PoolEntryLike[];
}

export interface DropTableLike {
  id: string;
  entries: readonly DropEntryLike[];
  guaranteedPools?: readonly GuaranteedPoolLike[];
}

/** One entry of an item's `bonusAttributePool` (2.1). */
export interface BonusPoolEntry {
  attribute: string;
  min: number;
  max: number;
  chance: number;
}

export interface RolledBonusValue {
  attribute: string;
  value: number;
}

export interface QuantityRange {
  min: number;
  max: number;
}

/** Quantity range of an entry: min defaults to 1, max defaults to min. */
export function quantityRange(entry: { minQuantity?: number; maxQuantity?: number }): QuantityRange {
  const min = entry.minQuantity ?? 1;
  return { min, max: entry.maxQuantity ?? min };
}

/** Average quantity of an entry. */
export function averageQuantity(entry: { minQuantity?: number; maxQuantity?: number }): number {
  const { min, max } = quantityRange(entry);
  return (min + max) / 2;
}

/** Sum of the weights of a guaranteed pool. */
export function poolTotalWeight(pool: GuaranteedPoolLike): number {
  return pool.entries.reduce((sum, e) => sum + e.weight, 0);
}

/** One line of a drop table as an expected rate (3.8). */
export interface DropSource {
  itemId: string;
  /** Id of the guaranteed pool this comes from, or null for a normal entry. */
  poolId: string | null;
  /** Normal entry: the base chance. Pool entry: weight / total weight of the pool. */
  baseChance: number;
  /** Normal entry: base chance x level modifier. Pool entry: the same as baseChance (no modifier). */
  finalChance: number;
  avgQuantity: number;
}

/**
 * Every line of a table with its chance of dropping per kill: the normal entries, then each pool's entries.
 * A pool whose weights add up to 0 throws a RangeError.
 */
export function dropSources(table: DropTableLike, characterLevel: number, enemyLevel: number): DropSource[] {
  const sources: DropSource[] = table.entries.map((entry) => ({
    itemId: entry.itemId,
    poolId: null,
    baseChance: entry.baseChance,
    finalChance: dropChance(entry.baseChance, characterLevel, enemyLevel),
    avgQuantity: averageQuantity(entry),
  }));
  for (const pool of table.guaranteedPools ?? []) {
    const total = poolTotalWeight(pool);
    if (!(total > 0)) throw new RangeError(`Guaranteed pool "${pool.id}" has no weight.`);
    for (const entry of pool.entries) {
      const chance = entry.weight / total;
      sources.push({
        itemId: entry.itemId,
        poolId: pool.id,
        baseChance: chance,
        finalChance: chance,
        avgQuantity: averageQuantity(entry),
      });
    }
  }
  return sources;
}

/**
 * Rolls an item's bonus attributes (2.1): each pool entry on its own chance, value in `min..max`, the first `max`
 * hits in listed order are kept. Always takes two draws per pool entry (a chance, then a value), hit or not and
 * whether or not the cap cuts it, so the stream stays aligned.
 */
export function rollBonuses(pool: readonly BonusPoolEntry[], maxBonusAttributes: number, rng: Rng): RolledBonusValue[] {
  const hits: RolledBonusValue[] = [];
  for (const entry of pool) {
    const hit = rng.chance(entry.chance);
    const value = rng.nextInt(entry.min, entry.max);
    if (hit) hits.push({ attribute: entry.attribute, value });
  }
  return hits.slice(0, Math.max(0, maxBonusAttributes));
}

export interface RolledDrop {
  itemId: string;
  qty: number;
  bonuses: RolledBonusValue[];
  /** The guaranteed pool it came from, or null for a normal entry. */
  poolId: string | null;
}

export interface DropRollOptions {
  /** Drop-rate boost (2.6). Multiplies a normal entry's chance after the level modifier (Q5). Default 1. */
  boost?: number;
  /** Bonus attribute pool of an item. Default: no bonuses. */
  bonusPoolOf?: (itemId: string) => readonly BonusPoolEntry[];
  /** Cap on bonus attributes per item (Q1). Default 0. */
  maxBonusAttributes?: number;
}

/**
 * Rolls one kill's drops. Takes the same draws for the same table whatever happens: per normal entry a chance, a
 * quantity and the bonus draws of its item; per pool a weighted pick, a quantity and the bonus draws of every item
 * in the pool. So the level modifier, a boost, a full bag or a loot filter never shift the stream (like `rollSpawn`).
 */
export function rollDrops(
  table: DropTableLike,
  characterLevel: number,
  enemyLevel: number,
  rng: Rng,
  options: DropRollOptions = {},
): RolledDrop[] {
  const boost = options.boost ?? 1;
  const maxBonus = options.maxBonusAttributes ?? 0;
  const bonusPoolOf = options.bonusPoolOf ?? (() => []);
  const rolled: RolledDrop[] = [];

  for (const entry of table.entries) {
    const hit = rng.chance(dropChance(entry.baseChance, characterLevel, enemyLevel) * boost);
    const { min, max } = quantityRange(entry);
    const qty = rng.nextInt(min, max);
    const bonuses = rollBonuses(bonusPoolOf(entry.itemId), maxBonus, rng);
    if (hit) rolled.push({ itemId: entry.itemId, qty, bonuses, poolId: null });
  }

  for (const pool of table.guaranteedPools ?? []) {
    const picked = rng.weightedPick(pool.entries, pool.entries.map((e) => e.weight));
    const { min, max } = quantityRange(picked);
    const qty = rng.nextInt(min, max);
    let bonuses: RolledBonusValue[] = [];
    for (const entry of pool.entries) {
      const rolledBonuses = rollBonuses(bonusPoolOf(entry.itemId), maxBonus, rng);
      if (entry === picked) bonuses = rolledBonuses;
    }
    rolled.push({ itemId: picked.itemId, qty, bonuses, poolId: pool.id });
  }
  return rolled;
}
