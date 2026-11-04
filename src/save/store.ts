/**
 * Where save records live (ADR 0003 "Storage"): IndexedDB through this small wrapper, or `localStorage` where
 * IndexedDB is unavailable (some private modes). Both hold strings by key. Browser APIs are passed in through
 * `StorageApis`, so tests can run on `fake-indexeddb`.
 */

export const DB_NAME = 'idle-rpg-absorber';
export const STORE_NAME = 'saves';
/** Fallback records in `localStorage` are `ab.save.<key>`. `ab.meta` stays separate (see saves.ts). */
export const FALLBACK_PREFIX = 'ab.save.';

/** `memory` means nothing outlives the tab: the browser blocks both kinds of storage. */
export type StorageKind = 'indexeddb' | 'localStorage' | 'memory';

export type LocalStorageApi = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface StorageApis {
  indexedDB?: IDBFactory;
  localStorage?: LocalStorageApi;
  /** Web Locks, for the single-writer lease. Missing in old browsers and insecure pages. */
  locks?: Pick<LockManager, 'request'>;
}

export interface SaveStore {
  readonly kind: StorageKind;
  get(key: string): Promise<string | undefined>;
  /** Resolves once the value is durably written. A failed put leaves the key as it was. */
  put(key: string, value: string): Promise<void>;
  /**
   * Writes `value` only if the key still holds `expected` (`undefined`: nothing). Resolves to whether it wrote.
   * The check and the write are one step, so of two writers that read the same value only one can win.
   */
  compareAndPut(key: string, expected: string | undefined, value: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => void request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('the save database is blocked'));
  });
}

/**
 * Runs one piece of work in its own transaction, and reads its result only when the transaction has committed.
 * `work` starts the requests and returns how to read the result.
 */
function inTransaction<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const result = work(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve(result());
    const fail = (): void => reject(transaction.error ?? new Error('the save transaction was aborted'));
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

/**
 * A browser can close the connection at any time, for example when site data is cleared. The next request then
 * opens a new one, so saving does not stay broken until a reload. Requests that arrive together share that one
 * reopen. A request is only retried when its transaction could not start (`InvalidStateError`), so nothing runs twice.
 * A tab also gives way when another asks for a higher database version, so an old tab cannot block an upgrade.
 */
function indexedDbStore(factory: IDBFactory, first: IDBDatabase): SaveStore {
  let connection: Promise<IDBDatabase> | null = null;

  function watch(db: IDBDatabase): IDBDatabase {
    db.onclose = () => void (connection = null);
    db.onversionchange = () => {
      db.close();
      connection = null;
    };
    return db;
  }
  connection = Promise.resolve(watch(first));

  function connect(): Promise<IDBDatabase> {
    connection ??= openDatabase(factory)
      .then(watch)
      .catch((error: unknown) => {
        connection = null;
        throw error;
      });
    return connection;
  }

  async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => () => T): Promise<T> {
    const used = connect();
    try {
      return await inTransaction(await used, mode, work);
    } catch (error) {
      if ((error as Partial<DOMException>).name !== 'InvalidStateError') throw error;
      if (connection === used) connection = null;
      return inTransaction(await connect(), mode, work);
    }
  }

  return {
    kind: 'indexeddb',
    get: (key) =>
      run('readonly', (store) => {
        const request = store.get(key) as IDBRequest<string | undefined>;
        return () => request.result;
      }),
    put: (key, value) =>
      run('readwrite', (store) => {
        store.put(value, key);
        return () => {};
      }),
    compareAndPut: (key, expected, value) =>
      run('readwrite', (store) => {
        let wrote = false;
        const request = store.get(key) as IDBRequest<string | undefined>;
        request.onsuccess = () => {
          if (request.result !== expected) return;
          wrote = true;
          store.put(value, key);
        };
        return () => wrote;
      }),
    delete: (key) =>
      run('readwrite', (store) => {
        store.delete(key);
        return () => {};
      }),
    keys: () =>
      run('readonly', (store) => {
        const request = store.getAllKeys();
        return () => request.result.map(String);
      }),
  };
}

export function localStorageStore(storage: LocalStorageApi): SaveStore {
  return {
    kind: 'localStorage',
    get: async (key) => storage.getItem(FALLBACK_PREFIX + key) ?? undefined,
    put: async (key, value) => storage.setItem(FALLBACK_PREFIX + key, value),
    compareAndPut: async (key, expected, value) => {
      if ((storage.getItem(FALLBACK_PREFIX + key) ?? undefined) !== expected) return false;
      storage.setItem(FALLBACK_PREFIX + key, value);
      return true;
    },
    delete: async (key) => storage.removeItem(FALLBACK_PREFIX + key),
    keys: async () => {
      const found: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(FALLBACK_PREFIX)) found.push(key.slice(FALLBACK_PREFIX.length));
      }
      return found;
    },
  };
}

export function memoryStore(): SaveStore {
  const records = new Map<string, string>();
  return {
    kind: 'memory',
    get: async (key) => records.get(key),
    put: async (key, value) => void records.set(key, value),
    compareAndPut: async (key, expected, value) => {
      if (records.get(key) !== expected) return false;
      records.set(key, value);
      return true;
    },
    delete: async (key) => void records.delete(key),
    keys: async () => [...records.keys()],
  };
}

/** Reading these globals can itself throw when a browser blocks site data, and in Node they may not exist. */
export function browserApis(): StorageApis {
  const read = <T>(get: () => T | undefined): T | undefined => {
    try {
      return get();
    } catch {
      return undefined;
    }
  };
  return {
    indexedDB: read(() => globalThis.indexedDB),
    localStorage: read(() => globalThis.localStorage),
    locks: read(() => globalThis.navigator?.locks),
  };
}

/** True when a `localStorage` write failed because it is full. Browsers name this differently. */
export function isQuotaError(error: unknown): boolean {
  const { name, code } = error as Partial<DOMException>;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/** The best store this browser allows: IndexedDB, then `localStorage`, then memory. */
export async function openSaveStore(apis: StorageApis): Promise<SaveStore> {
  if (apis.indexedDB) {
    try {
      return indexedDbStore(apis.indexedDB, await openDatabase(apis.indexedDB));
    } catch {
      // Falls through: some private modes have the API and refuse to open it.
    }
  }
  return apis.localStorage ? localStorageStore(apis.localStorage) : memoryStore();
}
