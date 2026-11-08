/**
 * Combat simulation for the balance tools (design 3.6, 5.3). Pure: builds fighters from the formulas in
 * src/game and resolves fights with a seeded RNG, one `fightTick` at a time, the same rule the game runs.
 * Nothing here reads files.
 *
 * Model: `fightTick` in src/game/combat.ts. Each fight starts at full health; regeneration, potions, spells and traits
 * are not modelled. The weapon attribute penalty (2.2) applies to the weapon's damage when the build lists the
 * weapon's required attributes. A build without a weapon fights unarmed (4.2).
 */
import constants from '../../data/constants.json';
import { enemyCombatant, fightTick, type Combatant } from '../../src/game/combat';
import { enemyAttackSpeed, enemyDamage, enemyDefence, enemyHealth } from '../../src/game/enemies';
import { attackSpeedBonus, proficiencyEffect } from '../../src/game/proficiency';
import { createStream, type Rng } from '../../src/game/rng';
import {
  attackIntervalMs,
  attackSpeed,
  critChance,
  defence,
  healthRegenPerSecond,
  maxHealth,
  physicalDamage,
  regenOverSeconds,
  weaponPenaltyMultiplier,
  type Attributes,
  type WeaponScaling,
} from '../../src/game/stats';
import { BalanceError, type EnemyEntry } from './load-data';

export type { Combatant };

export type WeaponType = 'unarmed' | 'one-handed' | 'two-handed';

export interface PlayerBuild {
  level: number;
  attributes: Attributes;
  /** Weapon damage, or null when unarmed (constants.stats.unarmedDamage is used). */
  weaponDamage: number | null;
  /** Attributes the weapon requires (2.2). Missing points cost damage; empty means no penalty. */
  weaponScaling: WeaponScaling[];
  armourDefence: number;
  weaponType: WeaponType;
  /** Proficiency points, 0 to constants.proficiency.maxPoints. */
  weaponProficiency: number;
  toughnessProficiency: number;
  /** General combat skill: adds attack speed (4.6). The speed skill trains by moving and does not affect fights. */
  combatProficiency: number;
}

/** Creation attributes plus the automatic gain per level (4.3), no points spent, unarmed, no armour, no proficiency. */
export function defaultBuild(level = 1): PlayerBuild {
  const base = constants.creation.baseAttributes;
  const perLevel = constants.progression.attributesPerLevel;
  return {
    level,
    attributes: {
      strength: base.strength + perLevel.strength * (level - 1),
      dexterity: base.dexterity + perLevel.dexterity * (level - 1),
      vitality: base.vitality + perLevel.vitality * (level - 1),
      intelligence: base.intelligence + perLevel.intelligence * (level - 1),
    },
    weaponDamage: null,
    weaponScaling: [],
    armourDefence: 0,
    weaponType: 'unarmed',
    weaponProficiency: 0,
    toughnessProficiency: 0,
    combatProficiency: 0,
  };
}

/**
 * The reference character docs/decisions.md N6 tuned the enemy baseline against: attribute points split 45/20/25/10
 * (strength, dexterity, vitality, intelligence), weapon damage 3 + 1.8 x (L - 1), armour 1 + 0.9 x (L - 1).
 * The numbers are in constants.balance.referenceBuild.
 */
const REFERENCE = constants.balance.referenceBuild;

export function referenceBuild(level: number): PlayerBuild {
  const base = constants.creation.baseAttributes;
  const total =
    base.strength + base.dexterity + base.vitality + base.intelligence + constants.creation.freePoints +
    constants.points.characterPointsPerLevel * (level - 1);
  return {
    ...defaultBuild(level),
    attributes: {
      strength: total * REFERENCE.attributeSplit.strength,
      dexterity: total * REFERENCE.attributeSplit.dexterity,
      vitality: total * REFERENCE.attributeSplit.vitality,
      intelligence: total * REFERENCE.attributeSplit.intelligence,
    },
    weaponDamage: REFERENCE.weaponBase + REFERENCE.weaponPerLevel * (level - 1),
    weaponType: 'one-handed',
    armourDefence: REFERENCE.armourBase + REFERENCE.armourPerLevel * (level - 1),
  };
}

