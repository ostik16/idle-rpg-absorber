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
  physicalDamage,
  potionHealPerSecond,
  potionHealPerTick,
  potionTickCount,
  queuePotions,
  spellDamageMultiplier,
  startingAttributes,
  weaponDamageOrUnarmed,
  weaponPenaltyMultiplier,
} from '../src/game/stats';

// Hand-computed from the coefficients in design 4.2: damage 1 + 0.6 x STR, attack speed 0.8 + 0.02 x DEX,
// crit 2% + 0.2% x DEX (cap 50%), health 30 + 8 x VIT, defence 0.25 x VIT, mana 20 + 4 x INT,
// spell damage +2% per INT. Unarmed damage is 2. Crits do 2x (after defence). Movement speed is a proficiency, not a stat.
describe('derived stats (design 4.2)', () => {
  it('physical damage is 1 + 0.6 per Strength plus the weapon', () => {
    expect(physicalDamage(5, 0)).toBeCloseTo(4);
    expect(physicalDamage(8, 3)).toBeCloseTo(8.8);
    expect(physicalDamage(50, 20)).toBeCloseTo(51);
  });

  it('uses unarmed damage (2) as the weapon damage when no weapon is equipped', () => {
    expect(weaponDamageOrUnarmed(null)).toBe(2);
    expect(weaponDamageOrUnarmed(7)).toBe(7);
    expect(weaponDamageOrUnarmed(0)).toBe(0);
    expect(physicalDamage(5)).toBeCloseTo(6); // 1 + 3 + 2
    expect(physicalDamage(5, null)).toBeCloseTo(6);
    expect(physicalDamage(10)).toBeCloseTo(9); // 1 + 6 + 2
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

  it('multiplies a critical hit by 2, after defence and the minimum', () => {
    expect(constants.combat.critMultiplier).toBe(2);
    expect(hitDamage(10, 4, true)).toBeCloseTo(12); // (10 - 4) x 2
    expect(hitDamage(3, 10, true)).toBeCloseTo(2); // minimum 1, then x 2
  });
});

describe('weapon attribute penalty (design 2.2)', () => {
  const attrs = { strength: 10, dexterity: 15, vitality: 5, intelligence: 5 };

  it('is 1 when every scaling attribute meets the required value', () => {
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', requiredValue: 10 }])).toBe(1);
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', requiredValue: 8 }])).toBe(1);
  });

  it('is 1 with no scaling (unarmed)', () => {
    expect(weaponPenaltyMultiplier(attrs, [])).toBe(1);
  });

  it('costs 1% per missing attribute point', () => {
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', requiredValue: 20 }])).toBeCloseTo(0.9, 10); // 10 missing
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', requiredValue: 11 }])).toBeCloseTo(0.99, 10);
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', requiredValue: 12.5 }])).toBeCloseTo(0.975, 10);
  });

  it('adds up the missing points of several attributes', () => {
    const scaling = [
      { attribute: 'strength' as const, requiredValue: 20 }, // 10 missing
      { attribute: 'dexterity' as const, requiredValue: 20 }, // 5 missing
    ];
    expect(weaponPenaltyMultiplier(attrs, scaling)).toBeCloseTo(0.85, 10);
  });

  it('does not let a surplus in one attribute offset a shortfall in another', () => {
    const scaling = [
      { attribute: 'strength' as const, requiredValue: 12 }, // 2 missing
      { attribute: 'dexterity' as const, requiredValue: 10 }, // 5 spare
    ];
    expect(weaponPenaltyMultiplier(attrs, scaling)).toBeCloseTo(0.98, 10);
  });

  it('never costs more than 50%', () => {
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', requiredValue: 55 }])).toBeCloseTo(0.55, 10); // 45 missing
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', requiredValue: 60 }])).toBeCloseTo(0.5, 10); // 50 missing
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'strength', requiredValue: 100 }])).toBe(0.5);
    expect(weaponPenaltyMultiplier(attrs, [{ attribute: 'intelligence', requiredValue: 500 }])).toBe(0.5);
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
  it('starts with no free points, no equipment and no items', () => {
    expect(constants.creation.freePoints).toBe(0);
    expect(constants.creation.startingEquipment).toEqual({});
    expect(constants.creation.startingItems).toEqual([]);
  });

  it('starts at the base attributes, 5 in each', () => {
    expect(startingAttributes()).toEqual({ strength: 5, dexterity: 5, vitality: 5, intelligence: 5 });
    expect(startingAttributes({ strength: 0, dexterity: 0, vitality: 0, intelligence: 0 })).toEqual(startingAttributes());
  });

  it('rejects any allocation, because there are no free points to spend', () => {
    expect(() => startingAttributes({ strength: 1, dexterity: 0, vitality: 0, intelligence: 0 })).toThrow(RangeError);
    expect(() => startingAttributes({ strength: 3, dexterity: 1, vitality: 1, intelligence: 0 })).toThrow(RangeError);
  });

  it('rejects negative or fractional allocations', () => {
    expect(() => startingAttributes({ strength: 1, dexterity: -1, vitality: 0, intelligence: 0 })).toThrow(RangeError);
    expect(() => startingAttributes({ strength: 0.5, dexterity: 0, vitality: 0, intelligence: 0 })).toThrow(RangeError);
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

describe('potion queue (design 2.6)', () => {
  const minor = { amount: 40, durationSeconds: 10 }; // 20 ticks of 2
  const standard = { amount: 320, durationSeconds: 8 }; // 16 ticks of 20

  it('stacking is "queue"', () => {
    expect(constants.potions.stacking).toBe('queue');
  });

  it('a single potion heals as it would alone', () => {
    const q = queuePotions([minor]);
    expect(q.totalTicks).toBe(20);
    expect(q.healPerTick[0]).toBeCloseTo(2);
    expect(q.totalHeal).toBeCloseTo(40);
  });

  it('starts the second potion when the first ends, without overlap', () => {
    const q = queuePotions([minor, minor]);
    expect(q.totalTicks).toBe(40);
    expect(q.healPerTick.every((h) => Math.abs(h - 2) < 1e-9)).toBe(true); // never 4 per tick
    expect(q.totalHeal).toBeCloseTo(80);
  });

  it('keeps the drinking order', () => {
    const q = queuePotions([minor, standard]);
    expect(q.totalTicks).toBe(36);
    expect(q.healPerTick[19]).toBeCloseTo(2);
    expect(q.healPerTick[20]).toBeCloseTo(20);
    expect(q.totalHeal).toBeCloseTo(360);
    expect(queuePotions([standard, minor]).healPerTick[0]).toBeCloseTo(20);
  });

  it('follows the tick length given', () => {
    expect(queuePotions([minor], 1000).totalTicks).toBe(10);
    expect(queuePotions([minor], 1000).healPerTick[0]).toBeCloseTo(4);
  });

  it('is empty for no potions', () => {
    expect(queuePotions([])).toEqual({ healPerTick: [], totalTicks: 0, totalHeal: 0 });
  });
});
