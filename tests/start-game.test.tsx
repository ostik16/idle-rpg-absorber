// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import constants from '../data/constants.json';
import { loadGameData, type GameData } from '../src/data/game-data';
import { startGame, type RunningAutosave, type SaveOpening, type SaveSeam } from '../src/start-game';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { GameState } from '../src/state/types';
import { send } from '../src/ui/store';

const T0 = 1_000_000;
/** More animation frames than one `combat.tickMs` takes at 16 ms each. */
const FRAMES_PAST_A_STEP = Math.ceil(constants.combat.tickMs / 16) + 1;
const data = loadGameData();
/** No hold and no paint wait, so tests need neither a clock nor a browser. */
const NO_BOOT = { holdMs: 0, paint: async () => {} };

function newGame(): GameState {
  return createGameState(7, T0, data);
}

/** A state the first step throws on: the character fights an enemy the tables do not have. */
function brokenGame(): GameState {
  const state = newGame();
  const character = createCharacterState('c1', 'Ysolde', data);
  character.phase = 'fighting';
  character.fight = { enemyId: 'no-such-enemy', enemyHp: 1, ticks: 0 };
  state.roster.push(character);
  return state;
}

function fakeSeam(opening: () => Promise<SaveOpening>) {
  const autosave = {
    saveNow: vi.fn<RunningAutosave['saveNow']>(async () => {}),
    stop: vi.fn<RunningAutosave['stop']>(),
  };
  let options: { data: GameData; getState: () => GameState } | undefined;
  const seam: SaveSeam = {
    open: () => opening(),
    startAutosave(given) {
      options = given;
      return autosave;
    },
  };
  return { seam, autosave, startedWith: () => options };
}

function play(state: GameState, notices: readonly string[] = []) {
  return fakeSeam(async () => ({ status: 'play', state, notices }));
}

function runFrames(count: number): void {
  for (let i = 0; i < count; i++) vi.advanceTimersToNextFrame();
}

