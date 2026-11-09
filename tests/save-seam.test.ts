// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import { createSaveSeam } from '../src/save-seam';
import { envelopeText, fakeLocalStorage, newState } from './save-helpers';

const data = loadGameData();
const NOW = 1_780_000_100_000;

/** The keys of the save records in a fake localStorage (`ab.save.record-<n>`). */
function recordKeys(storage: ReturnType<typeof fakeLocalStorage>): string[] {
  return Array.from({ length: storage.length }, (_, i) => storage.key(i) as string).filter((key) => /^ab\.save\.record-/.test(key));
}

describe('save seam', () => {
  it('starts a new game and writes it at once, then a later page loads it with the roster', async () => {
    const apis = { localStorage: fakeLocalStorage() };
    const writer = createSaveSeam('test', apis);
    const opened = await writer.open(data, NOW);
    expect(opened.status).toBe('play');
    if (opened.status !== 'play') return;
    const state = newState(50);
    const autosave = writer.startAutosave({ data, getState: () => state });
    await autosave.saveNow();
    autosave.stop();

    const loaded = await createSaveSeam('test', apis).open(data, NOW);
    expect(loaded.status).toBe('play');
    if (loaded.status === 'play') expect(loaded.state.roster.map((c) => [c.name, c.gold])).toEqual([['Kaela', 50]]);
  });

  it('writes a new game as soon as autosave starts, so closing the tab at once keeps it', async () => {
    const apis = { localStorage: fakeLocalStorage() };
    const seam = createSaveSeam('test', apis);
    const opened = await seam.open(data, NOW);
    if (opened.status !== 'play') throw new Error('expected play');
    const autosave = seam.startAutosave({ data, getState: () => opened.state });
    await new Promise((resolve) => setTimeout(resolve, 20));
    autosave.stop();

    const reloaded = await createSaveSeam('test', apis).open(data, NOW);
    expect(reloaded.status).toBe('play');
    expect(recordKeys(apis.localStorage).length).toBeGreaterThan(0);
  });

  it('blocks on a save from a newer game, with the update line', async () => {
    const localStorage = fakeLocalStorage();
    const apis = { localStorage };
    const seam = createSaveSeam('test', apis);
    const first = await seam.open(data, NOW);
    if (first.status !== 'play') throw new Error('expected play');
    const autosave = seam.startAutosave({ data, getState: () => newState() });
    await autosave.saveNow();
    autosave.stop();
    for (const key of recordKeys(localStorage)) localStorage.setItem(key, envelopeText({ whatever: 'shape' }, 99));

    const blocked = await createSaveSeam('test', apis).open(data, NOW);
    expect(blocked.status).toBe('blocked');
    if (blocked.status === 'blocked') expect(blocked.lines[0]).toContain('needs a newer game');
  });
});
