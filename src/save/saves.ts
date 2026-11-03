/**
 * Rotating records and the recovery order (ADR 0003 "Writing", "Corruption and backup handling").
 *
 * Each write is a new key, `record-<n>`. A `pointer` record lists the live keys, newest first: their positions
 * are `current`, `previous` and `previous2`. The pointer moves only after the new record is fully written, so a
 * crash at any point leaves the older records and the pointer to them as they were.
 */
import type { GameState } from '../state/types';
import { encodeEnvelope, readSave, type RecordFailure } from './envelope';
import { MIGRATIONS, type Migration } from './migrations';
import { reconcile, type ReconcileReport, type ReconcileTables } from './reconcile';
import { browserApis, openSaveStore, type SaveStore, type StorageApis, type StorageKind } from './store';

const POINTER_KEY = 'pointer';
const META_KEY = 'ab.meta';
const RECORD_KEY = /^record-(\d+)$/;
const BACKUP_KEY = /^backup-v(\d+)$/;
const CORRUPT_PREFIX = 'corrupt-';
const ROTATION = ['current', 'previous', 'previous2'] as const;

type BackupName = `backup-v${number}`;

/** Which record a load tried or used, in recovery order. */
export type RecordName = (typeof ROTATION)[number] | BackupName;

export interface RecordProblem {
  record: RecordName;
  /** `missing`: the pointer named a record that is gone. `unreadable`: the store failed, so it stays where it is. */
  reason: RecordFailure | 'missing' | 'unreadable';
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
  /** No save at all: start a new game. */
  | { status: 'empty' }
  /** Do not start the game: writes stay refused and the record is untouched. The player has to update. */
  | { status: 'newerVersion'; record: RecordName; saveVersion: number; gameVersion: number }
  /** Records exist and none loads. Show the recovery screen. The failed ones are kept under `corrupt-<time>`. */
  | { status: 'unrecoverable'; failures: RecordProblem[] };

/** Thrown by `write` once a load has found a save from a newer version, so that save is never rotated out. */
export class SaveBlockedError extends Error {
  constructor() {
    super('a save from a newer version exists, so this build does not write');
    this.name = 'SaveBlockedError';
  }
}

export interface SavesOptions {
  /** Stored in the envelope, for debugging. */
  appBuild: string;
  /** What reconcile checks ids against. Pass `GameData`. */
  tables: ReconcileTables;
  now?: () => number;
  apis?: StorageApis;
  /** Called after the first save of a session (ADR 0003). Defaults to `navigator.storage.persist()`. */
  requestPersistence?: () => Promise<unknown>;
  migrations?: readonly Migration[];
}

export interface Saves {
  /** Where the records go. Anything but `indexeddb` needs a notice (`saveNotices`). */
  readonly storage: StorageKind;
  /** Runs the recovery order. Call it once at boot, before the first write. */
  load(): Promise<LoadResult>;
  /**
   * Serialises the state now and writes it. One write runs at a time: a call during a write waits, and only
   * the latest of those waiting is written. Rejects when the write fails, and with `SaveBlockedError` as above.
   */
  write(state: GameState): Promise<void>;
  /** The records that failed a load, kept for export (#36). */
  corruptRecords(): Promise<{ key: string; text: string }[]>;
}

/** What `ab.meta` holds, for fast boot decisions: is there a save at all, and how old. */
export interface SaveMeta {
  slot: string;
  savedAt: number;
}

interface Pointer {
  /** The number of the newest record. */
  seq: number;
  /** Live record keys, newest first. */
  rotation: string[];
}

interface WaitingWrite {
  text: string;
  savedAt: number;
  done: Promise<void>;
}

function recordKey(seq: number): string {
  return `record-${seq}`;
}

function parsePointer(text: string | undefined): Pointer | null {
  if (text === undefined) return null;
  try {
    const parsed = JSON.parse(text) as Partial<Pointer>;
    const { seq, rotation } = parsed;
    if (
      typeof seq === 'number' &&
      Array.isArray(rotation) &&
      rotation.length <= ROTATION.length &&
      rotation.every((key) => typeof key === 'string')
    ) {
      return { seq, rotation };
    }
  } catch {
    // Falls through: a damaged pointer is rebuilt from the record keys.
  }
  return null;
}

/** The live pointer, or one rebuilt from the record keys when it is gone or damaged. */
async function readPointer(store: SaveStore): Promise<Pointer> {
  const pointer = parsePointer(await store.get(POINTER_KEY));
  if (pointer !== null) return pointer;
  const seqs = (await store.keys())
    .flatMap((key) => key.match(RECORD_KEY)?.[1] ?? [])
    .map(Number)
    .sort((a, b) => b - a);
  return { seq: seqs[0] ?? 0, rotation: seqs.slice(0, ROTATION.length).map(recordKey) };
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
    return text ? (JSON.parse(text) as SaveMeta) : null;
  } catch {
    return null;
  }
}

function requestBrowserPersistence(): Promise<unknown> {
  return globalThis.navigator?.storage?.persist?.() ?? Promise.resolve();
}

