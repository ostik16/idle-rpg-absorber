// @vitest-environment happy-dom
import { options, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import constants from '../data/constants.json';
import { loadGameData } from '../src/data/game-data';
import { createEngine, type Engine } from '../src/engine/engine';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { CharacterState, GameState } from '../src/state/types';
import { App } from '../src/ui/App';
import { Roster } from '../src/ui/Roster';
import {
  closeCreation,
  closeDeleteConfirm,
  connectEngine,
  creationOpen,
  lastingNotices,
  notice,
  openCreation,
  openDeleteConfirm,
  roster,
  send,
  showLastingNotices,
  warehouseTabs,
} from '../src/ui/store';

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

function goldTextNode(row: number): Text {
  const stat = host.querySelectorAll('.ab-char')[row]?.querySelector('.ab-char__stat');
  return stat?.querySelector('b')?.firstChild as Text;
}

describe('live numbers (ADR 0001)', () => {
  it("changing one character's gold updates one text node, not the component tree", async () => {
    const state = gameWith('Ysolde', 'Brann');
    const refresh = connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<Roster />, host);

    const target = goldTextNode(0);
    const other = goldTextNode(1);
    const otherText = other.data;
    const rows = [...host.querySelectorAll('.ab-char')];
    (state.roster[0] as CharacterState).gold = 48_210;

    const { records, diffs } = await observe(refresh);

    expect(records).toHaveLength(1);
    expect(records[0]?.type).toBe('characterData');
    expect(records[0]?.target).toBe(target);
    expect(target.data).toBe('48,210');
    expect(diffs).toBe(0);

    expect(goldTextNode(0)).toBe(target);
    expect(other.data).toBe(otherText);
    expect([...host.querySelectorAll('.ab-char')]).toEqual(rows);
  });

  it('touches nothing when no shown value changed', async () => {
    const state = gameWith('Ysolde');
    const refresh = connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<Roster />, host);
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
    const state = deepFreeze(gameWith());
    const dispatch = vi.fn();
    const refresh = connectEngine({ state, dispatch, drainEvents: () => [] }, data);
    render(<App />, host);

    openCreation();
    await new Promise((resolve) => setTimeout(resolve));
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'Brann';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    refresh();

    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'createCharacter', name: 'Brann' });
    expect(state.roster).toHaveLength(0);
    expect(creationOpen.value).toBe(false);
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

describe('numbers on screen', () => {
  function viewOf(change: (character: CharacterState) => void) {
    const state = gameWith('Ysolde');
    change(state.roster[0] as CharacterState);
    connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    return roster.value[0];
  }

  it('flags a character with no health potion in the bag (decisions A1)', () => {
    expect(viewOf(() => {})?.noPotions.value).toBe(false);
    expect(viewOf((character) => void (character.bag = []))?.noPotions.value).toBe(true);
  });

  it('rounds XP up to a whole number, like health and mana', () => {
    const view = viewOf((character) => {
      character.xpInLevel = 12.25;
    });
    expect(view?.xpInLevel.value).toBe(13);
  });

  it.each([
    [12_000, '12s'],
    [59_999, '59s'],
    [60_000, '1m 0s'],
    [192_000, '3m 12s'],
    [3_599_000, '59m 59s'],
    [3_600_000, '1h 0m'],
    [7_500_000, '2h 5m'],
    [27_720_000, '7h 42m'],
  ])('shows %i ms in a phase as %s (design system README)', (ms, text) => {
    const view = viewOf((character) => {
      character.timeInPhaseMs = ms;
    });
    expect(view?.timeInActivity.value).toBe(text);
  });
});

describe('the avatar initial', () => {
  function avatarOf(name: string): string | null | undefined {
    const state = gameWith(name);
    connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<Roster />, host);
    return host.querySelector('.ab-char__avatar')?.textContent;
  }

  it('is the first letter', () => {
    expect(avatarOf('Ysolde')).toBe('Y');
  });

  it('keeps a character outside the basic plane whole', () => {
    expect(avatarOf('\u{1D4D0}da')).toBe('\u{1D4D0}');
  });

  it('is empty, not "undefined", for an empty name', () => {
    expect(avatarOf('')).toBe('');
  });
});

