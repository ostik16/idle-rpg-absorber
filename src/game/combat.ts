/**
 * One tick of a fight (design 3.6, N2, N3), shared by the engine and the balance tools so they cannot drift.
 * Both sides attack on the engine tick (constants.combat.tickMs). The first attack of each side lands one full
 * interval after the fight starts. On a tick where both attack, the player acts first, so an enemy killed on that
 * tick does not strike back. Only the player can crit (enemy crit is not in the design).
 */
import type { Rng } from './rng';
import { attackIntervalMs, hitDamage } from './stats';

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

/** The fields of a row in data/enemies.json that a fight reads. */
export interface EnemyCombatStats {
  health: number;
  damage: number;
  /** Attacks per second. */
  attackSpeed: number;
  defence: number;
}

/** An enemy's numbers as a fighter. */
export function enemyCombatant(enemy: EnemyCombatStats, tickMs: number): Combatant {
  return {
    maxHp: enemy.health,
    damage: enemy.damage,
    defence: enemy.defence,
    critChance: 0,
    intervalMs: attackIntervalMs(enemy.attackSpeed, tickMs),
  };
}

export interface FightTickInput {
  /** This tick's number. The first tick of a fight is 1. */
  tick: number;
  playerHp: number;
  enemyHp: number;
  player: Combatant;
  enemy: Combatant;
  rng: Rng;
  tickMs: number;
  /** False while fleeing: the player does not attack, and the enemy still does (decisions L5). */
  playerAttacks: boolean;
}

export interface FightTick {
  /** Below 0 when the blow overkills. */
  playerHp: number;
  enemyHp: number;
  playerHit: boolean;
  playerCrit: boolean;
  /** Damage the player's hit took off the enemy, 0 when it did not attack. */
  playerDamage: number;
  enemyHit: boolean;
  /** How the fight ended on this tick, or null when it goes on. */
  outcome: 'win' | 'loss' | null;
}

function attacksOnTick(tick: number, intervalMs: number, tickMs: number): boolean {
  return tick % Math.max(1, Math.round(intervalMs / tickMs)) === 0;
}

/** Works out one tick. A crit roll uses one draw per attack, for either side, so the stream stays aligned. */
export function fightTick(input: FightTickInput): FightTick {
  const { tick, player, enemy, rng, tickMs } = input;
  let { playerHp, enemyHp } = input;
  let playerHit = false;
  let playerCrit = false;
  let playerDamage = 0;
  let enemyHit = false;

  if (input.playerAttacks && attacksOnTick(tick, player.intervalMs, tickMs)) {
    playerCrit = rng.chance(player.critChance);
    playerDamage = hitDamage(player.damage, enemy.defence, playerCrit);
    enemyHp -= playerDamage;
    playerHit = true;
    if (enemyHp <= 0) return { playerHp, enemyHp, playerHit, playerCrit, playerDamage, enemyHit, outcome: 'win' };
  }
  if (attacksOnTick(tick, enemy.intervalMs, tickMs)) {
    const enemyCrit = rng.chance(enemy.critChance);
    playerHp -= hitDamage(enemy.damage, player.defence, enemyCrit);
    enemyHit = true;
    if (playerHp <= 0) return { playerHp, enemyHp, playerHit, playerCrit, playerDamage, enemyHit, outcome: 'loss' };
  }
  return { playerHp, enemyHp, playerHit, playerCrit, playerDamage, enemyHit, outcome: null };
}
