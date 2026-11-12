import { useState } from 'preact/hooks';
import { formatGold, inCity } from './format';
import { Icon } from './Icon';
import { BagGrid } from './ItemSlot';
import { clearShoppingList, itemInfo, listShops, openShopId, selectedCharacter, send, setShoppingQty, shoppingList, shopItems } from './store';

export function Shop() {
  const view = selectedCharacter.value;
  const shop = listShops().find((row) => row.id === openShopId.value);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const qty = shoppingList.value;
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  if (view === null || shop === undefined) return null;

  const bag = view.bag.value;
  const here = inCity(view.activity.value);
  const dead = view.activity.value === 'dead';
  const headingBack = view.activity.value === 'fleeing' || view.activity.value === 'returning';
  const stock = shopItems(shop.id);
  const chosen = stock.filter((row) => (qty[row.itemId] ?? 0) > 0);
  const items = chosen.reduce((sum, row) => sum + (qty[row.itemId] ?? 0), 0);
  const cost = chosen.reduce((sum, row) => sum + row.price * (qty[row.itemId] ?? 0), 0);
  const sold = [...picked].filter((i) => bag[i] !== undefined).sort((a, b) => a - b);
  const proceeds = sold.reduce((sum, i) => sum + itemInfo(bag[i]?.itemId ?? '').sellPrice * (bag[i]?.qty ?? 0), 0);
  const held = (itemId: string) => bag.filter((s) => s.itemId === itemId).reduce((sum, s) => sum + s.qty, 0);

  const buy = () => {
    for (const row of chosen) send({ type: 'buyItem', characterId: view.id, shopId: shop.id, itemId: row.itemId, qty: qty[row.itemId] ?? 0 }, { saveAfter: true });
    clearShoppingList();
  };
  // Highest index first: selling a stack shifts the ones after it.
  const sell = () => {
    for (const i of [...sold].reverse()) send({ type: 'sellItem', characterId: view.id, bagIndex: i, qty: bag[i]?.qty ?? 1 }, { saveAfter: true });
    setPicked(new Set());
  };
  const toggle = (i: number) => {
    const next = new Set(picked);
    if (!next.delete(i)) next.add(i);
    setPicked(next);
  };

  return (
    <section class="app__stack">
      <div class="app__field-head">
        <span class="app__field-help ab-c-muted app__grow">{shop.purpose}. Bag stacks to {view.bagMaxStack.value}.</span>
      </div>
      <div class="app__field-head">
        <span class="ab-title">{view.name}</span>
        <span class="app__field-help ab-c-muted app__grow">Lv {view.level.value} · bag {view.bagUsedCells.value}/{view.bagCapacity.value}</span>
        <span class="ab-c-gold ab-num"><Icon name="gold" size={14} /> {formatGold(view.gold.value)}</span>
      </div>
      {!here && (
        <div class="ab-card app__stack">
          <p class="app__field-help ab-c-warning">{view.name} is not in the city. Travel there to buy.</p>
          {dead ? (
            <p class="app__field-help ab-c-muted">{view.name} is dead and will wait in the city.</p>
          ) : headingBack ? (
            <p class="app__field-help ab-c-muted">On the way back now.</p>
          ) : (
            <button type="button" class="ab-btn ab-btn--block" onClick={() => send({ type: 'returnToCity', characterId: view.id })}>
              <Icon name="returnToCity" size={16} /> Call {view.name} back
            </button>
          )}
        </div>
      )}
      <div class="ab-seg" role="tablist" aria-label="Shop view">
        <button type="button" role="tab" class="ab-seg__item" aria-selected={tab === 'buy'} onClick={() => setTab('buy')}>Buy</button>
        <button type="button" role="tab" class="ab-seg__item" aria-selected={tab === 'sell'} onClick={() => setTab('sell')}>Sell</button>
      </div>
      {tab === 'buy' ? (
        <>
          {stock.map((row) => {
            const info = itemInfo(row.itemId);
            const n = qty[row.itemId] ?? 0;
            const has = held(row.itemId);
            return (
              <div class="ab-card app__shop-row" key={row.itemId}>
                <span class="ab-slot" aria-hidden="true"><Icon name={info.icon} /></span>
                <span class="app__target-body">
                  <span class="ab-num">{info.name}</span>
                  <span class="app__field-help ab-c-muted">{formatGold(row.price)} each{has > 0 ? ` · ${view.name} has ${has}` : ''}</span>
                </span>
                <span class="app__stepper">
                  <button type="button" class="ab-btn ab-btn--icon" aria-label={`One fewer ${info.name}`} disabled={n === 0} onClick={() => setShoppingQty(row.itemId, n - 1)}>−</button>
                  <span class="ab-num" aria-live="polite">{n}</span>
                  <button type="button" class="ab-btn ab-btn--icon" aria-label={`One more ${info.name}`} onClick={() => setShoppingQty(row.itemId, n + 1)}>+</button>
                </span>
              </div>
            );
          })}
          <div class="ab-card app__stack app__bar-bottom">
            <span class="app__field-help ab-c-muted">
              {items === 0 ? 'Nothing chosen yet' : `${items} ${items === 1 ? 'item' : 'items'} · gold after ${formatGold(view.gold.value - cost)}`}
            </span>
            <button type="button" class="ab-btn ab-btn--primary ab-btn--block" disabled={!here || items === 0 || cost > view.gold.value} onClick={buy}>Buy · {formatGold(cost)}</button>
          </div>
        </>
      ) : (
        <>
          <section class="ab-card app__stack" aria-labelledby="sell-h">
            <h2 id="sell-h" class="ab-label">{view.name}'s bag</h2>
            <p class="app__field-help ab-c-muted">Tap items to sell. A stack sells whole.</p>
            <BagGrid label={`${view.name}'s bag`} stacks={bag} capacity={view.bagCapacity.value} used={view.bagUsedCells.value} selected={picked} onToggle={toggle} />
          </section>
          <div class="ab-card app__stack app__bar-bottom">
            <span class="app__field-help ab-c-muted">{sold.length === 0 ? 'Select items to sell' : `${sold.length} selected`}</span>
            {sold.map((i) => {
              const stack = bag[i];
              if (stack === undefined) return null;
              const info = itemInfo(stack.itemId);
              return (
                <div class="app__field-head" key={i}>
                  <span class="app__grow">{info.name}{stack.qty > 1 ? ` ×${stack.qty}` : ''}</span>
                  <span class="ab-num ab-c-gold">{formatGold(info.sellPrice * stack.qty)}</span>
                </div>
              );
            })}
            <button type="button" class="ab-btn ab-btn--primary ab-btn--block" disabled={!here || sold.length === 0} onClick={sell}>Sell · {formatGold(proceeds)}</button>
          </div>
        </>
      )}
    </section>
  );
}
