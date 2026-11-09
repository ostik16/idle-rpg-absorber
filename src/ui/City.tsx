import { usedCells } from '../game/inventory';
import { inCity } from './format';
import { Icon } from './Icon';
import { hrefFor } from './router';
import {
  formatDuration,
  itemInfo,
  listShops,
  openSettings,
  openShop,
  openWarehouse,
  roster,
  selectCharacter,
  selectedCharacterId,
  warehouseTabs,
  type CharacterView,
} from './store';

function stateLine(view: CharacterView): string {
  const phase = view.activity.value;
  if (phase === 'dead') {
    const left = Math.max(0, (view.phaseTotalMs.value ?? 0) - view.phaseElapsedMs.value);
    return `Fell. Back on its feet in ${formatDuration(left)}.`;
  }
  return phase === 'restocking' ? 'Restocking.' : 'In the city.';
}

/** "Minor health potion to 10, Swift draught to 2." or "Nothing." for the character's restock list. */
function restockLine(view: CharacterView): string {
  const lines = view.restockList.value.filter((entry) => entry.quantity > 0).map((entry) => `${itemInfo(entry.itemId).name} to ${entry.quantity}`);
  return lines.length === 0 ? 'Nothing.' : `${lines.join(', ')}.`;
}

function CityRow({ view }: { view: CharacterView }) {
  const here = inCity(view.activity.value);
  const shopping = selectedCharacterId.value === view.id;
  return (
    <article class="ab-card app__stack">
      <div class="app__field-head">
        <span class="ab-title">{view.name}</span>
        <span class="ab-level">Lv <b>{view.level}</b></span>
      </div>
      <p class="app__field-help ab-c-muted">{stateLine(view)}</p>
      {here && (
        <div class="app__transfer">
          <button type="button" class="ab-btn" disabled={shopping} onClick={() => selectCharacter(view.id)}>
            {shopping ? 'Shopping' : 'Shop as'}
          </button>
          <a class="ab-btn ab-btn--primary" href={hrefFor('farm')} onClick={() => selectCharacter(view.id)}>Send out</a>
        </div>
      )}
    </article>
  );
}

export function City() {
  const views = roster.value;
  const inTown = views.filter((view) => inCity(view.activity.value) || view.activity.value === 'dead');
  const tab = warehouseTabs.value[0]?.value;
  const used = tab === undefined ? 0 : usedCells(tab.items, itemInfo);
  const shopper = views.find((view) => view.id === selectedCharacterId.value);
  return (
    <section class="app__stack">
      <header class="app__section-head">
        <span class="ab-ornament" aria-hidden="true" />
        <h2 class="ab-label app__section-title">In the city</h2>
        <span class="ab-label app__section-count">{inTown.length} of {views.length}</span>
      </header>
      {inTown.length === 0 && <p class="app__text ab-c-muted">Everyone is out farming.</p>}
      {inTown.map((view) => <CityRow key={view.id} view={view} />)}
      <header class="app__section-head">
        <h2 class="ab-label app__section-title">Shops</h2>
        {shopper !== undefined && <span class="ab-label app__section-count">Shopping as {shopper.name}</span>}
      </header>
      {listShops().map((shop) => (
        <button type="button" key={shop.id} class="ab-card app__area" onClick={() => openShop(shop.id)}>
          <span class="app__area-top">
            <Icon name="shop" />
            <span class="ab-title">{shop.name}</span>
          </span>
          <span class="app__field-help ab-c-muted">{shop.purpose}</span>
        </button>
      ))}
      {shopper !== undefined && (
        <div class="ab-card app__field-head">
          <span class="app__target-body app__grow">
            <span class="ab-label">Restock on return</span>
            <span class="app__field-help ab-c-muted">{restockLine(shopper)}</span>
          </span>
          <button type="button" class="ab-btn ab-btn--sm" onClick={() => openSettings(shopper.id)}>Edit</button>
        </div>
      )}
      <button type="button" class="ab-card app__area" onClick={openWarehouse}>
        <span class="app__area-top">
          <Icon name="warehouse" />
          <span class="ab-title">Warehouse</span>
        </span>
        <span class="app__field-help ab-c-muted">{used}/{tab?.cells ?? 0} slots · shared</span>
      </button>
    </section>
  );
}
