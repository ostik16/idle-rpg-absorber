/**
 * One character's state machine (ADR 0002 "Multiple characters"). A character is independent: it shares
 * nothing with the others except through the events it emits, which the engine applies at the end of the step.
 */
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

/** Stable order for characters: plain string comparison, not locale-aware, so every machine agrees. */
export function compareCharacterIds(a: { readonly id: string }, b: { readonly id: string }): number {
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

/** Moves a character to another phase: time in phase starts again and `phaseChanged` is emitted. */
export function enterPhase(character: CharacterState, phase: Phase, ctx: StepContext): void {
  const from = character.phase;
  character.phase = phase;
  character.timeInPhaseMs = 0;
  ctx.emit({ type: 'phaseChanged', characterId: character.id, from, to: phase });
}

type PhaseStep = (character: CharacterState, ctx: StepContext) => void;

const stayInPhase: PhaseStep = () => {};

/**
 * What each phase does in one step. Every phase only stays put for now: the transitions
 * (travelling to searching to fighting to looting to returning to restocking, and dead) and
 * their formulas come with the issues that build each phase. They will call `enterPhase`.
 */
const PHASE_STEPS: Readonly<Record<Phase, PhaseStep>> = {
  travelling: stayInPhase,
  searching: stayInPhase,
  fighting: stayInPhase,
  looting: stayInPhase,
  returning: stayInPhase,
  restocking: stayInPhase,
  dead: stayInPhase,
  idle: stayInPhase,
};

/** Advances one character by exactly one step. */
export function stepCharacter(character: CharacterState, ctx: StepContext): void {
  character.timeInPhaseMs += ctx.tickMs;
  PHASE_STEPS[character.phase](character, ctx);
}
