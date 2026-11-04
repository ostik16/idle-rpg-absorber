import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../src/engine/engine';
import { reconcile as exportedReconcile } from '../src/save';
import { encodeEnvelope, InvalidSaveError } from '../src/save/envelope';
import type { Migration } from '../src/save/migrations';
import { formatAge, saveFailureNotice, saveNotices } from '../src/save/notices';
import { isRecoveredTab, reconcile } from '../src/save/reconcile';
import { createSaves, openSaves, readSaveMeta, SaveBlockedError, type LoadResult, type Saves, type SavesOptions } from '../src/save/saves';
import {
  FALLBACK_PREFIX,
  localStorageStore,
  memoryStore,
  openSaveStore,
  type LocalStorageApi,
  type SaveStore,
  type StorageApis,
} from '../src/save/store';
import type { GameState } from '../src/state/types';
import { data, envelopeText, fakeLocalStorage, newState, rotationOf, snapshot, T0 } from './save-helpers';

const NOW = T0 + 60_000;

function options(extra: Partial<SavesOptions> = {}): SavesOptions {
  return { appBuild: 'test', tables: data, now: () => NOW, apis: {}, requestPersistence: async () => {}, ...extra };
}

function goldOf(result: LoadResult): number | undefined {
  return result.status === 'loaded' ? result.state.roster[0]?.gold : undefined;
}

/** A store and saves with `golds.length` saves already written, oldest first. */
async function savedWith(store: SaveStore, golds: readonly number[], extra: Partial<SavesOptions> = {}): Promise<Saves> {
  const saves = createSaves(store, options(extra));
  for (const gold of golds) await saves.write(newState(gold));
  return saves;
}

/** A later boot on the same storage. */
function reboot(store: SaveStore, extra: Partial<SavesOptions> = {}): Saves {
  return createSaves(store, options(extra));
}

async function corrupt(store: SaveStore, position: number, text = '{"format":"idle-rpg-abso'): Promise<void> {
  const key = (await rotationOf(store))[position];
  if (key === undefined) throw new Error(`nothing at position ${position}`);
  await store.put(key, text);
}

