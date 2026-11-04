/**
 * The save system (ADR 0003). What `main` calls:
 *
 *   const saves = await openSaves({ appBuild, tables: data });
 *   const result = await saves.load();
 *   for (const line of saveNotices(result, saves.storage)) show(line);
 *   // result.status:
 *   //   'loaded': use result.state.    'empty': start a new game.
 *   //   'unrecoverable': the recovery screen, import a file or start fresh.
 *   //   'newerVersion', 'storeFault': do not start the game. Writes are refused, so the save stays safe.
 *
 *   const autosave = startAutosave({
 *     saves,
 *     getState: () => engine.state,
 *     intervalMs: requireNumberConstant(data, 'save.autosaveSeconds') * 1000,
 *     onError: (error) => show(saveFailureNotice(error)),
 *     saveAfterEvents: ['characterPointsSpent'],
 *   });
 *   // Wherever `main` or the store drains engine events, after the step that applied the command:
 *   autosave.onEngineEvents(events);
 *   // Not `autosave.saveNow()` after `dispatch`: the command has not applied yet, so that saves the old state.
 *
 * Export and import (#36) build on `encodeEnvelope`, `decodeEnvelope`, `readSave`, `reconcile`, and on
 * `currentText`, `backupCurrent` and `corruptRecords` of `Saves`.
 */
export { startAutosave, type Autosave, type AutosaveOptions } from './autosave';
export { crc32 } from './crc32';
export {
  decodeEnvelope,
  encodeEnvelope,
  InvalidSaveError,
  readSave,
  SAVE_FORMAT,
  type DecodedEnvelope,
  type ReadSave,
  type RecordFailure,
  type SaveEnvelope,
} from './envelope';
export { SAVE_VERSION } from './migrations';
export { formatAge, saveFailureNotice, saveNotices } from './notices';
export { isRecoveredTab, reconcile, RECOVERED_TAB_NAME, type ReconcileReport, type ReconcileTables, type RecoveredTab } from './reconcile';
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
export { validatePayload } from './schema';
export type { StorageKind } from './store';
