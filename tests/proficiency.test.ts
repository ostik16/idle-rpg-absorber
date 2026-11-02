import { describe, expect, it } from 'vitest';
import {
  addProficiency,
  proficiencyEffect,
  proficiencyGain,
  proficiencyReferenceLevel,
  proficiencyTitle,
} from '../src/game/proficiency';

// Reference level = 0.3 x points (at least 1). Gain = base x min(1, actionLevel / reference)^2 (design 4.6).
describe('proficiency reference level', () => {
  it('is 0.3 levels per point, never below 1', () => {
    expect(proficiencyReferenceLevel(0)).toBe(1);
    expect(proficiencyReferenceLevel(50)).toBeCloseTo(15);
    expect(proficiencyReferenceLevel(100)).toBeCloseTo(30);
  });
});

describe('proficiency gain (design 4.6)', () => {
  it('gives the full gain for a new skill against any enemy', () => {
    expect(proficiencyGain('one-handed', 0, 1)).toBeCloseTo(0.003);
    expect(proficiencyGain('toughness', 0, 5)).toBeCloseTo(0.003);
  });

  it('gives the full gain against an enemy at the skill reference level or above', () => {
    expect(proficiencyGain('unarmed', 50, 15)).toBeCloseTo(0.003);
    expect(proficiencyGain('unarmed', 50, 30)).toBeCloseTo(0.003);
  });

  it('squares the ratio for weaker enemies: a third of the level gives a ninth of the gain', () => {
    expect(proficiencyGain('unarmed', 50, 5)).toBeCloseTo(0.003 / 9);
    expect(proficiencyGain('two-handed', 90, 9)).toBeCloseTo(0.003 / 9);
  });

  it('trains a high skill very little on weak enemies', () => {
    expect(proficiencyGain('one-handed', 90, 3)).toBeLessThan(0.00005);
  });

  it('gives speed a lower gain than weapon skills', () => {
    expect(proficiencyGain('speed', 0, 1)).toBeCloseTo(0.0015);
  });

  it('gives endurance its own rate per second moved', () => {
    expect(proficiencyGain('endurance', 0, 1)).toBeCloseTo(0.001);
  });

  it('gains nothing at the maximum', () => {
    expect(proficiencyGain('unarmed', 100, 30)).toBe(0);
  });

  it('adds a gain and stays inside 0..100', () => {
    expect(addProficiency(10, 0.5)).toBeCloseTo(10.5);
    expect(addProficiency(99.9, 5)).toBe(100);
    expect(addProficiency(0, -1)).toBe(0);
  });
});

describe('proficiency effect (design 4.6)', () => {
  it('weapon skills add 0.3% damage per point', () => {
    expect(proficiencyEffect('one-handed', 0)).toBe(0);
    expect(proficiencyEffect('one-handed', 50)).toBeCloseTo(0.15);
    expect(proficiencyEffect('one-handed', 100)).toBeCloseTo(0.3);
  });

  it('toughness adds 0.3% health, speed 0.2% attack speed, endurance 0.5% move speed per point', () => {
    expect(proficiencyEffect('toughness', 100)).toBeCloseTo(0.3);
    expect(proficiencyEffect('speed', 100)).toBeCloseTo(0.2);
    expect(proficiencyEffect('endurance', 40)).toBeCloseTo(0.2);
  });

  it('caps points at 100', () => {
    expect(proficiencyEffect('speed', 500)).toBeCloseTo(0.2);
  });
});

describe('proficiency titles (design 4.6)', () => {
  it('uses the thresholds 0, 15, 35, 60, 85', () => {
    expect(proficiencyTitle(0)).toBe('Novice');
    expect(proficiencyTitle(14.9)).toBe('Novice');
    expect(proficiencyTitle(15)).toBe('Apprentice');
    expect(proficiencyTitle(34.9)).toBe('Apprentice');
    expect(proficiencyTitle(35)).toBe('Adept');
    expect(proficiencyTitle(60)).toBe('Expert');
    expect(proficiencyTitle(84.9)).toBe('Expert');
    expect(proficiencyTitle(85)).toBe('Master');
    expect(proficiencyTitle(100)).toBe('Master');
  });
});