// The rotation and the recovery order work the same on each store.
describe.each<[string, () => Promise<SaveStore>]>([
  ['IndexedDB', () => openSaveStore({ indexedDB: new IDBFactory() })],
  ['the localStorage fallback', () => openSaveStore({ localStorage: fakeLocalStorage() })],
])('save records on %s', (_label, makeStore) => {
  let store: SaveStore;
  beforeEach(async () => {
    store = await makeStore();
  });

  describe('writing (ADR 0003 "Writing")', () => {
    it('reads back what it wrote, with the time on it', async () => {
      await savedWith(store, [50]);
      const result = await reboot(store).load();
      expect(result).toMatchObject({ status: 'loaded', source: 'current', savedAt: NOW, ageMs: 0, migratedFrom: null, failures: [] });
      expect(goldOf(result)).toBe(50);
      expect(result.status === 'loaded' && result.state.clock.savedAt).toBe(NOW);
    });

    it('keeps the three newest records and removes the rest', async () => {
      await savedWith(store, [1, 2, 3, 4, 5]);
      const rotation = await rotationOf(store);
      expect(rotation).toHaveLength(3);
      expect((await store.keys()).sort()).toEqual([...rotation, 'pointer'].sort());
    });

    it('has the newest first: current, previous, previous2', async () => {
      await savedWith(store, [1, 2, 3]);
      const rotation = await rotationOf(store);
      const golds = await Promise.all(rotation.map(async (key) => JSON.parse((await store.get(key)) as string).payload.roster[0].gold));
      expect(golds).toEqual([3, 2, 1]);
    });
  });

  describe('a crash mid-write', () => {
    /** Fails like a crash at one step of a write: that put never lands, and whatever follows never runs. */
    function crashingOn(match: (key: string) => boolean): SaveStore {
      return {
        ...store,
        put: (key, value) => (match(key) ? Promise.reject(new Error('crash')) : store.put(key, value)),
      };
    }

    it('during the new record: the older record loads, and nothing else changed', async () => {
      await savedWith(store, [1, 2]);
      const before = await snapshot(store);
      const crashing = createSaves(crashingOn((key) => key.startsWith('record-')), options());
      await expect(crashing.write(newState(3))).rejects.toThrow('crash');

      expect(await snapshot(store)).toEqual(before);
      expect(goldOf(await reboot(store).load())).toBe(2);
    });

    it('before the pointer moves: the older record is still current, and the new one is cleared later', async () => {
      await savedWith(store, [1, 2]);
      const rotation = await rotationOf(store);
      const crashing = createSaves(crashingOn((key) => key === 'pointer'), options());
      await expect(crashing.write(newState(3))).rejects.toThrow('crash');

      expect(await rotationOf(store)).toEqual(rotation);
      const result = await reboot(store).load();
      expect(result).toMatchObject({ source: 'current', failures: [] });
      expect(goldOf(result)).toBe(2);

      await reboot(store).write(newState(4));
      await reboot(store).write(newState(5));
      await reboot(store).write(newState(6));
      expect(await store.keys()).toHaveLength(4);
      expect(goldOf(await reboot(store).load())).toBe(6);
    });

    it('a write that lands half a record behind the pointer: the older record takes over', async () => {
      await savedWith(store, [1, 2]);
      await corrupt(store, 0, (await store.get((await rotationOf(store))[0]!))!.slice(0, 100));
      const result = await reboot(store).load();
      expect(result).toMatchObject({ source: 'previous' });
      expect(goldOf(result)).toBe(1);
    });
  });

  describe('the recovery order (ADR 0003 "Corruption and backup handling")', () => {
    it('current fails: previous, and the player is told', async () => {
      await savedWith(store, [1, 2, 3]);
      await corrupt(store, 0);
      const result = await reboot(store, { now: () => NOW + 192_000 }).load();

      expect(goldOf(result)).toBe(2);
      expect(result).toMatchObject({ status: 'loaded', source: 'previous', ageMs: 192_000, failures: [{ record: 'current', reason: 'parse' }] });
      expect(saveNotices(result, store.kind)[0]).toBe('The newest save could not be read. Loaded the previous save, 3m 12s old.');
    });

    it('current and previous fail: previous2, and the player is told', async () => {
      await savedWith(store, [1, 2, 3]);
      await corrupt(store, 0);
      await corrupt(store, 1);
      const result = await reboot(store).load();

      expect(goldOf(result)).toBe(1);
      expect(result).toMatchObject({ source: 'previous2' });
      expect(saveNotices(result, store.kind)[0]).toContain('the save before the previous one');
    });

    it('all three fail: backup-v<N>, and the player is told', async () => {
      await savedWith(store, [1, 2, 3]);
      await store.put('backup-v1', encodeEnvelope(newState(99), NOW, 'test'));
      for (const position of [0, 1, 2]) await corrupt(store, position);
      const result = await reboot(store).load();

      expect(goldOf(result)).toBe(99);
      expect(result).toMatchObject({ source: 'backup-v1' });
      expect(result.status === 'loaded' && result.failures.map((failure) => failure.record)).toEqual(['current', 'previous', 'previous2']);
      expect(saveNotices(result, store.kind)[0]).toContain('the backup of save version 1');
    });

    it('tries the newest backup first', async () => {
      const addTwo: Migration[] = [(payload) => payload, (payload) => payload];
      await store.put('backup-v1', envelopeText(newState(1), 1));
      await store.put('backup-v2', envelopeText(newState(2), 2));
      await store.put('backup-v3', envelopeText(newState(3), 3));
      const result = await reboot(store, { migrations: addTwo }).load();
      expect(result).toMatchObject({ source: 'backup-v3' });
    });

    it('says nothing when current is fine', async () => {
      await savedWith(store, [1]);
      expect(saveNotices(await reboot(store).load(), store.kind).filter((line) => line.includes('could not be read'))).toEqual([]);
    });

    it.each<[string, (text: string) => string, string]>([
      ['a broken parse', (text) => text.slice(0, 40), 'parse'],
      ['a bad checksum', (text) => text.replace('"gold":3', '"gold":4'), 'checksum'],
      ['a wrong format', (text) => text.replace('idle-rpg-absorber', 'other-game'), 'format'],
      ['a payload outside the schema', () => envelopeText({ clock: 1 }, 1), 'schema'],
    ])('counts %s as a failure', async (_label, damage, reason) => {
      await savedWith(store, [2, 3]);
      const [key] = await rotationOf(store);
      await store.put(key!, damage((await store.get(key!))!));
      expect(await reboot(store).load()).toMatchObject({ source: 'previous', failures: [{ record: 'current', reason }] });
    });

    it('keeps a failed record under corrupt-<time>, word for word', async () => {
      await savedWith(store, [1, 2]);
      await corrupt(store, 0, 'damaged text');
      const saves = reboot(store);
      await saves.load();
      expect(await saves.corruptRecords()).toEqual([{ key: `corrupt-${NOW}-current`, text: 'damaged text', readable: false }]);
    });

    it('moves a failed record out of the rotation, so the next boot neither repeats the notice nor copies it again', async () => {
      await savedWith(store, [1, 2, 3]);
      await corrupt(store, 0);
      await reboot(store).load();

      const second = reboot(store, { now: () => NOW + 1 });
      const result = await second.load();
      expect(goldOf(result)).toBe(2);
      expect(result).toMatchObject({ source: 'current', failures: [] });
      expect(await second.corruptRecords()).toHaveLength(1);
    });

    it('writes on after a recovery, from the record that loaded', async () => {
      await savedWith(store, [1, 2, 3]);
      await corrupt(store, 0);
      const saves = reboot(store);
      await saves.load();
      await saves.write(newState(4));

      const result = await reboot(store).load();
      expect(goldOf(result)).toBe(4);
      await corrupt(store, 0);
      expect(goldOf(await reboot(store).load())).toBe(2);
    });

    it('rebuilds a lost or damaged pointer from the records', async () => {
      await savedWith(store, [1, 2, 3]);
      await store.delete('pointer');
      expect(goldOf(await reboot(store).load())).toBe(3);

      await store.put('pointer', 'not json');
      expect(goldOf(await reboot(store).load())).toBe(3);
    });

    it('moves on when the pointer names a record that is gone', async () => {
      await savedWith(store, [1, 2]);
      await store.delete((await rotationOf(store))[0]!);
      expect(await reboot(store).load()).toMatchObject({ source: 'previous', failures: [{ record: 'current', reason: 'missing' }] });
    });
  });

  describe('when nothing loads', () => {
    it('no save at all is a new game', async () => {
      expect(await reboot(store).load()).toEqual({ status: 'empty' });
    });

    it('records that all fail need the recovery screen, and every one is kept', async () => {
      await savedWith(store, [1, 2]);
      await corrupt(store, 0, 'first');
      await corrupt(store, 1, 'second');
      const saves = reboot(store);
      const result = await saves.load();

      expect(result).toMatchObject({ status: 'unrecoverable', failures: [{ record: 'current' }, { record: 'previous' }] });
      expect(saveNotices(result, store.kind)[0]).toBe('No save could be read. Import a file or start fresh. The failed saves are kept.');
      expect((await saves.corruptRecords()).map((record) => record.text).sort()).toEqual(['first', 'second']);
    });

    it('still asks on the next boot, and does not start over on top of them', async () => {
      await savedWith(store, [1]);
      await corrupt(store, 0);
      await reboot(store).load();
      expect(await reboot(store).load()).toMatchObject({ status: 'unrecoverable' });
    });

    it('starting fresh writes a new save beside the kept ones', async () => {
      await savedWith(store, [1]);
      await corrupt(store, 0, 'kept');
      const saves = reboot(store);
      await saves.load();
      await saves.write(newState(7));

      const next = reboot(store);
      expect(goldOf(await next.load())).toBe(7);
      expect((await next.corruptRecords()).map((record) => record.text)).toEqual(['kept']);
    });

    it('says "kept" only when something was', async () => {
      const localStorage = fakeLocalStorage();
      localStorage.setItem('ab.meta', JSON.stringify({ slot: 'record-1', savedAt: T0, storage: store.kind }));
      const result = await reboot(store, { apis: { localStorage } }).load();
      expect(result).toEqual({ status: 'unrecoverable', failures: [{ record: 'current', reason: 'missing' }] });
      expect(saveNotices(result, store.kind)[0]).toBe('No save could be read. Import a file or start fresh.');
    });
  });

  describe('a good record the state must not push out', () => {
    it.each<[string, (state: GameState) => void]>([
      ['NaN, which JSON turns into null', (state) => void (state.roster[0]!.gold = Number.NaN)],
      ['Infinity, which JSON turns into null', (state) => void (state.clock.lastSimulatedAt = Number.POSITIVE_INFINITY)],
      ['a missing field', (state) => void delete (state as Partial<GameState>).bestiary],
    ])('refuses a state with %s, however often it is tried, and every record stays', async (_label, damage) => {
      await savedWith(store, [1, 2, 3]);
      const before = await snapshot(store);
      const bad = newState(4);
      damage(bad);

      const saves = reboot(store);
      for (let i = 0; i < 4; i++) await expect(saves.write(bad)).rejects.toBeInstanceOf(InvalidSaveError);

      expect(await snapshot(store)).toEqual(before);
      expect(goldOf(await reboot(store).load())).toBe(3);
    });

    it('a refused state does not stop the next good write', async () => {
      const saves = await savedWith(store, [1]);
      const bad = newState();
      bad.roster[0]!.gold = Number.NaN;
      await expect(saves.write(bad)).rejects.toBeInstanceOf(InvalidSaveError);
      await saves.write(newState(2));
      expect(goldOf(await reboot(store).load())).toBe(2);
    });
  });

  describe('a build with a bug, then a fixed build', () => {
    const buggy: Migration[] = [
      () => {
        throw new Error('bug in the migration');
      },
    ];
    const fixed: Migration[] = [(payload) => payload];

    it('the buggy build keeps the records; the fixed build opens the newest of them', async () => {
      await savedWith(store, [1, 2, 3]);
      const first = await reboot(store, { migrations: buggy }).load();
      expect(first).toMatchObject({ status: 'unrecoverable' });
      expect(first.status === 'unrecoverable' && first.failures.map((failure) => failure.reason)).toEqual(['migration', 'migration', 'migration']);

      const result = await reboot(store, { migrations: fixed }).load();
      expect(goldOf(result)).toBe(3);
      expect(result).toMatchObject({ status: 'loaded', source: `corrupt-${NOW}-current`, migratedFrom: 1, failures: [] });
      expect(saveNotices(result, store.kind)[0]).toBe('The newest save could not be read. Loaded a save set aside earlier, 0s old.');
    });

    it('says what failed on every boot of the buggy build, not an empty list', async () => {
      await savedWith(store, [1]);
      await reboot(store, { migrations: buggy }).load();
      expect(await reboot(store, { migrations: buggy }).load()).toEqual({
        status: 'unrecoverable',
        failures: [{ record: `corrupt-${NOW}-current`, reason: 'migration' }],
      });
    });

    it('does not copy a set-aside record again when it fails again', async () => {
      await savedWith(store, [1]);
      await reboot(store, { migrations: buggy }).load();
      const again = reboot(store, { migrations: buggy, now: () => NOW + 1 });
      await again.load();
      expect(await again.corruptRecords()).toHaveLength(1);
    });

    it('tries the latest failure first', async () => {
      await store.put('corrupt-100-current', encodeEnvelope(newState(1), T0, 'test'));
      await store.put('corrupt-200-previous', encodeEnvelope(newState(2), T0, 'test'));
      await store.put('corrupt-200-current', encodeEnvelope(newState(3), T0, 'test'));
      expect(goldOf(await reboot(store).load())).toBe(3);
    });

    it('marks which kept records a build can open, for a player who started fresh meanwhile', async () => {
      await savedWith(store, [5]);
      await reboot(store, { migrations: buggy }).load();
      await store.put(`corrupt-${NOW}-previous`, 'damaged');
      const records = await reboot(store, { migrations: fixed }).corruptRecords();
      expect(records.map(({ readable }) => readable)).toEqual([true, false]);
    });

    it('a real save stays first once the player has one again', async () => {
      await savedWith(store, [1]);
      await store.put(`corrupt-${NOW}-current`, encodeEnvelope(newState(9), T0, 'test'));
      expect(goldOf(await reboot(store).load())).toBe(1);
    });
  });

  describe('a store fault', () => {
    it('a store that fails altogether is neither "no save" nor a fresh start, and writes are refused', async () => {
      await savedWith(store, [1]);
      const before = await snapshot(store);
      const failing: SaveStore = { ...store, get: () => Promise.reject(new Error('down')), keys: () => Promise.reject(new Error('down')) };
      const saves = reboot(failing);
      const result = await saves.load();

      expect(result).toEqual({ status: 'storeFault' });
      expect(saveNotices(result, store.kind)[0]).toBe('Save storage did not respond. Reload to try again. Nothing was changed.');
      await expect(saves.write(newState(2))).rejects.toBeInstanceOf(SaveBlockedError);
      expect(await snapshot(store)).toEqual(before);
    });

    it('one record it cannot read stops the load, so no older save takes over and pushes it out', async () => {
      await savedWith(store, [1, 2, 3]);
      const before = await snapshot(store);
      const [currentKey] = await rotationOf(store);
      const flaky: SaveStore = { ...store, get: (key) => (key === currentKey ? Promise.reject(new Error('down')) : store.get(key)) };
      const saves = reboot(flaky);

      expect(await saves.load()).toEqual({ status: 'storeFault' });
      for (let i = 0; i < 3; i++) await expect(saves.write(newState(9))).rejects.toBeInstanceOf(SaveBlockedError);
      expect(await snapshot(store)).toEqual(before);
      expect(goldOf(await reboot(store).load())).toBe(3);
    });

    it('a failed copy to corrupt-* leaves the record in its place and refuses writes', async () => {
      await savedWith(store, [1, 2]);
      await corrupt(store, 0, 'damaged');
      const before = await snapshot(store);
      const noCopies: SaveStore = {
        ...store,
        put: (key, value) => (key.startsWith('corrupt-') ? Promise.reject(new Error('full')) : store.put(key, value)),
      };
      const saves = reboot(noCopies);

      expect(await saves.load()).toEqual({ status: 'storeFault' });
      await expect(saves.write(newState(9))).rejects.toBeInstanceOf(SaveBlockedError);
      expect(await snapshot(store)).toEqual(before);
    });

    it('a later load in the same session can clear it', async () => {
      await savedWith(store, [1]);
      let down = true;
      const flaky: SaveStore = { ...store, get: (key) => (down ? Promise.reject(new Error('down')) : store.get(key)) };
      const saves = reboot(flaky);
      expect(await saves.load()).toEqual({ status: 'storeFault' });

      down = false;
      expect(goldOf(await saves.load())).toBe(1);
      await saves.write(newState(2));
      expect(goldOf(await reboot(store).load())).toBe(2);
    });
  });

  describe('a save from a newer version (ADR 0003)', () => {
    const NEWER = 2;

    it('is not opened, the player is told to update, and the record is left untouched', async () => {
      await store.put('record-1', envelopeText({ whatever: 'shape' }, NEWER));
      await store.put('pointer', JSON.stringify({ seq: 1, rotation: ['record-1'] }));
      const before = await snapshot(store);
      const saves = reboot(store);
      const result = await saves.load();

      expect(result).toEqual({ status: 'newerVersion', record: 'current', saveVersion: NEWER, gameVersion: 1 });
      expect(saveNotices(result, store.kind)[0]).toBe(
        'Save version 2 needs a newer game. This is version 1. Update the game to open it. The save is unchanged.',
      );
      expect(await snapshot(store)).toEqual(before);
    });

    it('refuses writes from then on, so it is never rotated out', async () => {
      await store.put('record-1', envelopeText({ whatever: 'shape' }, NEWER));
      await store.put('pointer', JSON.stringify({ seq: 1, rotation: ['record-1'] }));
      const before = await snapshot(store);
      const saves = reboot(store);
      await saves.load();

      await expect(saves.write(newState())).rejects.toBeInstanceOf(SaveBlockedError);
      expect(await snapshot(store)).toEqual(before);
    });

    it('stops the recovery there: no older record is opened, and earlier failures are left as they are', async () => {
      await store.put('record-1', encodeEnvelope(newState(1), T0, 'test'));
      await store.put('record-2', envelopeText({ whatever: 'shape' }, NEWER));
      await store.put('record-3', 'damaged');
      await store.put('pointer', JSON.stringify({ seq: 3, rotation: ['record-3', 'record-2', 'record-1'] }));
      const before = await snapshot(store);

      expect(await reboot(store).load()).toMatchObject({ status: 'newerVersion', record: 'previous' });
      expect(await snapshot(store)).toEqual(before);
    });
  });

  describe('migrating on load (ADR 0003)', () => {
    /** Version 1 kept gold as `cash`. */
    const cashToGold: Migration = (payload) => {
      const state = structuredClone(payload) as GameState & { roster: (GameState['roster'][0] & { cash?: number })[] };
      for (const character of state.roster) {
        character.gold = character.cash as number;
        delete character.cash;
      }
      return state;
    };

    function oldPayload(cash: number): unknown {
      const state = newState();
      const { gold: _gold, ...character } = state.roster[0]!;
      return { ...state, roster: [{ ...character, cash }] };
    }

    async function withOldRecord(text: string, seq = 1): Promise<void> {
      await store.put(`record-${seq}`, text);
      await store.put('pointer', JSON.stringify({ seq, rotation: [`record-${seq}`] }));
    }

    it('runs the missing steps and says which version it came from', async () => {
      await withOldRecord(envelopeText(oldPayload(40), 1));
      const result = await reboot(store, { migrations: [cashToGold] }).load();
      expect(goldOf(result)).toBe(40);
      expect(result).toMatchObject({ source: 'current', migratedFrom: 1 });
    });

    it('copies the unmigrated record to backup-v<N>, word for word', async () => {
      const text = envelopeText(oldPayload(40), 1);
      await withOldRecord(text);
      await reboot(store, { migrations: [cashToGold] }).load();
      expect(await store.get('backup-v1')).toBe(text);
    });

    it('leaves a good backup alone when the record cannot be migrated, then falls back to it', async () => {
      const good = envelopeText(oldPayload(40), 1);
      await store.put('backup-v1', good);
      await withOldRecord(envelopeText({ clock: 'older and broken' }, 1));
      const result = await reboot(store, { migrations: [cashToGold] }).load();

      expect(await store.get('backup-v1')).toBe(good);
      expect(goldOf(result)).toBe(40);
      expect(result).toMatchObject({ source: 'backup-v1', failures: [{ record: 'current', reason: 'migration' }] });
    });

    it('stops when the backup cannot be written: no migrated save, writes refused, the old record untouched', async () => {
      const text = envelopeText(oldPayload(40), 1);
      await withOldRecord(text);
      const before = await snapshot(store);
      const noBackups: SaveStore = {
        ...store,
        put: (key, value) => (key.startsWith('backup-') ? Promise.reject(new Error('full')) : store.put(key, value)),
      };
      const saves = reboot(noBackups, { migrations: [cashToGold] });

      expect(await saves.load()).toEqual({ status: 'storeFault' });
      await expect(saves.write(newState())).rejects.toBeInstanceOf(SaveBlockedError);
      expect(await snapshot(store)).toEqual(before);
    });

    it('a backup that loads is not copied over itself', async () => {
      const good = envelopeText(oldPayload(40), 1);
      await store.put('backup-v1', good);
      await reboot(store, { migrations: [cashToGold] }).load();
      expect(await store.get('backup-v1')).toBe(good);
    });

    it('writes nothing for a record already at the current version', async () => {
      await savedWith(store, [1]);
      const before = await snapshot(store);
      await reboot(store).load();
      expect(await snapshot(store)).toEqual(before);
    });
  });

  describe('reconcile on load', () => {
    it('moves an unknown item to Recovered items, tells the player, and it stays moved after the next write', async () => {
      const state = newState();
      state.roster[0]!.bag.push({ itemId: 'removed-item', bonuses: [], upgradeLevel: 0, qty: 3 });
      await savedWith(store, []);
      await reboot(store).write(state);

      const saves = reboot(store);
      const result = await saves.load();
      if (result.status !== 'loaded') throw new Error(result.status);
      expect(result.state.account.warehouse.tabs.find(isRecoveredTab)?.items).toMatchObject([{ itemId: 'removed-item', qty: 3 }]);
      expect(saveNotices(result, store.kind)).toEqual(['1 item moved to Recovered items: no longer in the game.', ...saveNotices({ status: 'empty' }, store.kind)]);

      await saves.write(result.state);
      const next = await reboot(store).load();
      expect(next).toMatchObject({ reconcile: { recovered: [] } });
      expect(next.status === 'loaded' && next.state.account.warehouse.tabs.find(isRecoveredTab)?.items).toHaveLength(1);
    });

    it('tells the player when a character returned to the city', async () => {
      const state = newState();
      state.roster[0]!.areaId = 'removed-area';
      await reboot(store).write(state);
      const lines = saveNotices(await reboot(store).load(), store.kind);
      expect(lines[0]).toBe('Kaela returned to the city: area or enemy no longer in the game.');
    });
  });
});

