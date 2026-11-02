/**
 * Derived stats, combat damage and character creation (design 4.1, 4.2, 2.2, 3.6).
 * Pure functions. Every coefficient comes from data/constants.json (design 5.1).
 * Bonuses from equipment and proficiency are passed in by the caller.
 */
import constants from '../../data/constants.json';

type StatsConstants = typeof constants.stats;
type CombatConstants = typeof constants.combat;
type CreationConstants = typeof constants.creation;

export type AttributeId = 'strength' | 'dexterity' | 'vitality' | 'intelligence';
export type Attributes = Record<AttributeId, number>;

const ATTRIBUTE_IDS: readonly AttributeId[] = ['strength', 'dexterity', 'vitality', 'intelligence'];

/**
 * Physical damage per hit, before the weapon penalty and proficiency bonus.
 * base + perStrength x Strength + the weapon's damage.
 */
export function physicalDamage(
  strength: number,
  weaponDamage = 0,
  c: StatsConstants = constants.stats,
): number {
  return c.physicalDamage.base + c.physicalDamage.perStrength * strength + weaponDamage;
}

/**
 * Attacks per second: (base + perDexterity x Dexterity) x (1 + bonus).
 * `bonus` is a fraction, for example 0.1 for +10% from the speed proficiency and gear.
 */
export function attackSpeed(dexterity: number, bonus = 0, c: StatsConstants = constants.stats): number {
  return (c.attackSpeed.base + c.attackSpeed.perDexterity * dexterity) * (1 + bonus);
}

/**
 * Time between attacks in ms. The engine acts on ticks (constants.combat.tickMs), so the interval is
 * rounded to the nearest whole tick, never below one tick.
 */
export function attackIntervalMs(
  attacksPerSecond: number,
  tickMs: number = constants.combat.tickMs,
): number {
  if (!(attacksPerSecond > 0)) throw new RangeError(`attacks per second must be above 0, got ${attacksPerSecond}`);
  const ticks = Math.max(1, Math.round(1000 / attacksPerSecond / tickMs));
  return ticks * tickMs;
}

/** Critical chance 0..1: base + perDexterity x Dexterity + bonus, capped. */
export function critChance(dexterity: number, bonus = 0, c: StatsConstants = constants.stats): number {
  const chance = c.critChance.base + c.critChance.perDexterity * dexterity + bonus;
  return Math.min(c.critChance.cap, Math.max(0, chance));
}

/**
 * Maximum health: (base + perVitality x Vitality) x (1 + healthBonus) + flat.
 * `healthBonus` is a fraction (toughness proficiency), `flat` comes from equipment.
 */
export function maxHealth(
  vitality: number,
  healthBonus = 0,
  flat = 0,
  c: StatsConstants = constants.stats,
): number {
  return (c.health.base + c.health.perVitality * vitality) * (1 + healthBonus) + flat;
}

/** Defence: perVitality x Vitality + flat defence from equipment. */
export function defence(vitality: number, flat = 0, c: StatsConstants = constants.stats): number {
  return c.defence.perVitality * vitality + flat;
}

/** Maximum mana: base + perIntelligence x Intelligence + flat from equipment. */
export function maxMana(intelligence: number, flat = 0, c: StatsConstants = constants.stats): number {
  return c.mana.base + c.mana.perIntelligence * intelligence + flat;
}

/** Spell damage multiplier: 1 + perIntelligence x Intelligence. A spell's own damage is multiplied by it. */
export function spellDamageMultiplier(intelligence: number, c: StatsConstants = constants.stats): number {
  return 1 + c.spellDamage.perIntelligence * intelligence;
}

/**
 * Movement speed multiplier from the endurance stat (design 4.2, decision I1):
 * 1 + perEndurance x endurance. Travel time is distance / (base speed x this).
 */
export function moveSpeedMultiplier(endurance: number, c: StatsConstants = constants.stats): number {
  return 1 + c.moveSpeed.perEndurance * endurance;
}

