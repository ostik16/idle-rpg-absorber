import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import { loadGameData } from '../src/data/game-data';
import {
  bagLimitsFor,
  effectiveAttributes,
  equippedStats,
  mainHandWeapon,
  twoHandedBlocks,
  weaponStyleOf,
  type EquipmentItemRow,
  type SlotRow,
} from '../src/game/equipment';
import { physicalDamage, weaponPenaltyMultiplier } from '../src/game/stats';
import { createCharacterState } from '../src/state/factory';
import { derivedStats } from '../src/state/selectors';
import type { CharacterState, ItemStack } from '../src/state/types';

const data = loadGameData();
const slots = data.equipmentSlots as unknown as readonly SlotRow[];
const itemOf = (id: string): EquipmentItemRow => {
  const row = data.items.find((r) => r.id === id);
  if (row === undefined) throw new Error(`no item ${id}`);
  return row as unknown as EquipmentItemRow;
};

function newCharacter(): CharacterState {
  return createCharacterState('a', 'Ada', data);
}

function equip(character: CharacterState, slot: string, itemId: string, bonuses: ItemStack['bonuses'] = []): void {
  character.equipment[slot] = { itemId, bonuses, upgradeLevel: 0, qty: 1 };
}

describe('weapon penalty (design 2.2)', () => {
  it('a weapon requiring 20 Strength + 20 Dexterity, used at 10 Strength + 15 Dexterity, works at 85%', () => {
    const penalty = weaponPenaltyMultiplier(
      { strength: 10, dexterity: 15, vitality: 0, intelligence: 0 },
      [
        { attribute: 'strength', requiredValue: 20 },
        { attribute: 'dexterity', requiredValue: 20 },
      ],
    );
    expect(penalty).toBeCloseTo(0.85);
  });

  it('equipping a weapon changes derived damage by the penalty (design 2.2)', () => {
    // Base character: str 5, dex 5, no weapon → unarmed damage 2.
    const character = newCharacter();
    const unarmed = derivedStats(character, data);
    expect(unarmed.damage).toBeCloseTo(physicalDamage(5)); // 1 + 3 + 2 = 6

    // Mossfang sword: damage 10, scales str 12 + dex 7 → 7+2 = 9 short, penalty 1 - 0.09 = 0.91.
    equip(character, 'main-hand', 'mossfang-sword');
    const equipped = derivedStats(character, data);
    const expectedPenalty = 1 - 0.09;
    const expectedDamage = 1 + 0.6 * 5 + 10 * expectedPenalty;
    expect(equipped.damage).toBeCloseTo(expectedDamage);
    expect(equipped.damage).toBeGreaterThan(unarmed.damage);
  });
});

describe('backpack bag limits (design 2.3)', () => {
  it('no backpack: 36 cells, stacks of 20', () => {
    const character = newCharacter();
    expect(bagLimitsFor(character.equipment, itemOf)).toEqual({ capacity: 36, maxStack: 20 });
  });

  it('a canvas pack: 40 cells, stacks of 40', () => {
    const character = newCharacter();
    equip(character, 'backpack', 'canvas-pack');
    expect(bagLimitsFor(character.equipment, itemOf)).toEqual({ capacity: 40, maxStack: 40 });
  });

  it('a backpack changes one character only', () => {
    const packed = newCharacter();
    equip(packed, 'backpack', 'leather-pack');
    const bare = newCharacter();
    expect(bagLimitsFor(packed.equipment, itemOf)).toEqual({ capacity: 42, maxStack: 60 });
    expect(bagLimitsFor(bare.equipment, itemOf)).toEqual({ capacity: 36, maxStack: 20 });
  });
});

describe('two-handed blocks the off hand (design 2.2)', () => {
  const twoHandedItem = itemOf('oak-greatclub');
  const oneHandedItem = itemOf('rusty-sword');

  it('refuses a two-handed weapon when the off hand is occupied', () => {
    const character = newCharacter();
    character.equipment['off-hand'] = { itemId: 'silver-bar', bonuses: [], upgradeLevel: 0, qty: 1 };
    // Stand-in off-hand to test the rule, the game only allows shields in reality.
    const mainSlot = slots.find((s) => s.id === 'main-hand')!;
    expect(twoHandedBlocks(character.equipment, mainSlot, twoHandedItem, slots, itemOf)).toBe(true);
    expect(twoHandedBlocks(character.equipment, mainSlot, oneHandedItem, slots, itemOf)).toBe(false);
  });

  it('refuses the off hand when a two-handed weapon is equipped', () => {
    const character = newCharacter();
    equip(character, 'main-hand', 'oak-greatclub');
    const offSlot = slots.find((s) => s.id === 'off-hand')!;
    const shield = { equipmentType: 'shield' } as EquipmentItemRow;
    expect(twoHandedBlocks(character.equipment, offSlot, shield, slots, itemOf)).toBe(true);
  });
});

describe('weapon style is the trained proficiency (decisions L11)', () => {
  it('no weapon → unarmed', () => {
    const character = newCharacter();
    expect(weaponStyleOf(mainHandWeapon(character.equipment, slots, itemOf))).toBe('unarmed');
  });

  it('one-handed sword → one-handed', () => {
    const character = newCharacter();
    equip(character, 'main-hand', 'rusty-sword');
    expect(weaponStyleOf(mainHandWeapon(character.equipment, slots, itemOf))).toBe('one-handed');
  });

  it('two-handed greatclub → two-handed', () => {
    const character = newCharacter();
    equip(character, 'main-hand', 'oak-greatclub');
    expect(weaponStyleOf(mainHandWeapon(character.equipment, slots, itemOf))).toBe('two-handed');
  });
});

describe('aggregate stats and bonus attributes', () => {
  it('sums flat defence and bonus attributes across the equipment', () => {
    const character = newCharacter();
    equip(character, 'body', 'ragged-tunic'); // defence 1
    equip(character, 'head', 'leather-cap'); // defence 1
    equip(character, 'necklace', 'fangtooth-necklace', [{ attribute: 'strength', value: 2 }]); // health 12

    const gear = equippedStats(character, slots, itemOf);
    expect(gear.flatDefence).toBe(2);
    expect(gear.flatHealth).toBe(12);
    expect(gear.attributeBonuses.strength).toBe(2);

    const base = character.attributes;
    expect(effectiveAttributes(base, gear.attributeBonuses).strength).toBe(base.strength + 2);
  });

  it('an added move-speed bonus feeds into derivedStats.movementSpeed', () => {
    const character = newCharacter();
    equip(character, 'necklace', 'fleetfoot-charm');
    const stats = derivedStats(character, data);
    // speed proficiency is 0 at start, so movementSpeed = 1 + 0 + 0.05 = 1.05
    expect(stats.movementSpeed).toBeCloseTo(1.05);
  });
});

describe('a new character still fights unarmed (design 4.2)', () => {
  it('starting equipment is empty', () => {
    expect(constants.creation.startingEquipment).toEqual({});
    const character = newCharacter();
    expect(character.equipment).toEqual({});
  });
});
