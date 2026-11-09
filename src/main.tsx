// CSS order matters: tokens first (generated from the design system), then fonts, then component classes,
// then the shell layout that places them.
import './styles/tokens.css';
import './styles/fonts.css';
import '../design/ui/design-system/components/bundle.css';
import './ui/shell.css';
import { createSaveSeam } from './save-seam';
import { startGame } from './start-game';
import { startRouteSync } from './ui/store';

const saveSeam = createSaveSeam(import.meta.env.MODE);

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');

startRouteSync();
await startGame(root, saveSeam);
