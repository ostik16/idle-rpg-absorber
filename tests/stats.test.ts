import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import {
  attackIntervalMs,
  attackSpeed,
  characterNameError,
  critChance,
  defence,
  hitDamage,
  maxHealth,
  maxMana,
  moveSpeedMultiplier,
  physicalDamage,
  potionHealPerSecond,
  potionHealPerTick,
  potionTickCount,
  spellDamageMultiplier,
  startingAttributes,
  weaponPenaltyMultiplier,
} from '../src/game/stats';

// Hand-computed from the coefficients in design 4.2: damage 1 + 0.6 x STR, attack speed 0.8 + 0.02 x DEX,
// crit 2% + 0.2% x DEX (cap 50%), health 30 + 8 x VIT, defence 0.25 x VIT, mana 20 + 4 x INT,
// spell damage +2% per INT, move speed +0.5% per endurance.
describe('derived stats (design 4.2)', () => {
  it('physical damage is 1 + 0.6 per Strength plus the weapon', () => {
    expect(physicalDamage(5)).toBeCloseTo(4);
    expect(physicalDamage(8, 3)).toBeCloseTo(8.8);
    expect(physicalDamage(50, 20)).toBeCloseTo(51);
  });

  it('attack speed is 0.8 + 0.02 per Dexterity, times 1 + bonus', () => {
    expect(attackSpeed(5)).toBeCloseTo(0.9);
    expect(attackSpeed(30)).toBeCloseTo(1.4);
    expect(attackSpeed(5, 0.1)).toBeCloseTo(0.99);
  });

  it('crit chance is 2% + 0.2% per Dexterity, capped at 50%', () => {
    expect(critChance(5)).toBeCloseTo(0.03);
    expect(critChance(60)).toBeCloseTo(0.14);
    expect(critChance(10, 0.05)).toBeCloseTo(0.09);
    expect(critChance(1000)).toBe(0.5);
  });

  it('health is 30 + 8 per Vitality, with a percentage bonus and flat gear', () => {
    expect(maxHealth(5)).toBeCloseTo(70);
    expect(maxHealth(5, 0.1, 20)).toBeCloseTo(97);
  });

  it('defence is 0.25 per Vitality plus gear', () => {
    expect(defence(5)).toBeCloseTo(1.25);
    expect(defence(5, 2)).toBeCloseTo(3.25);
  });

  it('mana is 20 + 4 per Intelligence plus gear', () => {
    expect(maxMana(5)).toBeCloseTo(40);
    expect(maxMana(10, 5)).toBeCloseTo(65);
  });

  it('spell damage multiplier is 1 + 2% per Intelligence', () => {
    expect(spellDamageMultiplier(0)).toBe(1);
    expect(spellDamageMultiplier(10)).toBeCloseTo(1.2);
  });

  it('movement speed is 1 + 0.5% per endurance', () => {
    expect(moveSpeedMultiplier(0)).toBe(1);
    expect(moveSpeedMultiplier(50)).toBeCloseTo(1.25);
  });
});

describe('attack interval (design 3.6)', () => {
  it('rounds to whole 100 ms ticks', () => {
    expect(attackIntervalMs(2)).toBe(500);
    expect(attackIntervalMs(0.9)).toBe(1100); // 1111 ms is 11.1 ticks
    expect(attackIntervalMs(1)).toBe(1000);
  });

  it('is never faster than one tick', () => {
    expect(attackIntervalMs(50)).toBe(100);
  });

  it('follows the tick length given', () => {
    expect(attackIntervalMs(3, 50)).toBe(350); // 333 ms is 6.7 ticks of 50 ms
  });

  it('rejects a speed of 0 or less', () => {
    expect(() => attackIntervalMs(0)).toThrow(RangeError);
  });
});

describe('hit damage (design 3.6)', () => {
  it('is attacker damage minus defender defence', () => {
    expect(hitDamage(10, 4)).toBe(6);
  });

  it('is at least the minimum damage', () => {
    expect(hitDamage(3, 10)).toBe(constants.combat.minDamage);
    expect(hitDamage(5, 5)).toBe(1);
  });

  it('multiplies a critical hit by 1.5', () => {
    expect(hitDamage(10, 4, true)).toBeCloseTo(9);
    expect(hitDamage(3, 10, true)).toBeCloseTo(1.5);
  });
});

