/** Shared by the save tests: real data, a plain state and direct access to what a store holds. */
import { loadGameData } from '../src/data/game-data';
import { crc32 } from '../src/save/crc32';
import { SAVE_FORMAT } from '../src/save/envelope';
import type { LocalStorageApi, SaveStore } from '../src/save/store';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { GameState } from '../src/state/types';

export const data = loadGameData();
export const T0 = 1_780_000_000_000;

/** A game with one character, Kaela. `gold` tells saves apart in the tests. */
export function newState(gold = 0): GameState {
  const state = createGameState(7, T0, data);
  const character = createCharacterState('c1', 'Kaela', data);
  character.gold = gold;
  state.roster.push(character);
  return state;
}

/** The text of a save of any version, for records this build would not write itself. */
export function envelopeText(payload: unknown, version: number, savedAt = T0): string {
  const checksum = crc32(JSON.stringify(payload));
  return JSON.stringify({ format: SAVE_FORMAT, version, savedAt, appBuild: 'test', checksum, payload });
}

/** `capacity` is in characters of keys and values. Past it, a write fails as a full `localStorage` does. */
export function fakeLocalStorage(capacity = Number.POSITIVE_INFINITY): LocalStorageApi {
  const entries = new Map<string, string>();
  const used = (): number => [...entries].reduce((total, [key, value]) => total + key.length + value.length, 0);
  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      const replaced = entries.has(key) ? key.length + (entries.get(key) as string).length : 0;
      if (used() - replaced + key.length + value.length > capacity) throw new DOMException('full', 'QuotaExceededError');
      entries.set(key, value);
    },
    removeItem: (key) => void entries.delete(key),
  };
}

/**
 * Web Locks across the tabs of one browser. As in a browser, a lock is held until the promise from its callback
 * settles. `release` is the page going away, which ends the locks however that promise stands.
 */
export function fakeLocks() {
  const held = new Set<string>();
  const request = ((name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    if (held.has(name)) return Promise.resolve(callback(null));
    held.add(name);
    const result = Promise.resolve(callback({ name, mode: 'exclusive' }));
    return result.finally(() => held.delete(name));
  }) as LockManager['request'];
  return { request, held, release: () => held.clear() };
}

/** The live record keys, newest first. */
export async function rotationOf(store: SaveStore): Promise<string[]> {
  const pointer = await store.get('pointer');
  return (JSON.parse(pointer ?? '{"rotation":[]}') as { rotation: string[] }).rotation;
}

/** Every key and value in a store, to compare before and after. */
export async function snapshot(store: SaveStore): Promise<Record<string, string | undefined>> {
  const keys = (await store.keys()).sort();
  return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await store.get(key)] as const)));
}
