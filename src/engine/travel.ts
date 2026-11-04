/**
 * Getting around (design 3.1, 3.2, 3.3, decisions L5): the `travelling`, `searching`, `looting` and `returning`
 * phases, and what the player's commands do to them. Fighting and fleeing are in fight.ts.
 */
import { constantSection, requireRow } from '../data/game-data';
import { baseMovementSeconds, rollSpawn, targetingMultiplier, type SpawnTable } from '../game/farming';
import type { CharacterState } from '../state/types';
import { startFight, startFleeing } from './fight';
import { trainOnMove } from './growth';
import { enterPhase, movementDurationMs, type StepContext } from './step-context';

/** The fields of an area row a character moves by (3.1). */
export interface AreaRow extends SpawnTable {
  /** Seconds of walking at 0 speed points. */
  distanceFromCity: number;
  movementSecondsBetweenEnemies?: number;
}

function currentArea(character: CharacterState, ctx: StepContext): AreaRow {
  if (character.areaId === null) throw new Error(`character "${character.id}" is ${character.phase} with no area`);
  return requireRow(ctx.data, 'areas', character.areaId) as unknown as AreaRow;
}

/** Time between the city and the character's area, either way, in whole steps (3.2, 4.2). */
export function travelDurationMs(character: CharacterState, ctx: StepContext): number {
  return movementDurationMs(currentArea(character, ctx).distanceFromCity, character, ctx);
}

/** Time to find the next enemy, in whole steps: targeting multiplies the movement, not the fight (3.3). */
export function searchDurationMs(character: CharacterState, ctx: StepContext): number {
  const farming = constantSection(ctx.data, 'farming');
  const base = baseMovementSeconds(currentArea(character, ctx), farming);
  if (character.targetEnemyId === null) return movementDurationMs(base, character, ctx);
  const enemy = requireRow(ctx.data, 'enemies', character.targetEnemyId) as { targetingMultiplier?: number };
  return movementDurationMs(base * targetingMultiplier(enemy, farming), character, ctx);
}

/** Sets out from the city. */
export function sendToArea(character: CharacterState, areaId: string, ctx: StepContext): void {
  character.areaId = areaId;
  character.stayInCity = false;
  enterPhase(character, 'travelling', ctx);
}

/** Done with the area: the character waits in the city for the player. */
export function settleInCity(character: CharacterState, ctx: StepContext): void {
  character.areaId = null;
  character.targetEnemyId = null;
  character.stayInCity = false;
  enterPhase(character, 'idle', ctx);
}

/**
 * Heads home and stays there. In a fight it has to flee first (L5). On the way out it turns round, so the way back
 * takes as long as it has walked so far. Dead or healing, it is home already and only stops going back out.
 */
export function returnToCity(character: CharacterState, ctx: StepContext): void {
  character.stayInCity = true;
  if (character.phase === 'dead' || character.phase === 'restocking') return;
  if (character.phase === 'fighting') {
    startFleeing(character, ctx);
    return;
  }
  const notWalked = character.phase === 'travelling' ? travelDurationMs(character, ctx) - character.timeInPhaseMs : 0;
  enterPhase(character, 'returning', ctx);
  character.timeInPhaseMs = notWalked;
}

export function stepTravelling(character: CharacterState, ctx: StepContext): void {
  trainOnMove(character, ctx);
  if (character.timeInPhaseMs >= travelDurationMs(character, ctx)) enterPhase(character, 'searching', ctx);
}

/** A target skips the spawn roll, and its draws: the character farms only that enemy (3.3). */
export function stepSearching(character: CharacterState, ctx: StepContext): void {
  trainOnMove(character, ctx);
  if (character.timeInPhaseMs < searchDurationMs(character, ctx)) return;
  startFight(character, character.targetEnemyId ?? rollSpawn(currentArea(character, ctx), ctx.streams.search), ctx);
}

/** Looting has no time of its own (3.3 counts the fight and the movement), so this step is the first of the search. */
export function stepLooting(character: CharacterState, ctx: StepContext): void {
  enterPhase(character, 'searching', ctx);
  character.timeInPhaseMs = ctx.tickMs;
}

/** Home: the character stops farming and waits for the player. The city routine comes with #27. */
export function stepReturning(character: CharacterState, ctx: StepContext): void {
  trainOnMove(character, ctx);
  if (character.timeInPhaseMs >= travelDurationMs(character, ctx)) settleInCity(character, ctx);
}
