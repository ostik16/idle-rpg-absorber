/**
 * The `fighting` and `fleeing` phases (design 3.6, 3.2, decisions L5). One tick of the fight itself is
 * `fightTick` in game/combat.ts, which the balance tools use too.
 */
import { constantSection, requireRow } from '../data/game-data';
import { enemyCombatant, fightTick, type Combatant, type EnemyCombatStats } from '../game/combat';
import { quantiseToSteps } from '../game/formulas';
import { movementSeconds } from '../game/proficiency';
import { derivedStats } from '../state/selectors';
import type { CharacterState, FightState } from '../state/types';
import { loseXpOnDeath } from './death';
import { grantKillXp } from './rewards';
import { enterPhase, type StepContext } from './step-context';

const MS_PER_SECOND = 1000;

function enemyStats(enemyId: string, ctx: StepContext): EnemyCombatStats {
  return requireRow(ctx.data, 'enemies', enemyId) as unknown as EnemyCombatStats;
}

function playerCombatant(character: CharacterState, ctx: StepContext): Combatant {
  const stats = derivedStats(character, ctx.data);
  return {
    maxHp: stats.maxHealth,
    damage: stats.damage,
    defence: stats.defence,
    critChance: stats.critChance,
    intervalMs: stats.attackIntervalMs,
  };
}

/** Puts a character into a fight with a fresh enemy of this type. */
export function startFight(character: CharacterState, enemyId: string, ctx: StepContext): void {
  character.fight = { enemyId, enemyHp: enemyStats(enemyId, ctx).health, ticks: 0 };
  enterPhase(character, 'fighting', ctx);
}

/**
 * Starts leaving the fight, for the health trigger or the player's return command (decisions L5). The enemy's
 * timer carries on. Does nothing unless the character is fighting.
 */
export function startFleeing(character: CharacterState, ctx: StepContext): void {
  if (character.phase === 'fighting') enterPhase(character, 'fleeing', ctx);
}

/** Time fleeing takes: `combat.fleeSeconds`, shortened by the speed skill like travel, in whole steps. */
export function fleeDurationMs(character: CharacterState, ctx: StepContext): number {
  const seconds = movementSeconds(
    constantSection(ctx.data, 'combat').fleeSeconds,
    character.proficiency.speed,
    constantSection(ctx.data, 'proficiency'),
  );
  return quantiseToSteps(seconds * MS_PER_SECOND, ctx.tickMs);
}

/** Runs one tick of the current fight. Returns false when it ended the fight. */
function runTick(character: CharacterState, fight: FightState, playerAttacks: boolean, ctx: StepContext): boolean {
  fight.ticks += 1;
  const tick = fightTick({
    tick: fight.ticks,
    playerHp: character.health,
    enemyHp: fight.enemyHp,
    player: playerCombatant(character, ctx),
    enemy: enemyCombatant(enemyStats(fight.enemyId, ctx), ctx.tickMs),
    rng: ctx.streams.combat,
    tickMs: ctx.tickMs,
    playerAttacks,
  });
  character.health = Math.max(0, tick.playerHp);
  fight.enemyHp = tick.enemyHp;

  if (tick.outcome === null) return true;
  character.fight = null;
  if (tick.outcome === 'win') {
    ctx.emit({ type: 'enemyKilled', characterId: character.id, enemyId: fight.enemyId });
    grantKillXp(character, fight.enemyId, ctx);
    enterPhase(character, 'looting', ctx);
  } else {
    character.potions = { queue: [], ticksDone: 0, msIntoTick: 0 };
    ctx.emit({ type: 'characterDied', characterId: character.id, enemyId: fight.enemyId });
    loseXpOnDeath(character, ctx);
    enterPhase(character, 'dead', ctx);
  }
  return false;
}

export function stepFighting(character: CharacterState, ctx: StepContext): void {
  if (character.fight !== null) runTick(character, character.fight, true, ctx);
}

/** The enemy keeps attacking until the flee time is up. An abandoned fight gives no reward. */
export function stepFleeing(character: CharacterState, ctx: StepContext): void {
  if (character.fight === null) return;
  if (!runTick(character, character.fight, false, ctx)) return;
  if (character.timeInPhaseMs >= fleeDurationMs(character, ctx)) {
    character.fight = null;
    enterPhase(character, 'returning', ctx);
  }
}
