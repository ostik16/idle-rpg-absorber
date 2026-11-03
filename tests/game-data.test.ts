import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import { createGameData, loadGameData, requireConstant, requireNumberConstant } from '../src/data/game-data';

const fixture = createGameData({
  constants: {
    combat: { tickMs: 100, undecided: null },
    list: [{ id: 'a', amount: 5 }],
    flag: true,
    name: 'text',
  },
  items: [{ id: 'sword', name: 'Sword' }],
});

describe('requireConstant (ADR 0002 "Reading data")', () => {
  it('returns the value at a dotted path', () => {
    expect(requireConstant(fixture, 'combat.tickMs')).toBe(100);
    expect(requireConstant(fixture, 'flag')).toBe(true);
    expect(requireConstant(fixture, 'name')).toBe('text');
    expect(requireConstant(fixture, 'combat')).toEqual({ tickMs: 100, undecided: null });
  });

  it('reaches into arrays by index', () => {
    expect(requireConstant(fixture, 'list.0.amount')).toBe(5);
  });

  it('throws a clear error naming the path when the value is null', () => {
    expect(() => requireConstant(fixture, 'combat.undecided')).toThrow(/"combat\.undecided" is null/);
  });

  it('throws a clear error naming the path when the value is missing', () => {
    expect(() => requireConstant(fixture, 'combat.missing')).toThrow(/"combat\.missing" is missing/);
    expect(() => requireConstant(fixture, 'nothing.here')).toThrow(/"nothing\.here" is missing/);
    expect(() => requireConstant(fixture, 'combat.tickMs.deeper')).toThrow(/"combat\.tickMs\.deeper" is missing/);
    expect(() => requireConstant(fixture, '')).toThrow(/is missing/);
  });

  it('does not find inherited properties', () => {
    expect(() => requireConstant(fixture, 'combat.toString')).toThrow(/is missing/);
    expect(() => requireConstant(fixture, 'constructor')).toThrow(/is missing/);
  });

  it('requireNumberConstant also needs a finite number', () => {
    expect(requireNumberConstant(fixture, 'combat.tickMs')).toBe(100);
    expect(() => requireNumberConstant(fixture, 'name')).toThrow(/"name" must be a finite number/);
    expect(() => requireNumberConstant(fixture, 'combat.undecided')).toThrow(/is null/);
  });

  it('reads the real constants', () => {
    const data = loadGameData();
    expect(requireConstant(data, 'combat.tickMs')).toBe(constants.combat.tickMs);
    expect(requireConstant(data, 'engine.maxStepsPerFrame')).toBe(constants.engine.maxStepsPerFrame);
    expect(requireConstant(data, 'potions.tiers.0.id')).toBe('minor');
  });
});

describe('GameData', () => {
  function isDeepFrozen(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return true;
    return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
  }

  it('is frozen all the way down', () => {
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(Object.isFrozen(fixture.constants)).toBe(true);
    expect(isDeepFrozen(fixture)).toBe(true);
    expect(isDeepFrozen(loadGameData())).toBe(true);
  });

  it('refuses writes', () => {
    const writable = fixture as unknown as { constants: { combat: { tickMs: number } }; items: { id: string }[] };
    expect(() => {
      writable.constants.combat.tickMs = 1;
    }).toThrow(TypeError);
    expect(() => {
      writable.items.push({ id: 'x' });
    }).toThrow(TypeError);
    expect(requireConstant(fixture, 'combat.tickMs')).toBe(100);
  });

  it('is a copy: the input stays editable and the JSON modules are left alone', () => {
    const input = { combat: { tickMs: 100 } };
    const data = createGameData({ constants: input });
    input.combat.tickMs = 5;
    expect(requireConstant(data, 'combat.tickMs')).toBe(100);
    expect(Object.isFrozen(constants)).toBe(false);
    expect(Object.isFrozen(constants.combat)).toBe(false);
  });

  it('leaves tables out as empty arrays, so a fixture lists only what it reads', () => {
    expect(fixture.items).toEqual([{ id: 'sword', name: 'Sword' }]);
    expect(fixture.areas).toEqual([]);
    expect(fixture.xpTable).toEqual([]);
  });

  it('loads every table in data/', () => {
    const data = loadGameData();
    const camelCase = (file: string): string =>
      file.replace(/-(\w)/g, (_match, letter: string) => letter.toUpperCase());
    const files = Object.keys(import.meta.glob('../data/*.json')).map((path) => /([^/]+)\.json$/.exec(path)?.[1] ?? '');
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const name = camelCase(file);
      expect(Object.keys(data), `data/${file}.json has no field "${name}" in GameData`).toContain(name);
    }
    expect(Object.keys(data)).toHaveLength(files.length);
    expect(data.constants).toEqual(constants);
    expect(data.enemies.length).toBeGreaterThan(0);
    expect(data.enemies.every((row) => typeof row.id === 'string')).toBe(true);
  });
});
