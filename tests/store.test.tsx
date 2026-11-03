// @vitest-environment happy-dom
import { options, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import constants from '../data/constants.json';
import { loadGameData } from '../src/data/game-data';
import { createEngine, type Engine } from '../src/engine/engine';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { CharacterState, GameState } from '../src/state/types';
import { App } from '../src/ui/App';
import { LiveRoster } from '../src/ui/LiveRoster';
import { connectEngine, notice, roster, send, warehouseTabs } from '../src/ui/store';

const T0 = 1_000_000;
const TICK = constants.combat.tickMs;
const data = loadGameData();

function gameWith(...names: string[]): GameState {
  const state = createGameState(7, T0, data);
  names.forEach((name, i) => state.roster.push(createCharacterState(`c${i + 1}`, name, data)));
  return state;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function step(engine: Engine, refresh: () => void): void {
  engine.advanceTo(engine.state.clock.lastSimulatedAt + TICK);
  refresh();
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

/** Mutation records and component renders caused by `change`. */
async function observe(change: () => void) {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(host, { subtree: true, characterData: true, childList: true, attributes: true });
  let diffs = 0;
  const previous = options.diffed;
  options.diffed = (vnode) => {
    if (typeof vnode.type === 'function') diffs += 1;
    previous?.(vnode);
  };
  change();
  await new Promise((resolve) => setTimeout(resolve));
  records.push(...observer.takeRecords());
  observer.disconnect();
  options.diffed = previous;
  return { records, diffs };
}

function healthTextNode(row: number): Text {
  const stat = host.querySelectorAll('.ab-char')[row]?.querySelectorAll('.ab-char__stat')[1];
  return stat?.querySelector('b')?.firstChild as Text;
}

describe('live numbers (ADR 0001)', () => {
  it("changing one character's health updates one text node, not the component tree", async () => {
    const state = gameWith('Ysolde', 'Brann');
    const refresh = connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<LiveRoster />, host);

    const target = healthTextNode(0);
    const other = healthTextNode(1);
    const otherText = other.data;
    const rows = [...host.querySelectorAll('.ab-char')];
    const character = state.roster[0] as CharacterState;
    character.health -= 5;
    const expected = String(Math.ceil(character.health));

    const { records, diffs } = await observe(refresh);

    expect(records).toHaveLength(1);
    expect(records[0]?.type).toBe('characterData');
    expect(records[0]?.target).toBe(target);
    expect(target.data).toBe(expected);
    expect(diffs).toBe(0);

    expect(healthTextNode(0)).toBe(target);
    expect(other.data).toBe(otherText);
    expect([...host.querySelectorAll('.ab-char')]).toEqual(rows);
  });

  it('touches nothing when no shown value changed', async () => {
    const state = gameWith('Ysolde');
    const refresh = connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<LiveRoster />, host);
    (state.roster[0] as CharacterState).health -= 0.0001;
    const { records, diffs } = await observe(refresh);
    expect(records).toHaveLength(0);
    expect(diffs).toBe(0);
  });

  it('keeps the same list and bag signals values until their contents change', () => {
    const state = gameWith('Ysolde');
    const refresh = connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    const views = roster.value;
    const tab = warehouseTabs.value[0];
    const tabValue = tab?.value;
    const view = views[0];
    const bag = view?.bag.value;

    refresh();
    expect(roster.value).toBe(views);
    expect(view?.bag.value).toBe(bag);
    expect(warehouseTabs.value[0]?.value).toBe(tabValue);

    (state.roster[0] as CharacterState).bag.push({ itemId: 'x', bonuses: [], upgradeLevel: 0, qty: 1 });
    state.account.warehouse.tabs[0]?.items.push({ itemId: 'y', bonuses: [], upgradeLevel: 0, qty: 2 });
    refresh();
    expect(roster.value).toBe(views);
    expect(view?.bag.value).not.toBe(bag);
    expect(view?.bag.value.at(-1)?.itemId).toBe('x');
    expect(warehouseTabs.value[0]?.value.items[0]?.itemId).toBe('y');
  });
});

describe('the UI only sends commands (ADR 0001)', () => {
  it('renders, takes input and refreshes over deep-frozen state, which would throw on any write', async () => {
    const state = deepFreeze(gameWith('Ysolde'));
    const dispatch = vi.fn();
    const refresh = connectEngine({ state, dispatch, drainEvents: () => [] }, data);
    render(<App />, host);

    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'Brann';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    refresh();

    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'createCharacter', name: 'Brann' });
    expect(state.roster).toHaveLength(1);
  });

  it('gives the UI copies: writing to a view does not reach state', () => {
    const state = gameWith('Ysolde');
    const before = JSON.stringify(state);
    connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);

    const bag = roster.value[0]?.bag.value as unknown as { qty: number }[];
    if (bag[0]) bag[0].qty = 999;
    (warehouseTabs.value[0]?.value.items as unknown[]).push('junk');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('a command reaches state only through the engine, at the next step', () => {
    const engine = createEngine({ data, state: createGameState(7, T0, data) });
    const refresh = connectEngine(engine, data);
    send({ type: 'createCharacter', name: 'Ysolde' });
    refresh();
    expect(engine.state.roster).toHaveLength(0);
    expect(roster.value).toHaveLength(0);

    step(engine, refresh);
    expect(roster.value.map((view) => view.name)).toEqual(['Ysolde']);
  });

  it('shows a refused command as a notice, and the next command clears it', () => {
    const engine = createEngine({ data, state: createGameState(7, T0, data) });
    const refresh = connectEngine(engine, data);
    send({ type: 'createCharacter', name: '' });
    step(engine, refresh);
    expect(notice.value).toEqual(expect.any(String));
    expect(engine.state.roster).toHaveLength(0);

    send({ type: 'createCharacter', name: 'Ysolde' });
    expect(notice.value).toBeNull();
  });

  it('shows a one-line notice when the clock goes backwards (ADR 0002)', () => {
    const engine = createEngine({ data, state: createGameState(7, T0, data) });
    const refresh = connectEngine(engine, data);
    engine.advanceTo(T0 - 5000);
    refresh();
    expect(notice.value).toBe('Clock moved back. No time was added.');
  });
});
