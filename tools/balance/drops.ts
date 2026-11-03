/**
 * Drop, XP and gold rates for one area at one character level (design 3.8, 4.7, 5.3). Pure.
 * Model: the character kills one enemy every (fight seconds + movement seconds); which enemy follows the area's spawn
 * weights (3.1). Targeting one enemy farms only that enemy, and multiplies the movement seconds (not the fight) by
 * that enemy's own `targetingMultiplier` (3.3). Guaranteed pools (3.8) give exactly one entry per kill, chosen by
 * weight, with no level modifier. Not modelled: drop boosts (2.6), bosses and other special spawns, inventory limits, offline efficiency.
 */
import { enemyMoneyRange } from '../../src/game/enemies';
import { movementSeconds } from '../../src/game/proficiency';
import { absorbOnKill, absorptionLevelModifier, dropChance, dropLevelModifier } from '../../src/game/formulas';
import { xpReward } from '../../src/game/progression';
import {
  BalanceError,
  baseMovementSeconds,
  findArea,
  findEnemy,
  type AreaEntry,
  type DropTableEntry,
  type EnemyEntry,
  type GuaranteedPool,
  type ItemEntry,
  targetingMultiplier,
} from './load-data';

export interface DropRow {
  itemId: string;
  itemName: string;
  /** Id of the guaranteed pool this row comes from, or null for a normal entry. */
  poolId: string | null;
  /** Normal entry: the base chance. Pool entry: weight / total weight of the pool. */
  baseChance: number;
  /** Normal entry: base chance x level modifier (3.8). Pool entry: the same as baseChance (no modifier). */
  finalChance: number;
  avgQuantity: number;
  dropsPerKill: number;
  dropsPerHour: number;
  /** Gold per hour if sold, or null when the item has no sellPrice. */
  sellValuePerHour: number | null;
}

export interface TraitRow {
  traitId: string;
  /** The enemy's value of the trait. */
  value: number;
  /** Gain per kill from a trait of zero (4.7). */
  perKill: number;
  killsToCap: number;
  hoursToCap: number;
}

export interface EnemyReport {
  enemyId: string;
  name: string;
  level: number;
  type: string;
  /** Share of this area's kills, 0..1. */
  share: number;
  killsPerHour: number;
  /** Seconds this enemy takes to kill. */
  fightSeconds: number;
  dropModifier: number;
  absorbable: boolean;
  absorptionModifier: number;
  traits: TraitRow[];
  drops: DropRow[];
  xpPerKill: number;
  xpPerHour: number;
  goldPerKill: number;
  goldPerHour: number;
}

export interface ItemTotal {
  itemId: string;
  itemName: string;
  dropsPerHour: number;
  sellValuePerHour: number | null;
}

export interface AreaReport {
  areaId: string;
  areaName: string;
  characterLevel: number;
  /** Seconds from one kill to the next: fight + movement (after speed and the targeting multiplier). */
  secondsPerKill: number;
  /** Fight part of secondsPerKill, averaged over the kills. */
  fightSeconds: number;
  /** Movement part of secondsPerKill. */
  movementSeconds: number;
  killsPerHour: number;
  targetEnemyId: string | null;
  /** The targeted enemy's targetingMultiplier, or null when not targeting. */
  targetingMultiplier: number | null;
  enemies: EnemyReport[];
  items: ItemTotal[];
  xpPerHour: number;
  goldPerHour: number;
  /** Gold per hour from selling every drop that has a sellPrice. */
  dropValuePerHour: number;
}

export interface AreaReportData {
  areas: readonly AreaEntry[];
  enemies: readonly EnemyEntry[];
  dropTables: readonly DropTableEntry[];
  items: readonly ItemEntry[];
}

/** XP of one kill: the enemy's own xpReward if set, else the progression formula (3.5). */
export function enemyXp(enemy: EnemyEntry): number {
  return typeof enemy.xpReward === 'number' ? enemy.xpReward : xpReward(enemy.level);
}

/** Average gold of one kill: the middle of the enemy's moneyRange if set, else of the baseline range (3.5). */
export function enemyGold(enemy: EnemyEntry): number {
  const range = enemy.moneyRange ?? enemyMoneyRange(enemy.level);
  return (range.min + range.max) / 2;
}

/** Spawn shares (0..1) of an area's enemies, in listed order. */
export function spawnShares(area: AreaEntry): number[] {
  const total = area.enemies.reduce((s, e) => s + e.spawnWeight, 0);
  if (!(total > 0)) throw new BalanceError(`Area "${area.id}" has no spawn weight.`);
  return area.enemies.map((e) => e.spawnWeight / total);
}

