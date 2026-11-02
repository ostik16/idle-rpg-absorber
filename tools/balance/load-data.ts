/**
 * Loads the game data for the balance tools (design 5.3). Reads data/*.json through static imports, so it works
 * under vite-node and in the typecheck. The entry types below list only the fields the tools read (design 5.1
 * "Tables"); fields that are missing fail with a clear message where they are needed, not here.
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
}

export interface AreaEnemyRef {
  enemyId: string;
  spawnWeight: number;
}

export interface AreaEntry {
  id: string;
  name?: string;
  levelRange?: unknown;
  enemies: AreaEnemyRef[];
}

export interface DropEntry {
  itemId: string;
  baseChance: number;
  minQuantity?: number;
  maxQuantity?: number;
}

export interface DropTableEntry {
  id: string;
  entries: DropEntry[];
}

export interface ItemEntry {
  id: string;
  name?: string;
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

/** Used when `constants.farming.secondsPerKill` does not exist. The 12 seconds N1 to N6 in docs/decisions.md assume. */
export const FALLBACK_SECONDS_PER_KILL = 12;

/** Seconds from one kill to the next (fight plus moving to the next enemy, 3.3): the constant if present, else 12. */
export function defaultSecondsPerKill(): number {
  const value = (constants.farming as Record<string, unknown>)['secondsPerKill'];
  return typeof value === 'number' && value > 0 ? value : FALLBACK_SECONDS_PER_KILL;
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
