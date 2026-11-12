// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import type { Command } from '../src/engine/commands';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { ItemStack } from '../src/state/types';
import { App } from '../src/ui/App';
import { closeShop, closeWarehouse, connectEngine, openShop, openWarehouse, route } from '../src/ui/store';

const data = loadGameData();
const host = document.createElement('div');
document.body.append(host);
const stack = (itemId: string, qty = 1): ItemStack => ({ itemId, bonuses: [], upgradeLevel: 0, qty });

function setup(bag: ItemStack[] = [], phase: 'idle' | 'searching' | 'dead' = 'idle') {
  const state = createGameState(7, 1_000_000, data);
  const character = createCharacterState('c1', 'Kaela', data);
  character.bag = bag;
  character.gold = 500;
  character.phase = phase;
  state.roster.push(character);
  state.account.warehouse.tabs[0]?.items.push(stack('hide-scrap', 5));
  const dispatch = vi.fn<(command: Command) => void>();
  connectEngine({ state, dispatch, drainEvents: () => [] }, data);
  return dispatch;
}

const flush = () => new Promise((resolve) => setTimeout(resolve));
const click = async (selector: string, text?: string) => {
  const found = [...host.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || el.textContent?.includes(text) || el.getAttribute('aria-label')?.includes(text));
  expect(found, `${selector} ${text}`).toBeDefined();
  found?.click();
  await flush();
};
const sent = (dispatch: ReturnType<typeof setup>) => dispatch.mock.calls.map(([c]) => c);

afterEach(() => {
  render(null, host);
  closeShop();
  closeWarehouse();
  route.value = 'farm';
});

describe('city, shop, warehouse and gear screens', () => {
  it('lists shops from data and the warehouse on the city screen', () => {
    setup();
    route.value = 'city';
    render(<App />, host);
    expect(host.textContent).toContain('General store');
    expect(host.textContent).toContain('Alchemist');
    expect(host.textContent).toMatch(/\d+\/56 slots · shared/);
  });

  it('buys the chosen quantity', async () => {
    const dispatch = setup();
    openShop('alchemist');
    render(<App />, host);
    await click('button', 'One more Minor health potion');
    await click('button', 'One more Minor health potion');
    expect(host.textContent).toContain('Buy · 24');
    await click('button', 'Buy ·');
    expect(sent(dispatch)).toEqual([{ type: 'buyItem', characterId: 'c1', shopId: 'alchemist', itemId: 'minor-health-potion', qty: 2 }]);
  });

  it('out of the city, shows a banner with a call-back, keeps browsing, and disables Buy (#72)', async () => {
    const dispatch = setup([], 'searching');
    openShop('alchemist');
    render(<App />, host);
    expect(host.textContent).toContain('is not in the city. Travel there to buy.');
    await click('button', 'One more Minor health potion'); // building the list stays allowed
    expect(host.textContent).toContain('Buy ·');
    const buy = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Buy ·')) as HTMLButtonElement;
    expect(buy.disabled).toBe(true);
    await click('button', 'Call Kaela back');
    expect(sent(dispatch)).toEqual([{ type: 'returnToCity', characterId: 'c1' }]);
  });

  it('sells selected stacks, highest bag slot first', async () => {
    const dispatch = setup([stack('rusty-sword'), stack('minor-health-potion', 4)]);
    openShop('alchemist');
    render(<App />, host);
    await click('[role=tab]', 'Sell');
    await click('button.ab-slot', 'Rusty sword');
    await click('button.ab-slot', 'Minor health potion');
    await click('button', 'Sell ·');
    expect(sent(dispatch)).toEqual([
      { type: 'sellItem', characterId: 'c1', bagIndex: 1, qty: 4 },
      { type: 'sellItem', characterId: 'c1', bagIndex: 0, qty: 1 },
    ]);
  });

  it('moves a bag stack to the warehouse and a warehouse stack to the bag', async () => {
    const dispatch = setup([stack('minor-health-potion', 4)]);
    openWarehouse();
    render(<App />, host);
    await click('button.ab-slot', 'Minor health potion');
    await click('button', 'To warehouse');
    await click('button.ab-slot', 'Hide scrap');
    await click('button', 'To bag');
    expect(sent(dispatch)).toEqual([
      { type: 'warehouseDeposit', characterId: 'c1', bagIndex: 0, tabIndex: 0, qty: 4 },
      { type: 'warehouseWithdraw', characterId: 'c1', tabIndex: 0, stackIndex: 0, qty: 5 },
    ]);
  });

  it('equips from the bag via the item sheet (#71)', async () => {
    const dispatch = setup([stack('rusty-sword')]);
    route.value = 'character';
    render(<App />, host);
    await click('[role=tab]', 'Inventory');
    await click('button.ab-slot', 'Rusty sword');
    await click('.ab-sheet button', 'Equip in Main hand');
    expect(sent(dispatch)).toEqual([{ type: 'equipItem', characterId: 'c1', bagIndex: 0, slot: 'main-hand' }]);
  });

  it('allows gear changes while out farming (#71)', async () => {
    const dispatch = setup([stack('rusty-sword')], 'searching');
    route.value = 'character';
    render(<App />, host);
    await click('[role=tab]', 'Inventory');
    await click('button.ab-slot', 'Rusty sword');
    expect((host.querySelector('.ab-sheet button.ab-btn--primary') as HTMLButtonElement).disabled).toBe(false);
    await click('.ab-sheet button', 'Equip in Main hand');
    expect(sent(dispatch)).toEqual([{ type: 'equipItem', characterId: 'c1', bagIndex: 0, slot: 'main-hand' }]);
  });

  it('disables equipping only while dead (#71)', async () => {
    setup([stack('rusty-sword')], 'dead');
    route.value = 'character';
    render(<App />, host);
    await click('[role=tab]', 'Inventory');
    await click('button.ab-slot', 'Rusty sword');
    expect((host.querySelector('.ab-sheet button.ab-btn--primary') as HTMLButtonElement).disabled).toBe(true);
  });
});