/** Builds the save system on a store. `openSaves` picks the store; tests pass their own. */
export function createSaves(store: SaveStore, options: SavesOptions): Saves {
  const { appBuild, tables, now = Date.now, requestPersistence = requestBrowserPersistence } = options;
  const { apis = browserApis(), migrations = MIGRATIONS } = options;
  const gameVersion = migrations.length + 1;

  let blocked = false;
  let persistenceRequested = false;
  let inFlight: Promise<void> | null = null;
  let waiting: WaitingWrite | null = null;

  /** Best effort: a save that went through is not failed by its tidying up. */
  function afterWrite(key: string, savedAt: number): void {
    try {
      apis.localStorage?.setItem(META_KEY, JSON.stringify({ slot: key, savedAt } satisfies SaveMeta));
    } catch {
      // `ab.meta` is only a hint.
    }
    if (!persistenceRequested) {
      persistenceRequested = true;
      void requestPersistence().catch(() => {});
    }
  }

  /** Removes what a crash or an older rotation left. The next write tries again if this fails. */
  async function removeUnlisted(rotation: readonly string[]): Promise<void> {
    try {
      const stale = (await store.keys()).filter((key) => RECORD_KEY.test(key) && !rotation.includes(key));
      await Promise.all(stale.map((key) => store.delete(key)));
    } catch {
      // Only costs space.
    }
  }

  /** New record, then the pointer moves, then the record that fell off the end goes. */
  async function writeRecord(text: string, savedAt: number): Promise<void> {
    const pointer = await readPointer(store);
    const seq = pointer.seq + 1;
    const key = recordKey(seq);
    await store.put(key, text);
    const rotation = [key, ...pointer.rotation].slice(0, ROTATION.length);
    await store.put(POINTER_KEY, JSON.stringify({ seq, rotation } satisfies Pointer));
    await removeUnlisted(rotation);
    afterWrite(key, savedAt);
  }

  function start(text: string, savedAt: number): Promise<void> {
    inFlight = writeRecord(text, savedAt).finally(() => {
      if (waiting === null) inFlight = null;
    });
    return inFlight;
  }

  /**
   * Moves failed records out of the rotation, so the next boot does not try them again and copy them again.
   * A failed record goes to `corrupt-<time>-<name>` first, and only leaves its place once that copy exists.
   */
  async function setAside(pointer: Pointer, failed: readonly TriedRecord[]): Promise<void> {
    const leaving = new Set<string>();
    for (const { name, key, text, problem } of failed) {
      try {
        if (text !== undefined) await store.put(`${CORRUPT_PREFIX}${now()}-${name}`, text);
        if (problem !== 'unreadable') leaving.add(key);
      } catch {
        // Stays where it is: nothing is deleted without its copy.
      }
    }
    if (leaving.size === 0) return;
    try {
      const rotation = pointer.rotation.filter((key) => !leaving.has(key));
      await store.put(POINTER_KEY, JSON.stringify({ seq: pointer.seq, rotation } satisfies Pointer));
      await Promise.all([...leaving].map((key) => store.delete(key)));
    } catch {
      // The next load finds these records where they were.
    }
  }

  async function runRecovery(): Promise<LoadResult> {
    const pointer = await readPointer(store);
    const keys = await store.keys();
    const candidates = [
      ...pointer.rotation.map((key, i) => ({ name: ROTATION[i] as RecordName, key })),
      ...backupCandidates(keys),
    ];

    const failed: TriedRecord[] = [];
    for (const { name, key } of candidates) {
      let text: string | undefined;
      try {
        text = await store.get(key);
      } catch {
        failed.push({ name, key, problem: 'unreadable' });
        continue;
      }
      if (text === undefined) {
        failed.push({ name, key, problem: 'missing' });
        continue;
      }

      const read = readSave(text, migrations);
      if (!read.ok && read.reason === 'newer') {
        // Nothing is written on this path, not even the earlier failures, and `write` refuses from now on.
        blocked = true;
        return { status: 'newerVersion', record: name, saveVersion: read.version, gameVersion };
      }
      if (!read.ok) {
        failed.push({ name, key, text, problem: read.reason });
        continue;
      }

      // Migrations are pure, so nothing is lost by running them first, and a record that fails them never
      // replaces a good backup. The copy still lands before anything migrated can be written.
      const backup = `backup-v${read.version}`;
      if (read.version < gameVersion && key !== backup) {
        await store.put(backup, text).catch(() => {});
      }
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

    await setAside(pointer, failed);
    const anyCorrupt = keys.some((key) => key.startsWith(CORRUPT_PREFIX));
    return failed.length === 0 && !anyCorrupt ? { status: 'empty' } : { status: 'unrecoverable', failures: failed.map(toProblem) };
  }

  return {
    storage: store.kind,

    async load() {
      try {
        return await runRecovery();
      } catch {
        // The store itself failed. Treated as unreadable, so nothing starts over on top of the player's save.
        return { status: 'unrecoverable', failures: [{ record: 'current', reason: 'unreadable' }] };
      }
    },

    write(state) {
      if (blocked) return Promise.reject(new SaveBlockedError());
      const savedAt = now();
      const text = encodeEnvelope(state, savedAt, appBuild);
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

    async corruptRecords() {
      const keys = (await store.keys()).filter((key) => key.startsWith(CORRUPT_PREFIX)).sort();
      const texts = await Promise.all(keys.map((key) => store.get(key)));
      return keys.map((key, i) => ({ key, text: texts[i] ?? '' }));
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
  return createSaves(await openSaveStore(apis), { ...options, apis });
}
