/**
 * Levels, XP and points (design 4.3, 4.4). XP per level is in data/xp-table.json,
 * the XP reward formula's coefficients are in data/constants.json (design 5.1).
 */
import constants from '../../data/constants.json';
import xpTable from '../../data/xp-table.json';

export type XpTable = readonly { level: number; xpToNext: number }[];
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

/** XP of one kill (design 3.5): the enemy's own `xpReward` if its row has one, else the formula. */
export function killXp(
  enemy: { readonly level: number; readonly xpReward?: number },
  c: ProgressionConstants = constants.progression,
): number {
  return enemy.xpReward ?? xpReward(enemy.level, c);
}

/** Kills of enemies at `enemyLevel` needed to clear a whole character level. Used by the balance tools (5.3). */
export function killsToClearLevel(characterLevel: number, enemyLevel: number): number {
  return Math.ceil(xpToNextLevel(characterLevel) / xpReward(enemyLevel));
}

/**
 * XP amounts, within a level, at which a character point is awarded (design 4.4): the fractions in
 * constants.points.characterPointAwardAtLevelFraction (25%, 50%, 75%) of the level's `xpToNext`.
 */
export function pointMarks(xpToNext: number, c: PointsConstants = constants.points): number[] {
  return c.characterPointAwardAtLevelFraction.map((f) => f * xpToNext);
}

/** Marks passed (reached or exceeded) at `xp` XP into a level. Also the number of points awarded, one per mark. */
export function pointsAwardedAt(xp: number, xpToNext: number, c: PointsConstants = constants.points): number {
  return pointMarks(xpToNext, c).filter((mark) => xp >= mark).length;
}

/**
 * XP floor for death (design 3.7, 4.4): the highest point mark already passed in the current level,
 * or 0 below the first mark. Dying can never take XP below it.
 */
export function xpFloor(xp: number, xpToNext: number, c: PointsConstants = constants.points): number {
  let floor = 0;
  for (const mark of pointMarks(xpToNext, c)) if (xp >= mark) floor = Math.max(floor, mark);
  return floor;
}

/**
 * XP into the level after dying (design 3.7). `lossFraction` is a random share of the level's requirement
 * (`xpToNext`), drawn by the caller between constants.death.xpLossMin and xpLossMax (0 to 25%).
 * Loss = min(lossFraction x xpToNext, xp - floor), so XP never drops below the highest point mark passed.
 * Example, level of 100 XP, maximum roll 25%: 74 XP has floor 50, loses 24; 76 XP has floor 75, loses 1;
 * 20 XP has floor 0, loses 20.
 */
export function xpAfterDeath(
  xp: number,
  xpToNext: number,
  lossFraction: number,
  c: PointsConstants = constants.points,
): number {
  if (!(lossFraction >= 0 && lossFraction <= 1)) throw new RangeError(`loss fraction must be 0 to 1, got ${lossFraction}`);
  const loss = Math.min(lossFraction * xpToNext, xp - xpFloor(xp, xpToNext, c));
  return xp - loss;
}

/** A fraction between xpLossMin and xpLossMax for `xpAfterDeath`, from a random number `r` in [0, 1). */
export function xpLossFractionFromRoll(r: number, c: typeof constants.death = constants.death): number {
  return c.xpLossMin + (c.xpLossMax - c.xpLossMin) * r;
}

/**
 * Character points newly awarded when XP in the current level is `newXp` (design 4.4).
 * `highestMarkReached` is the number of marks (0 to 3) this character has ever reached in this level, saved with
 * the character and reset to 0 on a level up. Points depend on it, not on the XP before, so XP that falls
 * (death, floored at a mark) and rises again never awards a mark twice. Returns the points and the new highest mark.
 */
export function newlyAwardedPoints(
  newXp: number,
  xpToNext: number,
  highestMarkReached: number,
  c: PointsConstants = constants.points,
): { points: number; highestMarkReached: number } {
  const perMark = c.characterPointsPerLevel / c.characterPointAwardAtLevelFraction.length;
  const reached = Math.max(highestMarkReached, pointsAwardedAt(newXp, xpToNext, c));
  return { points: (reached - highestMarkReached) * perMark, highestMarkReached: reached };
}