/** XP of one kill averaged over an area's spawns. Used by the progression curve. */
export function areaAverageXp(area: AreaEntry, enemies: readonly EnemyEntry[]): number {
  const shares = spawnShares(area);
  return area.enemies.reduce((sum, ref, i) => sum + (shares[i] ?? 0) * enemyXp(findEnemy(enemies, ref.enemyId)), 0);
}

function avgQuantity(min: number | undefined, max: number | undefined): number {
  return ((min ?? 1) + (max ?? min ?? 1)) / 2;
}

function poolRows(
  enemy: EnemyEntry,
  pool: GuaranteedPool,
  killsPerHour: number,
  items: ReadonlyMap<string, ItemEntry>,
): DropRow[] {
  const total = pool.entries.reduce((s, e) => s + e.weight, 0);
  if (!(total > 0)) throw new BalanceError(`Guaranteed pool "${pool.id}" of enemy "${enemy.id}" has no weight.`);
  return pool.entries.map((entry) => {
    const item = items.get(entry.itemId);
    const quantity = avgQuantity(entry.minQuantity, entry.maxQuantity);
    const chance = entry.weight / total;
    const dropsPerKill = chance * quantity;
    const dropsPerHour = dropsPerKill * killsPerHour;
    return {
      itemId: entry.itemId,
      itemName: item?.name ?? entry.itemId,
      poolId: pool.id,
      baseChance: chance,
      finalChance: chance,
      avgQuantity: quantity,
      dropsPerKill,
      dropsPerHour,
      sellValuePerHour: typeof item?.sellPrice === 'number' ? dropsPerHour * item.sellPrice : null,
    };
  });
}

function dropRows(
  enemy: EnemyEntry,
  characterLevel: number,
  killsPerHour: number,
  tables: ReadonlyMap<string, DropTableEntry>,
  items: ReadonlyMap<string, ItemEntry>,
): DropRow[] {
  if (enemy.dropTableId === undefined) return [];
  const dropTable = tables.get(enemy.dropTableId);
  if (!dropTable) throw new BalanceError(`Enemy "${enemy.id}" uses drop table "${enemy.dropTableId}", which is not in data/drop-tables.json.`);
  const rows = dropTable.entries.map((entry): DropRow => {
    const item = items.get(entry.itemId);
    const quantity = avgQuantity(entry.minQuantity, entry.maxQuantity);
    const finalChance = dropChance(entry.baseChance, characterLevel, enemy.level);
    const dropsPerKill = finalChance * quantity;
    const dropsPerHour = dropsPerKill * killsPerHour;
    return {
      itemId: entry.itemId,
      itemName: item?.name ?? entry.itemId,
      poolId: null,
      baseChance: entry.baseChance,
      finalChance,
      avgQuantity: quantity,
      dropsPerKill,
      dropsPerHour,
      sellValuePerHour: typeof item?.sellPrice === 'number' ? dropsPerHour * item.sellPrice : null,
    };
  });
  for (const pool of dropTable.guaranteedPools ?? []) rows.push(...poolRows(enemy, pool, killsPerHour, items));
  return rows;
}

/** How long a kill takes (3.3): the fight, and the movement to the next enemy. */
export interface Pace {
  /** Seconds of fighting per kill: one number for every enemy, or a function of the enemy. */
  fightSeconds: number | ((enemy: EnemyEntry) => number);
  /** Overrides the area's movement seconds between enemies (before speed and targeting). */
  movementSeconds?: number;
  /** Speed skill points: movement takes baseSeconds / (1 + points x effectPerPoint.speed) (4.6). */
  speedPoints?: number;
}

function fightOf(pace: Pace, enemy: EnemyEntry): number {
  const f = typeof pace.fightSeconds === 'number' ? pace.fightSeconds : pace.fightSeconds(enemy);
  if (!(f >= 0)) throw new BalanceError(`Fight seconds for "${enemy.id}" must be 0 or more, got ${f}.`);
  return f;
}

/** Movement seconds between enemies in the area after the speed skill, before any targeting multiplier. */
export function areaMovementSeconds(area: AreaEntry, pace: Pace): number {
  return movementSeconds(pace.movementSeconds ?? baseMovementSeconds(area), pace.speedPoints ?? 0);
}

/** Average seconds per kill over an area's spawn mix, no targeting: mean fight seconds + movement seconds. */
export function areaSecondsPerKill(area: AreaEntry, enemies: readonly EnemyEntry[], pace: Pace): number {
  const shares = spawnShares(area);
  const fight = area.enemies.reduce((sum, ref, i) => sum + (shares[i] ?? 0) * fightOf(pace, findEnemy(enemies, ref.enemyId)), 0);
  return fight + areaMovementSeconds(area, pace);
}

