import { describe, expect, it } from 'vitest';

// ADR 0001 and architecture "Dependency direction": `ui` imports engine types only, and the components reach the game
// through the store. The repo has no linter, so this test is that rule, like tests/purity.test.ts.
const sources = import.meta.glob('../src/ui/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const IMPORT = /^import\s+(type\s+)?[^'"]*from\s+'([^']+)'/gm;

function imports(source: string): { typeOnly: boolean; from: string }[] {
  return [...source.matchAll(IMPORT)].map((match) => ({ typeOnly: match[1] !== undefined, from: match[2] as string }));
}

describe('UI boundary', () => {
  it('finds the UI sources', () => {
    expect(Object.keys(sources).some((path) => path.endsWith('/store.ts'))).toBe(true);
  });

  it.each(Object.entries(sources))('%s imports only types from the engine', (_path, source) => {
    const fromEngine = imports(source).filter(({ from }) => from.includes('/engine/'));
    expect(fromEngine.filter(({ typeOnly }) => !typeOnly)).toEqual([]);
  });

  it.each(Object.entries(sources).filter(([path]) => !path.endsWith('/store.ts') && !path.endsWith('/frame-loop.ts')))(
    '%s never touches the engine or state directly',
    (_path, source) => {
      expect(source).not.toMatch(/\bengine\b\s*\.|\.state\b|\.roster\b(?!\.value)/);
      expect(imports(source).filter(({ from }) => from.includes('/state/') || from.includes('/engine/'))).toEqual([]);
    },
  );
});
