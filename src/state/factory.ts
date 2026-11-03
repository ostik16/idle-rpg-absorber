/**
 * Starting values for state. Pure: the caller supplies the time and seed.
 */
import type { CharacterState, GameState } from './types';

/** A character that has not started farming: idle, no time in phase, streams left for the engine to derive. */
export function createCharacterState(id: string, name: string): CharacterState {
  return { id, name, phase: 'idle', timeInPhaseMs: 0 };
}

/** State for a new game that starts at `nowMs`, with an empty roster. */
export function createGameState(masterSeed: number, nowMs: number): GameState {
  return {
    clock: { lastSimulatedAt: nowMs, masterSeed, diagnostics: { clockRewind: 0 } },
    roster: [],
    pendingSummary: null,
  };
}
