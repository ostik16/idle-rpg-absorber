/**
 * Seedable random numbers (ADR 0002). sfc32 with four 32-bit words of state, seeded through splitmix32.
 * Pure TypeScript, no Math.random. Every stream is reproducible from a master seed plus a list of names
 * (character id, purpose, ...), so a change to one system does not reshuffle the others.
 */

/** The four 32-bit words of an sfc32 generator. Saved with the game (ADR 0003). */
export type RngState = readonly [number, number, number, number];

export interface Rng {
  /** Next float in [0, 1). */
  nextFloat(): number;
  /** Whole number from `min` to `max`, both included. */
  nextInt(min: number, max: number): number;
  /** True with probability `p`. Always consumes one draw, so streams stay aligned whatever `p` is. */
  chance(p: number): boolean;
  /** Index into `weights`, chosen in proportion to the weights. Weights may be 0 but not negative. */
  weightedIndex(weights: readonly number[]): number;
  /** Item from `items`, chosen in proportion to `weights` (same length). */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
  /** Current state, for saving. `rngFromState` restores it. */
  getState(): RngState;
}

const TWO_POW_32 = 4294967296;

/** splitmix32: a stream of 32-bit words from a 32-bit seed. Used to spread a seed over the sfc32 state. */
export function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

/** FNV-1a hash of a string to an unsigned 32-bit number. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seedWord(value: number | string): number {
  if (typeof value === 'string') return hashString(value);
  if (!Number.isFinite(value)) throw new RangeError(`seed parts must be finite numbers or strings, got ${value}`);
  return Math.trunc(value) >>> 0;
}

/**
 * Derives a 32-bit seed from a master seed and any number of parts, for example
 * `deriveSeed(master, characterId, 'drops')`. Order matters; the same inputs always give the same seed.
 */
export function deriveSeed(master: number | string, ...parts: readonly (number | string)[]): number {
  let h = splitmix32(seedWord(master))();
  for (const part of parts) h = splitmix32((h ^ seedWord(part)) | 0)();
  return h;
}

function fromState(a0: number, b0: number, c0: number, d0: number): Rng {
  let a = a0 | 0;
  let b = b0 | 0;
  let c = c0 | 0;
  let d = d0 | 0;

  const nextFloat = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / TWO_POW_32;
  };

  const weightedIndex = (weights: readonly number[]): number => {
    if (weights.length === 0) throw new RangeError('weightedIndex needs at least one weight');
    let total = 0;
    for (const w of weights) {
      if (!Number.isFinite(w) || w < 0) throw new RangeError(`weights must be finite and not negative, got ${w}`);
      total += w;
    }
    if (!(total > 0)) throw new RangeError('weights must add up to more than 0');
    const roll = nextFloat() * total;
    let cumulative = 0;
    let lastPositive = 0;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] ?? 0;
      if (w <= 0) continue;
      lastPositive = i;
      cumulative += w;
      if (roll < cumulative) return i;
    }
    return lastPositive; // only reached through floating point rounding at the very top of the range
  };

  return {
    nextFloat,
    nextInt(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`nextInt needs whole numbers with min <= max, got ${min}..${max}`);
      }
      return min + Math.floor(nextFloat() * (max - min + 1));
    },
    chance(p) {
      return nextFloat() < p;
    },
    weightedIndex,
    weightedPick(items, weights) {
      if (items.length !== weights.length) throw new RangeError('items and weights must be the same length');
      return items[weightedIndex(weights)] as (typeof items)[number];
    },
    getState: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
  };
}

/** Restores a generator from saved state. */
export function rngFromState(state: RngState): Rng {
  return fromState(state[0], state[1], state[2], state[3]);
}

/** New generator from a 32-bit number or a string. splitmix32 spreads it over the 128-bit state. */
export function createRng(seed: number | string): Rng {
  const next = splitmix32(seedWord(seed));
  const rng = fromState(next(), next(), next(), next());
  for (let i = 0; i < 12; i++) rng.nextFloat(); // sfc32 warm-up
  return rng;
}

/** A separate stream for one character and purpose: `createStream(master, characterId, 'combat')`. */
export function createStream(master: number | string, ...parts: readonly (number | string)[]): Rng {
  return createRng(deriveSeed(master, ...parts));
}
