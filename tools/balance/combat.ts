/**
 * Combat simulation for the balance tools (design 3.6, 5.3). Pure: builds fighters from the formulas in
 * src/game and resolves fights tick by tick with a seeded RNG. Nothing here reads files.
 *
 * Model: both sides attack on the engine tick (constants.combat.tickMs). The first attack of each side lands one
 * full interval after the fight starts. On a tick where both attack, the player acts first, so an enemy killed on
 * that tick does not strike back. Only the player can crit (enemy crit is not in the design). Each fight starts at
 * full health; potions, spells, traits and the weapon attribute penalty are not modelled.
 */
import constants from '../../data/constants.json';
import { enemyAttackSpeed, enemyDamage, enemyDefence, enemyHealth } from '../../src/game/enemies';
import { proficiencyEffect, type ProficiencyId } from '../../src/game/proficiency';
import type { Rng } from '../../src/game/rng';
import {
  attackIntervalMs,
  attackSpeed,
  critChance,
  defence,
  hitDamage,
  maxHealth,
  physicalDamage,
  type Attributes,
} from '../../src/game/stats';
import { BalanceError, type EnemyEntry } from './load-data';

export interface Combatant {
  maxHp: number;
  /** Damage per hit before the target's defence. */
  damage: number;
  defence: number;
  /** Crit chance 0..1. */
  critChance: number;
  /** Time between attacks, a whole number of ticks. */
  intervalMs: number;
}

export type WeaponType = 'unarmed' | 'one-handed' | 'two-handed';

export interface PlayerBuild {
  level: number;
  attributes: Attributes;
  weaponDamage: number;
  armourDefence: number;
  weaponType: WeaponType;
  /** Proficiency points, 0 to constants.proficiency.maxPoints. */
  weaponProficiency: number;
  toughnessProficiency: number;
  speedProficiency: number;
}

/** Creation attributes, no gear, no proficiency. */
export function defaultBuild(level = 1): PlayerBuild {
  return {
    level,
    attributes: { ...constants.creation.baseAttributes },
    weaponDamage: 0,
    armourDefence: 0,
    weaponType: 'one-handed',
    weaponProficiency: 0,
    toughnessProficiency: 0,
    speedProficiency: 0,
  };
}

/**
 * The reference character docs/decisions.md N6 tuned the enemy baseline against: attribute points split 45/20/25/10
 * (strength, dexterity, vitality, intelligence), weapon damage 3 + 1.8 x (L - 1), armour 1 + 0.9 x (L - 1).
 * These gear numbers are from the decision log, not from data/constants.json: proposed home is a `balance.referenceBuild` constant.
 */
export const REFERENCE_SPLIT = { strength: 0.45, dexterity: 0.2, vitality: 0.25, intelligence: 0.1 } as const;
export const REFERENCE_GEAR = { weaponBase: 3, weaponPerLevel: 1.8, armourBase: 1, armourPerLevel: 0.9 } as const;

export function referenceBuild(level: number): PlayerBuild {
  const base = constants.creation.baseAttributes;
  const total =
    base.strength + base.dexterity + base.vitality + base.intelligence + constants.creation.freePoints +
    constants.points.characterPointsPerLevel * (level - 1);
  return {
    ...defaultBuild(level),
    attributes: {
      strength: total * REFERENCE_SPLIT.strength,
      dexterity: total * REFERENCE_SPLIT.dexterity,
      vitality: total * REFERENCE_SPLIT.vitality,
      intelligence: total * REFERENCE_SPLIT.intelligence,
    },
    weaponDamage: REFERENCE_GEAR.weaponBase + REFERENCE_GEAR.weaponPerLevel * (level - 1),
    armourDefence: REFERENCE_GEAR.armourBase + REFERENCE_GEAR.armourPerLevel * (level - 1),
  };
}

/** Turns a build into a fighter with the stats.ts formulas (4.2) and the proficiency bonuses (4.6). */
export function buildPlayer(build: PlayerBuild, tickMs: number = constants.combat.tickMs): Combatant {
  const { attributes: a } = build;
  const weaponSkill: ProficiencyId = build.weaponType;
  const damageBonus = proficiencyEffect(weaponSkill, build.weaponProficiency);
  const healthBonus = proficiencyEffect('toughness', build.toughnessProficiency);
  const speedBonus = proficiencyEffect('speed', build.speedProficiency);
  return {
    maxHp: maxHealth(a.vitality, healthBonus),
    damage: physicalDamage(a.strength, build.weaponDamage) * (1 + damageBonus),
    defence: defence(a.vitality, build.armourDefence),
    critChance: critChance(a.dexterity),
    intervalMs: attackIntervalMs(attackSpeed(a.dexterity, speedBonus), tickMs),
  };
}

/** The baseline enemy of a level (design 3.5, constants.enemyScaling). */
export function baselineEnemy(level: number, tickMs: number = constants.combat.tickMs): Combatant {
  return {
    maxHp: enemyHealth(level),
    damage: enemyDamage(level),
    defence: enemyDefence(level),
    critChance: 0,
    intervalMs: attackIntervalMs(enemyAttackSpeed(level), tickMs),
  };
}

