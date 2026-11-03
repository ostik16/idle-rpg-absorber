/**
 * The simulation engine (ADR 0002 "One engine, driven by timestamps"). `advanceTo(nowMs)` is the only way
 * time moves: it runs whole fixed steps of `combat.tickMs`. The engine never reads a clock; the caller
 * passes the time (`main.tsx` will pass `Date.now()`, tests and tools pass synthetic times).
 * Drops and the real offline estimate come later.
 */
import { requireNumberConstant, type GameData } from '../data/game-data';
import type { CharacterState, GameState } from '../state/types';
import { compareCharacterIds, stepCharacter, type StepContext } from './character';
import { applyCommand, type Command } from './commands';
import { publishStepEvents, type EngineEvent } from './events';
import { mergeSummaries, stubEstimateOffline, type EstimateOffline } from './offline';
import { createCharacterStreams, readStreamStates, type CharacterStreams } from './streams';

const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;

/**
 * How `advanceTo` covered the time (ADR 0002 "Catch-up on return and offline"):
 *  - `step`: the steps due fit in `engine.maxStepsPerFrame`.
 *  - `catch-up`: a larger backlog, up to `offline.stepSimMaxSeconds`, run as real steps.
 *  - `offline`: a longer gap, estimated in bulk and left in `state.pendingSummary`.
 *  - `clock-rewind`: `now` was before `lastSimulatedAt`; no progress.
 */
export type AdvanceMode = 'step' | 'catch-up' | 'offline' | 'clock-rewind';

export interface AdvanceResult {
  mode: AdvanceMode;
  /** Whole steps run. 0 for `offline` and `clock-rewind`. */
  steps: number;
}

export interface EngineOptions {
  data: GameData;
  /** Mutated in place; the engine is the only writer. Serialise it to save. */
  state: GameState;
  /** Defaults to a stub with zero yields. */
  estimateOffline?: EstimateOffline;
}

export interface Engine {
  readonly state: GameState;
  /** Runs the whole steps due up to `nowMs`; the sub-step remainder waits for the next call. */
  advanceTo(nowMs: number): AdvanceResult;
  /** Queues a command. It is applied between steps, at the start of the next step that runs. */
  dispatch(command: Command): void;
  /** Returns the events since the last call, oldest first, and clears them. */
  drainEvents(): EngineEvent[];
}

interface EngineConfig {
  tickMs: number;
  maxStepsPerFrame: number;
  stepSimMaxMs: number;
  capSeconds: number;
}

interface Runner {
  readonly character: CharacterState;
  readonly streams: CharacterStreams;
  readonly ctx: StepContext;
}

/** Reads the constants the loop needs. Throws, naming the path, when one is null, missing or out of range. */
function readConfig(data: GameData): EngineConfig {
  const above0 = (path: string): number => {
    const value = requireNumberConstant(data, path);
    if (!(value > 0)) throw new RangeError(`constant "${path}" must be above 0, got ${value}`);
    return value;
  };
  const tickMs = above0('combat.tickMs');
  const maxStepsPerFrame = above0('engine.maxStepsPerFrame');
  if (!Number.isInteger(maxStepsPerFrame)) {
    throw new RangeError(`constant "engine.maxStepsPerFrame" must be a whole number, got ${maxStepsPerFrame}`);
  }
  const stepSimMaxSeconds = requireNumberConstant(data, 'offline.stepSimMaxSeconds');
  if (stepSimMaxSeconds < 0) {
    throw new RangeError(`constant "offline.stepSimMaxSeconds" must be 0 or more, got ${stepSimMaxSeconds}`);
  }
  const capHours = above0('offline.capHours');
  return {
    tickMs,
    maxStepsPerFrame,
    stepSimMaxMs: stepSimMaxSeconds * MS_PER_SECOND,
    capSeconds: capHours * SECONDS_PER_HOUR,
  };
}

