/**
 * The order the game starts in (architecture "Data flow"): load data, load the save, build the engine, catch up,
 * publish, mount, keep running. `main.tsx` calls it with the page's root and the save seam.
 */
import { render } from 'preact';
import constants from '../data/constants.json';
import { loadGameData, type GameData } from './data/game-data';
import { devNow } from './dev/clock';
import { createEngine, type Engine } from './engine/engine';
import type { GameState } from './state/types';
import { App } from './ui/App';
import { holdAtLeast, nextPaint } from './ui/boot';
import { startFrameLoop } from './ui/frame-loop';
import { GameFailure } from './ui/GameFailure';
import { Splash } from './ui/Splash';
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

/** Splash timing. Tests replace it so they need no clock and no paint. */
export interface Boot {
  /** The splash stays up at least this long, so a fast start does not flicker. */
  holdMs: number;
  /** Resolves once the browser has drawn what was just rendered. */
  paint(): Promise<void>;
}

const DEFAULT_BOOT: Boot = { holdMs: constants.ui.splashMinMs, paint: nextPaint };

/** Opens the save and catches up to now. Null when the save blocked the game (the failure is already on screen). */
async function openAndCatchUp(root: Element, seam: SaveSeam, data: GameData, boot: Boot): Promise<Engine | null> {
  const opening = await seam.open(data, Date.now());
  if (opening.status === 'blocked') {
    render(<GameFailure lines={opening.lines} />, root);
    return null;
  }
  showLastingNotices(opening.notices);
  const engine = createEngine({ data, state: opening.state });
  const gapSeconds = (Date.now() - opening.state.clock.lastSimulatedAt) / 1000;
  if (gapSeconds > constants.offline.stepSimMaxSeconds) {
    render(<Splash status="Catching up on your time away" />, root);
    await boot.paint();
  }
  engine.advanceTo(Date.now());
  return engine;
}

/**
 * Runs the game in `root`. The splash is the catch-up screen: it shows while the save loads and, after a long
 * absence, while the offline estimate runs (that blocks the page, so the splash is drawn first and shows no
 * progress). Whatever goes wrong before the game is running shows on screen, so a failure is never a blank page, and
 * stops the autosave, so nothing is left writing state. Autosave starts before the UI can send a
 * command, and the frame loop last, so nothing moves until all of it is in place.
 */
export async function startGame(root: Element, seam: SaveSeam, boot: Boot = DEFAULT_BOOT): Promise<void> {
  let stopAutosave = (): void => {};
  try {
    render(<Splash status="Loading" />, root);
    const data = loadGameData();
    const engine = await holdAtLeast(openAndCatchUp(root, seam, data, boot), boot.holdMs);
    if (!engine) return;
    const autosave = seam.startAutosave({ data, getState: () => engine.state });
    stopAutosave = () => autosave.stop();
    const refresh = connectEngine(engine, data, () => void autosave.saveNow());
    render(<App />, root);
    if (import.meta.env.DEV) void import('./dev/mount').then(({ mountDevTools }) => mountDevTools(engine, data));
    startFrameLoop(
      engine,
      refresh,
      (error) => {
        console.error(error);
        autosave.stop();
        showLastingNotices([GAME_STOPPED]);
      },
      import.meta.env.DEV ? devNow : Date.now,
    );
  } catch (error) {
    console.error(error);
    stopAutosave();
    render(<GameFailure lines={[STARTUP_FAILED]} />, root);
  }
}
