/**
 * Loads the game data for the balance tools (design 5.3). Reads data/*.json through static imports, so it works
 * under vite-node and in the typecheck. The entry types below list only the fields the tools read (design 5.1
 * "Tables"); fields that are missing fail with a clear message where they are needed, not here.
 * Items (equipment, consumables, materials and rare items) all live in data/items.json; the old
 * data/consumables.json and data/rare-items.json are not read.
 */
import constants from '../../data/constants.json';
import xpTableJson from '../../data/xp-table.json';
import areasJson from '../../data/areas.json';
import enemiesJson from '../../data/enemies.json';
import dropTablesJson from '../../data/drop-tables.json';
import itemsJson from '../../data/items.json';

export interface EnemyTrait {
  id: string;
  value: number;
  magical?: boolean;
}

export interface EnemyEntry {
  id: string;
  name?: string;
  level: number;
  /** normal, mini-boss, boss or cursed-object (3.5). Only normal enemies can be absorbed (4.7). */
  type?: string;
  health?: number;
  damage?: number;
  attackSpeed?: number;
  defence?: number;
  traits?: EnemyTrait[];
  xpReward?: number;
  moneyRange?: { min: number; max: number };
  dropTableId?: string;
  /** Multiplier on the movement time to find this enemy when targeting it (3.3). Common 2, special enemies up to 10. */
  targetingMultiplier?: number;
}

export interface AreaEnemyRef {
  enemyId: string;
  spawnWeight: number;
}

export interface AreaEntry {
  id: string;
  name?: string;
  levelRange?: unknown;
  /** Seconds of movement between enemies in this area; constants.farming.movementSecondsBetweenEnemies if absent. */
  movementSecondsBetweenEnemies?: number;
  enemies: AreaEnemyRef[];
}

export interface DropEntry {
  itemId: string;
  baseChance: number;
  minQuantity?: number;
  maxQuantity?: number;
}

export interface GuaranteedPoolEntry {
  itemId: string;
  weight: number;
  minQuantity?: number;
  maxQuantity?: number;
}

/** Every kill yields exactly one entry of each pool, chosen by weight; the level modifier does not apply (3.8). */
export interface GuaranteedPool {
  id: string;
  entries: GuaranteedPoolEntry[];
}

export interface DropTableEntry {
  id: string;
  entries: DropEntry[];
  guaranteedPools?: GuaranteedPool[];
}

export interface ItemEntry {
  id: string;
  name?: string;
  /** equipment, consumable, material or rare. */
  category?: string;
  sellPrice?: number;
}

export interface XpRow {
  level: number;
  xpToNext: number;
}

export interface BalanceData {
  areas: AreaEntry[];
  enemies: EnemyEntry[];
  dropTables: DropTableEntry[];
  items: ItemEntry[];
  xpTable: readonly XpRow[];
}

/** Thrown for problems the person running a tool can fix (unknown id, empty table). Scripts print the message only. */
export class BalanceError extends Error {}

export function loadBalanceData(): BalanceData {
  return {
    areas: areasJson as unknown as AreaEntry[],
    enemies: enemiesJson as unknown as EnemyEntry[],
    dropTables: dropTablesJson as unknown as DropTableEntry[],
    items: itemsJson as unknown as ItemEntry[],
    xpTable: xpTableJson,
  };
}

/**
 * Seconds of movement between enemies in an area, before targeting (3.3): the area's own
 * `movementSecondsBetweenEnemies` if present, else constants.farming.movementSecondsBetweenEnemies.
 */
export function baseMovementSeconds(area: AreaEntry): number {
  return area.movementSecondsBetweenEnemies ?? constants.farming.movementSecondsBetweenEnemies;
}

/**
 * Multiplier on the movement time when targeting this enemy (3.3): its own `targetingMultiplier`,
 * else constants.farming.targeting.commonMultiplier. Rejects values outside 1..maxMultiplier.
 */
export function targetingMultiplier(enemy: EnemyEntry): number {
  const t = constants.farming.targeting;
  const m = enemy.targetingMultiplier ?? t.commonMultiplier;
  if (!(m >= 1 && m <= t.maxMultiplier)) {
    throw new BalanceError(`Enemy "${enemy.id}" has targetingMultiplier ${m}; it must be between 1 and ${t.maxMultiplier}.`);
  }
  return m;
}

export function findEnemy(enemies: readonly EnemyEntry[], id: string): EnemyEntry {
  const enemy = enemies.find((e) => e.id === id);
  if (!enemy) {
    const known = enemies.map((e) => e.id).join(', ');
    throw new BalanceError(
      enemies.length === 0 ? `Unknown enemy "${id}": data/enemies.json is empty.` : `Unknown enemy "${id}". Known: ${known}.`,
    );
  }
  return enemy;
}

export function findArea(areas: readonly AreaEntry[], id: string): AreaEntry {
  const area = areas.find((a) => a.id === id);
  if (!area) {
    const known = areas.map((a) => a.id).join(', ');
    throw new BalanceError(
      areas.length === 0 ? `Unknown area "${id}": data/areas.json is empty.` : `Unknown area "${id}". Known: ${known}.`,
    );
  }
  return area;
}

/** "1-4" from a levelRange written as [1, 4] or { min: 1, max: 4 }; empty string if it is neither. */
export function levelRangeText(levelRange: unknown): string {
  if (Array.isArray(levelRange) && levelRange.length === 2) return `${levelRange[0]}-${levelRange[1]}`;
  if (typeof levelRange === 'object' && levelRange !== null) {
    const { min, max } = levelRange as { min?: unknown; max?: unknown };
    if (typeof min === 'number' && typeof max === 'number') return `${min}-${max}`;
  }
  return '';
}