describe('a real IndexedDB transaction dying mid-write', () => {
  afterEach(() => void vi.restoreAllMocks());

  it('rolls back the new record: the write fails and the older record is intact', async () => {
    const store = await openSaveStore({ indexedDB: new IDBFactory() });
    await savedWith(store, [1]);
    const before = await snapshot(store);

    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = realPut.call(this, value, key);
      this.transaction.abort();
      return request;
    });
    await expect(reboot(store).write(newState(2))).rejects.toBeDefined();

    expect(await snapshot(store)).toEqual(before);
    expect(goldOf(await reboot(store).load())).toBe(1);
  });
});

describe('one write at a time (ADR 0003 "Writing")', () => {
  /** A store whose record writes wait until released, counting how many run at once. */
  function gatedStore() {
    const inner = memoryStore();
    const release: (() => void)[] = [];
    const stats = { running: 0, most: 0, written: [] as string[] };
    const store: SaveStore = {
      ...inner,
      put: async (key, value) => {
        if (key.startsWith('record-')) {
          stats.running++;
          stats.most = Math.max(stats.most, stats.running);
          await new Promise<void>((resolve) => release.push(resolve));
          stats.running--;
          stats.written.push(value);
        }
        await inner.put(key, value);
      },
    };
    const releaseNext = async (): Promise<void> => {
      while (release.length === 0) await new Promise((resolve) => setTimeout(resolve));
      release.shift()!();
    };
    return { store, stats, releaseNext };
  }

  it('runs one, then only the latest of those that waited', async () => {
    const { store, stats, releaseNext } = gatedStore();
    const saves = createSaves(store, options());
    const writes = [1, 2, 3, 4].map((gold) => saves.write(newState(gold)));

    await releaseNext();
    await releaseNext();
    await Promise.all(writes);

    expect(stats.most).toBe(1);
    expect(stats.written.map((text) => JSON.parse(text).payload.roster[0].gold)).toEqual([1, 4]);
    expect(goldOf(await reboot(store).load())).toBe(4);
  });

  it('takes the state at the moment of the call, whatever happens to it later', async () => {
    const { store, releaseNext } = gatedStore();
    const state = newState(5);
    const write = createSaves(store, options()).write(state);
    state.roster[0]!.gold = 6;
    await releaseNext();
    await write;
    expect(goldOf(await reboot(store).load())).toBe(5);
  });

  it('a failed write does not stop the one waiting, and the next call works', async () => {
    const inner = memoryStore();
    let failNext = true;
    const store: SaveStore = {
      ...inner,
      put: async (key, value) => {
        if (failNext && key.startsWith('record-')) {
          failNext = false;
          throw new Error('quota');
        }
        await inner.put(key, value);
      },
    };
    const saves = createSaves(store, options());
    const first = saves.write(newState(1));
    const second = saves.write(newState(2));
    await expect(first).rejects.toThrow('quota');
    await second;
    expect(goldOf(await reboot(store).load())).toBe(2);

    await saves.write(newState(3));
    expect(goldOf(await reboot(store).load())).toBe(3);
  });
});