/** Builds the engine. Throws when a constant it needs is `null` (undecided), for example `combat.tickMs` (ADR 0002). */
export function createEngine({ data, state, estimateOffline = stubEstimateOffline }: EngineOptions): Engine {
  const config = readConfig(data);
  const pendingCommands: Command[] = [];
  const outbox: EngineEvent[] = [];
  const stepEvents: EngineEvent[] = [];
  let runners: Runner[] = [];

  /** One runner per character, in id order, with streams restored from the state (or derived when new). */
  function loadRunners(): void {
    const ordered = [...state.roster].sort(compareCharacterIds);
    ordered.forEach((character, i) => {
      if (i > 0 && ordered[i - 1]?.id === character.id) throw new Error(`duplicate character id "${character.id}"`);
    });
    runners = ordered.map((character) => {
      const streams = createCharacterStreams(state.clock.masterSeed, character.id, character.rng);
      character.rng = readStreamStates(streams);
      const ctx: StepContext = { data, tickMs: config.tickMs, streams, emit: (event) => void stepEvents.push(event) };
      return { character, streams, ctx };
    });
  }

  /** Writes the live stream states into the state, so a save taken between calls is complete. */
  function saveStreams(): void {
    for (const { character, streams } of runners) character.rng = readStreamStates(streams);
  }

  function applyPendingCommands(): void {
    if (pendingCommands.length === 0) return;
    const rosterSize = state.roster.length;
    for (const command of pendingCommands.splice(0)) {
      const event = applyCommand(state, command, data);
      if (event) outbox.push(event);
    }
    if (state.roster.length !== rosterSize) {
      saveStreams();
      loadRunners();
    }
  }

  /** One step: queued commands first, then every character once in id order, then the shared effects. */
  function runSteps(count: number): void {
    for (let i = 0; i < count; i++) {
      applyPendingCommands();
      for (const { character, ctx } of runners) stepCharacter(character, ctx);
      publishStepEvents(stepEvents, outbox);
      state.clock.lastSimulatedAt += config.tickMs;
    }
  }

  /** The gap is too long to step through: cap it, estimate it in bulk and keep the result for the Welcome back screen. */
  function estimateAbsence(nowMs: number, gapMs: number): void {
    applyPendingCommands();
    const gapSeconds = gapMs / MS_PER_SECOND;
    const seconds = Math.min(gapSeconds, config.capSeconds);
    saveStreams();
    const estimate = estimateOffline(state, seconds, data);
    loadRunners(); // the estimator may have drawn from the saved streams and may have changed the roster
    state.pendingSummary = mergeSummaries(state.pendingSummary, {
      seconds,
      discardedSeconds: gapSeconds - seconds,
      characters: estimate.characters,
    });
    state.clock.lastSimulatedAt = nowMs;
    outbox.push({ type: 'summaryReady' });
  }

  /** Clock went backwards: no progress, no punishment (ADR 0002). Queued commands wait for the next step. */
  function rewindClock(nowMs: number): AdvanceResult {
    outbox.push({ type: 'clockRewind', from: state.clock.lastSimulatedAt, to: nowMs });
    state.clock.lastSimulatedAt = nowMs;
    state.clock.diagnostics.clockRewind += 1;
    return { mode: 'clock-rewind', steps: 0 };
  }

  loadRunners();

  return {
    state,

    advanceTo(nowMs) {
      if (!Number.isFinite(nowMs)) throw new RangeError(`time must be a finite number of ms, got ${nowMs}`);
      const gapMs = nowMs - state.clock.lastSimulatedAt;
      if (gapMs < 0) return rewindClock(nowMs);

      const stepsDue = Math.floor(gapMs / config.tickMs);
      let result: AdvanceResult;
      if (stepsDue <= config.maxStepsPerFrame) {
        runSteps(stepsDue);
        result = { mode: 'step', steps: stepsDue };
      } else if (gapMs <= config.stepSimMaxMs) {
        runSteps(stepsDue);
        result = { mode: 'catch-up', steps: stepsDue };
      } else {
        estimateAbsence(nowMs, gapMs);
        result = { mode: 'offline', steps: 0 };
      }
      saveStreams();
      return result;
    },

    dispatch(command) {
      pendingCommands.push(command);
    },

    drainEvents() {
      return outbox.splice(0);
    },
  };
}
