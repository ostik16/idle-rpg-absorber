/** What a character's step works with, and the one way to change its phase. */
import type { GameData } from '../data/game-data';
import type { CharacterState, Phase } from '../state/types';
import type { EngineEvent } from './events';
import type { CharacterStreams } from './streams';

export interface StepContext {
  readonly data: GameData;
  /** Length of one step in ms (combat.tickMs). */
  readonly tickMs: number;
  /** This character's own random streams. */
  readonly streams: CharacterStreams;
  /** Queues an event for the end of the step. Events are applied in the order they were emitted. */
  emit(event: EngineEvent): void;
}

/** Moves a character to another phase: time in phase starts again and `phaseChanged` is emitted. */
export function enterPhase(character: CharacterState, phase: Phase, ctx: StepContext): void {
  const from = character.phase;
  character.phase = phase;
  character.timeInPhaseMs = 0;
  ctx.emit({ type: 'phaseChanged', characterId: character.id, from, to: phase });
}
