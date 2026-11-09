/**
 * The clock the dev build hands to the frame loop (#74). It is real time plus an offset, so a speed-up or a skip
 * only changes the time `advanceTo` is given: the engine's normal step, catch-up or offline estimate does the work.
 * After a skip the saved clock is ahead of the real one, so a reload shows the clock-rewind notice. That is harmless.
 */
let offsetMs = 0;
let speed = 1;
let lastRealMs = Date.now();

export function devNow(): number {
  const real = Date.now();
  offsetMs += (real - lastRealMs) * (speed - 1);
  lastRealMs = real;
  return real + offsetMs;
}

/** Runs the game `factor` times faster from now on. Not 0: a paused clock would never apply a queued command. */
export function setSpeed(factor: number): void {
  devNow(); // settle the time passed at the old speed first
  speed = factor;
}

export const getSpeed = (): number => speed;

/** Moves the clock `ms` ahead; the next frame runs that gap through the engine. */
export function skipTime(ms: number): void {
  offsetMs += ms;
}
