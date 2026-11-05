/**
 * Equipment slot rules and the aggregate of what the equipped items give a character (design 2.2).
 * Pure: a slot and item reader are passed in. Nothing here reads data files directly.
 */
import constants from '../../data/constants.json';
import { bagCells as baseBagCells, bagMaxStack as baseBagMaxStack, type BackpackLike } from './inventory';
import type { WeaponStyleId } from './proficiency';
import { type Attributes, type WeaponScaling } from './stats';

/** Row of data/equipment-slots.json that this module reads. */
export interface SlotRow {
  id: string;
  allowedTypes: readonly string[];
  twoHandedBlocks?: string;
  blockedByTwoHanded?: boolean;
  trainsProficiency?: Record<string, string>;
}

/** Fields of a data/items.json row that this module reads. */
export interface EquipmentItemRow {
  id: string;
  category?: string;
  equipmentType?: string;
  size: number;
  requiredLevel?: number;
  baseStats?: Record<string, number>;
  scaling?: readonly WeaponScaling[];
  bagCells?: number;
  maxStack?: number;
}

export interface EquippedStackLike {
  itemId: string;
  bonuses: readonly { attribute: string; value: number }[];
}

/** Slots an equipment item of this type fits. Several when a type has twins (two rings). */
export function slotsForType(type: string | undefined, slots: readonly SlotRow[]): SlotRow[] {
  if (type === undefined) return [];
  return slots.filter((slot) => slot.allowedTypes.includes(type));
}

/**
 * Whether the two-handed rule stops `item` from being placed in `slot` with what else is equipped (design 2.2):
 * - a two-handed weapon cannot go in main hand while the off hand is occupied
 * - the off hand cannot be occupied while a two-handed weapon is in main hand
 */
export function twoHandedBlocks(
  equipment: Readonly<Record<string, EquippedStackLike>>,
  slot: SlotRow,
  item: EquipmentItemRow,
  slots: readonly SlotRow[],
  itemOf: (id: string) => Pick<EquipmentItemRow, 'equipmentType'>,
): boolean {
  if (slot.blockedByTwoHanded) {
    const mainHand = slots.find((s) => s.twoHandedBlocks === slot.id);
    const occupying = mainHand === undefined ? undefined : equipment[mainHand.id];
    if (occupying !== undefined && itemOf(occupying.itemId).equipmentType === 'two-handed-weapon') return true;
  }
  if (item.equipmentType === 'two-handed-weapon' && slot.twoHandedBlocks !== undefined) {
    return equipment[slot.twoHandedBlocks] !== undefined;
  }
  return false;
}

/** The weapon in the main hand, or null (no weapon, so unarmed). */
export function mainHandWeapon(
  equipment: Readonly<Record<string, EquippedStackLike>>,
  slots: readonly SlotRow[],
  itemOf: (id: string) => EquipmentItemRow,
): EquipmentItemRow | null {
  const mainSlot = slots.find((s) => s.trainsProficiency !== undefined);
  const stack = mainSlot === undefined ? undefined : equipment[mainSlot.id];
  if (stack === undefined) return null;
  const item = itemOf(stack.itemId);
  if (item.equipmentType !== 'one-handed-weapon' && item.equipmentType !== 'two-handed-weapon') return null;
  return item;
}

/** Weapon style for the equipped main hand, the id of the trained proficiency. */
export function weaponStyleOf(weapon: EquipmentItemRow | null): WeaponStyleId {
  if (weapon === null) return 'unarmed';
  return weapon.equipmentType === 'two-handed-weapon' ? 'two-handed' : 'one-handed';
}

/** The equipped backpack, or null. */
export function equippedBackpack(
  equipment: Readonly<Record<string, EquippedStackLike>>,
  itemOf: (id: string) => EquipmentItemRow,
): BackpackLike | null {
  const stack = equipment['backpack'];
  if (stack === undefined) return null;
  const item = itemOf(stack.itemId);
  if (item.bagCells === undefined || item.maxStack === undefined) return null;
  return { bagCells: item.bagCells, maxStack: item.maxStack };
}

/** Effective bag capacity and stack size for this character's bag. */
export function bagLimitsFor(
  equipment: Readonly<Record<string, EquippedStackLike>>,
  itemOf: (id: string) => EquipmentItemRow,
  inventory: typeof constants.inventory = constants.inventory,
): { capacity: number; maxStack: number } {
  const pack = equippedBackpack(equipment, itemOf);
  return { capacity: baseBagCells(pack, inventory), maxStack: baseBagMaxStack(pack, inventory) };
}

export interface EquippedStats {
  /** Weapon base damage, before the penalty is applied, or null when unarmed. */
  weaponDamage: number | null;
  weaponScaling: readonly WeaponScaling[];
  style: WeaponStyleId;
  flatDefence: number;
  flatHealth: number;
  flatMana: number;
  /** Added to the movement-speed multiplier. */
  moveSpeedBonus: number;
  /** Rolled bonus attributes totalled across all equipped items. */
  attributeBonuses: Attributes;
}

const ZERO_BONUSES: Attributes = { strength: 0, dexterity: 0, vitality: 0, intelligence: 0 };

/** Sums what the equipped items give. Flat bonuses, bonus attributes, and the main-hand weapon's stats. */
export function equippedStats(
  character: {
    equipment: Readonly<Record<string, EquippedStackLike>>;
    attributes: Attributes;
  },
  slots: readonly SlotRow[],
  itemOf: (id: string) => EquipmentItemRow,
): EquippedStats {
  const attributeBonuses: Attributes = { ...ZERO_BONUSES };
  let flatDefence = 0;
  let flatHealth = 0;
  let flatMana = 0;
  let moveSpeedBonus = 0;

  for (const stack of Object.values(character.equipment)) {
    const row = itemOf(stack.itemId);
    const stats = row.baseStats ?? {};
    flatDefence += stats.defence ?? 0;
    flatHealth += stats.health ?? 0;
    flatMana += stats.mana ?? 0;
    moveSpeedBonus += stats.moveSpeed ?? 0;
    for (const bonus of stack.bonuses) {
      if (bonus.attribute in attributeBonuses) {
        attributeBonuses[bonus.attribute as keyof Attributes] += bonus.value;
      }
    }
  }

  const weapon = mainHandWeapon(character.equipment, slots, itemOf);
  return {
    weaponDamage: weapon === null ? null : weapon.baseStats?.damage ?? null,
    weaponScaling: weapon?.scaling ?? [],
    style: weaponStyleOf(weapon),
    flatDefence,
    flatHealth,
    flatMana,
    moveSpeedBonus,
    attributeBonuses,
  };
}

/** Attributes with the equipment's rolled bonuses added. Combat formulas and the weapon penalty use these. */
export function effectiveAttributes(base: Attributes, bonuses: Attributes): Attributes {
  return {
    strength: base.strength + bonuses.strength,
    dexterity: base.dexterity + bonuses.dexterity,
    vitality: base.vitality + bonuses.vitality,
    intelligence: base.intelligence + bonuses.intelligence,
  };
}