describe('startGame', () => {
  let root: HTMLElement;

  /** The splash text at the moment the offline estimate would start, or null if no paint was asked for. */
  async function textAtPaint(state: GameState): Promise<string | null> {
    let seen: string | null = null;
    const paint = async () => {
      seen = root.textContent;
    };
    await startGame(root, play(state).seam, { holdMs: 0, paint });
    return seen;
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: T0, toFake: ['Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('the splash', () => {
    it('says it is catching up after a long absence, drawn before the estimate runs', async () => {
      const state = newGame();
      state.clock.lastSimulatedAt = T0 - (constants.offline.stepSimMaxSeconds + 1) * 1000;
      expect(await textAtPaint(state)).toContain('Catching up on your time away');
      expect(root.querySelector('.app')).not.toBeNull();
    });

    it('does not ask for a paint after a short gap', async () => {
      expect(await textAtPaint(newGame())).toBeNull();
    });

    it('holds for at least the minimum time even when the start is instant', async () => {
      vi.useFakeTimers({ now: T0, toFake: ['Date', 'setTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
      let started = false;
      const running = startGame(root, play(newGame()).seam, { holdMs: 1000, paint: async () => {} }).then(() => (started = true));
      await vi.advanceTimersByTimeAsync(999);
      expect(started).toBe(false);
      expect(root.textContent).toContain('Loading');
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(started).toBe(true);
    });
  });

  describe('a load that must not start the game', () => {
    it('shows every line, starts no game and never autosaves', async () => {
      const lines = ['Save version 9 needs a newer game. The save is unchanged.', 'Export your save to keep a copy.'];
      const { seam, autosave, startedWith } = fakeSeam(async () => ({ status: 'blocked', lines }));
      await startGame(root, seam, NO_BOOT);

      expect(root.querySelector('.ab-card')?.textContent).toContain(lines[0]);
      expect(root.querySelector('.ab-card')?.textContent).toContain(lines[1]);
      expect(root.querySelector('.app')).toBeNull();
      expect(startedWith()).toBeUndefined();
      runFrames(5);
      expect(autosave.saveNow).not.toHaveBeenCalled();
    });
  });

  describe('a load with something to tell the player', () => {
    it('puts its notices on the running screen', async () => {
      const line = 'The newest save could not be read. Loaded the previous save, 3m 12s old.';
      await startGame(root, play(newGame(), [line]).seam, NO_BOOT);
      runFrames(3);
      await vi.advanceTimersByTimeAsync(0);
      expect(root.querySelector('.app')).not.toBeNull();
      const shown = [...root.querySelectorAll('.ab-notice')].map((node) => node.textContent);
      expect(shown).toContain(line);
    });
  });

  describe('a startup failure shows a message, never a blank page', () => {
    function expectFailureScreen(): void {
      expect(root.querySelector('.ab-card')?.textContent).toContain('could not start');
      expect(root.querySelector('.app')).toBeNull();
      expect(console.error).toHaveBeenCalled();
    }

    it('when the load rejects', async () => {
      const { seam, startedWith } = fakeSeam(async () => {
        throw new Error('no database');
      });
      await startGame(root, seam, NO_BOOT);
      expectFailureScreen();
      expect(startedWith()).toBeUndefined();
    });

    it('when the store cannot read the state, after autosave has started, and autosave stops', async () => {
      const state = newGame();
      delete (state.account as Partial<GameState['account']>).warehouse;
      const { seam, autosave, startedWith } = play(state);
      await startGame(root, seam, NO_BOOT);
      expectFailureScreen();
      expect(startedWith()).toBeDefined();
      expect(autosave.stop).toHaveBeenCalledTimes(1);
    });

    it('when the engine refuses the state, and nothing is left writing it', async () => {
      const state = newGame();
      state.roster.push(createCharacterState('c1', 'A', data), createCharacterState('c1', 'B', data));
      const { seam, startedWith } = play(state);
      await startGame(root, seam, NO_BOOT);
      expectFailureScreen();
      expect(startedWith()).toBeUndefined();
    });
  });

  describe('autosave', () => {
    it('gets the data and reads the live state', async () => {
      const state = newGame();
      const { seam, startedWith } = play(state);
      await startGame(root, seam, NO_BOOT);
      expect(startedWith()?.data.constants).toEqual(data.constants);
      expect(startedWith()?.getState()).toBe(state);
    });

    it('is running before the UI exists, so no command can get ahead of it', async () => {
      const { seam } = play(newGame());
      const start = seam.startAutosave;
      let mountedAtStart: boolean | undefined;
      seam.startAutosave = (options) => {
        mountedAtStart = root.querySelector('.app') !== null;
        return start(options);
      };
      await startGame(root, seam, NO_BOOT);
      expect(mountedAtStart).toBe(false);
      expect(root.querySelector('.app')).not.toBeNull();
    });

    it('stops when a frame fails, and the player is told', async () => {
      const { seam, autosave } = play(brokenGame());
      await startGame(root, seam, NO_BOOT);
      expect(autosave.stop).not.toHaveBeenCalled();

      runFrames(FRAMES_PAST_A_STEP);
      await vi.advanceTimersByTimeAsync(0);
      expect(autosave.stop).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalled();

      const shown = [...root.querySelectorAll('.ab-notice')].map((node) => node.textContent);
      expect(shown.join(' ')).toContain('Game stopped');
    });

    it('does not save a failed game after a saveAfter command', async () => {
      const { seam, autosave } = play(brokenGame());
      await startGame(root, seam, NO_BOOT);
      send({ type: 'createCharacter', name: 'Brann' }, { saveAfter: true });
      runFrames(FRAMES_PAST_A_STEP);
      expect(autosave.stop).toHaveBeenCalledTimes(1);
      expect(autosave.saveNow).not.toHaveBeenCalled();
    });

    it('saves once a saveAfter command has been applied, with its result in the state', async () => {
      const state = newGame();
      const { seam, autosave, startedWith } = play(state);
      autosave.saveNow.mockImplementation(async () => {
        expect(startedWith()?.getState().roster).toHaveLength(1);
      });
      await startGame(root, seam, NO_BOOT);

      send({ type: 'createCharacter', name: 'Ysolde' }, { saveAfter: true });
      expect(autosave.saveNow).not.toHaveBeenCalled();
      runFrames(FRAMES_PAST_A_STEP);
      expect(autosave.saveNow).toHaveBeenCalledTimes(1);
      expect(state.roster).toHaveLength(1);
    });
  });
});
