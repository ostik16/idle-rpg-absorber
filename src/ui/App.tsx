import { CharacterCreate } from './CharacterCreate';
import { CharacterScreen } from './CharacterScreen';
import { City } from './City';
import { DeleteConfirm } from './DeleteConfirm';
import { Farm } from './Farm';
import { Icon } from './Icon';
import { Notice } from './Notice';
import { Settings } from './Settings';
import { Shop } from './Shop';
import { Switcher } from './Switcher';
import { Warehouse } from './Warehouse';
import { hrefFor, ROUTES, type Route } from './router';
import {
  closePushed,
  creationOpen,
  listShops,
  openCreation,
  openShopId,
  roster,
  route,
  selectedCharacter,
  settingsCharacterId,
  warehouseOpen,
} from './store';

const LABELS: Record<Route, string> = { farm: 'Farm', city: 'City', character: 'Character' };

/** The destinations. Used by both the phone tab bar and the desktop rail; CSS shows one of them. A tap always closes pushed screens. */
function Tabs({ current }: { current: Route }) {
  return (
    <>
      {ROUTES.map((r) => (
        <a key={r} class="ab-tab" href={hrefFor(r)} aria-current={r === current ? 'page' : undefined} onClick={closePushed}>
          <Icon name={r} />
          {LABELS[r]}
        </a>
      ))}
    </>
  );
}

function NoCharacter() {
  return (
    <section class="ab-card app__stack">
      <p class="app__text">No characters yet.</p>
      <button type="button" class="ab-btn ab-btn--primary ab-btn--block" onClick={openCreation}>
        Create character
      </button>
    </section>
  );
}

export function App() {
  const current = route.value;
  const shopName = openShopId.value === null ? undefined : listShops().find((s) => s.id === openShopId.value)?.name;
  const settingsName = settingsCharacterId.value === null ? undefined : roster.value.find((v) => v.id === settingsCharacterId.value)?.name;
  const creating = creationOpen.value;
  const storing = warehouseOpen.value;
  // The most specific pushed screen wins, as before. Tabs close all of them.
  const pushedTitle =
    settingsName !== undefined ? `${settingsName} · settings` : shopName !== undefined ? shopName : storing ? 'Warehouse' : creating ? 'New character' : null;
  const hasCharacter = selectedCharacter.value !== null;

  return (
    <div class="app">
      <nav class="ab-rail app__rail" aria-label="Main">
        <Tabs current={current} />
      </nav>
      <div class="app__col">
        <header class="ab-appbar">
          <h1 class="app__sr">{LABELS[current]}</h1>
          <Switcher />
        </header>
        <main class="app__main">
          <div class="app__content">
            <Notice />
            {pushedTitle !== null && <h2 class="ab-title app__text app__pushed-title">{pushedTitle}</h2>}
            {settingsName !== undefined ? (
              <Settings />
            ) : shopName !== undefined ? (
              <Shop />
            ) : storing ? (
              <Warehouse />
            ) : creating ? (
              <CharacterCreate />
            ) : current === 'farm' ? (
              <Farm />
            ) : current === 'city' ? (
              <City />
            ) : hasCharacter ? (
              <CharacterScreen />
            ) : (
              <NoCharacter />
            )}
          </div>
        </main>
        <nav class="ab-tabbar app__tabbar" aria-label="Main">
          <Tabs current={current} />
        </nav>
      </div>
      <DeleteConfirm />
    </div>
  );
}
