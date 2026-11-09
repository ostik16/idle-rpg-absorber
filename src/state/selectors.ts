/**
 * Values worked out from state, never stored (design 4.2). Pure. The stats.ts formulas and the proficiency
 * bonuses combine as in `buildPlayer` in tools/balance/combat.ts, so the game and the balance tools agree.
 */
import { constantSection, requireRow, type GameData } from '../data/game-data';
import {
  effectiveAttributes,
  equippedStats,
  type EquipmentItemRow,
  type SlotRow,
} from '../game/equipment';
import { attackSpeedBonus, proficiencyEffect } from '../game/proficiency';
import {
  attackIntervalMs,
  attackSpeed,
  critChance,
  defence,
  maxHealth,
  maxMana,
  physicalDamage,
  spellDamageMultiplier,
  weaponPenaltyMultiplier,
} from '../game/stats';
import type { CharacterState } from './types';

export interface DerivedStats {
  /** Damage per hit, before the enemy's defence. */
  damage: number;
  attacksPerSecond: number;
  /** Time between attacks, rounded to whole ticks. */
  attackIntervalMs: number;
  /** Chance from 0 to 1. */
  critChance: number;
  maxHealth: number;
  defence: number;
  maxMana: number;
  spellDamageMultiplier: number;
  /** Multiplier that divides travel and movement time. */
  movementSpeed: number;
}

/**
 * A character's stats (design 4.2, 2.2). Reads the equipped items: weapon damage with the attribute penalty,
 * flat bonuses, bonus attributes, the trained weapon-style proficiency, and the backpack's move-speed bonus
 * if its row carries one. A character with no weapon fights unarmed (`constants.stats.unarmedDamage`).
 */
export function derivedStats(character: CharacterState, data: GameData): DerivedStats {
  const stats = constantSection(data, 'stats');
  const proficiency = constantSection(data, 'proficiency');
  const combat = constantSection(data, 'combat');
  const slots = data.equipmentSlots as unknown as readonly SlotRow[];
  const itemOf = (id: string): EquipmentItemRow => requireRow(data, 'items', id) as unknown as EquipmentItemRow;

  const gear = equippedStats(character, slots, itemOf);
  const a = effectiveAttributes(character.attributes, gear.attributeBonuses);
  const { proficiency: points } = character;

  const stylePoints = points[gear.style] ?? 0;
  const penaltyMultiplier = weaponPenaltyMultiplier(a, gear.weaponScaling, combat);
  const weaponDamage = gear.weaponDamage === null ? null : gear.weaponDamage * penaltyMultiplier;

  const attacksPerSecond = attackSpeed(
    a.dexterity,
    attackSpeedBonus(gear.style, stylePoints, points.combat, proficiency),
    stats,
  );

  return {
    damage:
      physicalDamage(a.strength, weaponDamage, stats) *
      (1 + proficiencyEffect(gear.style, stylePoints, proficiency)),
    attacksPerSecond,
    attackIntervalMs: attackIntervalMs(attacksPerSecond, combat.tickMs),
    critChance: critChance(a.dexterity, 0, stats),
    maxHealth: maxHealth(a.vitality, proficiencyEffect('toughness', points.toughness, proficiency), gear.flatHealth, stats),
    defence: defence(a.vitality, gear.flatDefence, stats),
    maxMana: maxMana(a.intelligence, gear.flatMana, stats),
    spellDamageMultiplier: spellDamageMultiplier(a.intelligence, stats),
    movementSpeed: 1 + proficiencyEffect('speed', points.speed, proficiency) + gear.moveSpeedBonus,
  };
}

/** True when the bag holds no health potion (design 2.6), the Farm screen's alert: the character can now die from it. */
export function outOfPotions(character: CharacterState, data: GameData): boolean {
  return !character.bag.some((stack) => {
    const row = requireRow(data, 'items', stack.itemId) as { effect?: { type?: string } };
    return stack.qty > 0 && row.effect?.type === 'heal-over-time';
  });
}
