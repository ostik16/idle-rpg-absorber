import { describe, expect, it } from 'vitest';
import { readSave } from '../src/save/envelope';
import { migratePayload, SAVE_VERSION, type Migration } from '../src/save/migrations';
import { createStream } from '../src/game/rng';
import { createCharacterStreams, readStreamStates } from '../src/engine/streams';
import { reconcile } from '../src/save/reconcile';
import { validatePayload } from '../src/save/schema';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { GameState } from '../src/state/types';
import { data, envelopeText, newState, T0 } from './save-helpers';

// One fixture per version, tests/fixtures/saves/v<N>.json. Each is the same game, saved in that version's shape.
// Fixtures of released versions are never changed: a new migration keeps them and adds v<N+1>.json, so every old
// version has to migrate to exactly what the newest fixture holds.
const fixtures = import.meta.glob('./fixtures/saves/v*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const fixtureVersions = Object.keys(fixtures)
  .map((path) => Number(path.match(/v(\d+)\.json$/)?.[1]))
  .sort((a, b) => a - b);

function fixtureText(version: number): string {
  return fixtures[`./fixtures/saves/v${version}.json`] as string;
}

describe('the migration fixtures (ADR 0003)', () => {
  it('has a fixture for every version up to the current one, so each migration has its older shape', () => {
    const versions = Array.from({ length: SAVE_VERSION }, (_, i) => i + 1);
    expect(fixtureVersions).toEqual(versions);
  });

  it.each(fixtureVersions)('version %i migrates to exactly what the current fixture holds', (version) => {
    const read = readSave(fixtureText(version));
    if (!read.ok) throw new Error(read.reason);
    expect(read.version).toBe(version);
    const current = JSON.parse(fixtureText(SAVE_VERSION)) as { payload: unknown };
    expect(read.state).toStrictEqual(current.payload);
  });

  it.each(fixtureVersions)('version %i keeps the game in it: its character, numbers and bag', (version) => {
    const read = readSave(fixtureText(version));
    if (!read.ok) throw new Error(read.reason);
    expect(read.savedAt).toBe(1_780_000_001_000);
    expect(read.state.clock).toMatchObject({ lastSimulatedAt: 1_780_000_001_000, masterSeed: 7 });
    expect(read.state.account).toMatchObject({ nextCharacterNumber: 2, unlockedSlots: 1 });
    expect(read.state.roster).toHaveLength(1);
    expect(read.state.roster[0]).toMatchObject({ id: 'c1', name: 'Kaela', gold: 0, level: 1, health: 70, phase: 'idle' });
    expect(read.state.roster[0]?.bag).toEqual([{ itemId: 'minor-health-potion', bonuses: [], upgradeLevel: 0, qty: 10 }]);
  });

  it.each(fixtureVersions)('version %i holds only ids the tables know, so reconcile leaves it alone', (version) => {
    const read = readSave(fixtureText(version));
    if (!read.ok) throw new Error(read.reason);
    expect(reconcile(read.state, data)).toEqual({ recovered: [], returned: [] });
  });

  it('a migration that changes a value is caught', () => {
    const changesLevel: Migration = (payload) => {
      const state = structuredClone(payload) as GameState;
      state.roster[0]!.level = 99;
      return state;
    };
    const old = JSON.parse(fixtureText(1)) as { payload: unknown };
    const read = readSave(envelopeText(old.payload, 1), [changesLevel]);
    if (!read.ok) throw new Error(read.reason);
    expect(read.state).not.toStrictEqual(old.payload);
  });
});

describe('the state this build makes', () => {
  it('a character from createCharacterState fits the schema, with and without its streams', () => {
    const state = createGameState(7, T0, data);
    const character = createCharacterState('c1', 'Kaela', data);
    state.roster.push(character);
    expect(validatePayload(state)).toBeNull();

    character.rng = readStreamStates(createCharacterStreams(7, 'c1'));
    expect(validatePayload(state)).toBeNull();
  });

  it('the current fixture loads with the fields of the progression and farming work', () => {
    const read = readSave(fixtureText(SAVE_VERSION));
    if (!read.ok) throw new Error(read.reason);
    const character = read.state.roster[0]!;
    expect(character.highestMarkReached).toBe(0);
    expect(character.stayInCity).toBe(false);
    expect(character.rng?.death).toEqual(createStream(7, 'c1', 'death').getState());
  });

  it('the current fixture holds every field a new character has, so it cannot fall behind the state', () => {
    const read = readSave(fixtureText(SAVE_VERSION));
    if (!read.ok) throw new Error(read.reason);
    const expected = Object.keys(createCharacterState('c1', 'Kaela', data)).sort();
    const held = Object.keys(read.state.roster[0]!).filter((key) => key !== 'rng').sort();
    expect(held).toEqual(expected);
  });
});

/** Two steps of the kind a real migration is: a renamed field, then a new one. */
const renameCash: Migration = (payload) => {
  const { cash, ...rest } = payload as { cash: number };
  return { ...rest, gold: cash };
};
const addTitle: Migration = (payload) => ({ ...(payload as object), title: 'none' });

describe('running migrations', () => {
  it('runs nothing on a payload that is already current', () => {
    const payload = newState();
    expect(migratePayload(payload, SAVE_VERSION)).toBe(payload);
  });

  it('runs every missing step, in order', () => {
    expect(migratePayload({ cash: 5 }, 1, [renameCash, addTitle])).toEqual({ gold: 5, title: 'none' });
  });

  it('starts from the version the payload has', () => {
    expect(migratePayload({ gold: 5 }, 2, [renameCash, addTitle])).toEqual({ gold: 5, title: 'none' });
  });

  it('does not change the old payload', () => {
    const old = { cash: 5 };
    migratePayload(old, 1, [renameCash]);
    expect(old).toEqual({ cash: 5 });
  });

  it('validates the result against the current schema, after the migrations', () => {
    const { roster, ...rest } = newState();
    const old = { ...rest, characters: roster };
    const rename: Migration = (payload) => {
      const { characters, ...others } = payload as typeof old;
      return { ...others, roster: characters };
    };
    expect(readSave(envelopeText(old, 1), [])).toEqual({ ok: false, reason: 'schema' });
    const read = readSave(envelopeText(old, 1), [rename]);
    expect(read).toMatchObject({ ok: true, version: 1 });
    expect((read as { state: GameState }).state.roster).toEqual(roster);
  });

  it('calls it a failed migration when a step throws', () => {
    const broken: Migration = () => {
      throw new Error('bug');
    };
    expect(readSave(envelopeText(newState(), 1), [broken])).toEqual({ ok: false, reason: 'migration' });
  });

  it('treats a version past the list as newer than the game', () => {
    expect(readSave(envelopeText(newState(), 3), [renameCash])).toEqual({ ok: false, reason: 'newer', version: 3 });
  });
});
