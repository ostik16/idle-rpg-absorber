import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/save/crc32';
import { decodeEnvelope, encodeEnvelope, readSave, SAVE_FORMAT, type SaveEnvelope } from '../src/save/envelope';
import { SAVE_VERSION } from '../src/save/migrations';
import { validatePayload } from '../src/save/schema';
import type { CharacterState } from '../src/state/types';
import { envelopeText, newState, T0 } from './save-helpers';

describe('crc32', () => {
  it('matches the published check value for "123456789"', () => {
    expect(crc32('123456789')).toBe('cbf43926');
  });

  it('is 00000000 for nothing, and always 8 digits', () => {
    expect(crc32('')).toBe('00000000');
    expect(crc32('a')).toBe('e8b7be43');
  });

  it('reads text as UTF-8, so names outside ASCII count by their bytes', () => {
    expect(crc32('é')).toBe('0e048d3e');
  });
});

describe('the envelope (ADR 0003)', () => {
  const text = encodeEnvelope(newState(50), T0 + 5, 'build-1');

  it('has the fields the ADR lists, with the checksum of the serialised payload', () => {
    const envelope = JSON.parse(text) as SaveEnvelope;
    expect(envelope).toMatchObject({ format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: T0 + 5, appBuild: 'build-1' });
    expect(envelope.checksum).toBe(crc32(JSON.stringify(envelope.payload)));
  });

  it('writes the time into the copy and leaves the state alone', () => {
    const state = newState();
    const before = structuredClone(state);
    const envelope = JSON.parse(encodeEnvelope(state, T0 + 5, 'build-1')) as SaveEnvelope;
    expect((envelope.payload as typeof state).clock.savedAt).toBe(T0 + 5);
    expect(state).toEqual(before);
  });

  it('reads back the same state', () => {
    const read = readSave(text);
    expect(read).toMatchObject({ ok: true, version: SAVE_VERSION, savedAt: T0 + 5 });
    if (!read.ok) throw new Error('unreachable');
    expect(read.state).toEqual({ ...newState(50), clock: { ...newState().clock, savedAt: T0 + 5 } });
  });

  it('still passes when a file is only reformatted', () => {
    expect(decodeEnvelope(JSON.stringify(JSON.parse(text), null, 2))).toMatchObject({ ok: true });
  });

  it.each([
    ['cut short', text.slice(0, text.length / 2), 'parse'],
    ['not JSON', 'nonsense', 'parse'],
    ['not an object', '12', 'format'],
    ['another format', text.replace(SAVE_FORMAT, 'other-game'), 'format'],
    ['a changed value', text.replace('"gold":50', '"gold":51'), 'checksum'],
  ])('refuses text that is %s', (_label, bad, reason) => {
    expect(decodeEnvelope(bad)).toEqual({ ok: false, reason });
    expect(readSave(bad)).toEqual({ ok: false, reason });
  });

  it('calls a newer version newer, whatever its checksum says', () => {
    const newer = envelopeText({ shape: 'unknown' }, SAVE_VERSION + 1).replace(/"checksum":"\w+"/, '"checksum":"bad"');
    expect(decodeEnvelope(newer)).toEqual({ ok: false, reason: 'newer', version: SAVE_VERSION + 1 });
  });

  it('refuses a good envelope whose payload does not fit the schema', () => {
    expect(readSave(envelopeText({ clock: {} }, SAVE_VERSION))).toEqual({ ok: false, reason: 'schema' });
  });
});

describe('the schema (ADR 0003)', () => {
  it('accepts a new game and a game with a fight, potions and streams', () => {
    const state = newState();
    expect(validatePayload(state)).toBeNull();
    const character = state.roster[0]!;
    character.fight = { enemyId: 'x', enemyHp: 1, ticks: 2 };
    character.rng = { combat: [1, 2, 3, 4], drops: [1, 2, 3, 4], search: [1, 2, 3, 4], death: [1, 2, 3, 4] };
    state.pendingSummary = { seconds: 1, discardedSeconds: 0, characters: [] };
    expect(validatePayload(state)).toBeNull();
  });

  it('accepts a pending summary with deaths and refuses deaths that is not a number', () => {
    const state = newState();
    const summary = { characterId: 'c1', kills: 1, xp: 1, gold: 1, items: {}, deaths: 2 };
    state.pendingSummary = { seconds: 1, discardedSeconds: 0, characters: [summary] };
    expect(validatePayload(state)).toBeNull();
    state.pendingSummary = { seconds: 1, discardedSeconds: 0, characters: [{ ...summary, deaths: 'two' as never }] };
    expect(validatePayload(state)).toContain('deaths');
  });

  it.each<[string, (state: ReturnType<typeof newState>) => void, string]>([
    ['a missing section', (s) => void delete (s as Partial<typeof s>).bestiary, 'payload.bestiary'],
    ['a number that is a string', (s) => void ((s.roster[0] as { gold: unknown }).gold = '5'), 'payload.roster[0].gold'],
    ['an unknown phase', (s) => void ((s.roster[0] as { phase: string }).phase = 'dancing'), 'payload.roster[0].phase'],
    ['a stack without an id', (s) => void delete (s.roster[0]!.bag[0] as { itemId?: string }).itemId, 'payload.roster[0].bag[0].itemId'],
    ['a stream of the wrong length', (s) => void (s.roster[0]!.rng = { combat: [1], drops: [1], search: [1], death: [1] } as never), 'payload.roster[0].rng.combat'],
    ['a missing point mark', (s) => void delete (s.roster[0] as Partial<CharacterState>).highestMarkReached, 'payload.roster[0].highestMarkReached'],
    ['a missing stay in city', (s) => void delete (s.roster[0] as Partial<CharacterState>).stayInCity, 'payload.roster[0].stayInCity'],
    ['a stay in city that is not true or false', (s) => void ((s.roster[0] as { stayInCity: unknown }).stayInCity = 1), 'payload.roster[0].stayInCity'],
    ['streams without death', (s) => void (s.roster[0]!.rng = { combat: [1, 2, 3, 4], drops: [1, 2, 3, 4], search: [1, 2, 3, 4] } as never), 'payload.roster[0].rng.death'],
  ])('names %s', (_label, damage, path) => {
    const state = newState();
    damage(state);
    expect(validatePayload(state)).toContain(path);
  });

  it('refuses two characters with one id, which the engine could not run', () => {
    const state = newState();
    state.roster.push(structuredClone(state.roster[0]!));
    expect(validatePayload(state)).toContain('duplicate character id');
  });
});
