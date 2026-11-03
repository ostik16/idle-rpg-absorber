// CSS order matters: tokens first (generated from the design system), then fonts, then component classes,
// then the shell layout that places them.
import './styles/tokens.css';
import './styles/fonts.css';
import '../design/ui/design-system/components/bundle.css';
import './ui/shell.css';
import { render } from 'preact';
import { App } from './ui/App';
import { startRouteSync } from './ui/store';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');

startRouteSync();
render(<App />, root);
