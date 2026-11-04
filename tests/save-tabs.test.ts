import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { saveFailureNotice, saveNotices } from '../src/save/notices';
import { createSaves, SaveBlockedError, type LoadResult, type Saves, type SavesOptions } from '../src/save/saves';
import { memoryStore, openSaveStore, type SaveStore } from '../src/save/store';
import { data, envelopeText, fakeLocalStorage, fakeLocks, newState, rotationOf, snapshot, T0 } from './save-helpers';

const NOW = T0 + 60_000;

function options(extra: Partial<SavesOptions> = {}): SavesOptions {
  return { appBuild: 'test', tables: data, leaseWaitMs: 0, now: () => NOW, apis: {}, requestPersistence: async () => {}, ...extra };
}

function goldOf(result: LoadResult): number | undefined {
  return result.status === 'loaded' ? result.state.roster[0]?.gold : undefined;
}

async function expectOtherTab(write: Promise<unknown>): Promise<void> {
  const error = await write.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SaveBlockedError);
  expect((error as SaveBlockedError).reason).toBe('otherTab');
}

describe('the single-writer lease', () => {
  function browser() {
    const store = memoryStore();
    const locks = fakeLocks();
    const tab = (extra: Partial<SavesOptions> = {}) => createSaves(store, options({ apis: { locks }, ...extra }));
    return { store, locks, tab };
  }

  it('a second tab gets otherTab, with a clear notice and no line about where saves go', async () => {
    const { store, tab } = browser();
    const first = tab();
    await first.load();
    await first.write(newState(1));
    const before = await snapshot(store);

    const second = tab();
    const get = vi.spyOn(store, 'get');
    const result = await second.load();
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();

    expect(result).toEqual({ status: 'otherTab' });
    expect(saveNotices(result, 'localStorage')).toEqual(['This game is open in another tab. Close that tab, then reload here.']);
    await expectOtherTab(second.write(newState(9)));
    await expectOtherTab(second.backupCurrent());
    expect(await snapshot(store)).toEqual(before);
  });

  it('the tab with the lease keeps saving', async () => {
    const { store, tab } = browser();
    const first = tab();
    await first.load();
    await tab().load();
    await first.write(newState(2));
    expect(goldOf(await createSaves(store, options()).load())).toBe(2);
  });

  it('holds it for the page: the same tab can load again, and it stays taken', async () => {
    const { locks, tab } = browser();
    const first = tab();
    await first.load();
    await new Promise((resolve) => setTimeout(resolve));
    expect(await first.load()).toEqual({ status: 'empty' });
    expect(locks.held.size).toBe(1);
  });

  it('a second tab can try again once the first has gone', async () => {
    const { locks, tab } = browser();
    const first = tab();
    await first.load();
    await first.write(newState(3));

    const second = tab();
    expect(await second.load()).toEqual({ status: 'otherTab' });
    locks.release();
    expect(goldOf(await second.load())).toBe(3);
    await second.write(newState(4));
  });

  it('waits for a page that is still going, as on a reload', async () => {
    const { locks, tab } = browser();
    await tab().load();

    const reloaded = tab({ leaseWaitMs: 20 });
    setTimeout(() => locks.release(), 5);
    expect(await reloaded.load()).toEqual({ status: 'empty' });
  });

  it('gives up after the wait, when another tab really is open', async () => {
    const { tab } = browser();
    await tab().load();
    expect(await tab({ leaseWaitMs: 5 }).load()).toEqual({ status: 'otherTab' });
  });

  it('goes on without a lease where Web Locks is missing or refuses', async () => {
    const store = memoryStore();
    expect(await createSaves(store, options()).load()).toEqual({ status: 'empty' });

    const refuses = { request: () => Promise.reject(new DOMException('no', 'SecurityError')) } as never;
    expect(await createSaves(store, options({ apis: { locks: refuses } })).load()).toEqual({ status: 'empty' });
  });
});

