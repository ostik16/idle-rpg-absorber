// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import constants from '../data/constants.json';
import { loadGameData } from '../src/data/game-data';
import { createEngine, type Engine } from '../src/engine/engine';
import { startFight } from '../src/engine/fight';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { GameState } from '../src/state/types';
import { startFrameLoop } from '../src/ui/frame-loop';
import { connectEngine, pendingSummary, roster } from '../src/ui/store';

const T0 = 1_000_000;
const TICK = constants.combat.tickMs;
const FRAME = 16;
const MINUTE = 60_000;
const data = loadGameData();

/** A character in a real fight, so a wrong catch-up shows up in health, RNG streams and kills. */
function fightingState(): GameState {
  const state = createGameState(7, T0, data);
  const character = createCharacterState('c1', 'Ysolde', data);
  startFight(
    character,
    'glade-rat',
    // startFight only reads data and tickMs here; the phase change is not something this test looks at.
    { data, tickMs: TICK, streams: {} as never, emit: () => {} },
  );
  state.roster.push(character);
  return state;
}

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

function runFrames(count: number): void {
  for (let i = 0; i < count; i++) vi.advanceTimersToNextFrame();
}

describe('frame loop (ADR 0002)', () => {
  let stop: () => void = () => {};
  let engine: Engine;
  let refresh: ReturnType<typeof vi.fn<() => void>>;

  function start(state: GameState = fightingState()): void {
    engine = createEngine({ data, state });
    const publish = connectEngine(engine, data);
    refresh = vi.fn(publish);
    stop = startFrameLoop(engine, refresh);
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: T0, toFake: ['Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('advances the engine to Date.now() on each frame while visible', () => {
    start();
    runFrames(100);
    const elapsed = Date.now() - T0;
    expect(engine.state.clock.lastSimulatedAt).toBe(T0 + Math.floor(elapsed / TICK) * TICK);
  });

  it('refreshes at most once per frame, and only when a step ran', () => {
    start();
    runFrames(100);
    const elapsed = Date.now() - T0;
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(Math.floor(elapsed / TICK));
    expect(refresh.mock.calls.length).toBeGreaterThan(0);
  });

  it('stops moving time while hidden', () => {
    start();
    setVisibility('hidden');
    const before = engine.state.clock.lastSimulatedAt;
    const calls = refresh.mock.calls.length;
    vi.advanceTimersByTime(MINUTE);
    expect(engine.state.clock.lastSimulatedAt).toBe(before);
    expect(refresh.mock.calls.length).toBe(calls);
  });

  it('a tab hidden for a minute catches up to the same state as one left running', () => {
    start();
    const control = createEngine({ data, state: fightingState() });

    setVisibility('hidden');
    vi.advanceTimersByTime(MINUTE);
    setVisibility('visible');

    for (let at = T0 + TICK; at <= T0 + MINUTE; at += TICK) control.advanceTo(at);
    expect(engine.state.clock.lastSimulatedAt).toBe(T0 + MINUTE);
    expect(engine.state).toEqual(control.state);
    expect(control.drainEvents().map((event) => event.type)).toContain('enemyKilled');
  });

  it('forces one full refresh on return, so the signals show the caught-up state at once', () => {
    start();
    setVisibility('hidden');
    vi.advanceTimersByTime(MINUTE);
    const calls = refresh.mock.calls.length;
    setVisibility('visible');
    expect(refresh.mock.calls.length).toBe(calls + 1);

    const character = engine.state.roster[0];
    const view = roster.value[0];
    expect(view?.health.value).toBe(Math.ceil(character?.health ?? -1));
    expect(view?.activity.value).toBe(character?.phase);
  });

  it('refreshes on return even when no whole step was due', () => {
    start();
    setVisibility('hidden');
    const calls = refresh.mock.calls.length;
    setVisibility('visible');
    expect(refresh.mock.calls.length).toBe(calls + 1);
  });

  it('runs one loop after return, not two', () => {
    start();
    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('hidden');
    setVisibility('visible');
    const advance = vi.spyOn(engine, 'advanceTo');
    runFrames(5);
    expect(advance).toHaveBeenCalledTimes(5);
  });

  it('a gap longer than offline.stepSimMaxSeconds publishes the summary for the Welcome back screen', () => {
    start();
    setVisibility('hidden');
    vi.advanceTimersByTime((constants.offline.stepSimMaxSeconds + 1) * 1000);
    setVisibility('visible');
    expect(pendingSummary.value?.seconds).toBe(constants.offline.stepSimMaxSeconds + 1);
  });

  it('does not start frames while the tab loads hidden', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    start();
    vi.advanceTimersByTime(FRAME * 10);
    expect(engine.state.clock.lastSimulatedAt).toBe(T0);
  });
});
