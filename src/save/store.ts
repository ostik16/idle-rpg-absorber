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
}

export interface SaveStore {
  readonly kind: StorageKind;
  get(key: string): Promise<string | undefined>;
  /** Resolves once the value is durably written. A failed put leaves the key as it was. */
  put(key: string, value: string): Promise<void>;
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

/** Runs one request in its own transaction. Resolves when the transaction commits, not when the request ends. */
function inTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  makeRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = makeRequest(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve(request.result);
    const fail = (): void => reject(transaction.error ?? new Error('the save transaction was aborted'));
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

function indexedDbStore(db: IDBDatabase): SaveStore {
  return {
    kind: 'indexeddb',
    get: (key) => inTransaction(db, 'readonly', (store) => store.get(key) as IDBRequest<string | undefined>),
    put: async (key, value) => void (await inTransaction(db, 'readwrite', (store) => store.put(value, key))),
    delete: async (key) => void (await inTransaction(db, 'readwrite', (store) => store.delete(key))),
    keys: async () => (await inTransaction(db, 'readonly', (store) => store.getAllKeys())).map(String),
  };
}

function localStorageStore(storage: LocalStorageApi): SaveStore {
  return {
    kind: 'localStorage',
    get: async (key) => storage.getItem(FALLBACK_PREFIX + key) ?? undefined,
    put: async (key, value) => storage.setItem(FALLBACK_PREFIX + key, value),
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
  };
}

/** The best store this browser allows: IndexedDB, then `localStorage`, then memory. */
export async function openSaveStore(apis: StorageApis): Promise<SaveStore> {
  if (apis.indexedDB) {
    try {
      return indexedDbStore(await openDatabase(apis.indexedDB));
    } catch {
      // Falls through: some private modes have the API and refuse to open it.
    }
  }
  return apis.localStorage ? localStorageStore(apis.localStorage) : memoryStore();
}
