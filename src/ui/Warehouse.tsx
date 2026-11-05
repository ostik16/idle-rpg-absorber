import { useState } from 'preact/hooks';
import { usedCells } from '../game/inventory';
import { inCity } from './format';
import { BagGrid } from './ItemSlot';
import { itemInfo, selectedCharacter, send, warehouseTabs } from './store';

const TAB = 0; // One tab on the phone; buying more is a later pass (decisions L13).

/** Toggles `index` in a copy of `set`. */
const flip = (set: ReadonlySet<number>, index: number): Set<number> => {
  const next = new Set(set);
  if (!next.delete(index)) next.add(index);
  return next;
};

export function Warehouse() {
  const view = selectedCharacter.value;
  const tab = warehouseTabs.value[TAB]?.value;
  const [bagPicked, setBagPicked] = useState<ReadonlySet<number>>(new Set());
  const [whPicked, setWhPicked] = useState<ReadonlySet<number>>(new Set());
  if (view === null || tab === undefined) return null;

  const bag = view.bag.value;
  const here = inCity(view.activity.value);
  const fromBag = [...bagPicked].filter((i) => bag[i] !== undefined).sort((a, b) => b - a);
  const fromWarehouse = [...whPicked].filter((i) => tab.items[i] !== undefined).sort((a, b) => b - a);
  // Highest index first: moving a stack shifts the ones after it.
  const deposit = () => {
    for (const i of fromBag) send({ type: 'warehouseDeposit', characterId: view.id, bagIndex: i, tabIndex: TAB, qty: bag[i]?.qty ?? 1 }, { saveAfter: true });
    setBagPicked(new Set());
  };
  const withdraw = () => {
    for (const i of fromWarehouse) send({ type: 'warehouseWithdraw', characterId: view.id, tabIndex: TAB, stackIndex: i, qty: tab.items[i]?.qty ?? 1 }, { saveAfter: true });
    setWhPicked(new Set());
  };
  // Picking on one side clears the other: only the button for the picked side is live.
  const pickBag = (i: number) => { setBagPicked(flip(bagPicked, i)); setWhPicked(new Set()); };
  const pickWarehouse = (i: number) => { setWhPicked(flip(whPicked, i)); setBagPicked(new Set()); };

  return (
    <section class="app__stack">
      {!here && <p class="app__field-help ab-c-warning">{view.name} has to be in the city to use the warehouse.</p>}
      <section class="ab-card app__stack" aria-labelledby="wb-h">
        <div class="app__field-head">
          <h2 id="wb-h" class="ab-label app__grow">{view.name}'s bag</h2>
          <span class="ab-num">{view.bagUsedCells.value}/{view.bagCapacity.value}</span>
        </div>
        <BagGrid label={`${view.name}'s bag`} stacks={bag} capacity={view.bagCapacity.value} used={view.bagUsedCells.value} selected={bagPicked} onToggle={pickBag} />
        <p class="app__field-help ab-c-muted">
          Bag max stack {view.bagMaxStack.value}{view.equipment.value['backpack'] === undefined ? ', no backpack' : ''}. The warehouse stacks to 100.
        </p>
      </section>
      <div class="app__transfer">
        <button type="button" class={`ab-btn${fromBag.length > 0 ? ' ab-btn--primary' : ''}`} disabled={!here || fromBag.length === 0} onClick={deposit}>
          To warehouse ↓ {fromBag.length > 0 && fromBag.length}
        </button>
        <button type="button" class={`ab-btn${fromWarehouse.length > 0 ? ' ab-btn--primary' : ''}`} disabled={!here || fromWarehouse.length === 0} onClick={withdraw}>
          To bag ↑ {fromWarehouse.length > 0 && fromWarehouse.length}
        </button>
      </div>
      <section class="ab-card app__stack" aria-labelledby="wh-h">
        <div class="app__field-head">
          <h2 id="wh-h" class="ab-label app__grow">Warehouse · tab 1 · shared</h2>
          <span class="ab-num">{usedCells(tab.items, itemInfo)}/{tab.cells}</span>
        </div>
        <BagGrid label="Warehouse" stacks={tab.items} capacity={tab.cells} used={usedCells(tab.items, itemInfo)} selected={whPicked} onToggle={pickWarehouse} />
      </section>
    </section>
  );
}
