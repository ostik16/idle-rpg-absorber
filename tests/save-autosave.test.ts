import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import constants from '../data/constants.json';
import { createEngine } from '../src/engine/engine';
import { startAutosave } from '../src/save/autosave';
import { createGameState } from '../src/state/factory';
import type { GameState } from '../src/state/types';
import { data, newState, T0 } from './save-helpers';

const INTERVAL = constants.save.autosaveSeconds * 1000;

/** Stands in for `document` and `window`. */
function fakePage(visibilityState: DocumentVisibilityState = 'visible') {
  const target = new EventTarget();
  return Object.assign(target, { visibilityState });
}

function start(state: GameState = newState()) {
  const write = vi.fn<(state: GameState) => Promise<void>>(async () => {});
  const page = fakePage();
  const host = new EventTarget();
  const onError = vi.fn();
  const autosave = startAutosave({ saves: { write }, getState: () => state, intervalMs: INTERVAL, page, host, onError });
  return { write, page, host, onError, autosave };
}

describe('autosave timing (ADR 0003 "Writing")', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('uses the 30 s in the data', () => {
    expect(constants.save.autosaveSeconds).toBe(30);
  });

  it('saves every interval, and not before', () => {
    const { write, autosave } = start();
    vi.advanceTimersByTime(INTERVAL - 1);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INTERVAL);
    expect(write).toHaveBeenCalledTimes(2);
    autosave.stop();
  });

  it('saves when the page goes hidden, and not when it comes back', () => {
    const { write, page, autosave } = start();
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    expect(write).toHaveBeenCalledTimes(1);
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    expect(write).toHaveBeenCalledTimes(1);
    autosave.stop();
  });

  it('saves on pagehide', () => {
    const { write, host, autosave } = start();
    host.dispatchEvent(new Event('pagehide'));
    expect(write).toHaveBeenCalledTimes(1);
    autosave.stop();
  });

  it('saves on demand, for irreversible actions, and reads the state at that moment', async () => {
    const state = newState(1);
    const { write, autosave } = start(state);
    await autosave.saveNow();
    expect(write).toHaveBeenCalledWith(state);
    autosave.stop();
  });

  it('does nothing after stop', () => {
    const { write, page, host, autosave } = start();
    autosave.stop();
    vi.advanceTimersByTime(INTERVAL * 3);
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    host.dispatchEvent(new Event('pagehide'));
    expect(write).not.toHaveBeenCalled();
  });

  it('reports a failed save and keeps going', async () => {
    const { write, onError, autosave } = start();
    const failure = new Error('quota');
    write.mockRejectedValueOnce(failure);
    await expect(autosave.saveNow()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(failure);
    await autosave.saveNow();
    expect(write).toHaveBeenCalledTimes(2);
    autosave.stop();
  });
});

describe('saving after an irreversible action', () => {
  const TICK = constants.combat.tickMs;

  /** A real engine, and each state as `write` saw it. */
  function withEngine() {
    const engine = createEngine({ data, state: createGameState(7, T0, data) });
    const saved: GameState[] = [];
    const write = async (state: GameState): Promise<void> => void saved.push(structuredClone(state));
    const page = fakePage();
    const autosave = startAutosave({
      saves: { write },
      getState: () => engine.state,
      intervalMs: INTERVAL,
      page,
      host: new EventTarget(),
      saveAfterEvents: ['characterCreated'],
    });
    return { engine, saved, autosave };
  }

  it('saveNow straight after dispatch has the state from before the command: this is why the docs forbid it', async () => {
    const { engine, saved, autosave } = withEngine();
    engine.dispatch({ type: 'createCharacter', name: 'Kaela' });
    await autosave.saveNow();
    expect(saved[0]?.roster).toEqual([]);
    autosave.stop();
  });

  it('onEngineEvents saves the state with the command applied', () => {
    const { engine, saved, autosave } = withEngine();
    engine.dispatch({ type: 'createCharacter', name: 'Kaela' });
    expect(saved).toEqual([]);

    engine.advanceTo(T0 + TICK);
    autosave.onEngineEvents(engine.drainEvents());
    expect(saved).toHaveLength(1);
    expect(saved[0]?.roster.map((character) => character.name)).toEqual(['Kaela']);
    autosave.stop();
  });

  it('does not save for an event not listed, a refused command, or nothing', () => {
    const { engine, saved, autosave } = withEngine();
    engine.dispatch({ type: 'createCharacter', name: '' });
    engine.advanceTo(T0 + TICK);
    const events = engine.drainEvents();
    expect(events.map((event) => event.type)).toEqual(['commandRejected']);

    autosave.onEngineEvents(events);
    autosave.onEngineEvents([]);
    expect(saved).toEqual([]);
    autosave.stop();
  });

  it('saves once for a batch, however many of its events are listed', () => {
    const { saved, autosave } = withEngine();
    autosave.onEngineEvents([{ type: 'characterCreated' }, { type: 'characterCreated' }]);
    expect(saved).toHaveLength(1);
    autosave.stop();
  });
});