/**
 * Damage of one hit (design 3.6): attacker damage minus defender defence, flat,
 * never below constants.combat.minDamage. A critical hit multiplies the result by critMultiplier.
 */
export function hitDamage(
  attackerDamage: number,
  defenderDefence: number,
  isCrit = false,
  c: CombatConstants = constants.combat,
): number {
  const dealt = Math.max(c.minDamage, attackerDamage - defenderDefence);
  return isCrit ? dealt * c.critMultiplier : dealt;
}

export interface WeaponScaling {
  attribute: AttributeId;
  recommended: number;
}

/**
 * Weapon attribute penalty (design 2.2). Returns a damage multiplier in [floor, 1].
 * Each scaling attribute below its recommended value contributes value / recommended,
 * the contributions multiply, and the result never falls below constants.combat.weaponPenaltyFloor.
 * A weapon with no scaling, and no weapon at all, has no penalty.
 */
export function weaponPenaltyMultiplier(
  attributes: Attributes,
  scaling: readonly WeaponScaling[],
  c: CombatConstants = constants.combat,
): number {
  let multiplier = 1;
  for (const { attribute, recommended } of scaling) {
    if (recommended <= 0) continue;
    multiplier *= Math.min(1, Math.max(0, attributes[attribute]) / recommended);
  }
  return Math.max(c.weaponPenaltyFloor, multiplier);
}

/** Starting attributes for a new character: the base values plus the player's allocation of free points. */
export function startingAttributes(
  allocation: Attributes,
  c: CreationConstants = constants.creation,
): Attributes {
  let spent = 0;
  for (const id of ATTRIBUTE_IDS) {
    const points = allocation[id];
    if (!Number.isInteger(points) || points < 0) {
      throw new RangeError(`allocation for ${id} must be a whole number of 0 or more, got ${points}`);
    }
    spent += points;
  }
  if (spent !== c.freePoints) {
    throw new RangeError(`allocate exactly ${c.freePoints} free points, got ${spent}`);
  }
  return {
    strength: c.baseAttributes.strength + allocation.strength,
    dexterity: c.baseAttributes.dexterity + allocation.dexterity,
    vitality: c.baseAttributes.vitality + allocation.vitality,
    intelligence: c.baseAttributes.intelligence + allocation.intelligence,
  };
}

/**
 * Checks a new character's name. Returns an error message, or null when the name is fine.
 * The name is trimmed first, must be 1 to 16 characters and must not match another character (case-insensitive).
 */
export function characterNameError(
  name: string,
  existingNames: readonly string[] = [],
  c: CreationConstants = constants.creation,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length < c.nameMinLength) return 'Enter a name.';
  if (trimmed.length > c.nameMaxLength) return `Use ${c.nameMaxLength} characters or fewer.`;
  const lower = trimmed.toLowerCase();
  if (existingNames.some((n) => n.trim().toLowerCase() === lower)) return 'Another character already has that name.';
  return null;
}

type PotionConstants = typeof constants.potions;

export interface PotionTier {
  id: string;
  /** Total health restored over the whole duration. */
  amount: number;
  durationSeconds: number;
}

/** Number of heal ticks a potion delivers: duration / tick length, at least 1. */
export function potionTickCount(
  durationSeconds: number,
  tickMs: number = constants.potions.tickMs,
): number {
  return Math.max(1, Math.round((durationSeconds * 1000) / tickMs));
}

/** Health restored on each tick (design 2.6): amount spread evenly over the ticks. */
export function potionHealPerTick(
  potion: Pick<PotionTier, 'amount' | 'durationSeconds'>,
  c: Pick<PotionConstants, 'tickMs'> = constants.potions,
): number {
  return potion.amount / potionTickCount(potion.durationSeconds, c.tickMs);
}

/** Heal rate in health per second. Better potions have a higher rate (design 2.6). */
export function potionHealPerSecond(potion: Pick<PotionTier, 'amount' | 'durationSeconds'>): number {
  return potion.amount / potion.durationSeconds;
}
