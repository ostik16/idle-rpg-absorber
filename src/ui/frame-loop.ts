// The only caller of `advanceTo` in the running game (ADR 0002). Neither the frame nor the tab event is the clock;
// both only ask the engine to catch up to `Date.now()`.
import type { Engine } from '../engine/engine';

/**
 * Advances the engine on every animation frame while the tab is visible, and catches up on return.
 * `refresh` publishes state to the UI. It runs at most once per frame, and only when time moved, so the rate
 * follows `combat.tickMs` rather than the frame rate (ADR 0001). A return always refreshes, whatever moved.
 * Returns a function that stops the loop.
 */
export function startFrameLoop(engine: Pick<Engine, 'advanceTo'>, refresh: () => void): () => void {
  let frame: number | null = null;

  function onFrame(): void {
    const { mode, steps } = engine.advanceTo(Date.now());
    if (steps > 0 || mode !== 'step') refresh();
    frame = requestAnimationFrame(onFrame);
  }

  function stopFrames(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function onVisibilityChange(): void {
    stopFrames();
    if (document.visibilityState !== 'visible') return;
    engine.advanceTo(Date.now());
    refresh();
    frame = requestAnimationFrame(onFrame);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  if (document.visibilityState === 'visible') frame = requestAnimationFrame(onFrame);

  return () => {
    stopFrames();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
