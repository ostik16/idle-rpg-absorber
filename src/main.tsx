// CSS order matters: tokens first (generated from the design system), then fonts, then component classes,
// then the shell layout that places them.
import './styles/tokens.css';
import './styles/fonts.css';
import '../design/ui/design-system/components/bundle.css';
import './ui/shell.css';
import { startGame, type SaveSeam } from './start-game';
import { createGameState } from './state/factory';
import { startRouteSync } from './ui/store';

/**
 * Issue #30's `src/save/` plugs in here, and nothing else needs to change. Until then every page load is a new game
 * and nothing is written. `open` maps its load results: `loaded` and `empty` play, `newerVersion` and `unrecoverable`
 * are blocked, and `saveNotices` gives the lines either way.
 */
const saveSeam: SaveSeam = {
  async open(data, nowMs) {
    const [masterSeed = 0] = crypto.getRandomValues(new Uint32Array(1));
    return { status: 'play', state: createGameState(masterSeed, nowMs, data), notices: [] };
  },
  startAutosave() {
    return { saveNow: async () => {}, stop() {} };
  },
};

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');

startRouteSync();
await startGame(root, saveSeam);
