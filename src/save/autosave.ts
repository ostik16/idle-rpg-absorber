/**
 * Autosave timing (ADR 0003 "Writing"): on a timer, when the page is hidden, on `pagehide`, and after
 * irreversible actions. `main` starts it once the game is running.
 * The saves on hide and `pagehide` are only attempts: the browser may end the page before the write lands, and a
 * review saw the `pagehide` save not land on a reload in Chromium. The timer is what limits the loss.
 */
import type { GameState } from '../state/types';
import type { Saves } from './saves';

export interface AutosaveOptions {
  saves: Pick<Saves, 'write'>;
  /** Read at each save, so it always takes the state as it is then. */
  getState: () => GameState;
  /** `save.autosaveSeconds` in data/constants.json, in ms. */
  intervalMs: number;
  /** A failed save is not fatal: the next one tries again. Tell the player (`saveFailureNotice`). */
  onError?: (error: unknown) => void;
  /**
   * Engine event types that mean an irreversible action has been applied, for `onEngineEvents`.
   * `save/` does not import `engine/` (architecture), so `main` lists them.
   */
  saveAfterEvents?: readonly string[];
  /** The page events. Default to the browser's. */
  page?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  host?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export interface Autosave {
  /**
   * Saves the state as it is at this moment. Never rejects. Do not call it straight after `engine.dispatch`: a
   * command only applies at the next step, so that would save the state from before the action. Call it from a
   * hook that runs after the command has applied, or use `onEngineEvents`.
   */
  saveNow(): Promise<void>;
  /**
   * Give it the events the engine reports. Saves once if any is in `saveAfterEvents`. An event is proof that its
   * command has applied, so this is the safe way to save after an irreversible action (spending points, upgrades, selling).
   */
  onEngineEvents(events: readonly { readonly type: string }[]): void;
  stop(): void;
}

export function startAutosave(options: AutosaveOptions): Autosave {
  const { saves, getState, intervalMs, onError = () => {}, saveAfterEvents = [] } = options;
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
    onEngineEvents(events) {
      if (events.some((event) => saveAfterEvents.includes(event.type))) void saveNow();
    },
    stop() {
      clearInterval(timer);
      page.removeEventListener('visibilitychange', onVisibilityChange);
      host.removeEventListener('pagehide', onPageHide);
    },
  };
}
