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

  it('shows the exact reason a send is refused next to the button (#65)', () => {
    setup('dead');
    route.value = 'farm';
    openArea('mossfang-glade');
    render(<App />, host);
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Send Kaela')?.disabled).toBe(true);
    expect(host.textContent).toContain('Kaela is dead.');
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
