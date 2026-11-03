import { describe, expect, it } from 'vitest';
import { readSave } from '../src/save/envelope';
import { migratePayload, MIGRATIONS, SAVE_VERSION, type Migration } from '../src/save/migrations';
import { reconcile } from '../src/save/reconcile';
import type { GameState } from '../src/state/types';
import { data, envelopeText, newState } from './save-helpers';

// One fixture per version, tests/fixtures/saves/v<N>.json, each a whole save of that version's shape. Fixtures
// are never changed: adding a migration keeps the old fixture and adds v<N+1>.json, so every old version stays covered.
const fixtures = import.meta.glob('./fixtures/saves/v*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const fixtureVersions = Object.keys(fixtures)
  .map((path) => Number(path.match(/v(\d+)\.json$/)?.[1]))
  .sort((a, b) => a - b);

describe('the migration fixtures (ADR 0003)', () => {
  it('has a fixture for every version up to the current one, so each migration has its older shape', () => {
    const versions = Array.from({ length: SAVE_VERSION }, (_, i) => i + 1);
    expect(fixtureVersions).toEqual(versions);
  });

  it('has one migration for each step between versions', () => {
    expect(MIGRATIONS).toHaveLength(SAVE_VERSION - 1);
  });

  it.each(fixtureVersions)('version %i reads, migrates and validates as the current schema', (version) => {
    const read = readSave(fixtures[`./fixtures/saves/v${version}.json`] as string);
    expect(read).toMatchObject({ ok: true, version });
  });

  it.each(fixtureVersions)('version %i holds only ids the tables know, so reconcile leaves it alone', (version) => {
    const read = readSave(fixtures[`./fixtures/saves/v${version}.json`] as string);
    if (!read.ok) throw new Error(read.reason);
    expect(reconcile(read.state, data)).toEqual({ recovered: [], returned: [] });
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
    expect(MIGRATIONS.length).toBe(SAVE_VERSION - 1);
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