describe('a stale writer, where there is no lease', () => {
  async function twoTabsOn(store: SaveStore): Promise<[Saves, Saves]> {
    const first = createSaves(store, options());
    const second = createSaves(store, options());
    await first.load();
    await second.load();
    return [first, second];
  }

  it('stops itself and rotates nothing away', async () => {
    const store = memoryStore();
    await createSaves(store, options()).write(newState(1));
    const [stale, live] = await twoTabsOn(store);
    await live.write(newState(2));
    await live.write(newState(3));
    const before = await snapshot(store);

    for (let i = 0; i < 4; i++) await expectOtherTab(stale.write(newState(99)));
    await expectOtherTab(stale.backupCurrent());
    expect(await snapshot(store)).toEqual(before);
    expect(goldOf(await createSaves(store, options()).load())).toBe(3);
  });

  it('the player is told, and the live tab carries on', async () => {
    const store = memoryStore();
    const [stale, live] = await twoTabsOn(store);
    await live.write(newState(2));
    const error = await stale.write(newState(99)).catch((reason: unknown) => reason);

    expect(saveFailureNotice(error)).toBe('Another tab is saving this game, so this tab has stopped saving. Close this tab and use the other one.');
    await live.write(newState(3));
    expect(goldOf(await createSaves(store, options()).load())).toBe(3);
  });

  it('cannot push out a save from a newer version that another tab wrote', async () => {
    const store = memoryStore();
    await createSaves(store, options()).write(newState(1));
    const [stale] = await twoTabsOn(store);
    const pointer = JSON.parse((await store.get('pointer')) as string) as { seq: number; rotation: string[] };
    await store.put('record-9', envelopeText({ whatever: 'shape' }, 2));
    await store.put('pointer', JSON.stringify({ seq: 9, rotation: ['record-9', ...pointer.rotation] }));
    const before = await snapshot(store);

    await expectOtherTab(stale.write(newState(99)));
    expect(await snapshot(store)).toEqual(before);
  });

  it('two tabs that start with no save: the second to write stops', async () => {
    const store = memoryStore();
    const [first, second] = await twoTabsOn(store);
    await first.write(newState(1));
    await expectOtherTab(second.write(newState(2)));
    expect(goldOf(await createSaves(store, options()).load())).toBe(1);
  });

  it('a load catches up, so reloading the stale tab makes it the writer', async () => {
    const store = memoryStore();
    const [stale, live] = await twoTabsOn(store);
    await live.write(newState(2));
    await expectOtherTab(stale.write(newState(99)));

    expect(goldOf(await stale.load())).toBe(2);
    await stale.write(newState(3));
    await expectOtherTab(live.write(newState(4)));
  });

  it('a waiting write stops too', async () => {
    const store = memoryStore();
    const [stale, live] = await twoTabsOn(store);
    await live.write(newState(2));
    const writes = [stale.write(newState(8)), stale.write(newState(9))];
    await expectOtherTab(writes[0] as Promise<void>);
    await expectOtherTab(writes[1] as Promise<void>);
    expect(goldOf(await createSaves(store, options()).load())).toBe(2);
  });
});

