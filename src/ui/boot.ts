// Boot timing. Pure apart from the default `wait`, so it can be tested without a clock.

const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves with the task's result, but no sooner than `minMs`, so a fast boot does not flicker the splash. */
export async function holdAtLeast<T>(task: Promise<T>, minMs: number, wait: (ms: number) => Promise<void> = timeout): Promise<T> {
  const [result] = await Promise.all([task, wait(minMs)]);
  return result;
}

/**
 * Resolves after the browser has drawn the last render, so a blocking job started next does not freeze the old
 * screen. A hidden tab never fires animation frames, so a timer ends the wait too.
 */
export const nextPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 250);
  });
