/**
 * Rotating records and the recovery order (ADR 0003 "Writing", "Corruption and backup handling").
 *
 * Each write is a new key, `record-<n>-<writer>`. A `pointer` record lists the live keys, newest first: their
 * positions are `current`, `previous` and `previous2`. The pointer moves only after the new record is fully written,
 * so a crash at any point leaves the older records and the pointer to them as they were.
 *
 * Only one tab writes. `load` takes a Web Locks lease, held until the page goes, and a second tab gets `otherTab`.
 * Where Web Locks is missing, a stale writer stops itself: it remembers the pointer's number, and the pointer only
 * moves by compare-and-swap, so a tab that finds it moved refuses to write and no newer record is pushed out.
 */
import type { GameState } from '../state/types';
import { decodeEnvelope, encodeEnvelope, readSave, type RecordFailure } from './envelope';
import { MIGRATIONS, type Migration } from './migrations';
import { reconcile, type ReconcileReport, type ReconcileTables } from './reconcile';
import {
  browserApis,
  isQuotaError,
  localStorageStore,
  openSaveStore,
  type SaveStore,
  type StorageApis,
  type StorageKind,
} from './store';

const POINTER_KEY = 'pointer';
const META_KEY = 'ab.meta';
const LEASE_NAME = 'idle-rpg-absorber-writer';
const RECORD_KEY = /^record-(\d+)(?:-\w+)?$/;
const BACKUP_KEY = /^backup-v(\d+)$/;
const CORRUPT_PREFIX = 'corrupt-';
const ROTATION = ['current', 'previous', 'previous2'] as const;

type BackupName = `backup-v${number}`;
type CorruptName = `corrupt-${string}`;

/** Which record a load tried or used, in recovery order. */
export type RecordName = (typeof ROTATION)[number] | BackupName | CorruptName;

export interface RecordProblem {
  record: RecordName;
  /** `missing`: the pointer or `ab.meta` named a save that is gone. */
  reason: RecordFailure | 'missing';
}

export type LoadResult =
  /** A record passed. `failures` lists those tried before it. Tell the player about `source` when it is not `current`. */
  | {
      status: 'loaded';
      state: GameState;
      source: RecordName;
      savedAt: number;
      ageMs: number;
      /** The version it was saved at, when it had to be migrated. */
      migratedFrom: number | null;
      failures: RecordProblem[];
      reconcile: ReconcileReport;
    }
  /** No save and no sign of one: start a new game. */
  | { status: 'empty' }
  /** Do not start the game: writes stay refused and the record is untouched. The player has to update. */
  | { status: 'newerVersion'; record: RecordName; saveVersion: number; gameVersion: number }
  /** The game is open in another tab, which holds the lease. Do not start it here. Writes are refused. */
  | { status: 'otherTab' }
  /**
   * The storage failed, or holds less than `ab.meta` says exists: IndexedDB would not open and this is the fallback.
   * Do not start the game and do not offer a fresh start. Writes stay refused, and a later load can try again.
   */
  | { status: 'storeFault' }
  /**
   * The storage works and nothing in it loads. Show the recovery screen: starting fresh is safe, because each
   * failed record is kept under `corrupt-<time>`, and a later build tries those again.
   */
  | { status: 'unrecoverable'; failures: RecordProblem[] };

type BlockReason = 'unsafeSave' | 'otherTab';

/**
 * Thrown by `write` so no save can be pushed out. `unsafeSave`: the last load ended in `newerVersion` or `storeFault`.
 * `otherTab`: another tab holds the lease, or wrote since this one last did, so this tab has stopped saving.
 */
export class SaveBlockedError extends Error {
  readonly reason: BlockReason;

  constructor(reason: BlockReason = 'unsafeSave') {
    super(reason === 'otherTab' ? 'another tab is writing this save' : 'the last load found a save this build must not write over');
    this.name = 'SaveBlockedError';
    this.reason = reason;
  }
}

