import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import {
  absorbOnKill,
  absorptionLevelModifier,
  chanceToMaxWithoutFailure,
  dropChance,
  dropLevelModifier,
  upgradeSuccessChance,
} from '../src/game/formulas';

describe('drop level modifier (design 3.8)', () => {
  it('is 1 at the same level', () => {
    expect(dropLevelModifier(10, 10)).toBe(1);
  });

  it('falls by 0.1 for each level the character is above the enemy', () => {
    expect(dropLevelModifier(11, 10)).toBeCloseTo(0.9);
    expect(dropLevelModifier(15, 10)).toBeCloseTo(0.5);
    expect(dropLevelModifier(19, 10)).toBeCloseTo(0.1);
  });

  it('is 0 at 10 or more levels above the enemy', () => {
    expect(dropLevelModifier(20, 10)).toBe(0);
    expect(dropLevelModifier(30, 1)).toBe(0);
  });

  it('is 1 for enemies 1-19 levels above the character, 0 from 20', () => {
    expect(dropLevelModifier(5, 6)).toBe(1);
    expect(dropLevelModifier(5, 24)).toBe(1);
    expect(dropLevelModifier(5, 25)).toBe(0);
  });

  it('multiplies the base chance', () => {
    expect(dropChance(0.2, 15, 10)).toBeCloseTo(0.1);
  });
});

describe('absorption (design 4.7)', () => {
  it('matches the documented level table', () => {
    const pct = (diff: number) => Math.round(absorptionLevelModifier(10 + diff, 10) * 100);
    expect(pct(0)).toBe(100);
    expect(pct(1)).toBe(90);
    expect(pct(5)).toBe(59);
    expect(pct(10)).toBe(35);
    expect(pct(20)).toBe(12);
  });

  it('never reaches 0', () => {
    expect(absorptionLevelModifier(30, 1)).toBeGreaterThan(0);
  });

  it('gives modifier 1 when the enemy is above the character (data/constants.json)', () => {
    expect(absorptionLevelModifier(5, 10)).toBe(1);
    expect(absorptionLevelModifier(1, 30)).toBe(1);
  });

  it('reads the enemy-above modifier from the constants, not from code', () => {
    const changed = { ...constants.absorption, enemyAboveCharacterModifier: 1.5 };
    expect(absorptionLevelModifier(5, 10, changed)).toBe(1.5);
  });

  it('follows the 10% life steal example: 0.1% per kill, capped at 10% after 100 kills', () => {
    let lifeSteal = 0;
    lifeSteal = absorbOnKill(lifeSteal, 10, 5, 5);
    expect(lifeSteal).toBeCloseTo(0.1);
    for (let i = 1; i < 100; i++) lifeSteal = absorbOnKill(lifeSteal, 10, 5, 5);
    expect(lifeSteal).toBeCloseTo(10);
    expect(absorbOnKill(lifeSteal, 10, 5, 5)).toBeCloseTo(10);
  });

  it('only a higher enemy value raises a capped trait', () => {
    expect(absorbOnKill(10, 12, 5, 5)).toBeCloseTo(10.12);
  });

  it('gains less from enemies below the character level', () => {
    expect(absorbOnKill(0, 10, 10, 5)).toBeCloseTo(0.1 * 0.9 ** 5);
  });
});

describe('upgrade success chance (design 2.7)', () => {
  it('matches the documented table', () => {
    const expected = [90.0, 81.0, 72.9, 65.6, 59.0, 53.1, 47.8, 43.0, 38.7];
    expected.forEach((pct, level) => {
      expect(Math.round(upgradeSuccessChance(level) * 1000) / 10).toBe(pct);
    });
  });

  it('rejects levels outside 0..8', () => {
    expect(() => upgradeSuccessChance(-1)).toThrow(RangeError);
    expect(() => upgradeSuccessChance(9)).toThrow(RangeError);
  });

  it('gives about 0.9% to reach +9 without a failure', () => {
    expect(Math.round(chanceToMaxWithoutFailure() * 1000) / 10).toBe(0.9);
  });
});
