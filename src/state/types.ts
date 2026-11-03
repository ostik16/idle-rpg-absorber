/**
 * Plain serialisable game state (ADR 0002, ADR 0003, architecture "state/").
 * Numbers, strings, arrays and plain objects only, so a save is `JSON.stringify(state)`.
 * This is the minimum the engine skeleton needs; later issues fill in the full model
 * (account, warehouse, bestiary, shops, per-character stats and gear).
 */

/** The farming loop a character is in (ADR 0002 "Multiple characters"). `idle` means not farming. */
export const PHASES = [
  'travelling',
  'searching',
  'fighting',
  'looting',
  'returning',
  'restocking',
  'dead',
  'idle',
] as const;

export type Phase = (typeof PHASES)[number];

/** The random streams every character has, one per purpose (ADR 0002 "RNG"). */
export type StreamName = 'combat' | 'drops' | 'search';

/** The four 32-bit words of one sfc32 stream. Same shape as `RngState` in game/rng.ts; state does not import game. */
export type StreamState = readonly [number, number, number, number];

/** Saved state of all of one character's streams (ADR 0003 "roster[]"). */
export type CharacterRngState = Readonly<Record<StreamName, StreamState>>;

export interface CharacterState {
  /** Unique and never reused. Step order, merge order and stream seeds all follow it. */
  id: string;
  name: string;
  phase: Phase;
  /** Time spent in the current phase, in ms. Grows by `combat.tickMs` every step. */
  timeInPhaseMs: number;
  /** Stream states. Absent on a new character: the engine derives them from `clock.masterSeed` and the id. */
  rng?: CharacterRngState;
}

export interface ClockState {
  /**
   * End of the last whole step, in wall-clock ms (ADR 0002 "Catch-up"). It moves in steps of `combat.tickMs`,
   * so `now - lastSimulatedAt` is also the sub-step remainder still waiting for its step.
   * After an offline estimate or a clock rewind it is set to `now`.
   */
  lastSimulatedAt: number;
  /** Seed all streams are derived from. Stored in the save so a run is reproducible. */
  masterSeed: number;
  diagnostics: {
    /** How many times the clock went backwards (ADR 0002 "Clock going backwards"). */
    clockRewind: number;
  };
}

/** What one character gained while the player was away. Fields follow design 3.4; levels and absorption come with the estimator. */
export interface CharacterSummary {
  characterId: string;
  kills: number;
  xp: number;
  gold: number;
  /** Item id to quantity. */
  items: Record<string, number>;
}

/** The Welcome back screen's data (design 3.4, 6), kept until the player has seen it. */
export interface OfflineSummary {
  /** Seconds the estimate covered, after the cap. */
  seconds: number;
  /** Seconds of absence past `offline.capHours`, thrown away. The screen says so. */
  discardedSeconds: number;
  /** One entry per character, in id order. */
  characters: CharacterSummary[];
}

export interface GameState {
  clock: ClockState;
  /** Any order; the engine steps characters in id order. */
  roster: CharacterState[];
  /** An offline summary not yet shown, so closing the tab on the Welcome back screen loses nothing (ADR 0003). */
  pendingSummary: OfflineSummary | null;
}
