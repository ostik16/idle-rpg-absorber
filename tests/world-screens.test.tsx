// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { Command } from '../src/engine/commands';
import { App } from '../src/ui/App';
import { closeArea, closeCharacter, connectEngine, openArea, openCharacter, route } from '../src/ui/store';

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
  closeCharacter();
  route.value = 'roster';
});

describe('world screens', () => {
  it('sends a character to an area with the chosen target and shows the multiplier', async () => {
    const dispatch = setup();
    route.value = 'world';
    openArea('mossfang-glade');
    render(<App />, host);
    expect(host.textContent).toContain('Targeting ×2');
    const radios = host.querySelectorAll<HTMLInputElement>('input[type=radio]');
    radios[1]?.click();
    await new Promise((resolve) => setTimeout(resolve));
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send Kaela')?.click();
    expect(dispatch.mock.calls.map(([c]) => c)).toEqual([
      { type: 'sendToArea', characterId: 'c1', areaId: 'mossfang-glade' },
      { type: 'setTarget', characterId: 'c1', enemyId: 'glade-rat' },
    ]);
  });

  it('shows the respawn health from data on a fallen character', () => {
    setup('dead');
    openCharacter('c1');
    render(<App />, host);
    expect(host.textContent).toContain('Respawns with10%');
    expect(host.textContent).toContain('heals to full before farming');
  });

  it('shows a fleeing character as Fleeing', () => {
    setup('fleeing');
    openCharacter('c1');
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
    openCharacter('c1');
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