describe('lasting notices', () => {
  it('survive connectEngine and the next command, while the engine notice does not', () => {
    showLastingNotices(['Loaded the previous save, 3m 12s old.']);
    const engine = createEngine({ data, state: createGameState(7, T0, data) });
    const refresh = connectEngine(engine, data);
    send({ type: 'createCharacter', name: '' });
    step(engine, refresh);
    expect(notice.value).toEqual(expect.any(String));

    send({ type: 'createCharacter', name: 'Ysolde' });
    expect(notice.value).toBeNull();
    expect(lastingNotices.value).toContain('Loaded the previous save, 3m 12s old.');
  });

  it('show every line on every screen', () => {
    showLastingNotices(['Line one.', 'Line two.']);
    connectEngine({ state: gameWith(), dispatch: () => {}, drainEvents: () => [] }, data);
    render(<App />, host);
    const shown = [...host.querySelectorAll('.ab-notice')].map((line) => line.textContent);
    expect(shown).toEqual(expect.arrayContaining(['Line one.', 'Line two.']));
  });
});

describe('roster and character creation (design 4.1)', () => {
  function connected(state: GameState) {
    const engine = createEngine({ data, state });
    const refresh = connectEngine(engine, data);
    return { engine, refresh };
  }

  it('shows a locked slot for every slot above unlockedSlots', () => {
    const state = gameWith('Ysolde');
    connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<App />, host);
    const locked = [...host.querySelectorAll('.ab-char--locked')];
    expect(locked).toHaveLength(constants.characters.maxSlots - state.account.unlockedSlots);
    expect(locked[0]?.textContent).toContain('Locked.');
  });

  it('shows one empty row per unlocked free slot, and clicking one opens creation', () => {
    const state = gameWith('Ysolde');
    state.account.unlockedSlots = 3;
    connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<Roster />, host);

    const empty = [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes('Empty. Create a character.'));
    expect(empty).toHaveLength(2);
    expect(empty[0]?.textContent).toContain('Slot 2');
    empty[0]?.click();
    expect(creationOpen.value).toBe(true);
    closeCreation();
  });

  it('shows an area name and level range on a character that farms somewhere', () => {
    const state = gameWith('Ysolde');
    (state.roster[0] as CharacterState).phase = 'searching';
    (state.roster[0] as CharacterState).areaId = 'mossfang-glade';
    connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<Roster />, host);
    const where = host.querySelector('.ab-char__where') as HTMLElement;
    expect(where.textContent).toContain('Mossfang Glade');
    expect(where.textContent).toContain('Lv 1');
    expect(where.textContent).toContain('5');
    expect(host.querySelector('.ab-status')?.textContent).toContain('Farming');
  });

  it('disables the Create button when every unlocked slot is taken, and shows no hardcoded ticket hint', () => {
    const state = gameWith('Ysolde');
    connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<App />, host);
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Create character');
    expect(button?.hasAttribute('disabled')).toBe(true);
    expect(host.querySelector('.app__stack [role="status"]')).toBeNull();
  });

  it('openCreation refuses to open when no slot is free, so a later caller cannot land on an unsubmittable form', () => {
    const state = gameWith('Ysolde');
    connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    openCreation();
    expect(creationOpen.value).toBe(false);
  });

  it('opens creation, types, submits a valid name, and closes', async () => {
    const { engine, refresh } = connected(gameWith());
    render(<App />, host);

    openCreation();
    await new Promise((resolve) => setTimeout(resolve));
    expect(host.querySelector('.ab-appbar__title')?.textContent).toBe('New character');

    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'Ysolde';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));

    const submit = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.hasAttribute('disabled')).toBe(false);
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    step(engine, refresh);

    expect(creationOpen.value).toBe(false);
    expect(engine.state.roster.map((c) => c.name)).toEqual(['Ysolde']);
  });

  it('keeps Create disabled and reports why for a duplicate name, without sending anything', async () => {
    const state = gameWith('Ysolde');
    state.account.unlockedSlots = constants.characters.maxSlots;
    const dispatch = vi.fn();
    connectEngine({ state, dispatch, drainEvents: () => [] }, data);
    openCreation();
    render(<App />, host);
    await new Promise((resolve) => setTimeout(resolve));

    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'ysolde';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));

    const submit = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    const help = host.querySelector('#char-name-help');
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(help?.textContent).toMatch(/already has that name/);
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(dispatch).not.toHaveBeenCalled();
    closeCreation();
  });

  it('delete confirm says what is lost and sends deleteCharacter on confirm', async () => {
    const { engine, refresh } = connected(gameWith('Ysolde'));
    render(<App />, host);

    openDeleteConfirm('c1');
    await new Promise((resolve) => setTimeout(resolve));

    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    const text = dialog.textContent ?? '';
    expect(text).toContain('items');
    expect(text).toContain('equipment');
    expect(text).toContain('gold');
    expect(text).toContain('warehouse');

    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Delete') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const input = dialog.querySelector('#delete-name') as HTMLInputElement;
    input.value = 'ysolde';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(confirm.disabled).toBe(false);
    confirm.click();
    step(engine, refresh);
    await new Promise((resolve) => setTimeout(resolve));

    expect(engine.state.roster).toHaveLength(0);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps Delete disabled for a wrong name', async () => {
    connected(gameWith('Ysolde'));
    render(<App />, host);
    openDeleteConfirm('c1');
    await new Promise((resolve) => setTimeout(resolve));

    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    const input = dialog.querySelector('#delete-name') as HTMLInputElement;
    input.value = 'Ysold';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));

    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Delete') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    closeDeleteConfirm();
  });

  it('reopening delete for the same character starts empty and disarmed', async () => {
    connected(gameWith('Ysolde'));
    render(<App />, host);
    openDeleteConfirm('c1');
    await new Promise((resolve) => setTimeout(resolve));

    const first = host.querySelector('#delete-name') as HTMLInputElement;
    first.value = 'Ysolde';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    closeDeleteConfirm();
    await new Promise((resolve) => setTimeout(resolve));
    openDeleteConfirm('c1');
    await new Promise((resolve) => setTimeout(resolve));

    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect((dialog.querySelector('#delete-name') as HTMLInputElement).value).toBe('');
    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Delete') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    closeDeleteConfirm();
  });

  it('cancel on the delete confirm leaves the character in place', async () => {
    const state = gameWith('Ysolde');
    const dispatch = vi.fn();
    connectEngine({ state, dispatch, drainEvents: () => [] }, data);
    render(<App />, host);

    openDeleteConfirm('c1');
    await new Promise((resolve) => setTimeout(resolve));
    const keep = [...host.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Keep') as HTMLButtonElement;
    keep.click();

    expect(dispatch).not.toHaveBeenCalled();
    closeDeleteConfirm();
  });
});

