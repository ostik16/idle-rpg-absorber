// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { Command } from '../src/engine/commands';
import { App } from '../src/ui/App';
import { closeArea, connectEngine, openArea, route, selectCharacter } from '../src/ui/store';

const data = loadGameData();
const host = document.createElement('div');
document.body.append(host);

function setup(phase?: 'dead' | 'fleeing') {
  const state = createGameState(7, 1_000_000, data);
  const character = createCharacterState('c1', 'Kaela', data);
  if (phase) character.phase = phase;
  state.roster.push(character);
  const dispatch = vi.fn<(command: Command) => void>();
  connectEngine({ state, dispatch, drainEvents: () => [] }, data);
  return dispatch;
}

afterEach(() => {
  render(null, host);
  closeArea();
  route.value = 'farm';
});

describe('farm screens', () => {
  it('sends a character straight to the area, with no target picker (#65)', () => {
    const dispatch = setup();
    route.value = 'farm';
    openArea('mossfang-glade');
    render(<App />, host);
    expect(host.querySelectorAll('input[type=radio]')).toHaveLength(0);
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send Kaela')?.click();
    expect(dispatch.mock.calls.map(([c]) => c)).toEqual([{ type: 'sendToArea', characterId: 'c1', areaId: 'mossfang-glade' }]);
  });

  it('sets a target afterwards from the Farm screen, with the multiplier shown', async () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    character.areaId = 'mossfang-glade';
    character.phase = 'searching';
    state.roster.push(character);
    state.bestiary.kills['c1'] = { 'glade-rat': 50 }; // unlocked for targeting (3.3, A3)
    const dispatch = vi.fn<(command: Command) => void>();
    connectEngine({ state, dispatch, drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Target enemy'))?.click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(host.textContent).toContain('Targeting ×2');
    host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]?.click();
    expect(dispatch.mock.calls.map(([c]) => c)).toEqual([{ type: 'setTarget', characterId: 'c1', enemyId: 'glade-rat' }]);
  });

  it('shows kill progress and disables the radio for a mob not yet unlocked (#67)', async () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    character.areaId = 'mossfang-glade';
    character.phase = 'searching';
    state.roster.push(character);
    state.bestiary.kills['c1'] = { 'glade-rat': 12 };
    const dispatch = vi.fn<(command: Command) => void>();
    connectEngine({ state, dispatch, drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Target enemy'))?.click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(host.textContent).toContain('12 / 50 kills to unlock');
    const locked = host.querySelectorAll<HTMLInputElement>('input[type=radio]')[1];
    expect(locked?.disabled).toBe(true);
    locked?.click();
    expect(dispatch.mock.calls).toHaveLength(0);
  });

  it('shows the exact reason a send is refused next to the button (#65)', () => {
    setup('dead');
    route.value = 'farm';
    openArea('mossfang-glade');
    render(<App />, host);
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Send Kaela')?.disabled).toBe(true);
    expect(host.textContent).toContain('Kaela is dead.');
  });

  it('shows the Now fighting card with the enemy, kills and a health bar (#68)', () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    character.areaId = 'mossfang-glade';
    character.phase = 'fighting';
    character.fight = { enemyId: 'glade-rat', enemyHp: 9, ticks: 0 };
    state.roster.push(character);
    state.bestiary.kills['c1'] = { 'glade-rat': 5 };
    connectEngine({ state, dispatch: vi.fn(), drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    expect(host.textContent).toContain('Now fighting');
    expect(host.textContent).toContain('Glade rat');
    expect(host.textContent).toContain('5 kills');
    const bar = [...host.querySelectorAll('[role=progressbar]')].find((b) => b.getAttribute('aria-label') === 'Glade rat health');
    expect(bar?.getAttribute('aria-valuenow')).toBe('9');
    expect(bar?.getAttribute('aria-valuemax')).toBe('18');
  });

  it('warns on the Farm screen when no potions are left to drink (#68)', () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    character.areaId = 'mossfang-glade';
    character.phase = 'searching';
    character.bag = [];
    state.roster.push(character);
    connectEngine({ state, dispatch: vi.fn(), drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    expect(host.textContent).toContain('No health potions left to drink');
  });

  it('shows the trip progress and destination while travelling (#68)', () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    character.areaId = 'mossfang-glade';
    character.phase = 'travelling';
    state.roster.push(character);
    connectEngine({ state, dispatch: vi.fn(), drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    expect(host.textContent).toContain('Arrives in');
    expect([...host.querySelectorAll('[role=progressbar]')].some((b) => b.getAttribute('aria-label') === 'Arrives in')).toBe(true);
  });

  it('moves the Bestiary onto the Character screen with tiered reveal, and drops the Bestiary nav tab (#69)', async () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    state.roster.push(character);
    state.bestiary.revealed = { 'glade-rat': 2 };
    state.bestiary.kills = { c1: { 'glade-rat': 15 } };
    connectEngine({ state, dispatch: vi.fn(), drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    expect([...host.querySelectorAll('.app__tabbar a')].map((a) => a.textContent)).not.toContain('Bestiary');

    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Bestiary')?.click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(host.textContent).toContain('Glade rat');
    expect(host.textContent).toContain('Health'); // stats revealed at tier 2 (10 kills)
    expect(host.textContent).toContain('25 kills reveal traits'); // next-tier hint
  });

  it('shows absorbed traits and the health-regen rows on the Stats tab (#70)', async () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    character.absorption = { 'life-steal': 3 };
    state.roster.push(character);
    connectEngine({ state, dispatch: vi.fn(), drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Stats'))?.click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(host.textContent).toContain('Absorbed traits');
    expect(host.textContent).toContain('Life steal');
    expect(host.textContent).toContain('of 15.0%'); // cap = highest enemy value
    expect(host.textContent).toContain('From Glade rat');
    expect(host.textContent).toContain('Health regen');
  });

  it('shows a now-absorbing line on the fighting card for a magical trait (#70)', () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    character.areaId = 'mossfang-glade';
    character.phase = 'fighting';
    character.fight = { enemyId: 'glade-rat', enemyHp: 9, ticks: 0 };
    character.absorption = { 'life-steal': 1 };
    state.roster.push(character);
    connectEngine({ state, dispatch: vi.fn(), drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    expect(host.textContent).toContain('Absorbing Life steal');
  });

  it('shows the game version at the bottom of the Character screen (#69)', () => {
    const state = createGameState(7, 1_000_000, data);
    state.roster.push(createCharacterState('c1', 'Kaela', data));
    connectEngine({ state, dispatch: vi.fn(), drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    expect(host.querySelector('.app__version')?.textContent).toMatch(/^Version \d+\.\d+\.\d+$/);
  });

  it('drinks a potion by hand in the city, only when health is short (decisions A1)', async () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    character.health = 5;
    state.roster.push(character);
    const dispatch = vi.fn<(command: Command) => void>();
    connectEngine({ state, dispatch, drainEvents: () => [] }, data);
    selectCharacter('c1');
    route.value = 'character';
    render(<App />, host);
    expect(host.textContent).toContain('10 Minor health potion');
    const drink = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Drink');
    expect(drink?.disabled).toBe(false);
    drink?.click();
    expect(dispatch.mock.calls.map(([c]) => c)).toEqual([{ type: 'drinkPotion', characterId: 'c1', itemId: 'minor-health-potion' }]);
  });

  it('shows the respawn health from data on a fallen character', () => {
    setup('dead');
    route.value = 'character';
    render(<App />, host);
    expect(host.textContent).toContain('Respawns with10%');
    expect(host.textContent).toContain('regenerates there until you send it out again');
  });

  it('shows a fleeing character as Fleeing', () => {
    setup('fleeing');
    route.value = 'character';
    render(<App />, host);
    expect(host.textContent).toContain('Fleeing');
  });

  it('accumulates pending attribute points and dispatches them on Confirm', async () => {
    const state = createGameState(7, 1_000_000, data);
    const character = createCharacterState('c1', 'Kaela', data);
    character.points.characterUnspent = 3;
    state.roster.push(character);
    const dispatch = vi.fn<(command: Command) => void>();
    connectEngine({ state, dispatch, drainEvents: () => [] }, data);
    route.value = 'character';
    render(<App />, host);
    const tick = () => new Promise((resolve) => setTimeout(resolve));
    [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Stats'))?.click();
    await tick();
    const add = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="Add a point to ${name}"]`)?.click();
    add('Strength');
    await tick();
    add('Strength');
    await tick();
    add('Vitality');
    await tick();
    expect(host.textContent).toContain('0 points left');
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Confirm')?.click();
    expect(dispatch.mock.calls.map(([c]) => c)).toEqual([
      { type: 'spendCharacterPoints', characterId: 'c1', attribute: 'strength', amount: 2 },
      { type: 'spendCharacterPoints', characterId: 'c1', attribute: 'vitality', amount: 1 },
    ]);
  });
});
