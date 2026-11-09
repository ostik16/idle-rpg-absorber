// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import { createSaveSeam } from '../src/save-seam';

const data = loadGameData();
/** localStorage is the fallback store (ADR 0003), so a Map-backed one stands in for the disk. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe('save seam', () => {
  it('starts a new game when nothing is saved, then loads what autosave wrote', async () => {
    const apis = { localStorage: fakeStorage() };
    const first = await createSaveSeam('test', apis).open(data, 1_000);
    expect(first.status).toBe('play');
    if (first.status !== 'play') return;

    const seam = createSaveSeam('test', apis);
    const again = createSaveSeam('test', apis);
    await seam.open(data, 1_000);
    await seam.startAutosave({ data, getState: () => first.state }).saveNow();

    const second = await again.open(data, 2_000);
    expect(second.status).toBe('play');
    if (second.status === 'play') expect(second.state.clock).toEqual({ ...first.state.clock, savedAt: expect.any(Number) });
  });
});