/** An enemy from data/enemies.json. Needs health, damage, attackSpeed and defence. */
export function enemyFromData(enemy: EnemyEntry, tickMs: number = constants.combat.tickMs): Combatant {
  const { health, damage, attackSpeed: speed, defence: def } = enemy;
  if (health === undefined || damage === undefined || speed === undefined || def === undefined) {
    throw new BalanceError(`Enemy "${enemy.id}" needs health, damage, attackSpeed and defence in data/enemies.json.`);
  }
  return { maxHp: health, damage, defence: def, critChance: 0, intervalMs: attackIntervalMs(speed, tickMs) };
}

export type Outcome = 'win' | 'loss' | 'timeout';

export interface FightResult {
  outcome: Outcome;
  /** Fight length in ms (to the killing blow, or the time limit). */
  timeMs: number;
  /** Damage the player took, including overkill on a loss. */
  damageTaken: number;
  playerHits: number;
  playerCrits: number;
  enemyHits: number;
}

export interface FightOptions {
  tickMs?: number;
  /** Fights longer than this count as a timeout (a stalemate). */
  maxSeconds?: number;
}

/** Resolves one fight from full health. See the model note at the top of the file. */
export function resolveFight(player: Combatant, enemy: Combatant, rng: Rng, options: FightOptions = {}): FightResult {
  const tickMs = options.tickMs ?? constants.combat.tickMs;
  const maxTicks = Math.ceil(((options.maxSeconds ?? 600) * 1000) / tickMs);
  const playerEvery = Math.max(1, Math.round(player.intervalMs / tickMs));
  const enemyEvery = Math.max(1, Math.round(enemy.intervalMs / tickMs));
  let playerHp = player.maxHp;
  let enemyHp = enemy.maxHp;
  let playerHits = 0;
  let playerCrits = 0;
  let enemyHits = 0;

  for (let tick = 1; tick <= maxTicks; tick++) {
    if (tick % playerEvery === 0) {
      const crit = rng.chance(player.critChance);
      enemyHp -= hitDamage(player.damage, enemy.defence, crit);
      playerHits++;
      if (crit) playerCrits++;
      if (enemyHp <= 0) {
        return { outcome: 'win', timeMs: tick * tickMs, damageTaken: player.maxHp - playerHp, playerHits, playerCrits, enemyHits };
      }
    }
    if (tick % enemyEvery === 0) {
      const crit = rng.chance(enemy.critChance);
      playerHp -= hitDamage(enemy.damage, player.defence, crit);
      enemyHits++;
      if (playerHp <= 0) {
        return { outcome: 'loss', timeMs: tick * tickMs, damageTaken: player.maxHp - playerHp, playerHits, playerCrits, enemyHits };
      }
    }
  }
  return { outcome: 'timeout', timeMs: maxTicks * tickMs, damageTaken: player.maxHp - playerHp, playerHits, playerCrits, enemyHits };
}

export interface TimeStats {
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

export interface FightSummary {
  runs: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  /** Seconds, wins only. Null when there were no wins. */
  timeToKill: TimeStats | null;
  /** Mean damage taken per fight over all fights (a loss counts what was taken until death). */
  meanDamageTaken: number;
  /** Mean health lost per fight, as a fraction of max health (a loss counts as 1). */
  meanHpLostFraction: number;
  /** Max health divided by mean damage taken in won fights: fights a full bar lasts. Infinity if no damage. */
  fightsPerFullHealth: number;
  playerMaxHp: number;
}

/** Nearest-rank percentile of a sorted array, p in 0..1. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1] ?? NaN;
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? NaN) : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
}

export function summarise(results: readonly FightResult[], playerMaxHp: number): FightSummary {
  const runs = results.length;
  const wins = results.filter((r) => r.outcome === 'win');
  const times = wins.map((r) => r.timeMs / 1000).sort((x, y) => x - y);
  const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
  const winDamage = wins.length === 0 ? 0 : sum(wins.map((r) => r.damageTaken)) / wins.length;
  return {
    runs,
    wins: wins.length,
    losses: results.filter((r) => r.outcome === 'loss').length,
    timeouts: results.filter((r) => r.outcome === 'timeout').length,
    winRate: runs === 0 ? 0 : wins.length / runs,
    timeToKill:
      times.length === 0
        ? null
        : { mean: sum(times) / times.length, median: median(times), p95: percentile(times, 0.95), min: times[0] ?? NaN, max: times[times.length - 1] ?? NaN },
    meanDamageTaken: runs === 0 ? 0 : sum(results.map((r) => r.damageTaken)) / runs,
    meanHpLostFraction: runs === 0 ? 0 : sum(results.map((r) => Math.min(1, r.damageTaken / playerMaxHp))) / runs,
    fightsPerFullHealth: winDamage > 0 ? playerMaxHp / winDamage : Infinity,
    playerMaxHp,
  };
}

/** Runs `runs` fights with one RNG and summarises them. */
export function runFights(player: Combatant, enemy: Combatant, runs: number, rng: Rng, options: FightOptions = {}): FightSummary {
  const results: FightResult[] = [];
  for (let i = 0; i < runs; i++) results.push(resolveFight(player, enemy, rng, options));
  return summarise(results, player.maxHp);
}
