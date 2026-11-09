// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import type { Command } from '../src/engine/commands';
import { createCharacterState, createGameState } from '../src/state/factory';
import { App } from '../src/ui/App';
import { locationLabel } from '../src/ui/format';
import {
  closePushed,
  closeShop,
  closeWarehouse,
  connectEngine,
  openSettings,
  openShop,
  openWarehouse,
  pendingDeleteId,
  closeDeleteConfirm,
  route,
  settingsCharacterId,
  shoppingList,
  warehouseOpen,
  openShopId,
} from '../src/ui/store';

const data = loadGameData();
const host = document.createElement('div');
document.body.append(host);
const flush = () => new Promise((resolve) => setTimeout(resolve));

function setup() {
  const state = createGameState(7, 1_000_000, data);
  const character = createCharacterState('c1', 'Kaela', data);
  character.gold = 500;
  state.roster.push(character);
  const dispatch = vi.fn<(command: Command) => void>();
  connectEngine({ state, dispatch, drainEvents: () => [] }, data);
}

const tab = (name: string) => [...host.querySelectorAll<HTMLAnchorElement>('nav.ab-tabbar a.ab-tab')].find((a) => a.textContent?.trim() === name) as HTMLAnchorElement;

afterEach(() => {
  render(null, host);
  closePushed();
  closeDeleteConfirm();
  route.value = 'farm';
  window.location.hash = '';
});

describe('navigation', () => {
  it('has the Farm, City, Character and Bestiary tabs and no Roster', () => {
    setup();
    render(<App />, host);
    expect([...host.querySelectorAll('nav.ab-tabbar a.ab-tab')].map((a) => a.textContent?.trim())).toEqual(['Farm', 'City', 'Character', 'Bestiary']);
  });

  it('shows only the switcher in the app bar', () => {
    setup();
    render(<App />, host);
    const bar = host.querySelector('.ab-appbar') as HTMLElement;
    expect(bar.querySelectorAll('button')).toHaveLength(1);
    expect(bar.textContent).toContain('Kaela');
    expect(bar.textContent).toContain('City');
    expect(bar.querySelector('.ab-gold')).toBeNull();
  });

  it.each([
    ['shop', () => openShop('alchemist'), () => openShopId.value],
    ['warehouse', () => openWarehouse(), () => warehouseOpen.value],
    ['settings', () => openSettings('c1'), () => settingsCharacterId.value],
  ])('a tab tap closes the pushed %s and an active tab tap returns to its root', async (_name, open, isOpen) => {
    setup();
    route.value = 'city';
    open();
    render(<App />, host);
    await flush();
    expect(isOpen()).toBeTruthy();
    tab('City').click();
    await flush();
    expect(isOpen()).toBeFalsy();
    expect(host.textContent).toContain('General store');
  });

  it('a tap on another tab closes the pushed screen too', async () => {
    setup();
    route.value = 'city';
    openWarehouse();
    render(<App />, host);
    tab('Character').click();
    await flush();
    expect(warehouseOpen.value).toBe(false);
  });

  it('deletes from the Character screen', async () => {
    setup();
    route.value = 'character';
    render(<App />, host);
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Delete Kaela')?.click();
    expect(pendingDeleteId.value).toBe('c1');
  });

  it('keeps the shopping list across a tab switch', async () => {
    setup();
    route.value = 'city';
    openShop('alchemist');
    render(<App />, host);
    [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'One more Minor health potion')?.click();
    await flush();
    tab('Farm').click();
    await flush();
    expect(openShopId.value).toBeNull();
    expect(shoppingList.value).toEqual({ 'minor-health-potion': 1 });
    openShop('alchemist');
    await flush();
    expect(host.textContent).toContain('Buy · 12');
    closeShop();
    closeWarehouse();
  });
});

describe('locationLabel', () => {
  it('names the city, the farming area and the walk', () => {
    expect(locationLabel('idle', null)).toBe('City');
    expect(locationLabel('fighting', 'Mossfang Glade')).toBe('Farming Mossfang Glade');
    expect(locationLabel('travelling', 'Mossfang Glade')).toBe('Travelling to Mossfang Glade');
    expect(locationLabel('returning', 'Mossfang Glade')).toBe('Returning to the city');
  });
});
