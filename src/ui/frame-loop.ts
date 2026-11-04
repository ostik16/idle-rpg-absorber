// The only caller of `advanceTo` in the running game (ADR 0002). Neither the frame nor the tab event is the clock;
// both only ask the engine to catch up to `Date.now()`.
import type { Engine } from '../engine/engine';

/**
 * Advances the engine on every animation frame while the tab is visible, and catches up on return.
 * `refresh` publishes state to the UI. It runs at most once per frame, and only when time moved, so the rate
 * follows `combat.tickMs` rather than the frame rate (ADR 0001). A return always refreshes, whatever moved.
 *
 * If either one throws, the loop stops for good and calls `onFailure` once. A failed `advanceTo` leaves state partly
 * stepped, so another call would only build on it, and the caller must stop saving it too.
 * Returns a function that stops the loop.
 */
export function startFrameLoop(
  engine: Pick<Engine, 'advanceTo'>,
  refresh: () => void,
  onFailure: (error: unknown) => void,
): () => void {
  let frame: number | null = null;

  /** Runs one turn of the loop and schedules the next. */
  function turn(work: () => void): void {
    try {
      work();
    } catch (error) {
      stop();
      onFailure(error);
      return;
    }
    frame = requestAnimationFrame(onFrame);
  }

  function onFrame(): void {
    turn(() => {
      const { mode, steps } = engine.advanceTo(Date.now());
      if (steps > 0 || mode !== 'step') refresh();
    });
  }

  function stopFrames(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function onVisibilityChange(): void {
    stopFrames();
    if (document.visibilityState !== 'visible') return;
    turn(() => {
      engine.advanceTo(Date.now());
      refresh();
    });
  }

  function stop(): void {
    stopFrames();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  if (document.visibilityState === 'visible') frame = requestAnimationFrame(onFrame);

  return stop;
}
