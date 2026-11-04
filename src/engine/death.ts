/**
 * What death costs (design 3.7, decisions T6, T11, I4): XP, floored at the point marks, and time. The bag, the gear
 * and the level are kept.
 */
import { constantSection } from '../data/game-data';
import { quantiseToSteps } from '../game/formulas';
import { respawnHealth, respawnSeconds, xpAfterDeath, xpLossFractionFromRoll, xpToNextLevel } from '../game/progression';
import { derivedStats } from '../state/selectors';
import type { CharacterState } from '../state/types';
import { xpTableOf } from './rewards';
import { enterPhase, type StepContext } from './step-context';

const MS_PER_SECOND = 1000;

/** Rolls the XP loss with the death stream. It always draws, so the stream does not depend on the XP held. */
export function loseXpOnDeath(character: CharacterState, ctx: StepContext): void {
  const fraction = xpLossFractionFromRoll(ctx.streams.death.nextFloat(), constantSection(ctx.data, 'death'));
  const xpToNext = xpToNextLevel(character.level, xpTableOf(ctx.data));
  const xpInLevel = xpAfterDeath(character.xpInLevel, xpToNext, fraction, constantSection(ctx.data, 'points'));
  const amount = character.xpInLevel - xpInLevel;
  character.xpInLevel = xpInLevel;
  if (amount > 0) ctx.emit({ type: 'xpLost', characterId: character.id, amount });
}

/** Time a dead character waits, in whole steps. */
export function respawnDurationMs(character: CharacterState, ctx: StepContext): number {
  const seconds = respawnSeconds(character.level, constantSection(ctx.data, 'death'));
  return quantiseToSteps(seconds * MS_PER_SECOND, ctx.tickMs);
}

/** Waits out the respawn timer, then the character is on its feet in the city, at 10% health. */
export function stepDead(character: CharacterState, ctx: StepContext): void {
  if (character.timeInPhaseMs < respawnDurationMs(character, ctx)) return;
  const { maxHealth } = derivedStats(character, ctx.data);
  character.health = respawnHealth(maxHealth, constantSection(ctx.data, 'death'));
  enterPhase(character, 'restocking', ctx);
}