const refusesToOpen = {
  open() {
    const request = { error: new Error('private mode') } as unknown as IDBOpenDBRequest;
    queueMicrotask(() => request.onerror?.(new Event('error') as never));
    return request;
  },
} as unknown as IDBFactory;

describe('evidence of a save the store cannot show', () => {
  /** One browser profile: IndexedDB and localStorage that outlive each boot. */
  function profile() {
    const indexedDB = new IDBFactory();
    const localStorage: LocalStorageApi = fakeLocalStorage();
    const boot = (extra: Partial<SavesOptions> = {}) => openSaves(options({ apis: { indexedDB, localStorage }, ...extra }));
    const bootWithoutIndexedDb = () => openSaves(options({ apis: { indexedDB: refusesToOpen, localStorage } }));
    return { indexedDB, localStorage, boot, bootWithoutIndexedDb };
  }

  it('IndexedDB failing to open once is a fault, not a new game, and the real save survives', async () => {
    const { boot, bootWithoutIndexedDb } = profile();
    await (await boot()).write(newState(50));

    const outage = await bootWithoutIndexedDb();
    expect(outage.storage).toBe('localStorage');
    const result = await outage.load();
    expect(result).toEqual({ status: 'storeFault' });
    expect(saveNotices(result, outage.storage)).toEqual(['Save storage did not respond. Reload to try again. Nothing was changed.']);
    await expect(outage.write(newState(0))).rejects.toBeInstanceOf(SaveBlockedError);

    expect(goldOf(await (await boot()).load())).toBe(50);
  });

  it('an older save in the fallback does not hide a newer one in IndexedDB', async () => {
    const { localStorage, boot, bootWithoutIndexedDb } = profile();
    await createSaves(localStorageStore(localStorage), options({ now: () => T0 })).write(newState(1));
    await (await boot({ now: () => NOW })).write(newState(2));

    expect(await (await bootWithoutIndexedDb()).load()).toEqual({ status: 'storeFault' });
  });

  it('a browser that only ever had the fallback carries on as normal', async () => {
    const { bootWithoutIndexedDb } = profile();
    await (await bootWithoutIndexedDb()).write(newState(7));
    expect(goldOf(await (await bootWithoutIndexedDb()).load())).toBe(7);
  });

  it('on such a browser, failed records go to the recovery screen: nothing else is out there', async () => {
    const { localStorage, bootWithoutIndexedDb } = profile();
    await (await bootWithoutIndexedDb()).write(newState(7));
    await corrupt(localStorageStore(localStorage), 0);
    expect(await (await bootWithoutIndexedDb()).load()).toMatchObject({ status: 'unrecoverable' });
  });

  it('a first visit with no evidence at all is still a new game', async () => {
    const { boot, bootWithoutIndexedDb } = profile();
    expect(await (await bootWithoutIndexedDb()).load()).toEqual({ status: 'empty' });
    expect(await (await boot()).load()).toEqual({ status: 'empty' });
  });

  it('a save only in the fallback loads once IndexedDB works, and carries on there', async () => {
    const { indexedDB, boot, bootWithoutIndexedDb } = profile();
    await (await bootWithoutIndexedDb()).write(newState(7));

    const saves = await boot();
    const result = await saves.load();
    expect(goldOf(result)).toBe(7);
    expect(result).toMatchObject({ source: 'current', failures: [] });

    await saves.write(newState(8));
    expect(goldOf(await (await boot()).load())).toBe(8);
    expect(await rotationOf(await openSaveStore({ indexedDB }))).toHaveLength(2);
  });

  it('a newer save in the fallback beats an older one in IndexedDB', async () => {
    const { boot, localStorage } = profile();
    await (await boot({ now: () => T0 })).write(newState(1));
    await createSaves(localStorageStore(localStorage), options({ now: () => NOW })).write(newState(2));
    expect(goldOf(await (await boot()).load())).toBe(2);
  });

  it('an older save in the fallback does not replace IndexedDB, and is not taken in again', async () => {
    const { indexedDB, boot, localStorage } = profile();
    await createSaves(localStorageStore(localStorage), options({ now: () => T0 })).write(newState(1));
    await (await boot()).load();
    await (await boot({ now: () => NOW })).write(newState(2));
    const rotation = await rotationOf(await openSaveStore({ indexedDB }));

    expect(goldOf(await (await boot()).load())).toBe(2);
    expect(await rotationOf(await openSaveStore({ indexedDB }))).toEqual(rotation);
  });

  it('a fallback holding only damaged records is not "no save"', async () => {
    const { boot, localStorage } = profile();
    const fallback = localStorageStore(localStorage);
    await fallback.put('record-1', 'damaged');
    await fallback.put('pointer', JSON.stringify({ seq: 1, rotation: ['record-1'] }));
    expect(await (await boot()).load()).toMatchObject({ status: 'unrecoverable' });
  });

  it('does not push a newer-version save in IndexedDB down with a record from the fallback', async () => {
    const { indexedDB, boot, localStorage } = profile();
    await createSaves(localStorageStore(localStorage), options({ now: () => NOW })).write(newState(1));
    const store = await openSaveStore({ indexedDB });
    await store.put('record-1', envelopeText({ whatever: 'shape' }, 2, T0));
    await store.put('pointer', JSON.stringify({ seq: 1, rotation: ['record-1'] }));
    const before = await snapshot(store);

    expect(await (await boot()).load()).toMatchObject({ status: 'newerVersion' });
    expect(await snapshot(store)).toEqual(before);
  });

  it('a fallback that fails does not stop a load from IndexedDB', async () => {
    const { indexedDB, boot, localStorage } = profile();
    await (await boot()).write(newState(3));
    const broken = { ...localStorageStore(localStorage), get: () => Promise.reject(new Error('down')) };
    const saves = createSaves(await openSaveStore({ indexedDB }), options({ apis: { localStorage } }), broken);
    expect(goldOf(await saves.load())).toBe(3);
  });
});

