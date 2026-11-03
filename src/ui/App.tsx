import { Icon } from './Icon';
import { hrefFor, ROUTES, type Route } from './router';
import { route } from './store';

// Placeholder content: none of these screens exist yet, so each says so and nothing more.
const SCREENS: Record<Route, { label: string; empty: string }> = {
  roster: { label: 'Roster', empty: 'No characters yet.' },
  world: { label: 'World', empty: 'No areas to show yet.' },
  city: { label: 'City', empty: 'Nothing in the city yet.' },
  bestiary: { label: 'Bestiary', empty: 'No enemies recorded yet.' },
};

/** The four destinations. Used by both the phone tab bar and the desktop rail; CSS shows one of them. */
function Tabs({ current }: { current: Route }) {
  return (
    <>
      {ROUTES.map((r) => (
        <a key={r} class="ab-tab" href={hrefFor(r)} aria-current={r === current ? 'page' : undefined}>
          <Icon name={r} />
          {SCREENS[r].label}
        </a>
      ))}
    </>
  );
}

export function App() {
  const current = route.value;
  const screen = SCREENS[current];

  return (
    <div class="app">
      <nav class="ab-rail app__rail" aria-label="Main">
        <Tabs current={current} />
      </nav>
      <div class="app__col">
        <header class="ab-appbar">
          <h1 class="ab-appbar__title">{screen.label}</h1>
        </header>
        <main class="app__main">
          <div class="app__content">
            <section class="ab-card">
              <div class="ab-card__head">
                <span class="ab-label">{screen.label}</span>
              </div>
              <p class="app__text">{screen.empty}</p>
              <p class="app__text ab-c-muted">This screen is not built yet.</p>
            </section>
          </div>
        </main>
        <nav class="ab-tabbar app__tabbar" aria-label="Main">
          <Tabs current={current} />
        </nav>
      </div>
    </div>
  );
}