/** Turns a build into a fighter with the stats.ts formulas (4.2) and the proficiency bonuses (4.6). */
export function buildPlayer(build: PlayerBuild, tickMs: number = constants.combat.tickMs): Combatant {
  const { attributes: a } = build;
  const damageBonus = proficiencyEffect(build.weaponType, build.weaponProficiency);
  const healthBonus = proficiencyEffect('toughness', build.toughnessProficiency);
  const speedBonus = attackSpeedBonus(build.weaponType, build.weaponProficiency, build.combatProficiency);
  // The penalty applies to the weapon's stats only; unarmed damage has none.
  const weaponDamage =
    build.weaponDamage === null ? null : build.weaponDamage * weaponPenaltyMultiplier(a, build.weaponScaling);
  return {
    maxHp: maxHealth(a.vitality, healthBonus),
    damage: physicalDamage(a.strength, weaponDamage) * (1 + damageBonus),
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
  return enemyCombatant({ health, damage, attackSpeed: speed, defence: def }, tickMs);
}

/** An enemy from data when it has all its stats, else the baseline enemy of its level (3.5). */
export function enemyOrBaseline(enemy: EnemyEntry, tickMs: number = constants.combat.tickMs): Combatant {
  try {
    return enemyFromData(enemy, tickMs);
  } catch (e) {
    if (e instanceof BalanceError) return baselineEnemy(enemy.level, tickMs);
    throw e;
  }
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
  let playerHp = player.maxHp;
  let enemyHp = enemy.maxHp;
  let playerHits = 0;
  let playerCrits = 0;
  let enemyHits = 0;

  for (let tick = 1; tick <= maxTicks; tick++) {
    const result = fightTick({ tick, playerHp, enemyHp, player, enemy, rng, tickMs, playerAttacks: true });
    ({ playerHp, enemyHp } = result);
    if (result.playerHit) playerHits++;
    if (result.playerCrit) playerCrits++;
    if (result.enemyHit) enemyHits++;
    if (result.outcome !== null) {
      return { outcome: result.outcome, timeMs: tick * tickMs, damageTaken: player.maxHp - playerHp, playerHits, playerCrits, enemyHits };
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

/**
 * Mean seconds to kill `enemy` over `runs` fights (wins only), or null when the player never wins.
 * The balance tools use it as the fight part of the time per kill.
 */
export function meanFightSeconds(player: Combatant, enemy: Combatant, runs: number, rng: Rng, options: FightOptions = {}): number | null {
  return runFights(player, enemy, runs, rng, options).timeToKill?.mean ?? null;
}

/**
 * Fight seconds per kill for the balance tools: mean time to kill `foe` with the reference build of `characterLevel`,
 * over `runs` seeded fights. Throws BalanceError if that build never wins (the caller should pass a fixed fight time).
 */
export function referenceFightSeconds(characterLevel: number, foe: Combatant, label: string, runs = 200): number {
  const seconds = meanFightSeconds(buildPlayer(referenceBuild(characterLevel)), foe, runs, createStream(1, 'balance', 'fight', characterLevel, label));
  if (seconds === null) {
    throw new BalanceError(`The reference build of level ${characterLevel} never beats ${label}; pass --fight-seconds.`);
  }
  return seconds;
}

/** Runs `runs` fights with one RNG and summarises them. */
export function runFights(player: Combatant, enemy: Combatant, runs: number, rng: Rng, options: FightOptions = {}): FightSummary {
  const results: FightResult[] = [];
  for (let i = 0; i < runs; i++) results.push(resolveFight(player, enemy, rng, options));
  return summarise(results, player.maxHp);
}

export interface RegenReport {
  /** Default regeneration in health per second (constants.stats.healthRegen). */
  regenPerSecond: number;
  /** Seconds between two fights: movement to the next enemy. */
  gapSeconds: number;
  /** Health regained during the gap. */
  gapRegenHp: number;
  /** The gap regeneration as a fraction of max health. */
  gapRegenFraction: number;
  /** Fight time plus gap. */
  cycleSeconds: number;
  /** Health regained over the whole cycle. */
  cycleRegenHp: number;
  /** Health lost per fight cycle: damage taken minus regeneration over fight time plus gap. Negative means a net gain. */
  netHpLost: number;
  /** netHpLost as a fraction of max health. */
  netHpLostFraction: number;
}

/**
 * Default health regeneration (3.7) against a fight cycle: how much health comes back in the average gap between
 * fights, and the net loss per cycle (damage taken minus regeneration over fight time plus gap).
 * Regeneration is not capped at max health here: it is the average, and a character at full health is simply wasting it.
 */
export function regenReport(maxHp: number, damageTaken: number, fightSeconds: number, gapSeconds: number): RegenReport {
  if (!(maxHp > 0)) throw new BalanceError(`Max health must be above 0, got ${maxHp}.`);
  if (!(gapSeconds >= 0)) throw new BalanceError(`Gap seconds must be 0 or more, got ${gapSeconds}.`);
  const gapRegenHp = regenOverSeconds(maxHp, gapSeconds);
  const cycleSeconds = fightSeconds + gapSeconds;
  const cycleRegenHp = regenOverSeconds(maxHp, cycleSeconds);
  const netHpLost = damageTaken - cycleRegenHp;
  return {
    regenPerSecond: healthRegenPerSecond(maxHp),
    gapSeconds,
    gapRegenHp,
    gapRegenFraction: gapRegenHp / maxHp,
    cycleSeconds,
    cycleRegenHp,
    netHpLost,
    netHpLostFraction: netHpLost / maxHp,
  };
}
