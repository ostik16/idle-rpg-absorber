// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import type { Command } from '../src/engine/commands';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { CharacterSettings } from '../src/state/types';
import { App } from '../src/ui/App';
import { closeSettings, connectEngine, openSettings, route, settingsCharacterId } from '../src/ui/store';

const data = loadGameData();
const host = document.createElement('div');
document.body.append(host);

function setup(settings: Partial<CharacterSettings> = {}) {
  const state = createGameState(7, 1_000_000, data);
  const character = createCharacterState('c1', 'Kaela', data);
  character.phase = 'idle';
  Object.assign(character.settings, settings);
  state.roster.push(character);
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

function open() {
  openSettings('c1');
  render(<App />, host);
}

afterEach(() => {
  render(null, host);
  closeSettings();
  route.value = 'farm';
});

describe('settings screen', () => {
  it('titles the screen with the character and shows data-driven rows', () => {
    setup();
    open();
    expect(host.querySelector('.app__pushed-title')?.textContent).toBe('Kaela · settings');
    expect(host.textContent).toContain('Heads back when health drops below 20%.');
    expect(host.textContent).toContain('Minor health potion');
    expect(host.textContent).toContain('Swift draught');
    expect(host.textContent).toContain('Potions down to 65%, then regeneration');
  });

  it('sends the return threshold as a fraction', async () => {
    const dispatch = setup();
    open();
    await click('button', 'Raise return threshold');
    expect(sent(dispatch)).toEqual([{ type: 'setReturnHealthThreshold', characterId: 'c1', threshold: 0.25 }]);
  });

  it('sends the city healing mode', async () => {
    const dispatch = setup();
    open();
    await click('[role=tab]', 'Slow');
    expect(sent(dispatch)).toEqual([{ type: 'setCityHealing', characterId: 'c1', mode: 'slow' }]);
  });

  it('sends the whole restock list, keeping its order and adding a new potion at the end', async () => {
    const dispatch = setup();
    open();
    await click('button', 'Raise Minor health potion restock');
    await click('button', 'Raise Swift draught restock');
    expect(sent(dispatch)).toEqual([
      { type: 'setRestockList', characterId: 'c1', list: [{ itemId: 'minor-health-potion', quantity: 11 }] },
      { type: 'setRestockList', characterId: 'c1', list: [{ itemId: 'minor-health-potion', quantity: 10 }, { itemId: 'swift-draught', quantity: 1 }] },
    ]);
  });

  it('sends a potion drink-at threshold, and null to go back to the default', async () => {
    const dispatch = setup({ potionThresholds: { 'lesser-health-potion': 0.5 } });
    open();
    expect(host.textContent).toContain('Drink at (default)');
    await click('button', 'Raise Minor health potion drink-at');
    await click('button', 'Use the default drink-at for Lesser health potion');
    expect(sent(dispatch)).toEqual([
      { type: 'setPotionThreshold', characterId: 'c1', itemId: 'minor-health-potion', threshold: 0.45 },
      { type: 'setPotionThreshold', characterId: 'c1', itemId: 'lesser-health-potion', threshold: null },
    ]);
  });

  it('turns the loot filter on and off without losing its ticks', async () => {
    const dispatch = setup({ lootFilter: { enabled: false, rules: [{ category: 'rare' }] } });
    open();
    expect(host.textContent).toContain('Picks up everything.');
    await click('[role=switch]', 'Loot filter');
    expect(sent(dispatch)).toEqual([{ type: 'setLootFilter', characterId: 'c1', lootFilter: { enabled: true, rules: [{ category: 'rare' }] } }]);
  });

  it('ticks a category into a rule and sets the equipment level', async () => {
    const dispatch = setup({ lootFilter: { enabled: true, rules: [{ category: 'rare' }] } });
    open();
    expect(host.textContent).toContain('Rare items.');
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(boxes.slice(0, 5).map((box) => box.checked)).toEqual([false, false, true, false, false]);
    boxes[0]?.click();
    await flush();
    expect(sent(dispatch)).toEqual([
      { type: 'setLootFilter', characterId: 'c1', lootFilter: { enabled: true, rules: [{ category: 'equipment', minRequiredLevel: 1 }, { category: 'rare' }] } },
    ]);
  });

  it('edits auto-sell with the same editor', async () => {
    const dispatch = setup({ autoSell: { enabled: true, rules: [{ category: 'equipment', minRequiredLevel: 3 }] } });
    open();
    expect(host.textContent).toContain('Equipment Lv 3+.');
    await click('button', 'Raise equipment required level');
    await click('button', 'Lower equipment required level');
    expect(sent(dispatch)).toEqual([
      { type: 'setAutoSell', characterId: 'c1', autoSell: { enabled: true, rules: [{ category: 'equipment', minRequiredLevel: 4 }] } },
      { type: 'setAutoSell', characterId: 'c1', autoSell: { enabled: true, rules: [{ category: 'equipment', minRequiredLevel: 2 }] } },
    ]);
  });

  it('greys the rows while a rule set is off', () => {
    setup({ autoSell: { enabled: false, rules: [] } });
    open();
    expect(host.textContent).toContain('Sells nothing.');
    const section = host.querySelector('[aria-labelledby="auto-sell-h"]') as HTMLElement;
    expect([...section.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every((box) => box.disabled)).toBe(true);
  });

  it('opens from the Gear tab and from the city card, and closes on a tab tap', async () => {
    setup();
    route.value = 'character';
    render(<App />, host);
    await click('[role=tab]', 'Gear');
    await click('button', 'Loot filter');
    expect(settingsCharacterId.value).toBe('c1');
    await click('a.ab-tab', 'Character');
    expect(settingsCharacterId.value).toBeNull();
    route.value = 'city';
    await flush();
    expect(host.textContent).toContain('Minor health potion to 10.');
    await click('button', 'Edit');
    expect(settingsCharacterId.value).toBe('c1');
  });
});