describe('the app bar gold pill (decisions L18)', () => {
  it('shows the first character\'s gold, formatted with thousand separators', async () => {
    const state = gameWith('Ysolde');
    (state.roster[0] as CharacterState).gold = 48_210;
    connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
    render(<App />, host);
    expect(host.querySelector('.ab-gold')?.textContent).toContain('48,210');
  });

  it('is absent while the roster is empty', () => {
    connectEngine({ state: gameWith(), dispatch: () => {}, drainEvents: () => [] }, data);
    render(<App />, host);
    expect(host.querySelector('.ab-gold')).toBeNull();
  });
});

describe('saving after an irreversible command (ADR 0003 "Writing")', () => {
  function connected() {
    const engine = createEngine({ data, state: createGameState(7, T0, data) });
    const rosterAtSave: number[] = [];
    const refresh = connectEngine(engine, data, () => rosterAtSave.push(engine.state.roster.length));
    return { engine, refresh, rosterAtSave };
  }
  const create = { type: 'createCharacter', name: 'Ysolde' } as const;

  it('fires once the command has been applied, so the save holds its result', () => {
    const { engine, refresh, rosterAtSave } = connected();
    send(create, { saveAfter: true });
    expect(rosterAtSave).toEqual([]);

    step(engine, refresh);
    expect(rosterAtSave).toEqual([1]);

    step(engine, refresh);
    expect(rosterAtSave).toEqual([1]);
  });

  it('waits when a refresh comes before any step has run', () => {
    const { engine, refresh, rosterAtSave } = connected();
    send(create, { saveAfter: true });
    refresh();
    expect(rosterAtSave).toEqual([]);
    engine.advanceTo(T0 + TICK / 2);
    refresh();
    expect(rosterAtSave).toEqual([]);

    step(engine, refresh);
    expect(rosterAtSave).toEqual([1]);
  });

  it('waits through a clock rewind, which leaves commands queued', () => {
    const { engine, refresh, rosterAtSave } = connected();
    send(create, { saveAfter: true });
    engine.advanceTo(T0 - 60_000);
    refresh();
    expect(rosterAtSave).toEqual([]);

    step(engine, refresh);
    expect(rosterAtSave).toEqual([1]);
  });

  it('fires after an offline estimate, which applies queued commands too', () => {
    const { engine, refresh, rosterAtSave } = connected();
    send(create, { saveAfter: true });
    engine.advanceTo(T0 + (constants.offline.stepSimMaxSeconds + 1) * 1000);
    refresh();
    expect(rosterAtSave).toEqual([1]);
  });

  it('does not fire for a command without the option', () => {
    const { engine, refresh, rosterAtSave } = connected();
    send(create);
    step(engine, refresh);
    expect(rosterAtSave).toEqual([]);
    expect(engine.state.roster).toHaveLength(1);
  });
});
