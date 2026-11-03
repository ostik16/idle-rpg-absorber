/**
 * The save envelope (ADR 0003 "Save envelope"): `{ format, version, savedAt, appBuild, checksum, payload }`.
 * Pure, and the only serialiser, so export and import (#36) use the same code as autosave.
 * The checksum covers `JSON.stringify(payload)`, so reformatting a file does not break it but changing a value does.
 */
import type { GameState } from '../state/types';
import { crc32 } from './crc32';
import { MIGRATIONS, migratePayload, SAVE_VERSION, type Migration } from './migrations';
import { validatePayload } from './schema';

export const SAVE_FORMAT = 'idle-rpg-absorber';

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: number;
  appBuild: string;
  checksum: string;
  payload: unknown;
}

/**
 * The text of a save. Nothing later changes it, so the state is free to move on while the write runs.
 * The state itself is not touched: only the copy gets the new `clock.savedAt`.
 */
export function encodeEnvelope(state: GameState, savedAt: number, appBuild: string): string {
  const payload = { ...state, clock: { ...state.clock, savedAt } };
  const envelope: SaveEnvelope = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt,
    appBuild,
    checksum: crc32(JSON.stringify(payload)),
    payload,
  };
  return JSON.stringify(envelope);
}

export type EnvelopeFailure = 'parse' | 'format' | 'checksum';

export type DecodedEnvelope =
  | { ok: true; envelope: SaveEnvelope }
  | { ok: false; reason: EnvelopeFailure }
  /** Newer than this build. Checked before the checksum: a newer build may have changed what it covers. */
  | { ok: false; reason: 'newer'; version: number };

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Reads a save's text and checks its format, version and checksum. Never throws. */
export function decodeEnvelope(text: string, currentVersion: number = SAVE_VERSION): DecodedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'parse' };
  }
  if (parsed === null || typeof parsed !== 'object') return { ok: false, reason: 'format' };

  const envelope = parsed as Partial<SaveEnvelope>;
  if (envelope.format !== SAVE_FORMAT || !isWholeNumber(envelope.version) || envelope.version < 1) {
    return { ok: false, reason: 'format' };
  }
  if (envelope.version > currentVersion) return { ok: false, reason: 'newer', version: envelope.version };
  if (typeof envelope.savedAt !== 'number' || envelope.payload === undefined) return { ok: false, reason: 'format' };
  if (envelope.checksum !== crc32(JSON.stringify(envelope.payload))) return { ok: false, reason: 'checksum' };
  return { ok: true, envelope: envelope as SaveEnvelope };
}

export type RecordFailure = EnvelopeFailure | 'migration' | 'schema';

export type ReadSave =
  | { ok: true; state: GameState; version: number; savedAt: number }
  | { ok: false; reason: RecordFailure }
  | { ok: false; reason: 'newer'; version: number };

/**
 * The whole read of one save's text: envelope, then every missing migration, then the current schema.
 * Pure and never throws. The migrations can be passed in so tests can run a list other than the real one.
 */
export function readSave(text: string, migrations: readonly Migration[] = MIGRATIONS): ReadSave {
  const decoded = decodeEnvelope(text, migrations.length + 1);
  if (!decoded.ok) return decoded;

  const { payload, version, savedAt } = decoded.envelope;
  let migrated: unknown;
  try {
    migrated = migratePayload(payload, version, migrations);
  } catch {
    return { ok: false, reason: 'migration' };
  }
  if (validatePayload(migrated) !== null) return { ok: false, reason: 'schema' };
  return { ok: true, state: migrated as GameState, version, savedAt };
}
