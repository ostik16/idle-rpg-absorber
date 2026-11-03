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

export function fakeLocalStorage(): LocalStorageApi {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
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
