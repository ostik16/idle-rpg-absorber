/** What the player is told after a load, as copy for the UI to show (ADR 0003, design system voice rules). */
import { InvalidSaveError } from './envelope';
import { RECOVERED_TAB_NAME } from './reconcile';
import { SaveBlockedError, type LoadResult, type RecordName } from './saves';
import type { StorageKind } from './store';

/** Fixed formats from the design system: `12s`, `3m 12s`, `7h 42m`. */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function recordLabel(record: RecordName): string {
  if (record === 'previous') return 'the previous save';
  if (record === 'previous2') return 'the save before the previous one';
  if (record.startsWith('corrupt-')) return 'a save set aside earlier';
  return `the backup of save version ${record.slice('backup-v'.length)}`;
}

function storageNotice(storage: StorageKind): string[] {
  if (storage === 'localStorage') return ['Browser database unavailable, so saves use local storage. Export your save to keep a copy.'];
  if (storage === 'memory') return ['This browser blocks storage, so progress is lost when the tab closes.'];
  return [];
}

function outcomeNotices(result: LoadResult): string[] {
  if (result.status === 'empty') return [];
  if (result.status === 'newerVersion') {
    return [
      `Save version ${result.saveVersion} needs a newer game. This is version ${result.gameVersion}. Update the game to open it. The save is unchanged.`,
    ];
  }
  if (result.status === 'otherTab') return ['This game is open in another tab. Close that tab, then reload here.'];
  if (result.status === 'storeFault') return ['Save storage did not respond. Reload to try again. Nothing was changed.'];
  if (result.status === 'unrecoverable') {
    const kept = result.failures.some((failure) => failure.reason !== 'missing');
    return [`No save could be read. Import a file or start fresh.${kept ? ' The failed saves are kept.' : ''}`];
  }

  const notices: string[] = [];
  if (result.source !== 'current') {
    notices.push(`The newest save could not be read. Loaded ${recordLabel(result.source)}, ${formatAge(result.ageMs)} old.`);
  }
  const { recovered, returned } = result.reconcile;
  if (recovered.length > 0) {
    const stacks = recovered.length === 1 ? '1 item' : `${recovered.length} items`;
    notices.push(`${stacks} moved to ${RECOVERED_TAB_NAME}: no longer in the game.`);
  }
  for (const { name } of returned) notices.push(`${name} returned to the city: area or enemy no longer in the game.`);
  return notices;
}

/** The line to show when an autosave fails: pass it the error `startAutosave` gives to `onError`. */
export function saveFailureNotice(error: unknown): string {
  if (error instanceof SaveBlockedError && error.reason === 'otherTab') {
    return 'Another tab is saving this game, so this tab has stopped saving. Close this tab and use the other one.';
  }
  if (error instanceof InvalidSaveError) return 'Save refused: the game state has a fault. Your earlier saves are safe.';
  return 'Save failed. The next autosave tries again.';
}

/** Every line the player should see after this load, most important first. */
export function saveNotices(result: LoadResult, storage: StorageKind): string[] {
  // In these two this tab saves nothing anywhere, so a line about where saves go would be false.
  const saving = result.status !== 'storeFault' && result.status !== 'otherTab';
  return saving ? [...outcomeNotices(result), ...storageNotice(storage)] : outcomeNotices(result);
}
