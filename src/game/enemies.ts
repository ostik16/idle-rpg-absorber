/**
 * Baseline enemy stats and money by level (design 3.5).
 * Enemies in data/enemies.json have fixed stats. These formulas give the baseline an author starts from
 * (and that the balance tools compare against); an individual enemy can sit above or below it.
 * Coefficients come from data/constants.json (design 5.1).
 */
import constants from '../../data/constants.json';

type EnemyScalingConstants = typeof constants.enemyScaling;

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`enemy level must be a whole number of 1 or more, got ${level}`);
}

/** Health: base x growth^(level - 1). */
export function enemyHealth(level: number, c: EnemyScalingConstants = constants.enemyScaling): number {
  assertLevel(level);
  return c.health.base * c.health.growthPerLevel ** (level - 1);
}

/** Damage per hit: base x growth^(level - 1). */
export function enemyDamage(level: number, c: EnemyScalingConstants = constants.enemyScaling): number {
  assertLevel(level);
  return c.damage.base * c.damage.growthPerLevel ** (level - 1);
}

/** Defence: coefficient x (level - 1)^exponent. Level 1 has none. */
export function enemyDefence(level: number, c: EnemyScalingConstants = constants.enemyScaling): number {
  assertLevel(level);
  return c.defence.coefficient * (level - 1) ** c.defence.exponent;
}

/** Attacks per second: base + perLevel x (level - 1). */
export function enemyAttackSpeed(level: number, c: EnemyScalingConstants = constants.enemyScaling): number {
  assertLevel(level);
  return c.attackSpeed.base + c.attackSpeed.perLevel * (level - 1);
}

export interface MoneyRange {
  min: number;
  max: number;
}

/**
 * Gold dropped per kill (design 3.5, 3.8): average = base x growth^(level - 1),
 * range = average x (1 -/+ spread), rounded to whole gold. Not reduced by level gap (3.8).
 */
export function enemyMoneyRange(level: number, c: EnemyScalingConstants = constants.enemyScaling): MoneyRange {
  assertLevel(level);
  const average = c.money.base * c.money.growthPerLevel ** (level - 1);
  return {
    min: Math.max(1, Math.round(average * (1 - c.money.spread))),
    max: Math.max(1, Math.round(average * (1 + c.money.spread))),
  };
}
