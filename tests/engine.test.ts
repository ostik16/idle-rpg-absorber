import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import { createGameData, loadGameData, type GameData } from '../src/data/game-data';
import { stepCharacter, enterPhase, type StepContext } from '../src/engine/character';
import { createEngine, type AdvanceMode, type Engine } from '../src/engine/engine';
import { publishStepEvents, type EngineEvent } from '../src/engine/events';
import { emptyCharacterSummary, type EstimateOffline } from '../src/engine/offline';
import { createCharacterStreams, readStreamStates } from '../src/engine/streams';
import type { Rng } from '../src/game/rng';
import { createCharacterState, createGameState } from '../src/state/factory';
import { PHASES, type CharacterState, type CharacterSummary, type GameState } from '../src/state/types';

// Small fixtures, not the real tables. With these constants one step is 100 ms, a frame may run 10 steps (1 s),
// real steps cover up to 5 s, and the offline cap is 1 hour.
const T0 = 1_000_000;
const TICK = 100;
const SEED = 7;

interface FixtureConstants {
  tickMs?: number | null;
  maxStepsPerFrame?: number | null;
  stepSimMaxSeconds?: number | null;
  capHours?: number | null;
}

function fixtureData(o: FixtureConstants = {}): GameData {
  const c = { tickMs: TICK, maxStepsPerFrame: 10, stepSimMaxSeconds: 5, capHours: 1, ...o };
  return createGameData({
    constants: {
      combat: { tickMs: c.tickMs },
      engine: { maxStepsPerFrame: c.maxStepsPerFrame },
      offline: { stepSimMaxSeconds: c.stepSimMaxSeconds, capHours: c.capHours },
    },
  });
}

function makeState(ids: readonly string[] = ['a']): GameState {
  const state = createGameState(SEED, T0);
  for (const id of ids) state.roster.push(createCharacterState(id, `Name ${id}`));
  return state;
}

function makeEngine(ids?: readonly string[], data: GameData = fixtureData(), estimateOffline?: EstimateOffline): Engine {
  return createEngine({ data, state: makeState(ids), estimateOffline });
}

function find(state: GameState, id: string): CharacterState {
  const character = state.roster.find((c) => c.id === id);
  if (!character) throw new Error(`no character ${id}`);
  return character;
}

function recordingEstimator() {
  const calls: { seconds: number; ids: string[]; data: GameData }[] = [];
  const estimate: EstimateOffline = (state, seconds, data) => {
    calls.push({ seconds, ids: state.roster.map((c) => c.id), data });
    return { characters: state.roster.map((c) => emptyCharacterSummary(c.id)) };
  };
  return { calls, estimate };
}

function draw(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextFloat());
}

