/**
 * Levels, XP and points (design 4.3, 4.4). XP per level is in data/xp-table.json,
 * the XP reward formula's coefficients are in data/constants.json (design 5.1).
 */
import constants from '../../data/constants.json';
import xpTable from '../../data/xp-table.json';

type XpTable = readonly { level: number; xpToNext: number }[];
type ProgressionConstants = typeof constants.progression;
type PointsConstants = typeof constants.points;

/** XP needed to go from `level` to `level + 1`. Levels 1 to 30; the level 30 row is used if the cap is raised. */
export function xpToNextLevel(level: number, table: XpTable = xpTable): number {
  const row = table.find((r) => r.level === level);
  if (!row) throw new RangeError(`no XP table row for level ${level}`);
  return row.xpToNext;
}

/** Total XP a character has earned on reaching `level` (the sum of the rows below it). */
export function totalXpForLevel(level: number, table: XpTable = xpTable): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNextLevel(l, table);
  return total;
}

/** Level for a lifetime XP total. Stops at the level cap; XP beyond it changes nothing. */
export function levelForTotalXp(
  totalXp: number,
  levelCap: number = constants.levelCap,
  table: XpTable = xpTable,
): number {
  let level = 1;
  let remaining = totalXp;
  while (level < levelCap) {
    const need = xpToNextLevel(level, table);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  return level;
}

/**
 * XP for one kill (design 3.5): round(base x growth^(enemyLevel - 1)).
 * Not reduced by level gap; the rising XP table is what makes low-level enemies too small (design 4.3).
 */
export function xpReward(enemyLevel: number, c: ProgressionConstants = constants.progression): number {
  if (!Number.isInteger(enemyLevel) || enemyLevel < 1) {
    throw new RangeError(`enemy level must be a whole number of 1 or more, got ${enemyLevel}`);
  }
  return Math.round(c.xpReward.base * c.xpReward.growthPerLevel ** (enemyLevel - 1));
}

/** Kills of enemies at `enemyLevel` needed to clear a whole character level. Used by the balance tools (5.3). */
export function killsToClearLevel(characterLevel: number, enemyLevel: number): number {
  return Math.ceil(xpToNextLevel(characterLevel) / xpReward(enemyLevel));
}

/**
 * Character points earned so far (design 4.4). The 3 points of a level are awarded as the character
 * progresses through it, at 25%, 50% and 75% of that level's XP, one point per mark.
 * `xpIntoLevel` is XP earned since reaching `level`. Points from finished levels count in full.
 * At the level cap there is no further progress, so only finished levels count.
 */
export function characterPointsEarned(
  level: number,
  xpIntoLevel: number,
  levelCap: number = constants.levelCap,
  c: PointsConstants = constants.points,
): number {
  const perMark = c.characterPointsPerLevel / c.characterPointAwardAtLevelFraction.length;
  const finished = (level - 1) * c.characterPointsPerLevel;
  if (level >= levelCap) return finished;
  const need = xpToNextLevel(level);
  const marks = c.characterPointAwardAtLevelFraction.filter((f) => xpIntoLevel >= f * need).length;
  return finished + marks * perMark;
}

/** Skill points earned (design 4.5): skillPointsPerLevel for every level gained after level 1. */
export function skillPointsEarned(level: number, c: PointsConstants = constants.points): number {
  return (level - 1) * c.skillPointsPerLevel;
}