describe('two writers interleaved, step by step', () => {
  /** Holds each record put until both tabs have made theirs, so both have read the same pointer. */
  function meetAtRecordPut(store: SaveStore): SaveStore {
    let arrived = 0;
    let letGo: () => void = () => {};
    const met = new Promise<void>((resolve) => (letGo = resolve));
    return {
      ...store,
      put: async (key, value) => {
        await store.put(key, value);
        if (!key.startsWith('record-')) return;
        arrived++;
        if (arrived === 2) letGo();
        await met;
      },
    };
  }

  describe.each<[string, () => Promise<SaveStore>]>([
    ['IndexedDB', () => openSaveStore({ indexedDB: new IDBFactory() })],
    ['localStorage', () => openSaveStore({ localStorage: fakeLocalStorage() })],
  ])('on %s', (_label, makeStore) => {
    it('both read the pointer and put a record: they use their own keys, and exactly one moves the pointer', async () => {
      const store = await makeStore();
      await createSaves(store, options()).write(newState(1));
      const shared = meetAtRecordPut(store);
      const a = createSaves(shared, options());
      const b = createSaves(shared, options());
      await a.load();
      await b.load();

      const results = await Promise.allSettled([a.write(newState(10)), b.write(newState(20))]);
      const won = results.flatMap((result, i) => (result.status === 'fulfilled' ? [[10, 20][i] as number] : []));
      const lost = results.find((result) => result.status === 'rejected');

      expect(won).toHaveLength(1);
      expect((lost as PromiseRejectedResult).reason).toBeInstanceOf(SaveBlockedError);
      expect(goldOf(await createSaves(store, options()).load())).toBe(won[0]);

      const rotation = await rotationOf(store);
      expect(rotation).toHaveLength(2);
      const records = (await store.keys()).filter((key) => key.startsWith('record-'));
      expect(records.sort()).toEqual([...rotation].sort());
    });

    it('compareAndPut lets only one of two writers with the same view through', async () => {
      const store = await makeStore();
      await store.put('k', 'old');
      const results = await Promise.all([store.compareAndPut('k', 'old', 'a'), store.compareAndPut('k', 'old', 'b')]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await store.get('k')).toBe(results[0] ? 'a' : 'b');
    });

    it('compareAndPut treats undefined as nothing there, and writes nothing on a mismatch', async () => {
      const store = await makeStore();
      expect(await store.compareAndPut('k', undefined, 'first')).toBe(true);
      expect(await store.compareAndPut('k', undefined, 'second')).toBe(false);
      expect(await store.compareAndPut('k', 'other', 'third')).toBe(false);
      expect(await store.get('k')).toBe('first');
    });
  });

  it('one tab tidying up does not delete the record another tab has just written', async () => {
    const inner = memoryStore();
    await createSaves(inner, options()).write(newState(1));
    let during: (() => Promise<void>) | null = null;
    const pausing: SaveStore = {
      ...inner,
      keys: async () => {
        const step = during;
        during = null;
        await step?.();
        return inner.keys();
      },
    };
    const tidying = createSaves(pausing, options());
    await tidying.load();

    // As the first tab starts its tidy-up, after its pointer move, a tab opened since writes a newer record.
    during = async () => {
      const newer = createSaves(inner, options());
      await newer.load();
      await newer.write(newState(3));
    };
    await tidying.write(newState(2));

    expect(await createSaves(inner, options()).load()).toMatchObject({ source: 'current', failures: [] });
    expect(goldOf(await createSaves(inner, options()).load())).toBe(3);
  });

  it('the losing tab does not delete the winner\'s record, only its own', async () => {
    const store = memoryStore();
    const shared = meetAtRecordPut(store);
    const a = createSaves(shared, options());
    const b = createSaves(shared, options());
    await a.load();
    await b.load();
    await Promise.allSettled([a.write(newState(10)), b.write(newState(20))]);

    expect(await createSaves(store, options()).load()).toMatchObject({ status: 'loaded', source: 'current', failures: [] });
    expect((await store.keys()).filter((key) => key.startsWith('record-'))).toHaveLength(1);
  });

  it('a tab setting a damaged record aside stops if another tab moved the pointer, and that tab\'s save stays', async () => {
    const inner = memoryStore();
    await createSaves(inner, options()).write(newState(1));
    await createSaves(inner, options()).write(newState(2));
    const [damaged] = await rotationOf(inner);
    await inner.put(damaged!, 'damaged');

    // Another tab writes between this load reading the pointer and setting the record aside.
    let raced = false;
    const racing: SaveStore = {
      ...inner,
      put: async (key, value) => {
        await inner.put(key, value);
        if (raced || !key.startsWith('corrupt-')) return;
        raced = true;
        const live = JSON.parse((await inner.get('pointer')) as string) as { seq: number; rotation: string[] };
        await inner.put('record-9-other', envelopeText(newState(9), 1));
        await inner.put('pointer', JSON.stringify({ seq: 9, rotation: ['record-9-other', ...live.rotation] }));
      },
    };

    const saves = createSaves(racing, options());
    expect(await saves.load()).toEqual({ status: 'otherTab' });
    await expectOtherTab(saves.write(newState(99)));
    expect(goldOf(await createSaves(inner, options()).load())).toBe(9);
  });

  it('a tab that loses the pointer takes its own record away, and stops', async () => {
    const store = memoryStore();
    await createSaves(store, options()).write(newState(1));
    const before = await snapshot(store);
    const saves = createSaves({ ...store, compareAndPut: async () => false }, options());

    await expectOtherTab(saves.write(newState(2)));
    expect(await snapshot(store)).toEqual(before);
    await expectOtherTab(saves.backupCurrent());
  });

  it('a crash between the steps still leaves a save, whichever tab it hit', async () => {
    const store = memoryStore();
    await createSaves(store, options()).write(newState(1));
    const crashing: SaveStore = { ...store, compareAndPut: () => Promise.reject(new Error('crash')) };
    await expect(createSaves(crashing, options()).write(newState(2))).rejects.toThrow('crash');
    expect(goldOf(await createSaves(store, options()).load())).toBe(1);
  });
});
