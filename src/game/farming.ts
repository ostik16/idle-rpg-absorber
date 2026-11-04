/**
 * Movement time and spawns while farming an area (design 3.1, 3.3). Pure.
 * Coefficients come from data/constants.json (design 5.1).
 */
import constants from '../../data/constants.json';
import type { Rng } from './rng';

type FarmingConstants = typeof constants.farming;

export interface SpawnEntry {
  enemyId: string;
  spawnWeight: number;
}

/** The fields of an area row that decide what spawns. A special enemy left out never spawns. */
export interface SpawnTable {
  enemies: readonly SpawnEntry[];
  miniBossId?: string | null;
  miniBossSpawnChance?: number;
  bossId?: string | null;
  bossSpawnChance?: number;
}

/**
 * Seconds of movement between enemies in an area, before speed and targeting (3.3): the area's own
 * `movementSecondsBetweenEnemies` if present, else constants.farming.movementSecondsBetweenEnemies.
 */
export function baseMovementSeconds(
  area: { movementSecondsBetweenEnemies?: number },
  c: FarmingConstants = constants.farming,
): number {
  return area.movementSecondsBetweenEnemies ?? c.movementSecondsBetweenEnemies;
}

/** Multiplier on the movement time when targeting this enemy (3.3): its own value, else the common one. */
export function targetingMultiplier(
  enemy: { targetingMultiplier?: number },
  c: FarmingConstants = constants.farming,
): number {
  return enemy.targetingMultiplier ?? c.targeting.commonMultiplier;
}

/** True when this enemy can be met in the area: a listed spawn, its mini-boss or its boss. */
export function spawnsInArea(area: SpawnTable, enemyId: string): boolean {
  return area.enemies.some((e) => e.enemyId === enemyId) || area.miniBossId === enemyId || area.bossId === enemyId;
}

/**
 * The enemy the character finds (3.1): the boss and the mini-boss at their own chance, otherwise one of the
 * listed enemies by spawn weight. Always takes the same two draws, so the stream stays aligned whatever spawns.
 */
export function rollSpawn(area: SpawnTable, rng: Rng): string {
  const listed = rng.weightedPick(area.enemies, area.enemies.map((e) => e.spawnWeight)).enemyId;
  const roll = rng.nextFloat();
  const bossChance = area.bossId ? (area.bossSpawnChance ?? 0) : 0;
  const miniBossChance = area.miniBossId ? (area.miniBossSpawnChance ?? 0) : 0;
  if (area.bossId && roll < bossChance) return area.bossId;
  if (area.miniBossId && roll < bossChance + miniBossChance) return area.miniBossId;
  return listed;
}
