/**
 * Proficiency, the hidden skills raised by actions (design 4.6). Points run from 0 to constants.proficiency.maxPoints.
 * Coefficients come from data/constants.json (design 5.1).
 */
import constants from '../../data/constants.json';

type ProficiencyConstants = typeof constants.proficiency;

/**
 * The hidden skills (design 4.6): unarmed, one-handed, two-handed, toughness, speed and combat.
 * Endurance was dropped (owner decision I1): there is no endurance skill or stat anywhere in src/game.
 */
export type ProficiencyId = keyof ProficiencyConstants['gainPerAction'];

/** The weapon-style skills: they add damage (effectPerPoint) and attack speed (attackSpeedPerPoint). */
export type WeaponStyleId = keyof Omit<ProficiencyConstants['attackSpeedPerPoint'], 'combat'>;

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
 * Units of one action: a hit for weapon-style skills and toughness, an attack for combat,
 * a second moved for speed (travel and the time between enemies).
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

/**
 * Bonus the skill gives at `points`, as a fraction: effectPerPoint x points (0.3 = +30%).
 * Weapon styles: damage. Toughness: health. Speed: movement speed. Combat has no direct effect (0);
 * it only adds attack speed through `attackSpeedBonus`.
 */
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

/**
 * Attack speed bonus as a fraction (design 4.6): weapon-style points x attackSpeedPerPoint[style]
 * + combat points x attackSpeedPerPoint.combat. Final attack speed is the dexterity-based attacks
 * per second x (1 + this); pass it as the `bonus` of stats.attackSpeed.
 */
export function attackSpeedBonus(
  style: WeaponStyleId,
  stylePoints: number,
  combatPoints: number,
  c: ProficiencyConstants = constants.proficiency,
): number {
  const clamp = (p: number): number => Math.min(c.maxPoints, Math.max(0, p));
  return c.attackSpeedPerPoint[style] * clamp(stylePoints) + c.attackSpeedPerPoint.combat * clamp(combatPoints);
}

/**
 * Time to cover a movement that takes `baseSeconds` at 0 speed points (design 3.3, 4.6):
 * baseSeconds / (1 + speedPoints x effectPerPoint.speed). Applies to travel and to the time between enemies.
 */
export function movementSeconds(
  baseSeconds: number,
  speedPoints: number,
  c: ProficiencyConstants = constants.proficiency,
): number {
  return baseSeconds / (1 + proficiencyEffect('speed', speedPoints, c));
}
