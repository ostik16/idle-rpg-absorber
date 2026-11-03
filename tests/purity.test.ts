import { describe, expect, it } from 'vitest';

// ADR 0002: no Math.random anywhere in src/game or src/engine, and the engine takes time as an argument.
// The repo has no linter, so this test is that rule. It reads the source text of the layers that must run
// in Node without a clock, a DOM or storage (architecture "Principle").
const sources = import.meta.glob('../src/{game,engine,state,data}/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const LAYERS = ['game', 'engine', 'state', 'data'];

// Not preceded by a word character, `$` or `.`, so `lastWindow.x` and `foo.performance.x` do not match.
const START = String.raw`(?<![\w$.])`;

const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Math.random', pattern: new RegExp(`${START}Math\\.random\\b`) },
  { name: 'Date.now', pattern: new RegExp(`${START}Date\\.now\\b`) },
  { name: 'new Date', pattern: new RegExp(`${START}new\\s+Date\\b`) },
  { name: 'performance.', pattern: new RegExp(`${START}performance\\.`) },
  { name: 'document.', pattern: new RegExp(`${START}document\\.`) },
  { name: 'window.', pattern: new RegExp(`${START}window\\.`) },
  { name: 'localStorage', pattern: new RegExp(`${START}localStorage\\b`) },
  { name: 'indexedDB', pattern: new RegExp(`${START}indexedDB\\b`) },
];

/**
 * Blanks out comments and the text of '...' and "..." strings, so a comment that says "no Math.random"
 * does not fail the rule. Template literals are kept as they are: an expression inside one is code.
 * Line breaks are kept, so reported line numbers stay right.
 */
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (ch === "'" || ch === '"') {
      out += ch;
      i++;
      while (i < source.length && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') i++;
        i++;
      }
      out += ch;
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Lines of `source` that use something forbidden, as "file:line name". */
function violations(file: string, source: string): string[] {
  const found: string[] = [];
  stripCommentsAndStrings(source)
    .split('\n')
    .forEach((line, index) => {
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(line)) found.push(`${file}:${index + 1} uses ${name}`);
      }
    });
  return found;
}

describe('purity of game, engine, state and data (ADR 0002)', () => {
  it('finds source files in every layer', () => {
    for (const layer of LAYERS) {
      const count = Object.keys(sources).filter((file) => file.includes(`/src/${layer}/`)).length;
      expect(count, `no files found under src/${layer}`).toBeGreaterThan(0);
    }
  });

  it('uses no randomness, clock, DOM or storage API', () => {
    const found = Object.entries(sources).flatMap(([file, source]) => violations(file, source));
    expect(found).toEqual([]);
  });

  describe('the scanner', () => {
    it('catches every forbidden call in code', () => {
      const code = [
        'const a = Math.random();',
        'const b = Date.now();',
        'const c = new Date();',
        'const d = performance.now();',
        'const e = document.body;',
        'const f = window.innerWidth;',
        'localStorage.getItem("x");',
        'indexedDB.open("x");',
      ].join('\n');
      expect(violations('sample.ts', code)).toHaveLength(8);
    });

    it('ignores comments, plain strings and look-alike names', () => {
      const code = [
        '// Math.random is not allowed here',
        '/* Date.now() and',
        '   new Date() */',
        "const message = 'call Math.random() or window.open';",
        'const other = "document.cookie";',
        'const x = lastWindow.size + foo.performance.now + mydocument.x;',
      ].join('\n');
      expect(violations('sample.ts', code)).toEqual([]);
    });

    it('still sees code after a comment, a string or a template', () => {
      expect(violations('sample.ts', "const s = '//'; const r = Math.random();")).toHaveLength(1);
      expect(violations('sample.ts', '/* note */ const r = Math.random();')).toHaveLength(1);
      expect(violations('sample.ts', 'const t = `at ${Date.now()}`;')).toHaveLength(1);
    });

    it('reports the right line number', () => {
      expect(violations('sample.ts', '/* one\ntwo */\nconst r = Math.random();')).toEqual([
        'sample.ts:3 uses Math.random',
      ]);
    });
  });
});