export interface SavesOptions {
  /** Stored in the envelope, for debugging. */
  appBuild: string;
  /** What reconcile checks ids against. Pass `GameData`. */
  tables: ReconcileTables;
  /**
   * How long a new page waits for the lease before it says `otherTab`, because a reload can start before the old
   * page has let go. `save.leaseWaitSeconds` in data/constants.json, in ms.
   */
  leaseWaitMs: number;
  now?: () => number;
  apis?: StorageApis;
  /** Called after the first save of a session (ADR 0003). Defaults to `navigator.storage.persist()`. */
  requestPersistence?: () => Promise<unknown>;
  migrations?: readonly Migration[];
}

export interface Saves {
  /** Where the records go. Anything but `indexeddb` needs a notice (`saveNotices`). */
  readonly storage: StorageKind;
  /** Takes the lease and runs the recovery order. Call it at boot, before the first write. Calling it again retries. */
  load(): Promise<LoadResult>;
  /**
   * Serialises the state now and writes it. One write runs at a time: a call during a write waits, and only
   * the latest of those waiting is written. Rejects when the write fails, with `InvalidSaveError` when the state
   * does not fit the schema, and with `SaveBlockedError` as above. A rejected write leaves every record as it was.
   */
  write(state: GameState): Promise<void>;
  /** The text of the current record, as it is stored, or null when there is none. For export (#36). */
  currentText(): Promise<string | null>;
  /**
   * Copies the current record to `backup-v<its version>`, which the recovery order tries, and returns that key.
   * Null when there is no current record that reads. For import, which backs up before it replaces (#36).
   */
  backupCurrent(): Promise<string | null>;
  /** The records that failed a load, kept for export. `readable` is true when this build can open one again. */
  corruptRecords(): Promise<{ key: string; text: string; readable: boolean }[]>;
}

/** What `ab.meta` holds, for fast boot decisions and as evidence that a save exists. */
export interface SaveMeta {
  slot: string;
  savedAt: number;
  /** Where that save went, so a fallback can tell it is not looking at the real one. */
  storage: StorageKind;
}

interface Pointer {
  /** The number of the newest record. */
  seq: number;
  /** Live record keys, newest first. */
  rotation: string[];
  /** Set only while the newest record is one taken from the fallback: the fallback's number then. A write clears it. */
  fallbackSeq?: number;
}

/** A pointer as read, with the exact text a later compare-and-swap has to find. */
interface LivePointer extends Pointer {
  raw: string | undefined;
}

interface WaitingWrite {
  text: string;
  savedAt: number;
  done: Promise<void>;
}

function parsePointer(text: string | undefined): Pointer | null {
  if (text === undefined) return null;
  try {
    const { seq, rotation, fallbackSeq } = JSON.parse(text) as Partial<Pointer>;
    if (
      typeof seq === 'number' &&
      Array.isArray(rotation) &&
      rotation.length <= ROTATION.length &&
      rotation.every((key) => typeof key === 'string')
    ) {
      return { seq, rotation, ...(fallbackSeq !== undefined && { fallbackSeq }) };
    }
  } catch {
    // Falls through: a damaged pointer is rebuilt from the record keys.
  }
  return null;
}

/** The number in a record key, or null when it is not a record. */
function recordNumber(key: string): number | null {
  const match = key.match(RECORD_KEY);
  return match ? Number(match[1]) : null;
}

/** The live pointer, or one rebuilt from the record keys when it is gone or damaged. */
async function readPointer(store: SaveStore): Promise<LivePointer> {
  const raw = await store.get(POINTER_KEY);
  const pointer = parsePointer(raw);
  if (pointer !== null) return { ...pointer, raw };
  const records = (await store.keys())
    .flatMap((key) => {
      const seq = recordNumber(key);
      return seq === null ? [] : [{ key, seq }];
    })
    .sort((a, b) => b.seq - a.seq);
  return { seq: records[0]?.seq ?? 0, rotation: records.slice(0, ROTATION.length).map(({ key }) => key), raw };
}

