/**
 * Values worked out from state, never stored (design 4.2). Pure. The stats.ts formulas and the proficiency
 * bonuses combine as in `buildPlayer` in tools/balance/combat.ts, so the game and the balance tools agree.
 */
import { constantSection, type GameData } from '../data/game-data';
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

/** A character's stats. Unarmed for now: equipment and the weapon penalty join when equipping exists. */
export function derivedStats(character: CharacterState, data: GameData): DerivedStats {
  const stats = constantSection(data, 'stats');
  const proficiency = constantSection(data, 'proficiency');
  const { attributes: a, proficiency: points } = character;

  const attacksPerSecond = attackSpeed(
    a.dexterity,
    attackSpeedBonus('unarmed', points.unarmed, points.combat, proficiency),
    stats,
  );
  return {
    damage:
      physicalDamage(a.strength, null, stats) * (1 + proficiencyEffect('unarmed', points.unarmed, proficiency)),
    attacksPerSecond,
    attackIntervalMs: attackIntervalMs(attacksPerSecond, constantSection(data, 'combat').tickMs),
    critChance: critChance(a.dexterity, 0, stats),
    maxHealth: maxHealth(a.vitality, proficiencyEffect('toughness', points.toughness, proficiency), 0, stats),
    defence: defence(a.vitality, 0, stats),
    maxMana: maxMana(a.intelligence, 0, stats),
    spellDamageMultiplier: spellDamageMultiplier(a.intelligence, stats),
    movementSpeed: 1 + proficiencyEffect('speed', points.speed, proficiency),
  };
}
