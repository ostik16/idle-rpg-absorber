/**
 * Pure formulas for rules the design docs have already decided.
 * Constants come from data/constants.json (design 5.1), never hard-coded here.
 */
import constants from '../../data/constants.json';

type DropConstants = typeof constants.drops;
type AbsorptionConstants = typeof constants.absorption;
type UpgradeConstants = typeof constants.upgrade;

/**
 * A time in ms as a whole number of engine steps, rounded to the nearest and at least one (ADR 0002
 * "One engine, driven by timestamps"). Attack intervals have their own rounding in stats.ts.
 */
export function quantiseToSteps(ms: number, tickMs: number): number {
  return Math.max(1, Math.round(ms / tickMs)) * tickMs;
}

/**
 * Drop level modifier (design 3.8).
 * diff = character level - enemy level.
 *  - diff >= 0: max(0, 1 - 0.1 * diff)
 *  - enemy 1-19 levels above the character: 1
 *  - enemy 20+ levels above the character: 0
 */
export function dropLevelModifier(
  characterLevel: number,
  enemyLevel: number,
  c: DropConstants = constants.drops,
): number {
  const diff = characterLevel - enemyLevel;
  if (diff >= 0) return Math.max(0, 1 - c.levelFalloffPerLevel * diff);
  if (-diff >= c.noDropEnemyLevelsAbove) return 0;
  return 1;
}

/** final chance = base chance x level modifier (design 3.8). */
export function dropChance(baseChance: number, characterLevel: number, enemyLevel: number): number {
  return baseChance * dropLevelModifier(characterLevel, enemyLevel);
}

/**
 * Absorption level modifier (design 4.7): 0.9^diff for a character above the enemy. Never reaches 0.
 * An enemy above the character gives constants.absorption.enemyAboveCharacterModifier (1, no bonus).
 */
export function absorptionLevelModifier(
  characterLevel: number,
  enemyLevel: number,
  c: AbsorptionConstants = constants.absorption,
): number {
  const diff = characterLevel - enemyLevel;
  return diff >= 0 ? c.levelFactor ** diff : c.enemyAboveCharacterModifier;
}

/**
 * New value of an absorbed trait after one kill (design 4.7).
 * Each kill grants 1% of the enemy's trait value, scaled by the level modifier,
 * and the trait can never exceed the value of the enemy it came from.
 * A trait already at or above the enemy's value is left unchanged.
 */
export function absorbOnKill(
  currentValue: number,
  enemyTraitValue: number,
  characterLevel: number,
  enemyLevel: number,
  c: AbsorptionConstants = constants.absorption,
): number {
  if (currentValue >= enemyTraitValue) return currentValue;
  const gain = enemyTraitValue * c.perKillFraction * absorptionLevelModifier(characterLevel, enemyLevel, c);
  return Math.min(enemyTraitValue, currentValue + gain);
}

/**
 * Success chance of one upgrade step (design 2.7). `fromLevel` is the current level, 0..maxLevel-1.
 * +0 -> +1 is 90%, and each next step is 90% of the previous one.
 */
export function upgradeSuccessChance(fromLevel: number, c: UpgradeConstants = constants.upgrade): number {
  if (!Number.isInteger(fromLevel) || fromLevel < 0 || fromLevel >= c.maxLevel) {
    throw new RangeError(`upgrade fromLevel must be an integer 0..${c.maxLevel - 1}, got ${fromLevel}`);
  }
  return c.startChance * c.chanceFactor ** fromLevel;
}

/** Chance to go from +0 to the max level without a failure, i.e. without protection (design 2.7, about 0.9%). */
export function chanceToMaxWithoutFailure(c: UpgradeConstants = constants.upgrade): number {
  let p = 1;
  for (let level = 0; level < c.maxLevel; level++) p *= upgradeSuccessChance(level, c);
  return p;
}
