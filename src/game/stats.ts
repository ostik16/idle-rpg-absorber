/**
 * Derived stats, combat damage and character creation (design 4.1, 4.2, 2.2, 3.6).
 * Pure functions. Every coefficient comes from data/constants.json (design 5.1).
 * Bonuses from equipment and proficiency are passed in by the caller.
 */
import constants from '../../data/constants.json';
import { quantiseToSteps } from './formulas';

type StatsConstants = typeof constants.stats;
type CombatConstants = typeof constants.combat;
type CreationConstants = typeof constants.creation;

export type AttributeId = 'strength' | 'dexterity' | 'vitality' | 'intelligence';
export type Attributes = Record<AttributeId, number>;

const ATTRIBUTE_IDS: readonly AttributeId[] = ['strength', 'dexterity', 'vitality', 'intelligence'];

/**
 * Unarmed damage (design 4.2): the weapon damage used when no weapon is equipped, constants.stats.unarmedDamage.
 * Characters start with no gear, so they fight unarmed at first.
 */
export function weaponDamageOrUnarmed(weaponDamage: number | null, c: StatsConstants = constants.stats): number {
  return weaponDamage === null ? c.unarmedDamage : weaponDamage;
}

/**
 * Physical damage per hit, before the weapon penalty and proficiency bonus.
 * base + perStrength x Strength + the weapon's damage. `weaponDamage` null means no weapon: unarmed damage is used.
 */
export function physicalDamage(
  strength: number,
  weaponDamage: number | null = null,
  c: StatsConstants = constants.stats,
): number {
  return c.physicalDamage.base + c.physicalDamage.perStrength * strength + weaponDamageOrUnarmed(weaponDamage, c);
}

/**
 * Attacks per second: (base + perDexterity x Dexterity) x (1 + bonus).
 * `bonus` is a fraction, for example 0.1 for +10%: use proficiency.attackSpeedBonus (weapon style and combat skills) plus gear.
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
  return quantiseToSteps(1000 / attacksPerSecond, tickMs);
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
 * Damage of one hit (design 3.6): attacker damage minus defender defence, flat,
 * never below constants.combat.minDamage. A critical hit multiplies the result by critMultiplier (2), after defence and the minimum.
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
  /** Attribute value the weapon requires. */
  requiredValue: number;
}

/**
 * Weapon attribute penalty (design 2.2). Returns a multiplier on the weapon's stats in [1 - cap, 1].
 * Each attribute point below a required value costs perMissingPoint (1%), added up over all the weapon's
 * scaling attributes, and the total penalty is capped (50%):
 * 1 - min(cap, perMissingPoint x sum(max(0, required - attribute))).
 * A weapon with no scaling, and no weapon at all, has no penalty.
 */
export function weaponPenaltyMultiplier(
  attributes: Attributes,
  scaling: readonly WeaponScaling[],
  c: CombatConstants = constants.combat,
): number {
  let missing = 0;
  for (const { attribute, requiredValue } of scaling) missing += Math.max(0, requiredValue - attributes[attribute]);
  return 1 - Math.min(c.weaponPenalty.cap, c.weaponPenalty.perMissingPoint * missing);
}

const NO_ALLOCATION: Attributes = { strength: 0, dexterity: 0, vitality: 0, intelligence: 0 };

/**
 * Starting attributes for a new character: the base values plus the player's allocation of free points.
 * constants.creation.freePoints is 0, so by default the allocation is empty and the result is the base values.
 * There is no starting gear (constants.creation.startingEquipment); the only starting items are constants.creation.startingItems.
 */
export function startingAttributes(
  allocation: Attributes = NO_ALLOCATION,
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

export interface QueuedPotions {
  /** Health restored on each tick, from the moment the first potion starts. */
  healPerTick: number[];
  /** Number of ticks until the last potion ends. */
  totalTicks: number;
  /** Total health restored. */
  totalHeal: number;
}

/**
 * Potions queue instead of stacking (constants.potions.stacking = "queue", design 2.6): a potion drunk while
 * another is healing starts healing when the previous one ends. `potions` are in drinking order, all drunk
 * while the first is still healing (so there is never a gap). Returns the heal on each tick.
 */
export function queuePotions(
  potions: readonly Pick<PotionTier, 'amount' | 'durationSeconds'>[],
  tickMs: number = constants.potions.tickMs,
): QueuedPotions {
  const healPerTick: number[] = [];
  for (const potion of potions) {
    const ticks = potionTickCount(potion.durationSeconds, tickMs);
    const perTick = potionHealPerTick(potion, { tickMs });
    for (let i = 0; i < ticks; i++) healPerTick.push(perTick);
  }
  return { healPerTick, totalTicks: healPerTick.length, totalHeal: healPerTick.reduce((s, h) => s + h, 0) };
}

/**
 * Default health regeneration (design 3.7): constants.stats.healthRegen.fractionOfMaxPerSecond (0.5%) of max health
 * per second, always on. Meant to be too slow to replace potions, but enough to heal without potions or money.
 */
export function healthRegenPerSecond(maxHealthValue: number, c: StatsConstants = constants.stats): number {
  return maxHealthValue * c.healthRegen.fractionOfMaxPerSecond;
}

/** Health regained over `seconds` seconds of default regeneration (not capped at max health). */
export function regenOverSeconds(maxHealthValue: number, seconds: number, c: StatsConstants = constants.stats): number {
  if (!(seconds >= 0)) throw new RangeError(`seconds must be 0 or more, got ${seconds}`);
  return healthRegenPerSecond(maxHealthValue, c) * seconds;
}

/**
 * Seconds to heal from `currentHealth` to full: missing health / (default regeneration + `extraHealPerSecond`,
 * for example a potion's rate). 0 when already full.
 */
export function secondsToHealToFull(
  maxHealthValue: number,
  currentHealth: number,
  extraHealPerSecond = 0,
  c: StatsConstants = constants.stats,
): number {
  const missing = maxHealthValue - currentHealth;
  if (missing <= 0) return 0;
  const rate = healthRegenPerSecond(maxHealthValue, c) + extraHealPerSecond;
  if (!(rate > 0)) throw new RangeError(`heal rate must be above 0, got ${rate}`);
  return missing / rate;
}
