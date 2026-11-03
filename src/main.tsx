// CSS order matters: tokens first (generated from the design system), then fonts, then component classes,
// then the shell layout that places them.
import './styles/tokens.css';
import './styles/fonts.css';
import '../design/ui/design-system/components/bundle.css';
import './ui/shell.css';
import { render } from 'preact';
import { loadGameData, type GameData } from './data/game-data';
import { createEngine } from './engine/engine';
import { createGameState } from './state/factory';
import type { GameState } from './state/types';
import { App } from './ui/App';
import { startFrameLoop } from './ui/frame-loop';
import { connectEngine, startRouteSync } from './ui/store';

/**
 * The save seam: all the game knows about saving. Issue #30 replaces these two bodies with `src/save/`.
 * Until then every page load is a new game and nothing is written.
 */
const saveSeam = {
  /** The state to play: the saved one, migrated, or a new game when there is none. */
  async load(data: GameData, nowMs: number): Promise<GameState> {
    const [masterSeed = 0] = crypto.getRandomValues(new Uint32Array(1));
    return createGameState(masterSeed, nowMs, data);
  },
  /** Saves `state` on a timer, on page hide and after irreversible actions (architecture "Data flow" 6). */
  startAutosave(_state: GameState): void {},
};

/** Architecture "Data flow": load data, load the save, build the engine, catch up, publish, keep running. */
async function startGame(): Promise<void> {
  const data = loadGameData();
  const state = await saveSeam.load(data, Date.now());
  const engine = createEngine({ data, state });
  engine.advanceTo(Date.now());
  const refresh = connectEngine(engine, data);
  startFrameLoop(engine, refresh);
  saveSeam.startAutosave(state);
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');

startRouteSync();
await startGame();
render(<App />, root);