describe('steps (ADR 0002 "One engine, driven by timestamps")', () => {
  it('one call for 10 s and 100 calls of 100 ms give identical state', () => {
    const data = fixtureData({ maxStepsPerFrame: 1000 });
    const whole = makeEngine(['a', 'b'], data);
    const parts = makeEngine(['a', 'b'], data);

    expect(whole.advanceTo(T0 + 10_000)).toEqual({ mode: 'step', steps: 100 });
    for (let i = 1; i <= 100; i++) expect(parts.advanceTo(T0 + i * TICK).mode).toBe('step');

    expect(parts.state).toEqual(whole.state);
    expect(find(whole.state, 'a').timeInPhaseMs).toBe(10_000);
    expect(whole.state.clock.lastSimulatedAt).toBe(T0 + 10_000);
  });

  it('gives identical state for any split, including uneven calls, with the real data', () => {
    const data = loadGameData();
    const whole = createEngine({ data, state: makeState(['a', 'b']) });
    const parts = createEngine({ data, state: makeState(['a', 'b']) });

    whole.advanceTo(T0 + 10_000);
    for (const t of [37, 250, 251, 999, 1000, 4321, 7777, 10_000]) parts.advanceTo(T0 + t);

    expect(parts.state).toEqual(whole.state);
    expect(find(whole.state, 'b').timeInPhaseMs).toBe(10_000);
  });

  it('carries the sub-step remainder to the next call', () => {
    const engine = makeEngine();
    const { state } = engine;

    expect(engine.advanceTo(T0 + 150)).toEqual({ mode: 'step', steps: 1 });
    expect(state.clock.lastSimulatedAt).toBe(T0 + 100);
    expect(find(state, 'a').timeInPhaseMs).toBe(100);

    expect(engine.advanceTo(T0 + 250)).toEqual({ mode: 'step', steps: 1 }); // 150 ms due: 50 ms carried, 100 ms run
    expect(state.clock.lastSimulatedAt).toBe(T0 + 200);

    expect(engine.advanceTo(T0 + 299)).toEqual({ mode: 'step', steps: 0 });
    expect(find(state, 'a').timeInPhaseMs).toBe(200);

    expect(engine.advanceTo(T0 + 300)).toEqual({ mode: 'step', steps: 1 });
    expect(find(state, 'a').timeInPhaseMs).toBe(300);
    expect(engine.advanceTo(T0 + 300)).toEqual({ mode: 'step', steps: 0 });
  });

  it('runs the same steps in catch-up as in step mode', () => {
    const caughtUp = makeEngine(['a', 'b']);
    const stepped = makeEngine(['a', 'b'], fixtureData({ maxStepsPerFrame: 1000 }));

    expect(caughtUp.advanceTo(T0 + 4000).mode).toBe('catch-up');
    expect(stepped.advanceTo(T0 + 4000).mode).toBe('step');

    expect(caughtUp.state).toEqual(stepped.state);
  });

  it('keeps the state plain: it survives JSON and a restarted engine continues the same run', () => {
    const data = fixtureData({ maxStepsPerFrame: 1000 });
    const first = makeEngine(['a', 'b'], data);
    first.advanceTo(T0 + 1234);

    const saved = JSON.parse(JSON.stringify(first.state)) as GameState;
    expect(saved).toEqual(first.state);

    const second = createEngine({ data, state: saved });
    first.advanceTo(T0 + 5000);
    second.advanceTo(T0 + 5000);
    expect(second.state).toEqual(first.state);
  });

  it('refuses a time that is not a finite number', () => {
    const engine = makeEngine();
    expect(() => engine.advanceTo(Number.NaN)).toThrow(RangeError);
    expect(() => engine.advanceTo(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(engine.state.clock.lastSimulatedAt).toBe(T0);
  });
});

describe('characters (ADR 0002 "Multiple characters")', () => {
  function recordStepOrder(state: GameState): string[] {
    const order: string[] = [];
    for (const character of state.roster) {
      let time = character.timeInPhaseMs;
      Object.defineProperty(character, 'timeInPhaseMs', {
        get: () => time,
        set: (value: number) => {
          time = value;
          order.push(character.id);
        },
        enumerable: true,
        configurable: true,
      });
    }
    return order;
  }

  it('advances every character one step at a time, in id order, whatever the roster order', () => {
    const state = makeState(['c', 'a', 'b']);
    const order = recordStepOrder(state);
    const engine = createEngine({ data: fixtureData(), state });

    engine.advanceTo(T0 + 2 * TICK);

    expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    expect(state.roster.map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });

  it('orders ids by plain string comparison, not by locale', () => {
    const state = makeState(['b', 'A', 'a']);
    const order = recordStepOrder(state);
    createEngine({ data: fixtureData(), state }).advanceTo(T0 + TICK);
    expect(order).toEqual(['A', 'a', 'b']);
  });

  it('refuses to start with two characters sharing an id', () => {
    expect(() => makeEngine(['a', 'b', 'a'])).toThrow(/duplicate character id "a"/);
  });

  it('stepCharacter only adds time in phase, whatever the phase', () => {
    const emitted: EngineEvent[] = [];
    const ctx: StepContext = {
      data: fixtureData(),
      tickMs: TICK,
      streams: createCharacterStreams(SEED, 'a'),
      emit: (event) => void emitted.push(event),
    };
    for (const phase of PHASES) {
      const character: CharacterState = { ...createCharacterState('a', 'A'), phase };
      stepCharacter(character, ctx);
      stepCharacter(character, ctx);
      expect(character).toMatchObject({ phase, timeInPhaseMs: 2 * TICK });
    }
    expect(emitted).toEqual([]);
  });

  it('enterPhase starts the new phase from zero and emits phaseChanged', () => {
    const emitted: EngineEvent[] = [];
    const ctx: StepContext = {
      data: fixtureData(),
      tickMs: TICK,
      streams: createCharacterStreams(SEED, 'a'),
      emit: (event) => void emitted.push(event),
    };
    const character: CharacterState = { ...createCharacterState('a', 'A'), phase: 'fighting', timeInPhaseMs: 700 };

    enterPhase(character, 'looting', ctx);

    expect(character).toMatchObject({ phase: 'looting', timeInPhaseMs: 0 });
    expect(emitted).toEqual([{ type: 'phaseChanged', characterId: 'a', from: 'fighting', to: 'looting' }]);
  });
});

describe('commands (ADR 0002, architecture "Data flow")', () => {
  it('waits for a step: dispatch does not change state, and a call with no whole step leaves it queued', () => {
    const engine = makeEngine(['a']);
    engine.dispatch({ type: 'addCharacter', id: 'b', name: 'Bea' });

    expect(engine.state.roster).toHaveLength(1);
    engine.advanceTo(T0 + 50); // no whole step
    expect(engine.state.roster).toHaveLength(1);
    expect(engine.drainEvents()).toEqual([]);

    engine.advanceTo(T0 + TICK);
    expect(engine.state.roster.map((c) => c.id)).toEqual(['a', 'b']);
    expect(engine.drainEvents()).toEqual([{ type: 'characterAdded', characterId: 'b' }]);
  });

  it('applies at the start of a step, so the new character is stepped in that same step', () => {
    const engine = makeEngine(['a']);
    engine.advanceTo(T0 + 3 * TICK);
    engine.dispatch({ type: 'addCharacter', id: 'b', name: 'Bea' });
    engine.advanceTo(T0 + 5 * TICK);

    expect(find(engine.state, 'a').timeInPhaseMs).toBe(5 * TICK);
    expect(find(engine.state, 'b').timeInPhaseMs).toBe(2 * TICK);
  });

  it('applies once, in the order dispatched', () => {
    const engine = makeEngine(['a']);
    engine.dispatch({ type: 'addCharacter', id: 'z', name: 'Zed' });
    engine.dispatch({ type: 'addCharacter', id: 'y', name: 'Yan' });
    engine.advanceTo(T0 + 5 * TICK);
    engine.advanceTo(T0 + 6 * TICK);

    expect(engine.state.roster.map((c) => c.id)).toEqual(['a', 'z', 'y']);
    expect(engine.drainEvents()).toEqual([
      { type: 'characterAdded', characterId: 'z' },
      { type: 'characterAdded', characterId: 'y' },
    ]);
  });

  it('rejects a duplicate or empty id with an event, changes nothing and does not throw', () => {
    const engine = makeEngine(['a']);
    const duplicate = { type: 'addCharacter', id: 'a', name: 'Again' } as const;
    const empty = { type: 'addCharacter', id: '', name: 'Nobody' } as const;
    engine.dispatch(duplicate);
    engine.dispatch(empty);

    expect(() => engine.advanceTo(T0 + TICK)).not.toThrow();

    expect(engine.state.roster).toHaveLength(1);
    expect(find(engine.state, 'a').name).toBe('Name a');
    expect(engine.drainEvents()).toEqual([
      { type: 'commandRejected', command: duplicate, reason: expect.stringContaining('already exists') },
      { type: 'commandRejected', command: empty, reason: expect.stringContaining('empty') },
    ]);
  });

  it('gives a character added by a command its own streams, in the state', () => {
    const engine = makeEngine([]);
    engine.dispatch({ type: 'addCharacter', id: 'b', name: 'Bea' });
    engine.advanceTo(T0 + TICK);

    expect(find(engine.state, 'b').rng).toEqual(readStreamStates(createCharacterStreams(SEED, 'b')));
  });

  it('dismissSummary clears the pending summary', () => {
    const engine = makeEngine(['a']);
    engine.advanceTo(T0 + 60_000); // offline: stub summary
    expect(engine.state.pendingSummary).not.toBeNull();

    engine.dispatch({ type: 'dismissSummary' });
    engine.advanceTo(engine.state.clock.lastSimulatedAt + TICK);
    expect(engine.state.pendingSummary).toBeNull();
  });

  it('applies commands queued before a long absence ahead of the estimate', () => {
    const { calls, estimate } = recordingEstimator();
    const engine = makeEngine(['a'], fixtureData(), estimate);
    engine.dispatch({ type: 'addCharacter', id: 'b', name: 'Bea' });

    engine.advanceTo(T0 + 60_000);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ids).toEqual(['a', 'b']);
  });

  it('keeps commands queued across a clock rewind', () => {
    const engine = makeEngine(['a']);
    engine.dispatch({ type: 'addCharacter', id: 'b', name: 'Bea' });

    engine.advanceTo(T0 - 1);
    expect(engine.state.roster).toHaveLength(1);

    engine.advanceTo(T0 - 1 + TICK);
    expect(engine.state.roster).toHaveLength(2);
  });
});

describe('modes at their boundaries (ADR 0002 "Catch-up on return and offline")', () => {
  // Fixture limits: 10 steps per frame = 1000 ms, real steps up to 5 s = 5000 ms, one step = 100 ms.
  const cases: readonly [string, number, AdvanceMode, number][] = [
    ['no time has passed', 0, 'step', 0],
    ['less than one step', TICK - 1, 'step', 0],
    ['exactly maxStepsPerFrame steps', 10 * TICK, 'step', 10],
    ['maxStepsPerFrame steps and a partial one', 10 * TICK + (TICK - 1), 'step', 10],
    ['one step more than maxStepsPerFrame', 11 * TICK, 'catch-up', 11],
    ['exactly stepSimMaxSeconds', 5000, 'catch-up', 50],
    ['stepSimMaxSeconds and a partial step', 5000 + (TICK - 1), 'offline', 0],
    ['one tick more than stepSimMaxSeconds', 5000 + TICK, 'offline', 0],
    ['one ms before lastSimulatedAt', -1, 'clock-rewind', 0],
  ];

  it.each(cases)('%s', (_name, gap, mode, steps) => {
    const { calls, estimate } = recordingEstimator();
    const engine = makeEngine(['a'], fixtureData(), estimate);

    expect(engine.advanceTo(T0 + gap)).toEqual({ mode, steps });

    expect(calls).toHaveLength(mode === 'offline' ? 1 : 0);
    expect(find(engine.state, 'a').timeInPhaseMs).toBe(steps * TICK);
  });

  it('catch-up at exactly stepSimMaxSeconds is real steps: no estimator call, no summary', () => {
    const { calls, estimate } = recordingEstimator();
    const engine = makeEngine(['a'], fixtureData(), estimate);

    engine.advanceTo(T0 + 5000);

    expect(calls).toEqual([]);
    expect(engine.state.pendingSummary).toBeNull();
    expect(engine.state.clock.lastSimulatedAt).toBe(T0 + 5000);
  });

  it('uses the real constants for its boundaries', () => {
    const { tickMs } = constants.combat;
    const frameMs = constants.engine.maxStepsPerFrame * tickMs;
    const stepSimMs = constants.offline.stepSimMaxSeconds * 1000;
    const results = [frameMs, frameMs + tickMs, stepSimMs, stepSimMs + tickMs].map((gap) =>
      createEngine({ data: loadGameData(), state: makeState() }).advanceTo(T0 + gap),
    );

    expect(results).toEqual([
      { mode: 'step', steps: constants.engine.maxStepsPerFrame },
      { mode: 'catch-up', steps: constants.engine.maxStepsPerFrame + 1 },
      { mode: 'catch-up', steps: stepSimMs / tickMs },
      { mode: 'offline', steps: 0 },
    ]);
  });

  it('sends every gap that does not fit a frame to the estimator when stepSimMaxSeconds is 0', () => {
    const data = fixtureData({ stepSimMaxSeconds: 0 });
    expect(makeEngine(['a'], data).advanceTo(T0 + 11 * TICK).mode).toBe('offline');
    expect(makeEngine(['a'], data).advanceTo(T0 + 10 * TICK).mode).toBe('step');
  });
});

describe('offline estimate (ADR 0002 "Offline estimator")', () => {
  const HOUR_MS = 3_600_000;

  it('hands the estimator the state, the seconds and the data, and stores its result', () => {
    const data = fixtureData();
    const engine = createEngine({
      data,
      state: makeState(['a']),
      estimateOffline: (state, seconds, passedData) => {
        expect(state).toBe(engine.state);
        expect(passedData).toBe(data);
        expect(seconds).toBe(600);
        return { characters: [{ characterId: 'a', kills: 12, xp: 340, gold: 56, items: { 'rusty-sword': 1 } }] };
      },
    });

    expect(engine.advanceTo(T0 + 600_000)).toEqual({ mode: 'offline', steps: 0 });

    expect(engine.state.pendingSummary).toEqual({
      seconds: 600,
      discardedSeconds: 0,
      characters: [{ characterId: 'a', kills: 12, xp: 340, gold: 56, items: { 'rusty-sword': 1 } }],
    });
    expect(engine.drainEvents()).toEqual([{ type: 'summaryReady' }]);
  });

  it('caps the gap at offline.capHours and says how many seconds were discarded', () => {
    const { calls, estimate } = recordingEstimator();
    const engine = makeEngine(['a'], fixtureData({ capHours: 1 }), estimate);

    engine.advanceTo(T0 + 2 * HOUR_MS + 30_000);

    expect(calls.map((c) => c.seconds)).toEqual([3600]);
    expect(engine.state.pendingSummary).toMatchObject({ seconds: 3600, discardedSeconds: 3600 + 30 });
  });

  it('discards nothing at exactly the cap or below it', () => {
    for (const [gapMs, seconds] of [
      [HOUR_MS, 3600],
      [HOUR_MS - 1000, 3599],
      [HOUR_MS + 1000, 3600],
    ] as const) {
      const engine = makeEngine(['a'], fixtureData({ capHours: 1 }));
      engine.advanceTo(T0 + gapMs);
      expect(engine.state.pendingSummary).toMatchObject({ seconds, discardedSeconds: gapMs / 1000 - seconds });
    }
  });

  it('reads the cap from the data', () => {
    const { calls, estimate } = recordingEstimator();
    makeEngine(['a'], fixtureData({ capHours: 2 }), estimate).advanceTo(T0 + 5 * HOUR_MS);
    expect(calls.map((c) => c.seconds)).toEqual([7200]);
  });

  it('moves lastSimulatedAt to now and drops the sub-step remainder', () => {
    const engine = makeEngine(['a']);
    engine.advanceTo(T0 + 60_000 + 57);
    expect(engine.state.clock.lastSimulatedAt).toBe(T0 + 60_057);
    expect(engine.advanceTo(T0 + 60_057 + TICK)).toEqual({ mode: 'step', steps: 1 });
  });

  it('default estimator is a stub: zero yields for every character in id order, nothing else changes', () => {
    const engine = makeEngine(['b', 'a']);
    engine.advanceTo(T0 + HOUR_MS);

    expect(engine.state.pendingSummary).toEqual({
      seconds: 3600,
      discardedSeconds: 0,
      characters: [emptyCharacterSummary('a'), emptyCharacterSummary('b')],
    });
    expect(engine.state.roster.map((c) => c.timeInPhaseMs)).toEqual([0, 0]);
  });

  it('adds to a summary the player has not seen yet instead of replacing it', () => {
    const results: CharacterSummary[] = [
      { characterId: 'a', kills: 10, xp: 100, gold: 5, items: { herb: 2 } },
      { characterId: 'a', kills: 4, xp: 40, gold: 1, items: { herb: 1, fang: 3 } },
    ];
    let call = 0;
    const engine = makeEngine(['a'], fixtureData(), () => ({ characters: [results[call++] as CharacterSummary] }));

    engine.advanceTo(T0 + 60_000);
    engine.advanceTo(engine.state.clock.lastSimulatedAt + 120_000);

    expect(engine.state.pendingSummary).toEqual({
      seconds: 180,
      discardedSeconds: 0,
      characters: [{ characterId: 'a', kills: 14, xp: 140, gold: 6, items: { herb: 3, fang: 3 } }],
    });
    expect(results[0]?.items).toEqual({ herb: 2 }); // the estimator's own objects are not changed

    engine.dispatch({ type: 'dismissSummary' });
    engine.advanceTo(engine.state.clock.lastSimulatedAt + TICK);
    engine.advanceTo(engine.state.clock.lastSimulatedAt + 60_000);
    expect(engine.state.pendingSummary).toMatchObject({ seconds: 60 });
  });

  it('keeps the stream draws the estimator makes (it reads and writes character.rng)', () => {
    const engine = makeEngine(['a'], fixtureData(), (state) => {
      const character = find(state, 'a');
      const streams = createCharacterStreams(SEED, 'a', character.rng);
      streams.drops.nextFloat();
      streams.drops.nextFloat();
      character.rng = readStreamStates(streams);
      return { characters: [emptyCharacterSummary('a')] };
    });
    const reference = createCharacterStreams(SEED, 'a');
    reference.drops.nextFloat();
    reference.drops.nextFloat();

    engine.advanceTo(T0 + 60_000);
    expect(find(engine.state, 'a').rng).toEqual(readStreamStates(reference));

    engine.advanceTo(engine.state.clock.lastSimulatedAt + 3 * TICK); // a later save must not undo the draws
    expect(find(engine.state, 'a').rng).toEqual(readStreamStates(reference));
  });
});

describe('clock going backwards (ADR 0002 "Clock going backwards")', () => {
  it('grants no progress, moves lastSimulatedAt to now, counts it and emits an event', () => {
    const { calls, estimate } = recordingEstimator();
    const engine = makeEngine(['a'], fixtureData(), estimate);
    engine.advanceTo(T0 + 500);

    expect(engine.advanceTo(T0 + 200)).toEqual({ mode: 'clock-rewind', steps: 0 });

    expect(engine.state.clock.lastSimulatedAt).toBe(T0 + 200);
    expect(engine.state.clock.diagnostics.clockRewind).toBe(1);
    expect(find(engine.state, 'a').timeInPhaseMs).toBe(500);
    expect(engine.state.pendingSummary).toBeNull();
    expect(calls).toEqual([]);
    expect(engine.drainEvents()).toEqual([{ type: 'clockRewind', from: T0 + 500, to: T0 + 200 }]);
  });

  it('counts every rewind and carries on from the new time', () => {
    const engine = makeEngine(['a']);
    engine.advanceTo(T0 + 1000);
    engine.advanceTo(T0 + 900);
    engine.advanceTo(T0 + 100);
    expect(engine.state.clock.diagnostics.clockRewind).toBe(2);

    expect(engine.advanceTo(T0 + 100 + 3 * TICK)).toEqual({ mode: 'step', steps: 3 });
    expect(find(engine.state, 'a').timeInPhaseMs).toBe(1000 + 3 * TICK);
  });

  it('does not treat a stand-still as a rewind', () => {
    const engine = makeEngine(['a']);
    engine.advanceTo(T0);
    expect(engine.state.clock.diagnostics.clockRewind).toBe(0);
    expect(engine.drainEvents()).toEqual([]);
  });
});

describe('starting the engine (ADR 0002 "Step length")', () => {
  it('refuses to start while combat.tickMs is null, and names it', () => {
    const state = makeState();
    const before = structuredClone(state);

    expect(() => createEngine({ data: fixtureData({ tickMs: null }), state })).toThrow(/"combat\.tickMs" is null/);
    expect(state).toEqual(before);
  });

  it.each([
    ['engine.maxStepsPerFrame', { maxStepsPerFrame: null }],
    ['offline.stepSimMaxSeconds', { stepSimMaxSeconds: null }],
    ['offline.capHours', { capHours: null }],
  ] as const)('refuses to start while %s is null', (path, override) => {
    expect(() => makeEngine(['a'], fixtureData(override))).toThrow(new RegExp(`"${path.replace('.', '\\.')}" is null`));
  });

  it('refuses to start when a constant is missing', () => {
    const data = createGameData({ constants: { combat: { tickMs: TICK } } });
    expect(() => createEngine({ data, state: makeState() })).toThrow(/"engine\.maxStepsPerFrame" is missing/);
  });

  it.each([
    ['combat.tickMs', { tickMs: 0 }],
    ['combat.tickMs', { tickMs: -100 }],
    ['engine.maxStepsPerFrame', { maxStepsPerFrame: 0 }],
    ['engine.maxStepsPerFrame', { maxStepsPerFrame: 2.5 }],
    ['offline.stepSimMaxSeconds', { stepSimMaxSeconds: -1 }],
    ['offline.capHours', { capHours: 0 }],
  ] as const)('refuses to start with a bad %s', (path, override) => {
    expect(() => makeEngine(['a'], fixtureData(override))).toThrow(RangeError);
    expect(() => makeEngine(['a'], fixtureData(override))).toThrow(path);
  });

  it('starts with the real data', () => {
    const engine = createEngine({ data: loadGameData(), state: makeState(['a']) });
    expect(engine.advanceTo(T0 + constants.combat.tickMs)).toEqual({ mode: 'step', steps: 1 });
  });
});

describe('random streams (ADR 0002 "RNG")', () => {
  it('the same seed gives the same sequence for each purpose', () => {
    const one = createCharacterStreams(SEED, 'a');
    const two = createCharacterStreams(SEED, 'a');
    expect(draw(one.combat, 20)).toEqual(draw(two.combat, 20));
    expect(draw(one.drops, 20)).toEqual(draw(two.drops, 20));
    expect(draw(one.search, 20)).toEqual(draw(two.search, 20));
  });

  it('purposes, characters and master seeds each give a different sequence', () => {
    const base = createCharacterStreams(SEED, 'a');
    const sequences = [
      draw(base.combat, 10),
      draw(base.drops, 10),
      draw(base.search, 10),
      draw(createCharacterStreams(SEED, 'b').combat, 10),
      draw(createCharacterStreams(SEED + 1, 'a').combat, 10),
    ];
    expect(new Set(sequences.map((s) => s.join())).size).toBe(sequences.length);
  });

  it('drawing from one purpose does not move another', () => {
    const busy = createCharacterStreams(SEED, 'a');
    const quiet = createCharacterStreams(SEED, 'a');
    draw(busy.drops, 1000);
    expect(draw(busy.combat, 10)).toEqual(draw(quiet.combat, 10));
  });

  it('a restored stream continues the same sequence', () => {
    const live = createCharacterStreams(SEED, 'a');
    draw(live.combat, 17);
    draw(live.drops, 5);

    const saved = readStreamStates(live);
    const restored = createCharacterStreams(SEED, 'a', saved);

    expect(draw(restored.combat, 25)).toEqual(draw(live.combat, 25));
    expect(draw(restored.drops, 25)).toEqual(draw(live.drops, 25));
    expect(draw(restored.search, 25)).toEqual(draw(live.search, 25));
  });

  it('restores from a saved copy that went through JSON', () => {
    const live = createCharacterStreams(SEED, 'a');
    draw(live.search, 9);
    const saved = JSON.parse(JSON.stringify(readStreamStates(live))) as ReturnType<typeof readStreamStates>;

    expect(draw(createCharacterStreams(SEED, 'a', saved).search, 10)).toEqual(draw(live.search, 10));
  });

  it('starts a stream missing from the saved state fresh', () => {
    const live = createCharacterStreams(SEED, 'a');
    draw(live.combat, 3);
    const { combat } = readStreamStates(live);
    const partial = createCharacterStreams(SEED, 'a', { combat });

    expect(draw(partial.combat, 5)).toEqual(draw(live.combat, 5));
    expect(draw(partial.drops, 5)).toEqual(draw(createCharacterStreams(SEED, 'a').drops, 5));
  });

  it('the engine writes the stream states into the state, derived from the master seed and the id', () => {
    const engine = makeEngine(['a', 'b']);
    expect(find(engine.state, 'a').rng).toEqual(readStreamStates(createCharacterStreams(SEED, 'a')));
    expect(find(engine.state, 'b').rng).toEqual(readStreamStates(createCharacterStreams(SEED, 'b')));
    expect(find(engine.state, 'a').rng).not.toEqual(find(engine.state, 'b').rng);
  });

  it('the engine continues saved streams instead of reseeding them', () => {
    const used = createCharacterStreams(SEED, 'a');
    draw(used.combat, 40);
    const saved = readStreamStates(used);
    const state = makeState(['a']);
    find(state, 'a').rng = saved;

    const engine = createEngine({ data: fixtureData(), state });
    engine.advanceTo(T0 + 5 * TICK);

    expect(find(engine.state, 'a').rng).toEqual(saved);
  });
});

describe('end of a step (ADR 0002 "Multiple characters")', () => {
  it('publishes step events in the order they were emitted, and empties the list', () => {
    const first: EngineEvent = { type: 'phaseChanged', characterId: 'a', from: 'idle', to: 'travelling' };
    const second: EngineEvent = { type: 'phaseChanged', characterId: 'b', from: 'idle', to: 'dead' };
    const earlier: EngineEvent = { type: 'summaryReady' };
    const stepEvents = [first, second];
    const outbox = [earlier];
    publishStepEvents(stepEvents, outbox);
    expect(outbox).toEqual([earlier, first, second]);
    expect(stepEvents).toEqual([]);
  });
});
