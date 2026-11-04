/**
 * The order the game starts in (architecture "Data flow"): load data, load the save, build the engine, catch up,
 * publish, mount, keep running. `main.tsx` calls it with the page's root and the save seam.
 */
import { render } from 'preact';
import { loadGameData, type GameData } from './data/game-data';
import { createEngine } from './engine/engine';
import type { GameState } from './state/types';
import { App } from './ui/App';
import { startFrameLoop } from './ui/frame-loop';
import { GameFailure } from './ui/GameFailure';
import { connectEngine, showLastingNotices } from './ui/store';

const STARTUP_FAILED = 'The game could not start. Reload the page to try again.';
const GAME_STOPPED = 'Game stopped by an error. Progress since the last save is not kept. Reload the page.';

/** What opening the save decided. */
export type SaveOpening =
  /** Play this state. `notices` are what the player should be told about the load. */
  | { status: 'play'; state: GameState; notices: readonly string[] }
  /** Do not start the game, and show `lines` instead: the save needs a newer game, or none could be read. */
  | { status: 'blocked'; lines: readonly string[] };

export interface RunningAutosave {
  /** Saves the state as it is now. Never rejects. */
  saveNow(): Promise<void>;
  stop(): void;
}

/** All the game knows about saving. */
export interface SaveSeam {
  open(data: GameData, nowMs: number): Promise<SaveOpening>;
  /** Saves on a timer and on page hide until `stop`. `getState` is read at each save. */
  startAutosave(options: { data: GameData; getState: () => GameState }): RunningAutosave;
}

/**
 * Runs the game in `root`. Whatever goes wrong before the game is running shows on screen, so a failure is never a
 * blank page. Autosave and the frame loop start last, so a failure before them leaves nothing writing state.
 */
export async function startGame(root: Element, seam: SaveSeam): Promise<void> {
  try {
    const data = loadGameData();
    const opening = await seam.open(data, Date.now());
    if (opening.status === 'blocked') {
      render(<GameFailure lines={opening.lines} />, root);
      return;
    }
    showLastingNotices(opening.notices);
    const engine = createEngine({ data, state: opening.state });
    engine.advanceTo(Date.now());
    // Only a later `refresh` can call this, and only the frame loop refreshes, so `autosave` exists by then.
    const refresh = connectEngine(engine, data, () => void autosave.saveNow());
    render(<App />, root);
    const autosave = seam.startAutosave({ data, getState: () => engine.state });
    startFrameLoop(engine, refresh, (error) => {
      console.error(error);
      autosave.stop();
      showLastingNotices([GAME_STOPPED]);
    });
  } catch (error) {
    console.error(error);
    render(<GameFailure lines={[STARTUP_FAILED]} />, root);
  }
}
