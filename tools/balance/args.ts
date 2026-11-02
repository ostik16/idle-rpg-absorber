/** Small flag parser for the balance scripts: `--name value`, `--name=value` and boolean `--name`. */
import { BalanceError } from './load-data';

export type FlagKind = 'number' | 'string' | 'boolean';
export type FlagSpec = Record<string, { kind: FlagKind; help: string }>;

export class Flags {
  private readonly values: ReadonlyMap<string, number | string | boolean>;

  constructor(values: ReadonlyMap<string, number | string | boolean>) {
    this.values = values;
  }

  number(name: string): number | undefined {
    const v = this.values.get(name);
    return typeof v === 'number' ? v : undefined;
  }

  string(name: string): string | undefined {
    const v = this.values.get(name);
    return typeof v === 'string' ? v : undefined;
  }

  bool(name: string): boolean {
    return this.values.get(name) === true;
  }
}

/**
 * Parses `argv` (without node and script) against `spec`. A bare `--` and stray non-flag words are ignored,
 * so `npm run balance:combat -- --level 5` works. Unknown flags, missing values and bad numbers throw BalanceError.
 */
export function parseFlags(argv: readonly string[], spec: FlagSpec): Flags {
  const values = new Map<string, number | string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (!token.startsWith('--') || token === '--') continue;
    let name = token.slice(2);
    let inline: string | undefined;
    const eq = name.indexOf('=');
    if (eq >= 0) {
      inline = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    const def = spec[name];
    if (!def) throw new BalanceError(`Unknown flag --${name}. Known: ${Object.keys(spec).map((k) => `--${k}`).join(' ')}`);
    if (def.kind === 'boolean') {
      values.set(name, inline === undefined ? true : inline !== 'false');
      continue;
    }
    let raw = inline;
    if (raw === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new BalanceError(`Flag --${name} needs a value.`);
      raw = next;
      i++;
    }
    if (def.kind === 'number') {
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n)) throw new BalanceError(`Flag --${name} needs a number, got "${raw}".`);
      values.set(name, n);
    } else {
      values.set(name, raw);
    }
  }
  return new Flags(values);
}

export function usage(command: string, summary: string, spec: FlagSpec): string {
  const width = Math.max(...Object.keys(spec).map((k) => k.length)) + 2;
  const lines = Object.entries(spec).map(([name, def]) => `  --${name.padEnd(width)}${def.help}`);
  return [`${command}: ${summary}`, '', 'Flags:', ...lines].join('\n');
}

/** Whole-number flag with a default and a minimum. */
export function intFlag(flags: Flags, name: string, fallback: number, min: number): number {
  const v = flags.number(name) ?? fallback;
  if (!Number.isInteger(v) || v < min) throw new BalanceError(`Flag --${name} must be a whole number of ${min} or more, got ${v}.`);
  return v;
}