export interface AreaReportOptions {
  /** Farm only this enemy (3.3). Multiplies the movement seconds by the enemy's own targetingMultiplier. */
  targetEnemyId?: string;
}

export function areaReport(
  data: AreaReportData,
  areaId: string,
  characterLevel: number,
  pace: Pace,
  options: AreaReportOptions = {},
): AreaReport {
  const area = findArea(data.areas, areaId);
  if (area.enemies.length === 0) throw new BalanceError(`Area "${area.id}" lists no enemies.`);
  const target = options.targetEnemyId ?? null;
  if (target !== null && !area.enemies.some((e) => e.enemyId === target)) {
    throw new BalanceError(`Enemy "${target}" does not spawn in area "${area.id}".`);
  }
  const baseMove = areaMovementSeconds(area, pace);
  const targetEnemy = target === null ? null : findEnemy(data.enemies, target);
  const multiplier = targetEnemy === null ? null : targetingMultiplier(targetEnemy);
  const moveSeconds = baseMove * (multiplier ?? 1);
  const fightOfRef = (enemyId: string): number => fightOf(pace, findEnemy(data.enemies, enemyId));
  const fightSeconds =
    target === null
      ? area.enemies.reduce((sum, ref, i) => sum + (spawnShares(area)[i] ?? 0) * fightOfRef(ref.enemyId), 0)
      : fightOfRef(target);
  const effectiveSeconds = fightSeconds + moveSeconds;
  if (!(effectiveSeconds > 0)) throw new BalanceError(`Seconds per kill must be above 0, got ${effectiveSeconds}.`);
  const killsPerHour = 3600 / effectiveSeconds;
  const shares = target === null ? spawnShares(area) : area.enemies.map((e) => (e.enemyId === target ? 1 : 0));
  const tables = new Map(data.dropTables.map((t) => [t.id, t]));
  const items = new Map(data.items.map((i) => [i.id, i]));

  const enemies: EnemyReport[] = [];
  area.enemies.forEach((ref, i) => {
    const share = shares[i] ?? 0;
    if (share === 0) return;
    const enemy = findEnemy(data.enemies, ref.enemyId);
    const enemyKills = killsPerHour * share;
    const absorbable = (enemy.type ?? 'normal') === 'normal';
    const traits: TraitRow[] = absorbable
      ? (enemy.traits ?? [])
          .filter((t) => t.magical === true)
          .map((t) => {
            const perKill = absorbOnKill(0, t.value, characterLevel, enemy.level);
            const killsToCap = Math.ceil(t.value / perKill - 1e-9);
            return { traitId: t.id, value: t.value, perKill, killsToCap, hoursToCap: enemyKills > 0 ? killsToCap / enemyKills : Infinity };
          })
      : [];
    const xpPerKill = enemyXp(enemy);
    const goldPerKill = enemyGold(enemy);
    enemies.push({
      enemyId: enemy.id,
      name: enemy.name ?? enemy.id,
      level: enemy.level,
      type: enemy.type ?? 'normal',
      share,
      killsPerHour: enemyKills,
      fightSeconds: fightOf(pace, enemy),
      dropModifier: dropLevelModifier(characterLevel, enemy.level),
      absorbable,
      absorptionModifier: absorptionLevelModifier(characterLevel, enemy.level),
      traits,
      drops: dropRows(enemy, characterLevel, enemyKills, tables, items),
      xpPerKill,
      xpPerHour: xpPerKill * enemyKills,
      goldPerKill,
      goldPerHour: goldPerKill * enemyKills,
    });
  });

  const totals = new Map<string, ItemTotal>();
  for (const e of enemies) {
    for (const row of e.drops) {
      const t = totals.get(row.itemId) ?? { itemId: row.itemId, itemName: row.itemName, dropsPerHour: 0, sellValuePerHour: null };
      t.dropsPerHour += row.dropsPerHour;
      if (row.sellValuePerHour !== null) t.sellValuePerHour = (t.sellValuePerHour ?? 0) + row.sellValuePerHour;
      totals.set(row.itemId, t);
    }
  }
  const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
  const itemList = [...totals.values()].sort((x, y) => y.dropsPerHour - x.dropsPerHour);
  return {
    areaId: area.id,
    areaName: area.name ?? area.id,
    characterLevel,
    secondsPerKill: effectiveSeconds,
    fightSeconds,
    movementSeconds: moveSeconds,
    killsPerHour,
    targetEnemyId: target,
    targetingMultiplier: multiplier,
    enemies,
    items: itemList,
    xpPerHour: sum(enemies.map((e) => e.xpPerHour)),
    goldPerHour: sum(enemies.map((e) => e.goldPerHour)),
    dropValuePerHour: sum(itemList.map((t) => t.sellValuePerHour ?? 0)),
  };
}