/** Corrupt copies as candidates: the latest failure first, and within one failure the newest position first. */
function corruptCandidates(keys: readonly string[]): { name: RecordName; key: string }[] {
  const timeOf = (key: string): number => Number(key.slice(CORRUPT_PREFIX.length).split('-')[0]);
  const rank = (key: string): number => {
    const position = ROTATION.findIndex((name) => key.endsWith(`-${name}`));
    return position === -1 ? ROTATION.length : position;
  };
  return keys
    .filter((key) => key.startsWith(CORRUPT_PREFIX))
    .sort((a, b) => timeOf(b) - timeOf(a) || rank(a) - rank(b))
    .map((key) => ({ name: key as CorruptName, key }));
}

/** Backup records as candidates, the newest version first. */
function backupCandidates(keys: readonly string[]): { name: RecordName; key: string }[] {
  return keys
    .flatMap((key) => key.match(BACKUP_KEY)?.[1] ?? [])
    .map(Number)
    .sort((a, b) => b - a)
    .map((version) => ({ name: `backup-v${version}` as const, key: `backup-v${version}` }));
}

/** `ab.meta`, or null when there is none or it cannot be read. Synchronous, so it works before the first await. */
export function readSaveMeta(apis: StorageApis = browserApis()): SaveMeta | null {
  try {
    const text = apis.localStorage?.getItem(META_KEY);
    const meta = text ? (JSON.parse(text) as Partial<SaveMeta>) : null;
    return typeof meta?.savedAt === 'number' ? (meta as SaveMeta) : null;
  } catch {
    return null;
  }
}

/** One try at the lease. Null when Web Locks refuses to run here. The promise it holds never ends, so the page keeps it. */
function tryLease(locks: NonNullable<StorageApis['locks']>): Promise<boolean | null> {
  return new Promise((resolve) => {
    locks
      .request(LEASE_NAME, { ifAvailable: true }, (lock) => {
        resolve(lock !== null);
        return lock === null ? undefined : new Promise<void>(() => {});
      })
      .catch(() => resolve(null));
  });
}

function requestBrowserPersistence(): Promise<unknown> {
  return globalThis.navigator?.storage?.persist?.() ?? Promise.resolve();
}

/**
 * Builds the save system on a store. `openSaves` picks the store; tests pass their own.
 * `fallback` is the `localStorage` store when `store` is IndexedDB: it may hold a newer save from an outage.
 */
