import { describe, expect, it } from 'vitest';
import {
  enemyAttackSpeed,
  enemyDamage,
  enemyDefence,
  enemyHealth,
  enemyMoneyRange,
} from '../src/game/enemies';

// Coefficients (design 3.5): health 24 x 1.11^(L-1), damage 5 x 1.07^(L-1), defence 0.5 x (L-1)^1.2,
// attack speed 0.8 + 0.015 x (L-1), money average 5 x 1.1^(L-1) +/- 50%.
describe('enemy baseline stats (design 3.5)', () => {
  it('level 1 is the base values', () => {
    expect(enemyHealth(1)).toBe(24);
    expect(enemyDamage(1)).toBe(5);
    expect(enemyDefence(1)).toBe(0);
    expect(enemyAttackSpeed(1)).toBeCloseTo(0.8);
  });

  it('health grows 11% per level', () => {
    expect(enemyHealth(5)).toBeCloseTo(36.43, 1); // 24 x 1.11^4
    expect(enemyHealth(2)).toBeCloseTo(26.64, 2);
  });

  it('damage grows 7% per level', () => {
    expect(enemyDamage(5)).toBeCloseTo(6.554, 2); // 5 x 1.07^4
  });

  it('defence follows a power curve', () => {
    expect(enemyDefence(5)).toBeCloseTo(2.639, 2); // 0.5 x 4^1.2
    expect(enemyDefence(2)).toBeCloseTo(0.5);
  });

  it('attack speed rises 0.015 per level', () => {
    expect(enemyAttackSpeed(5)).toBeCloseTo(0.86);
    expect(enemyAttackSpeed(30)).toBeCloseTo(1.235);
  });

  it('rejects levels below 1 and fractions', () => {
    expect(() => enemyHealth(0)).toThrow(RangeError);
    expect(() => enemyDamage(1.5)).toThrow(RangeError);
    expect(() => enemyDefence(-1)).toThrow(RangeError);
  });
});

describe('enemy money (design 3.5)', () => {
  it('is an average of 5 gold at level 1, plus or minus half', () => {
    expect(enemyMoneyRange(1)).toEqual({ min: 3, max: 8 });
  });

  it('grows 10% per level', () => {
    expect(enemyMoneyRange(30)).toEqual({ min: 40, max: 119 }); // average 79.3
  });
});
