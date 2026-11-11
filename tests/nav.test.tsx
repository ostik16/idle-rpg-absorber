// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import type { Command } from '../src/engine/commands';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { CharacterState } from '../src/state/types';
import { App } from '../src/ui/App';
import { locationLabel } from '../src/ui/format';
import {
  closePushed,
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
  creationOpen,
  openCreation,
  selectCharacter,
  startRouteSync,
} from '../src/ui/store';

const data = loadGameData();
const host = document.createElement('div');
document.body.append(host);
const flush = () => new Promise((resolve) => setTimeout(resolve));

function setup(names: string[] = ['Kaela']) {
  const state = createGameState(7, 1_000_000, data);
  names.forEach((name, i) => state.roster.push(createCharacterState(`c${i + 1}`, name, data)));
  for (const character of state.roster) (character as CharacterState).gold = 500;
  state.account.unlockedSlots = 3;
  const dispatch = vi.fn<(command: Command) => void>();
  connectEngine({ state, dispatch, drainEvents: () => [] }, data);
}

const tab = (name: string) => [...host.querySelectorAll<HTMLAnchorElement>('nav.ab-tabbar a.ab-tab')].find((a) => a.textContent?.trim() === name) as HTMLAnchorElement;

/** What the browser does on a link tap or the back button: the hash changes and `hashchange` fires. */
const navigate = async (hash: string) => {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await flush();
};
const tapTab = async (name: string) => {
  const link = tab(name);
  link.click();
  await navigate(link.getAttribute('href') as string);
};

let stopSync: () => void = () => {};
afterEach(() => {
  stopSync();
  render(null, host);
  closePushed();
  closeDeleteConfirm();
  route.value = 'farm';
  window.location.hash = '';
});

const PUSHED = [
  ['shop', () => openShop('alchemist'), () => openShopId.value !== null],
  ['warehouse', () => openWarehouse(), () => warehouseOpen.value],
  ['settings', () => openSettings('c1'), () => settingsCharacterId.value !== null],
  ['creation', () => openCreation(), () => creationOpen.value],
] as const;

describe('navigation', () => {
  it('has the Farm, City, Character and Bestiary tabs and no Roster', () => {
    setup();
    render(<App />, host);
    expect([...host.querySelectorAll('nav.ab-tabbar a.ab-tab')].map((a) => a.textContent?.trim())).toEqual(['Farm', 'City', 'Character', 'Bestiary']);
  });

  it('shows only the switcher in the app bar, with the page heading for screen readers', () => {
    setup();
    render(<App />, host);
    const bar = host.querySelector('.ab-appbar') as HTMLElement;
    expect(bar.querySelectorAll('button')).toHaveLength(1);
    expect(bar.textContent).toContain('Kaela');
    expect(bar.textContent).toContain('City');
    expect(bar.querySelector('.ab-gold')).toBeNull();
    expect(host.querySelector('h1')?.textContent).toBe('Farm');
  });

  it.each(PUSHED)('a tap on another tab closes the pushed %s and shows that tab', async (_name, open, isOpen) => {
    setup();
    stopSync = startRouteSync();
    await navigate('#/city');
    open();
    render(<App />, host);
    await flush();
    expect(isOpen()).toBe(true);
    await tapTab('Character');
    expect(isOpen()).toBe(false);
    expect(route.value).toBe('character');
    expect(host.textContent).toContain('Delete Kaela');
  });

  it.each(PUSHED)('a tap on the active tab returns from the pushed %s to its root', async (_name, open, isOpen) => {
    setup();
    stopSync = startRouteSync();
    await navigate('#/city');
    open();
    render(<App />, host);
    await flush();
    expect(isOpen()).toBe(true);
    await tapTab('City');
    expect(isOpen()).toBe(false);
    expect(route.value).toBe('city');
    expect(host.textContent).toContain('General store');
  });

  it('closes a pushed screen when the route changes without a tab tap (back button, in-content link)', async () => {
    setup();
    stopSync = startRouteSync();
    await navigate('#/city');
    openShop('alchemist');
    render(<App />, host);
    await flush();
    await navigate('#/farm');
    expect(openShopId.value).toBeNull();
    expect(host.textContent).toContain('Drop rates and travel times for Kaela');
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
    stopSync = startRouteSync();
    await navigate('#/city');
    openShop('alchemist');
    render(<App />, host);
    [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'One more Minor health potion')?.click();
    await flush();
    await tapTab('Farm');
    expect(openShopId.value).toBeNull();
    expect(shoppingList.value).toEqual({ 'minor-health-potion': 1 });
    await navigate('#/city');
    openShop('alchemist');
    await flush();
    expect(host.textContent).toContain('Buy · 12');
  });

  it('starts another character with an empty shopping list', async () => {
    setup(['Kaela', 'Brann']);
    openShop('alchemist');
    render(<App />, host);
    [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'One more Minor health potion')?.click();
    await flush();
    expect(shoppingList.value).toEqual({ 'minor-health-potion': 1 });
    selectCharacter('c1');
    expect(shoppingList.value).toEqual({ 'minor-health-potion': 1 });
    selectCharacter('c2');
    await flush();
    expect(shoppingList.value).toEqual({});
    expect(host.textContent).toContain('Nothing chosen yet');
  });
});

describe('switcher sheet', () => {
  it('moves focus into the sheet and back to the trigger on Escape, and wraps Tab', async () => {
    setup();
    render(<App />, host);
    const trigger = host.querySelector('.app__who') as HTMLButtonElement;
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 150)); // Preact runs effects after the next frame.
    const sheet = host.querySelector('[role=dialog]') as HTMLElement;
    expect(document.activeElement).toBe(sheet);
    const buttons = sheet.querySelectorAll('button');
    (buttons[buttons.length - 1] as HTMLElement).focus();
    const tabKey = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    sheet.dispatchEvent(tabKey);
    expect(tabKey.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(host.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
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