describe('a closed IndexedDB connection', () => {
  /** A factory that remembers its connections, so a test can close them as the browser does. */
  function watchedFactory() {
    const factory = new IDBFactory();
    const connections: IDBDatabase[] = [];
    const open = factory.open.bind(factory);
    let refuse = false;
    factory.open = (...args: Parameters<IDBFactory['open']>) => {
      if (refuse) return refusesToOpen.open(args[0]);
      const request = open(...args);
      request.addEventListener('success', () => connections.push(request.result));
      return request;
    };
    return { factory, connections, setRefuse: (value: boolean) => void (refuse = value) };
  }

  it('is opened again by the next request, so later saves still land', async () => {
    const { factory, connections } = watchedFactory();
    const saves = await openSaves(options({ apis: { indexedDB: factory } }));
    await saves.write(newState(1));
    connections[0]!.close();

    await saves.write(newState(2));
    expect(connections).toHaveLength(2);
    expect(goldOf(await (await openSaves(options({ apis: { indexedDB: factory } }))).load())).toBe(2);
  });

  it('a failed reopen rejects that write only, and the next one works', async () => {
    const { factory, connections, setRefuse } = watchedFactory();
    const saves = await openSaves(options({ apis: { indexedDB: factory } }));
    await saves.write(newState(1));
    connections[0]!.close();

    setRefuse(true);
    await expect(saves.write(newState(2))).rejects.toThrow('private mode');
    setRefuse(false);
    await saves.write(newState(3));
    expect(goldOf(await (await openSaves(options({ apis: { indexedDB: factory } }))).load())).toBe(3);
  });

  it('does not retry what failed for another reason', async () => {
    const store = await openSaveStore({ indexedDB: new IDBFactory() });
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('no', 'DataError');
    });
    await expect(store.put('a', 'b')).rejects.toThrow('no');
    expect(put).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe('what #36 builds on', () => {
  it('reads the current record as it is stored', async () => {
    const store = memoryStore();
    const saves = createSaves(store, options());
    expect(await saves.currentText()).toBeNull();
    await saves.write(newState(4));
    expect(await saves.currentText()).toBe(await store.get((await rotationOf(store))[0]!));
  });

  it('backs up the current record to a key the recovery order tries', async () => {
    const store = memoryStore();
    const saves = createSaves(store, options());
    expect(await saves.backupCurrent()).toBeNull();
    await saves.write(newState(4));
    expect(await saves.backupCurrent()).toBe('backup-v1');

    await corrupt(store, 0);
    expect(await reboot(store).load()).toMatchObject({ source: 'backup-v1' });
  });

  it('does not back up a damaged record over a good backup', async () => {
    const store = memoryStore();
    const saves = createSaves(store, options());
    await saves.write(newState(4));
    await saves.backupCurrent();
    const good = await store.get('backup-v1');
    await corrupt(store, 0);
    expect(await saves.backupCurrent()).toBeNull();
    expect(await store.get('backup-v1')).toBe(good);
  });

  it('refuses to back up while writes are blocked', async () => {
    const store = memoryStore();
    await store.put('pointer', JSON.stringify({ seq: 1, rotation: ['record-1'] }));
    await store.put('record-1', envelopeText({ whatever: 'shape' }, 2));
    const saves = reboot(store);
    await saves.load();
    await expect(saves.backupCurrent()).rejects.toBeInstanceOf(SaveBlockedError);
  });

  it('exports reconcile from the public API', () => {
    expect(exportedReconcile).toBe(reconcile);
  });
});

describe('the line for a failed autosave', () => {
  it('says the earlier saves are safe when the state was refused', () => {
    expect(saveFailureNotice(new InvalidSaveError('x'))).toBe('Save refused: the game state has a fault. Your earlier saves are safe.');
  });

  it('says the next autosave tries again otherwise', () => {
    expect(saveFailureNotice(new Error('quota'))).toBe('Save failed. The next autosave tries again.');
  });
});

describe('choosing the storage (ADR 0003 "Storage")', () => {
  it.each<[string, () => StorageApis, string]>([
    ['IndexedDB when it opens', () => ({ indexedDB: new IDBFactory(), localStorage: fakeLocalStorage() }), 'indexeddb'],
    ['localStorage when there is no IndexedDB', () => ({ localStorage: fakeLocalStorage() }), 'localStorage'],
    ['localStorage when IndexedDB refuses to open', () => ({ indexedDB: refusesToOpen, localStorage: fakeLocalStorage() }), 'localStorage'],
    ['memory when both are blocked', () => ({}), 'memory'],
  ])('picks %s', async (_label, apis, kind) => {
    expect((await openSaves(options({ apis: apis() }))).storage).toBe(kind);
  });

  it('the fallback survives a reboot and stays under its own prefix', async () => {
    const localStorage = fakeLocalStorage();
    const first = await openSaves(options({ apis: { localStorage } }));
    await first.write(newState(8));
    const second = await openSaves(options({ apis: { localStorage } }));
    expect(goldOf(await second.load())).toBe(8);

    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) as string);
    expect(keys.filter((key) => key !== 'ab.meta').every((key) => key.startsWith(FALLBACK_PREFIX))).toBe(true);
  });

  it('IndexedDB also survives a reboot, on a new connection', async () => {
    const indexedDB = new IDBFactory();
    const first = await openSaves(options({ apis: { indexedDB } }));
    await first.write(newState(8));
    expect(goldOf(await (await openSaves(options({ apis: { indexedDB } }))).load())).toBe(8);
  });

  it('recommends export on the fallback, and warns when nothing can be stored', () => {
    expect(saveNotices({ status: 'empty' }, 'indexeddb')).toEqual([]);
    expect(saveNotices({ status: 'empty' }, 'localStorage')).toEqual([
      'Browser database unavailable, so saves use local storage. Export your save to keep a copy.',
    ]);
    expect(saveNotices({ status: 'empty' }, 'memory')).toEqual(['This browser blocks storage, so progress is lost when the tab closes.']);
  });

  it('reports a full fallback as a failed write, and the older save is kept', async () => {
    const localStorage = fakeLocalStorage();
    const saves = await openSaves(options({ apis: { localStorage } }));
    await saves.write(newState(1));
    const realSet = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    await expect(saves.write(newState(2))).rejects.toThrow('Quota');
    localStorage.setItem = realSet;
    expect(goldOf(await (await openSaves(options({ apis: { localStorage } }))).load())).toBe(1);
  });
});

