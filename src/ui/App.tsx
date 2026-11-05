import { useComputed } from '@preact/signals';
import { CharacterCreate } from './CharacterCreate';
import { DeleteConfirm } from './DeleteConfirm';
import { formatGold } from './format';
import { Icon } from './Icon';
import { Notice } from './Notice';
import { Roster } from './Roster';
import { hrefFor, ROUTES, type Route } from './router';
import { closeCreation, creationOpen, route, selectedCharacter } from './store';

// Placeholder content for the screens not built yet.
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

/** The app bar's gold pill reads the selected character (decisions L18). Null for an empty roster. */
function GoldPill() {
  const text = useComputed(() => {
    const view = selectedCharacter.value;
    return view === null ? null : formatGold(view.gold.value);
  });
  if (text.value === null) return null;
  return (
    <span class="ab-gold" aria-label="Gold">
      <Icon name="gold" size={16} />
      {text}
    </span>
  );
}

export function App() {
  const current = route.value;
  const creating = creationOpen.value;
  const screen = SCREENS[current];
  const title = creating ? 'New character' : screen.label;

  return (
    <div class="app">
      <nav class="ab-rail app__rail" aria-label="Main">
        <Tabs current={current} />
      </nav>
      <div class="app__col">
        <header class={`ab-appbar${creating ? ' ab-appbar--pushed' : ''}`}>
          {creating && (
            <button
              type="button"
              class="ab-btn ab-btn--ghost ab-btn--icon"
              aria-label="Back to roster"
              onClick={closeCreation}
            >
              <svg class="ab-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="m15 18-6-6 6-6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          )}
          <h1 class="ab-appbar__title">{title}</h1>
          {!creating && <GoldPill />}
        </header>
        <main class="app__main">
          <div class="app__content">
            <Notice />
            {creating ? (
              <CharacterCreate />
            ) : current === 'roster' ? (
              <Roster />
            ) : (
              <section class="ab-card">
                <div class="ab-card__head">
                  <span class="ab-label">{screen.label}</span>
                </div>
                <p class="app__text">{screen.empty}</p>
                <p class="app__text ab-c-muted">This screen is not built yet.</p>
              </section>
            )}
          </div>
        </main>
        {!creating && (
          <nav class="ab-tabbar app__tabbar" aria-label="Main">
            <Tabs current={current} />
          </nav>
        )}
      </div>
      <DeleteConfirm />
    </div>
  );
}