describe('weapon attribute penalty (design 2.2)', () => {
  const attrs = { strength: 10, dexterity: 15, vitality: 5, intelligence: 5 };

  it('is 1 when every scaling attribute meets the recommended value', () => {
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', recommended: 10 }])).toBe(1);
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', recommended: 8 }])).toBe(1);
  });

  it('is 1 with no scaling (unarmed)', () => {
    expect(weaponPenaltyMultiplier(attrs, [])).toBe(1);
  });

  it('falls in proportion to the shortfall', () => {
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', recommended: 20 }])).toBeCloseTo(0.5);
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', recommended: 12.5 }])).toBeCloseTo(0.8);
  });

  it('multiplies the shortfalls of several attributes', () => {
    const scaling = [
      { attribute: 'strength' as const, recommended: 20 }, // 0.5
      { attribute: 'dexterity' as const, recommended: 20 }, // 0.75
    ];
    expect(weaponPenaltyMultiplier(attrs, scaling)).toBeCloseTo(0.375);
  });

  it('never falls below the 25% floor', () => {
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', recommended: 100 }])).toBe(0.25);
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'intelligence', recommended: 500 }])).toBe(0.25);
  });
});

describe('potion heal over time (design 2.6)', () => {
  it('spreads the amount evenly over ticks of 500 ms', () => {
    expect(potionTickCount(10)).toBe(20);
    expect(potionHealPerTick({ amount: 40, durationSeconds: 10 })).toBeCloseTo(2);
    expect(potionHealPerTick({ amount: 320, durationSeconds: 8 })).toBeCloseTo(20);
  });

  it('has a heal rate in health per second', () => {
    expect(potionHealPerSecond({ amount: 40, durationSeconds: 10 })).toBeCloseTo(4);
    expect(potionHealPerSecond({ amount: 320, durationSeconds: 8 })).toBeCloseTo(40);
  });

  it('heals the full amount over the duration', () => {
    for (const tier of constants.potions.tiers) {
      const ticks = potionTickCount(tier.durationSeconds);
      expect(potionHealPerTick(tier) * ticks).toBeCloseTo(tier.amount);
    }
  });

  it('gives better tiers more healing at a faster rate', () => {
    const tiers = constants.potions.tiers;
    for (let i = 1; i < tiers.length; i++) {
      const lower = tiers[i - 1]!;
      const higher = tiers[i]!;
      expect(higher.amount).toBeGreaterThan(lower.amount);
      expect(potionHealPerSecond(higher)).toBeGreaterThan(potionHealPerSecond(lower));
    }
  });
});

describe('character creation (design 4.1)', () => {
  it('adds the allocated free points to the base attributes', () => {
    expect(startingAttributes({ strength: 3, dexterity: 1, vitality: 1, intelligence: 0 })).toEqual({
      strength: 8,
      dexterity: 6,
      vitality: 6,
      intelligence: 5,
    });
  });

  it('requires all 5 free points to be spent', () => {
    expect(() => startingAttributes({ strength: 2, dexterity: 1, vitality: 1, intelligence: 0 })).toThrow(RangeError);
    expect(() => startingAttributes({ strength: 4, dexterity: 1, vitality: 1, intelligence: 0 })).toThrow(RangeError);
  });

  it('rejects negative or fractional allocations', () => {
    expect(() => startingAttributes({ strength: 6, dexterity: -1, vitality: 0, intelligence: 0 })).toThrow(RangeError);
    expect(() => startingAttributes({ strength: 2.5, dexterity: 2.5, vitality: 0, intelligence: 0 })).toThrow(RangeError);
  });

  it('accepts a name of 1 to 16 characters and trims it', () => {
    expect(characterNameError('Aria')).toBeNull();
    expect(characterNameError('  Aria  ')).toBeNull();
    expect(characterNameError('A'.repeat(16))).toBeNull();
  });

  it('rejects empty and over-long names', () => {
    expect(characterNameError('')).not.toBeNull();
    expect(characterNameError('   ')).not.toBeNull();
    expect(characterNameError('A'.repeat(17))).not.toBeNull();
  });

  it('rejects a name another character has, ignoring case', () => {
    expect(characterNameError('aria', ['Aria', 'Bo'])).not.toBeNull();
    expect(characterNameError('Cy', ['Aria', 'Bo'])).toBeNull();
  });
});
