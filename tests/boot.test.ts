import { describe, expect, it } from 'vitest';
import { holdAtLeast } from '../src/ui/boot';

/** A `wait` the test finishes by hand, recording the time it was asked for. */
function manualWait() {
  const asked: number[] = [];
  let finish = () => {};
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      asked.push(ms);
      finish = resolve;
    });
  return { asked, wait, finish: () => finish() };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('holdAtLeast', () => {
  it('waits for the minimum time when the task is already done', async () => {
    const { asked, wait, finish } = manualWait();
    let done = false;
    const held = holdAtLeast(Promise.resolve('save'), 1000, wait).then((result) => {
      done = true;
      return result;
    });

    await flush();
    expect(asked).toEqual([1000]);
    expect(done).toBe(false);

    finish();
    await expect(held).resolves.toBe('save');
  });

  it('waits for the task when it outlasts the minimum time', async () => {
    let finishTask = (_: string) => {};
    const task = new Promise<string>((resolve) => {
      finishTask = resolve;
    });
    let done = false;
    const held = holdAtLeast(task, 1000, () => Promise.resolve()).then((result) => {
      done = true;
      return result;
    });

    await flush();
    expect(done).toBe(false);

    finishTask('save');
    await expect(held).resolves.toBe('save');
  });

  it('passes a failed task on', async () => {
    await expect(holdAtLeast(Promise.reject(new Error('corrupt')), 1000, () => Promise.resolve())).rejects.toThrow('corrupt');
  });
});
