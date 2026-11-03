/**
 * The save system (ADR 0003). What `main` calls:
 *
 *   const saves = await openSaves({ appBuild, tables: data });
 *   const result = await saves.load();
 *   // result.status: 'loaded' uses result.state; 'empty' starts a new game;
 *   // 'newerVersion' does not start the game; 'unrecoverable' shows the recovery screen.
 *   for (const line of saveNotices(result, saves.storage)) show(line);
 *   const autosave = startAutosave({
 *     saves,
 *     getState: () => engine.state,
 *     intervalMs: requireNumberConstant(data, 'save.autosaveSeconds') * 1000,
 *   });
 *   // after an irreversible action: void autosave.saveNow();
 *
 * Export and import (#36) build on `encodeEnvelope`, `decodeEnvelope`, `readSave` and `corruptRecords`.
 */
export { startAutosave, type Autosave, type AutosaveOptions } from './autosave';
export { crc32 } from './crc32';
export {
  decodeEnvelope,
  encodeEnvelope,
  readSave,
  SAVE_FORMAT,
  type DecodedEnvelope,
  type ReadSave,
  type RecordFailure,
  type SaveEnvelope,
} from './envelope';
export { SAVE_VERSION } from './migrations';
export { formatAge, saveNotices } from './notices';
export { isRecoveredTab, RECOVERED_TAB_NAME, type ReconcileReport, type ReconcileTables, type RecoveredTab } from './reconcile';
export {
  createSaves,
  openSaves,
  readSaveMeta,
  SaveBlockedError,
  type LoadResult,
  type RecordName,
  type RecordProblem,
  type SaveMeta,
  type Saves,
  type SavesOptions,
} from './saves';
export type { StorageKind } from './store';
