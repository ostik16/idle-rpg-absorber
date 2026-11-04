/** What a character's step works with, and the one way to change its phase. */
import { constantSection, type GameData } from '../data/game-data';
import { quantiseToSteps } from '../game/formulas';
import { movementSeconds } from '../game/proficiency';
import type { CharacterState, Phase } from '../state/types';
import type { EngineEvent } from './events';
import type { CharacterStreams } from './streams';

const MS_PER_SECOND = 1000;

export interface StepContext {
  readonly data: GameData;
  /** Length of one step in ms (combat.tickMs). */
  readonly tickMs: number;
  /** This character's own random streams. */
  readonly streams: CharacterStreams;
  /** Queues an event for the end of the step. Events are applied in the order they were emitted. */
  emit(event: EngineEvent): void;
}

/** Time a movement of `baseSeconds` takes this character, shortened by the speed skill (4.2), in whole steps. */
export function movementDurationMs(baseSeconds: number, character: CharacterState, ctx: StepContext): number {
  const seconds = movementSeconds(baseSeconds, character.proficiency.speed, constantSection(ctx.data, 'proficiency'));
  return quantiseToSteps(seconds * MS_PER_SECOND, ctx.tickMs);
}

/** Moves a character to another phase: time in phase starts again and `phaseChanged` is emitted. */
export function enterPhase(character: CharacterState, phase: Phase, ctx: StepContext): void {
  const from = character.phase;
  character.phase = phase;
  character.timeInPhaseMs = 0;
  ctx.emit({ type: 'phaseChanged', characterId: character.id, from, to: phase });
}
