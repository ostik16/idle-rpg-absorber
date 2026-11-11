/** What a character's step works with, and the one way to change its phase. */
import { constantSection, type GameData } from '../data/game-data';
import { movementDurationMs as movementDurationMsPure } from '../game/formulas';
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

/** Time a movement of `baseSeconds` takes this character, shortened by the speed skill (4.2), in whole steps. */
export function movementDurationMs(baseSeconds: number, character: CharacterState, ctx: StepContext): number {
  return movementDurationMsPure(baseSeconds, character.proficiency.speed, constantSection(ctx.data, 'proficiency'), ctx.tickMs);
}

/** Moves a character to another phase: time in phase starts again and `phaseChanged` is emitted. */
export function enterPhase(character: CharacterState, phase: Phase, ctx: StepContext): void {
  const from = character.phase;
  character.phase = phase;
  character.timeInPhaseMs = 0;
  ctx.emit({ type: 'phaseChanged', characterId: character.id, from, to: phase });
}
