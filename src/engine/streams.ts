/**
 * Per-character random streams (ADR 0002 "RNG"). One stream per purpose, so a change in one system
 * does not reshuffle the others. The generator is `createStream` from game/rng.ts; nothing new here.
 */
import { createStream, rngFromState, type Rng } from '../game/rng';
import type { CharacterRngState, StreamName } from '../state/types';

export type CharacterStreams = Readonly<Record<StreamName, Rng>>;

/**
 * The streams of one character. Fresh, derived from `masterSeed` and the id, or continued from `saved`
 * (as read by `readStreamStates`). A stream missing from `saved` starts fresh.
 */
export function createCharacterStreams(
  masterSeed: number,
  characterId: string,
  saved?: Partial<CharacterRngState>,
): CharacterStreams {
  const make = (name: StreamName): Rng => {
    const state = saved?.[name];
    return state ? rngFromState(state) : createStream(masterSeed, characterId, name);
  };
  return { combat: make('combat'), drops: make('drops'), search: make('search') };
}

/** Current state of every stream, for saving (ADR 0003). */
export function readStreamStates(streams: CharacterStreams): CharacterRngState {
  return {
    combat: streams.combat.getState(),
    drops: streams.drops.getState(),
    search: streams.search.getState(),
  };
}