export function createSaves(store: SaveStore, options: SavesOptions, fallback?: SaveStore): Saves {
  const { appBuild, tables, leaseWaitMs, now = Date.now, requestPersistence = requestBrowserPersistence } = options;
  const { apis = browserApis(), migrations = MIGRATIONS } = options;
  const gameVersion = migrations.length + 1;
  /** Keeps two tabs that write at once off each other's records. */
  const writerId = Math.random().toString(36).slice(2, 10);

  let blocked: BlockReason | null = null;
  let leased = false;
  /** The pointer's number after this tab's last load or write. Null until the first of those. */
  let expectedSeq: number | null = null;
  let persistenceRequested = false;
  let inFlight: Promise<void> | null = null;
  let waiting: WaitingWrite | null = null;

  /** Best effort: a save that went through is not failed by its tidying up. */
  function afterWrite(key: string, savedAt: number): void {
    try {
      const meta: SaveMeta = { slot: key, savedAt, storage: store.kind };
      apis.localStorage?.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // `ab.meta` is only a hint.
    }
    if (!persistenceRequested) {
      persistenceRequested = true;
      void requestPersistence().catch(() => {});
    }
  }

  /** Takes the lease if this tab does not have it. True when it holds it, or when Web Locks is not there to ask. */
  async function holdLease(): Promise<boolean> {
    if (leased || apis.locks === undefined) return true;
    let granted = await tryLease(apis.locks);
    if (granted === false && leaseWaitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, leaseWaitMs));
      granted = await tryLease(apis.locks);
    }
    if (granted === null) return true;
    leased = granted;
    return granted;
  }

  function otherWriter(): SaveBlockedError {
    blocked = 'otherTab';
    return new SaveBlockedError('otherTab');
  }

  /** Moves the pointer only if nobody else has since `from` was read. Otherwise this tab stops writing. */
  async function movePointer(from: LivePointer, next: Pointer): Promise<LivePointer> {
    const { seq, rotation, fallbackSeq } = next;
    const raw = JSON.stringify({ seq, rotation, fallbackSeq });
    if (!(await store.compareAndPut(POINTER_KEY, from.raw, raw))) throw otherWriter();
    return { ...next, raw };
  }

  /**
   * Removes what a crash or an older rotation left. The next write tries again if this fails.
   * A record numbered above `seq` is left alone: it belongs to another writer, which may be about to move the pointer.
   */
  async function removeUnlisted(seq: number, rotation: readonly string[]): Promise<void> {
    try {
      const stale = (await store.keys()).filter((key) => {
        const number = recordNumber(key);
        return number !== null && number <= seq && !rotation.includes(key);
      });
      await Promise.all(stale.map((key) => store.delete(key)));
    } catch {
      // Only costs space.
    }
  }

  async function freeOldestCorrupt(): Promise<boolean> {
    const oldest = corruptCandidates(await store.keys()).at(-1);
    if (oldest === undefined) return false;
    await store.delete(oldest.key);
    return true;
  }

  /**
   * Writes a record where `localStorage` may be full (about 5 MB, and a browser that needs the fallback has nowhere
   * else). `free` removes one thing to make room, and returns false when nothing more may go.
   */
  async function putMakingRoom(key: string, text: string, free: () => Promise<boolean>): Promise<void> {
    for (;;) {
      try {
        return await store.put(key, text);
      } catch (error) {
        if (store.kind !== 'localStorage' || !isQuotaError(error) || !(await free())) throw error;
      }
    }
  }

  /** The rotation without its oldest record, or null when that would not leave a record that reads. */
  async function rotationWithoutOldest(live: LivePointer): Promise<string[] | null> {
    for (const [i, key] of live.rotation.entries()) {
      const text = await store.get(key);
      if (text === undefined || !decodeEnvelope(text, gameVersion).ok) continue;
      return i < live.rotation.length - 1 ? live.rotation.slice(0, -1) : null;
    }
    return null;
  }

  /**
   * New record, then the pointer moves, then the record that fell off the end goes. Returns the new key.
   * `theirSeq` marks the record as taken from the fallback at that number.
   */
  async function addRecord(text: string, theirSeq?: number): Promise<string> {
    let live = await readPointer(store);
    if (expectedSeq !== null && live.seq !== expectedSeq) throw otherWriter();
    const seq = live.seq + 1;
    const key = `record-${seq}-${writerId}`;
    let rotation: string[];
    try {
      await putMakingRoom(key, text, async () => {
        const before = (await store.keys()).length;
        await removeUnlisted(live.seq, live.rotation);
        if ((await store.keys()).length < before || (await freeOldestCorrupt())) return true;
        const shorter = await rotationWithoutOldest(live);
        if (shorter === null) return false;
        const dropped = live.rotation.at(-1) as string;
        live = await movePointer(live, { ...live, rotation: shorter });
        await store.delete(dropped);
        return true;
      });
      rotation = [key, ...live.rotation].slice(0, ROTATION.length);
      await movePointer(live, { seq, rotation, ...(theirSeq !== undefined && { fallbackSeq: theirSeq }) });
    } catch (error) {
      await store.delete(key).catch(() => {});
      throw error;
    }
    expectedSeq = seq;
    await removeUnlisted(seq, rotation);
    return key;
  }

  async function writeRecord(text: string, savedAt: number): Promise<void> {
    afterWrite(await addRecord(text), savedAt);
  }

  function start(text: string, savedAt: number): Promise<void> {
    inFlight = writeRecord(text, savedAt).finally(() => {
      if (waiting === null) inFlight = null;
    });
    return inFlight;
  }

  /**
   * Moves failed records out of the rotation, so the next boot does not copy them again and a fresh start cannot
   * push them out. A failed record goes to `corrupt-<time>-<name>` first. Copies from an earlier load stay as they
   * are. A store error here reaches `load`, which ends in `storeFault`, so no record is left without its copy.
   */
  async function setAside(pointer: LivePointer, failed: readonly TriedRecord[]): Promise<void> {
    const leaving = failed.filter(({ key }) => !key.startsWith(CORRUPT_PREFIX));
    if (leaving.length === 0) return;
    for (const { name, text } of leaving) {
      if (text !== undefined) await putMakingRoom(`${CORRUPT_PREFIX}${now()}-${name}`, text, freeOldestCorrupt);
    }
    const keys = new Set(leaving.map(({ key }) => key));
    const rotation = pointer.rotation.filter((key) => !keys.has(key));
    await movePointer(pointer, { ...pointer, rotation });
    await Promise.all([...keys].map((key) => store.delete(key)));
  }

  /** The newest record in a store that passes its checksum, or `newer` when a newer version comes first. */
  async function newestRecord(from: SaveStore): Promise<{ text: string; savedAt: number } | 'newer' | null> {
    for (const key of (await readPointer(from)).rotation) {
      const text = await from.get(key);
      if (text === undefined) continue;
      const decoded = decodeEnvelope(text, gameVersion);
      if (decoded.ok) return { text, savedAt: decoded.envelope.savedAt };
      if (decoded.reason === 'newer') return 'newer';
    }
    return null;
  }

  /**
   * A save written to the fallback stays out of sight once IndexedDB works. It becomes the current record only when
   * it cannot hide anything: IndexedDB has no records, or its newest came from the fallback, nothing was written since,
   * and the fallback has moved on. `savedAt` plays no part. A game started on the fallback during an outage is a new
   * game with a later time, and the clock can be wrong, so neither may put it in front of the real save.
   * Returns whether the fallback holds any record, which is evidence of a save even when none could be taken.
   */
  async function adoptFromFallback(): Promise<boolean> {
    if (fallback === undefined) return false;
    let theirs: Awaited<ReturnType<typeof newestRecord>>;
    let theirPointer: LivePointer;
    try {
      theirs = await newestRecord(fallback);
      theirPointer = await readPointer(fallback);
    } catch {
      return false; // Only ever a second source: a failure here must not stop a load from IndexedDB.
    }
    if (theirs !== null && theirs !== 'newer') {
      const ours = await readPointer(store);
      const movedOn = ours.fallbackSeq !== undefined && theirPointer.seq > ours.fallbackSeq;
      if (ours.rotation.length === 0 || movedOn) await addRecord(theirs.text, theirPointer.seq);
    }
    return theirPointer.rotation.length > 0;
  }

  function storeFault(): LoadResult {
    blocked = 'unsafeSave';
    return { status: 'storeFault' };
  }

  /** True when `ab.meta` says IndexedDB holds a save newer than `savedAt`, and this store is only the fallback. */
  function newerSaveOutOfReach(savedAt: number): boolean {
    const meta = readSaveMeta(apis);
    return meta !== null && meta.storage === 'indexeddb' && store.kind !== 'indexeddb' && meta.savedAt > savedAt;
  }

  async function runRecovery(): Promise<LoadResult> {
    const fallbackHeldRecords = await adoptFromFallback();
    const pointer = await readPointer(store);
    expectedSeq = pointer.seq;
    const keys = await store.keys();
    const candidates = [
      ...pointer.rotation.map((key, i) => ({ name: ROTATION[i] as RecordName, key })),
      ...backupCandidates(keys),
      // Last: a record set aside by a build with a bug in its migration or schema can open in a fixed build.
      ...corruptCandidates(keys),
    ];

    const failed: TriedRecord[] = [];
    for (const { name, key } of candidates) {
      // A store error is not a verdict on the record: it reaches `load`, and no older record replaces this one.
      const text = await store.get(key);
      if (text === undefined) {
        failed.push({ name, key, problem: 'missing' });
        continue;
      }

      const read = readSave(text, migrations);
      if (!read.ok && read.reason === 'newer') {
        // Nothing is written on this path, not even the earlier failures, and `write` refuses from now on. This
        // also holds for an old `backup-v*` or `corrupt-*` entry. It is only reached when nothing before it loaded,
        // and an update may open it, so the player is told to update rather than sent to the recovery screen.
        blocked = 'unsafeSave';
        return { status: 'newerVersion', record: name, saveVersion: read.version, gameVersion };
      }
      if (!read.ok) {
        failed.push({ name, key, text, problem: read.reason });
        continue;
      }
      if (newerSaveOutOfReach(read.savedAt)) return storeFault();

      // Migrations are pure, so nothing is lost by running them first, and a record that fails them never
      // replaces a good backup. A failed copy reaches `load`, so a migrated save never goes on without its backup.
      const backup = `backup-v${read.version}`;
      if (read.version < gameVersion && key !== backup) await putMakingRoom(backup, text, freeOldestCorrupt);
      await setAside(pointer, failed);
      return {
        status: 'loaded',
        state: read.state,
        source: name,
        savedAt: read.savedAt,
        ageMs: now() - read.savedAt,
        migratedFrom: read.version < gameVersion ? read.version : null,
        failures: failed.map(toProblem),
        reconcile: reconcile(read.state, tables),
      };
    }

    if (newerSaveOutOfReach(-Infinity)) return storeFault();
    await setAside(pointer, failed);
    if (failed.length > 0) return { status: 'unrecoverable', failures: failed.map(toProblem) };
    if (readSaveMeta(apis) !== null) return { status: 'unrecoverable', failures: [{ record: 'current', reason: 'missing' }] };
    return fallbackHeldRecords ? { status: 'unrecoverable', failures: [] } : { status: 'empty' };
  }

  return {
    storage: store.kind,

    async load() {
      blocked = null;
      expectedSeq = null;
      if (!(await holdLease())) {
        blocked = 'otherTab';
        return { status: 'otherTab' };
      }
      try {
        return await runRecovery();
      } catch (error) {
        return error instanceof SaveBlockedError ? { status: 'otherTab' } : storeFault();
      }
    },

    write(state) {
      if (blocked !== null) return Promise.reject(new SaveBlockedError(blocked));
      const savedAt = now();
      let text: string;
      try {
        text = encodeEnvelope(state, savedAt, appBuild);
      } catch (error) {
        return Promise.reject(error);
      }
      if (inFlight === null) return start(text, savedAt);
      if (waiting !== null) {
        waiting.text = text;
        waiting.savedAt = savedAt;
        return waiting.done;
      }
      const next: WaitingWrite = {
        text,
        savedAt,
        done: inFlight
          .catch(() => {})
          .then(() => {
            waiting = null;
            return start(next.text, next.savedAt);
          }),
      };
      waiting = next;
      return next.done;
    },

    async currentText() {
      const [key] = (await readPointer(store)).rotation;
      return key === undefined ? null : ((await store.get(key)) ?? null);
    },

    async backupCurrent() {
      if (blocked !== null) throw new SaveBlockedError(blocked);
      const [key] = (await readPointer(store)).rotation;
      const text = key === undefined ? undefined : await store.get(key);
      const decoded = text === undefined ? null : decodeEnvelope(text, gameVersion);
      if (text === undefined || !decoded?.ok) return null;
      const backup = `backup-v${decoded.envelope.version}`;
      await putMakingRoom(backup, text, freeOldestCorrupt);
      return backup;
    },

    async corruptRecords() {
      const keys = (await store.keys()).filter((key) => key.startsWith(CORRUPT_PREFIX)).sort();
      const texts = await Promise.all(keys.map(async (key) => (await store.get(key)) ?? ''));
      return keys.map((key, i) => {
        const text = texts[i] as string;
        return { key, text, readable: readSave(text, migrations).ok };
      });
    },
  };
}

interface TriedRecord {
  name: RecordName;
  key: string;
  text?: string;
  problem: RecordProblem['reason'];
}

function toProblem({ name, problem }: TriedRecord): RecordProblem {
  return { record: name, reason: problem };
}

/** Opens the best storage the browser allows and builds the save system on it. */
export async function openSaves(options: SavesOptions): Promise<Saves> {
  const apis = options.apis ?? browserApis();
  const store = await openSaveStore(apis);
  const fallback = store.kind === 'indexeddb' && apis.localStorage ? localStorageStore(apis.localStorage) : undefined;
  return createSaves(store, { ...options, apis }, fallback);
}