/** Where a character stands in its levels. `highestMarkReached` is explained at `newlyAwardedPoints`. */
export interface XpProgress {
  level: number;
  xpInLevel: number;
  highestMarkReached: number;
}

/** The progress after gaining XP, and the points and levels that came with it. */
export interface XpGain extends XpProgress {
  characterPoints: number;
  skillPoints: number;
  levelsGained: number;
}

/**
 * Adds `amount` XP (design 4.3, 4.4). XP past a level's requirement carries into the next level, so one kill can
 * pass several marks or levels. Reaching a level pays skillPointsPerLevel. At the level cap XP stays at 0.
 */
export function gainXp(
  progress: XpProgress,
  amount: number,
  levelCap: number = constants.levelCap,
  table: XpTable = xpTable,
  c: PointsConstants = constants.points,
): XpGain {
  let { level, highestMarkReached } = progress;
  let xpInLevel = progress.xpInLevel + amount;
  let characterPoints = 0;
  while (level < levelCap) {
    const need = xpToNextLevel(level, table);
    const award = newlyAwardedPoints(xpInLevel, need, highestMarkReached, c);
    characterPoints += award.points;
    highestMarkReached = award.highestMarkReached;
    if (xpInLevel < need) break;
    xpInLevel -= need;
    level++;
    highestMarkReached = 0;
  }
  if (level >= levelCap) xpInLevel = 0;
  const levelsGained = level - progress.level;
  return {
    level,
    xpInLevel,
    highestMarkReached,
    characterPoints,
    skillPoints: levelsGained * c.skillPointsPerLevel,
    levelsGained,
  };
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
  return finished + pointsAwardedAt(xpIntoLevel, xpToNextLevel(level), c) * perMark;
}

/**
 * Seconds until a dead character is back (design 3.7): level x constants.death.respawnSecondsPerLevel (4),
 * so level 30 waits 120 s.
 */
export function respawnSeconds(level: number, c: typeof constants.death = constants.death): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`level must be a whole number of 1 or more, got ${level}`);
  return level * c.respawnSecondsPerLevel;
}

/**
 * Health a character comes back with after respawning (design 3.7): constants.death.respawnHealthFraction (10%)
 * of its max health, rounded up, at least 1. It must heal to full (constants.death.mustHealToFullBeforeFarming)
 * before it farms again; see secondsToHealToFull in stats.ts.
 */
export function respawnHealth(maxHealth: number, c: typeof constants.death = constants.death): number {
  if (!(maxHealth > 0)) throw new RangeError(`max health must be above 0, got ${maxHealth}`);
  // The small offset keeps float noise (70 x 0.1 = 7.000000000000001) from rounding up an exact result.
  return Math.max(1, Math.ceil(maxHealth * c.respawnHealthFraction - 1e-9));
}

/**
 * Character slot tickets earned by a level change (design 4.1): a character that first reaches
 * constants.characters.slotTicketLevel (20) receives slotTicketsPerCharacter (1) ticket, once.
 * 0 or slotTicketsPerCharacter, never more in total, because only crossing the level from below counts.
 */
export function slotTicketsEarned(
  previousLevel: number,
  newLevel: number,
  c: typeof constants.characters = constants.characters,
): number {
  return previousLevel < c.slotTicketLevel && newLevel >= c.slotTicketLevel ? c.slotTicketsPerCharacter : 0;
}

/** Skill points earned (design 4.5): skillPointsPerLevel for every level gained after level 1. */
export function skillPointsEarned(level: number, c: PointsConstants = constants.points): number {
  return (level - 1) * c.skillPointsPerLevel;
}

/** Slots unlocked (design 4.1): constants.characters.startingUnlockedSlots plus one per ticket used, up to maxSlots. */
export function unlockedSlots(ticketsUsed: number, c: typeof constants.characters = constants.characters): number {
  if (!Number.isInteger(ticketsUsed) || ticketsUsed < 0) throw new RangeError(`tickets used must be a whole number of 0 or more, got ${ticketsUsed}`);
  return Math.min(c.maxSlots, c.startingUnlockedSlots + ticketsUsed);
}

/** Slots still locked: maxSlots minus the unlocked ones. */
export function lockedSlots(ticketsUsed: number, c: typeof constants.characters = constants.characters): number {
  return c.maxSlots - unlockedSlots(ticketsUsed, c);
}