describe('ab.meta and persistence (ADR 0003 "Storage")', () => {
  it('holds the active slot, the last-saved time and which storage has it', async () => {
    const localStorage = fakeLocalStorage();
    const saves = await openSaves(options({ apis: { indexedDB: new IDBFactory(), localStorage } }));
    expect(readSaveMeta({ localStorage })).toBeNull();
    await saves.write(newState());
    expect(readSaveMeta({ localStorage })).toEqual({ slot: 'record-1', savedAt: NOW, storage: 'indexeddb' });
    expect(localStorage.length).toBe(1);
  });

  it('does not fail a save when ab.meta cannot be written, and reads as null when damaged', async () => {
    const localStorage = fakeLocalStorage();
    localStorage.setItem('ab.meta', 'not json');
    expect(readSaveMeta({ localStorage })).toBeNull();

    localStorage.setItem = () => {
      throw new Error('blocked');
    };
    const store = memoryStore();
    await createSaves(store, options({ apis: { localStorage } })).write(newState(1));
    expect(goldOf(await reboot(store).load())).toBe(1);
  });

  it('asks for persistent storage after the first save only, and not before', async () => {
    const requestPersistence = vi.fn(async () => true);
    const saves = createSaves(memoryStore(), options({ requestPersistence }));
    await saves.load();
    expect(requestPersistence).not.toHaveBeenCalled();
    await saves.write(newState());
    await saves.write(newState());
    expect(requestPersistence).toHaveBeenCalledTimes(1);
  });

  it('does not ask after a save that failed', async () => {
    const requestPersistence = vi.fn(async () => true);
    const store: SaveStore = { ...memoryStore(), put: () => Promise.reject(new Error('full')) };
    await expect(createSaves(store, options({ requestPersistence })).write(newState())).rejects.toThrow('full');
    expect(requestPersistence).not.toHaveBeenCalled();
  });

  it('a refused persistence request does not fail the save', async () => {
    const store = memoryStore();
    await createSaves(store, options({ requestPersistence: () => Promise.reject(new Error('no')) })).write(newState(1));
    expect(goldOf(await reboot(store).load())).toBe(1);
  });
});

describe('a loaded save carries on the same (ADR 0002, 0003)', () => {
  it('the engine runs on from a save as if nothing happened', async () => {
    const first = createEngine({ data, state: newState(5) });
    first.advanceTo(T0 + 1000);

    const store = memoryStore();
    await createSaves(store, options()).write(first.state);
    const result = await reboot(store).load();
    if (result.status !== 'loaded') throw new Error(result.status);
    const second = createEngine({ data, state: result.state });

    first.advanceTo(T0 + 5000);
    second.advanceTo(T0 + 5000);
    expect({ ...second.state, clock: { ...second.state.clock, savedAt: 0 } }).toEqual({
      ...first.state,
      clock: { ...first.state.clock, savedAt: 0 },
    });
  });
});

describe('formatAge (design system fixed formats)', () => {
  it.each([
    [0, '0s'],
    [12_000, '12s'],
    [192_000, '3m 12s'],
    [27_720_000, '7h 42m'],
    [-5_000, '0s'],
  ])('%i ms is %s', (ms, text) => {
    expect(formatAge(ms)).toBe(text);
  });
});
