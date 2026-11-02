import { describe, expect, it } from 'vitest';
import { createRng, createStream, deriveSeed, hashString, rngFromState, splitmix32 } from '../src/game/rng';

function draw(rng: { nextFloat(): number }, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextFloat());
}

describe('rng (ADR 0002)', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draw(createRng(42), 50)).toEqual(draw(createRng(42), 50));
    expect(draw(createRng('abc'), 20)).toEqual(draw(createRng('abc'), 20));
  });

  it('gives different sequences for different seeds', () => {
    expect(draw(createRng(1), 10)).not.toEqual(draw(createRng(2), 10));
    expect(draw(createRng('a'), 10)).not.toEqual(draw(createRng('b'), 10));
  });

  it('keeps floats in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const x = rng.nextFloat();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  it('splitmix32 is deterministic and moves', () => {
    const a = splitmix32(5);
    const b = splitmix32(5);
    const first = a();
    expect(first).toBe(b());
    expect(a()).not.toBe(first);
  });

  it('hashes strings the same way each time and tells them apart', () => {
    expect(hashString('combat')).toBe(hashString('combat'));
    expect(hashString('combat')).not.toBe(hashString('drops'));
    expect(hashString('')).toBe(0x811c9dc5);
  });

  it('streams with different names differ, and the same names match', () => {
    const combat = draw(createStream(99, 'char-1', 'combat'), 10);
    const drops = draw(createStream(99, 'char-1', 'drops'), 10);
    const other = draw(createStream(99, 'char-2', 'combat'), 10);
    expect(combat).not.toEqual(drops);
    expect(combat).not.toEqual(other);
    expect(combat).toEqual(draw(createStream(99, 'char-1', 'combat'), 10));
  });

  it('derived seeds depend on part order and master seed', () => {
    expect(deriveSeed(1, 'a', 'b')).not.toBe(deriveSeed(1, 'b', 'a'));
    expect(deriveSeed(1, 'a')).not.toBe(deriveSeed(2, 'a'));
    expect(deriveSeed(1, 'a', 3)).toBe(deriveSeed(1, 'a', 3));
  });

  it('one stream does not change when another is drawn from (independence)', () => {
    const combat = createStream(5, 'c', 'combat');
    const drops = createStream(5, 'c', 'drops');
    const before = draw(createStream(5, 'c', 'combat'), 5);
    draw(drops, 1000);
    expect(draw(combat, 5)).toEqual(before);
  });

  it('streams are not correlated (loose)', () => {
    const a = createStream(3, 'x', 'combat');
    const b = createStream(3, 'x', 'drops');
    const n = 20000;
    let sumA = 0;
    let sumB = 0;
    let sumAB = 0;
    for (let i = 0; i < n; i++) {
      const x = a.nextFloat();
      const y = b.nextFloat();
      sumA += x;
      sumB += y;
      sumAB += x * y;
    }
    const cov = sumAB / n - (sumA / n) * (sumB / n);
    // Independent uniforms: covariance 0, the standard deviation of the estimate is about 1/12/sqrt(n) = 0.0006.
    expect(Math.abs(cov) < 0.003).toBe(true);
  });

  it('is roughly uniform', () => {
    const rng = createRng(2024);
    const n = 100000;
    const buckets = new Array<number>(10).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = rng.nextFloat();
      sum += x;
      const k = Math.floor(x * 10);
      buckets[k] = (buckets[k] ?? 0) + 1;
    }
    expect(Math.abs(sum / n - 0.5) < 0.01).toBe(true);
    for (const count of buckets) expect(Math.abs(count - n / 10) < 400).toBe(true); // 4% of the expected 10,000
  });

  it('nextInt covers the whole inclusive range and nothing else', () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.nextInt(3, 6);
      expect(v >= 3 && v <= 6).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
    expect(rng.nextInt(5, 5)).toBe(5);
    expect(() => rng.nextInt(2, 1)).toThrow();
    expect(() => rng.nextInt(0.5, 2)).toThrow();
  });

  it('chance respects 0, 1 and rough probability', () => {
    const rng = createRng(8);
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
    let hits = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) if (rng.chance(0.3)) hits++;
    expect(Math.abs(hits / n - 0.3) < 0.015).toBe(true);
  });

  it('chance consumes one draw whatever p is', () => {
    const a = createRng(4);
    const b = createRng(4);
    a.chance(0);
    b.chance(0.5);
    expect(a.nextFloat()).toBe(b.nextFloat());
  });

  it('weighted pick follows the weights', () => {
    const rng = createRng(77);
    const counts = [0, 0, 0];
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const idx = rng.weightedIndex([1, 3, 6]);
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    expect(Math.abs((counts[0] ?? 0) / n - 0.1) < 0.01).toBe(true);
    expect(Math.abs((counts[1] ?? 0) / n - 0.3) < 0.015).toBe(true);
    expect(Math.abs((counts[2] ?? 0) / n - 0.6) < 0.015).toBe(true);
  });

  it('weighted pick never returns a zero-weight item and validates input', () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i++) expect(rng.weightedPick(['a', 'b', 'c'], [0, 5, 0])).toBe('b');
    expect(() => rng.weightedPick(['a'], [0])).toThrow();
    expect(() => rng.weightedPick(['a', 'b'], [1])).toThrow();
    expect(() => rng.weightedIndex([1, -1])).toThrow();
    expect(() => rng.weightedIndex([])).toThrow();
  });

  it('saved state restores the same future', () => {
    const rng = createRng(31);
    draw(rng, 17);
    const state = rng.getState();
    const restored = rngFromState(state);
    expect(draw(restored, 10)).toEqual(draw(rng, 10));
  });
});
