/**
 * Autosave timing (ADR 0003 "Writing"): on a timer, when the page is hidden, on `pagehide`, and whenever
 * `saveNow` is called after an irreversible action. `main` starts it once the game is running.
 */
import type { GameState } from '../state/types';
import type { Saves } from './saves';

export interface AutosaveOptions {
  saves: Pick<Saves, 'write'>;
  /** Read at each save, so it always takes the state as it is then. */
  getState: () => GameState;
  /** `save.autosaveSeconds` in data/constants.json, in ms. */
  intervalMs: number;
  /** A failed save is not fatal: the next one tries again. Called with what went wrong. */
  onError?: (error: unknown) => void;
  /** The page events. Default to the browser's. */
  page?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  host?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export interface Autosave {
  /** Saves now, for irreversible actions (spending points, upgrades, selling). Never rejects. */
  saveNow(): Promise<void>;
  stop(): void;
}

export function startAutosave(options: AutosaveOptions): Autosave {
  const { saves, getState, intervalMs, onError = () => {} } = options;
  const { page = globalThis.document, host = globalThis.window } = options;

  async function saveNow(): Promise<void> {
    try {
      await saves.write(getState());
    } catch (error) {
      onError(error);
    }
  }

  const onVisibilityChange = (): void => {
    if (page.visibilityState === 'hidden') void saveNow();
  };
  const onPageHide = (): void => void saveNow();

  const timer = setInterval(() => void saveNow(), intervalMs);
  page.addEventListener('visibilitychange', onVisibilityChange);
  host.addEventListener('pagehide', onPageHide);

  return {
    saveNow,
    stop() {
      clearInterval(timer);
      page.removeEventListener('visibilitychange', onVisibilityChange);
      host.removeEventListener('pagehide', onPageHide);
    },
  };
}
