/**
 * Proficiency, the hidden skills raised by actions (design 4.6). Points run from 0 to constants.proficiency.maxPoints.
 * Coefficients come from data/constants.json (design 5.1).
 */
import constants from '../../data/constants.json';

type ProficiencyConstants = typeof constants.proficiency;

export type ProficiencyId = keyof ProficiencyConstants['gainPerAction'];

/**
 * The enemy level a skill at `points` is "at home" with: levelsPerPoint x points, never below minReferenceLevel.
 * With 0.3 levels per point, 100 points matches level 30.
 */
export function proficiencyReferenceLevel(points: number, c: ProficiencyConstants = constants.proficiency): number {
  return Math.max(c.diminishing.minReferenceLevel, c.diminishing.levelsPerPoint * points);
}

/**
 * Points gained from one action (design 4.6): gainPerAction x min(1, actionLevel / referenceLevel)^exponent.
 * `actionLevel` is the level of the enemy fought or hit by (for moving, the level of the area).
 * Training at or above the skill's reference level gives the full gain; training far below it gives very little.
 * Returns 0 once the skill is at maxPoints. Callers apply constants.offline.proficiencyRate offline.
 */
export function proficiencyGain(
  skill: ProficiencyId,
  currentPoints: number,
  actionLevel: number,
  c: ProficiencyConstants = constants.proficiency,
): number {
  if (currentPoints >= c.maxPoints) return 0;
  const ratio = Math.min(1, Math.max(0, actionLevel) / proficiencyReferenceLevel(currentPoints, c));
  return c.gainPerAction[skill] * ratio ** c.diminishing.exponent;
}

/** Adds a gain and keeps the total inside 0..maxPoints. */
export function addProficiency(
  currentPoints: number,
  gain: number,
  c: ProficiencyConstants = constants.proficiency,
): number {
  return Math.min(c.maxPoints, Math.max(0, currentPoints + gain));
}

/** Bonus the skill gives at `points`, as a fraction: effectPerPoint x points (0.3 = +30%). Endurance counts points as the stat. */
export function proficiencyEffect(
  skill: ProficiencyId,
  points: number,
  c: ProficiencyConstants = constants.proficiency,
): number {
  return c.effectPerPoint[skill] * Math.min(c.maxPoints, Math.max(0, points));
}

/** Title shown for a skill: the highest title whose threshold the points have reached (design 4.6). */
export function proficiencyTitle(points: number, c: ProficiencyConstants = constants.proficiency): string {
  let title = c.titles[0] ?? '';
  c.titleThresholds.forEach((threshold, i) => {
    const name = c.titles[i];
    if (points >= threshold && name !== undefined) title = name;
  });
  return title;
}
