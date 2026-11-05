/**
 * Bag and warehouse stacking (design 2.3, 5.1). Pure functions; numbers come from data/constants.json.
 * Every stackable item stacks to one number set by the equipped backpack (its `maxStack`); with no backpack it is
 * constants.inventory.baseMaxStack. The warehouse uses constants.storage.maxStack for every stackable item.
 */
import constants from '../../data/constants.json';

export interface BackpackLike {
  /** Cells the backpack adds to the base bag. */
  bagCells: number;
  /** Stack size of every stackable item while this backpack is equipped. */
  maxStack: number;
}

export interface StackableLike {
  stackable: boolean;
}

/** Stack size of stackable items in the bag: the backpack's maxStack, or constants.inventory.baseMaxStack without one. */
export function bagMaxStack(backpack: Pick<BackpackLike, 'maxStack'> | null, c: typeof constants.inventory = constants.inventory): number {
  return backpack === null ? c.baseMaxStack : backpack.maxStack;
}

/** Bag cells: constants.inventory.baseCells plus the backpack's bagCells. */
export function bagCells(backpack: Pick<BackpackLike, 'bagCells'> | null, c: typeof constants.inventory = constants.inventory): number {
  return c.baseCells + (backpack === null ? 0 : backpack.bagCells);
}

/** Items per bag cell for this item: 1 when it is not stackable, else bagMaxStack. */
export function effectiveStackLimit(
  item: StackableLike,
  backpack: Pick<BackpackLike, 'maxStack'> | null,
  c: typeof constants.inventory = constants.inventory,
): number {
  return item.stackable ? bagMaxStack(backpack, c) : 1;
}

/** Items per warehouse cell: 1 when not stackable, else constants.storage.maxStack. */
export function warehouseStackLimit(item: StackableLike, c: typeof constants.storage = constants.storage): number {
  return item.stackable ? c.maxStack : 1;
}

/** The fields of an item row that the bag reads. */
export interface BagItemLike {
  /** Cells one stack of this item uses (items.json `size`). */
  size: number;
  stackable: boolean;
  category?: string;
  requiredLevel?: number;
}

/** A stack in a bag, as state holds it. */
export interface BagStackLike {
  itemId: string;
  bonuses: { attribute: string; value: number }[];
  upgradeLevel: number;
  qty: number;
}

/**
 * Cells the bag uses (decisions L7): each stack takes its item's `size`, whatever its quantity. Only the count
 * matters, never the position. `itemOf` must find every item in the bag (it may throw).
 */
export function usedCells(bag: readonly BagStackLike[], itemOf: (itemId: string) => Pick<BagItemLike, 'size'>): number {
  return bag.reduce((sum, stack) => sum + itemOf(stack.itemId).size, 0);
}

/** Cells still free in a bag of `capacity` cells. Never below 0, even if the bag holds more than it should. */
export function freeCells(
  bag: readonly BagStackLike[],
  capacity: number,
  itemOf: (itemId: string) => Pick<BagItemLike, 'size'>,
): number {
  return Math.max(0, capacity - usedCells(bag, itemOf));
}

export interface AddToBagResult {
  /** The bag after adding: a new array, the stacks that changed are new objects. */
  bag: BagStackLike[];
  /** How many of the items went in. */
  added: number;
  /** How many did not fit. */
  refused: number;
}

export interface AddToBagLimits {
  /** Bag capacity in cells (`bagCells`). */
  capacity: number;
  /** Stack size of stackable items (`bagMaxStack`). */
  maxStack: number;
}

/**
 * Adds `qty` of an item to a bag, by count only (decisions L7). A stackable item tops up the stacks of the same item
 * (same bonuses and upgrade level) first, then opens new stacks of up to `maxStack`, each costing the item's `size`
 * in cells. A stack that already holds more than `maxStack` (a smaller backpack was fitted) takes nothing. An item
 * that is not stackable takes `size` cells for each one. What does not fit is refused, the rest goes in, so a bag
 * with 3 free cells takes a size 3 sword and a full one refuses it wherever the free cells are.
 * The bag passed in is not changed.
 */
export function addToBag(
  bag: readonly BagStackLike[],
  stack: BagStackLike,
  item: Pick<BagItemLike, 'size' | 'stackable'>,
  limits: AddToBagLimits,
  itemOf: (itemId: string) => Pick<BagItemLike, 'size'>,
): AddToBagResult {
  const next = bag.map((s) => ({ ...s }));
  let remaining = Math.max(0, Math.floor(stack.qty));
  const limit = item.stackable ? limits.maxStack : 1;

  if (item.stackable) {
    for (const existing of next) {
      if (remaining === 0) break;
      if (existing.itemId !== stack.itemId || existing.upgradeLevel !== stack.upgradeLevel) continue;
      if (!sameBonuses(existing.bonuses, stack.bonuses)) continue;
      const room = limit - existing.qty;
      if (room <= 0) continue;
      const moved = Math.min(room, remaining);
      existing.qty += moved;
      remaining -= moved;
    }
  }

  let free = freeCells(next, limits.capacity, itemOf);
  while (remaining > 0 && item.size <= free && limit > 0) {
    const qty = Math.min(limit, remaining);
    next.push({ itemId: stack.itemId, bonuses: stack.bonuses.map((b) => ({ ...b })), upgradeLevel: stack.upgradeLevel, qty });
    remaining -= qty;
    free -= item.size;
  }

  const total = Math.max(0, Math.floor(stack.qty));
  return { bag: next, added: total - remaining, refused: remaining };
}

function sameBonuses(a: BagStackLike['bonuses'], b: BagStackLike['bonuses']): boolean {
  return a.length === b.length && a.every((x, i) => x.attribute === b[i]?.attribute && x.value === b[i]?.value);
}

/** One rule of a loot filter (design 2.3). Fields left out match any item. */
export interface LootRuleLike {
  category?: string;
  minRequiredLevel?: number;
  bonusAttribute?: string;
}

export interface LootFilterLike {
  enabled: boolean;
  rules: readonly LootRuleLike[];
}

/**
 * A rule matches when every field it sets matches: the category is equal, the item's required level is at least
 * `minRequiredLevel`, and one of the rolled bonuses is on `bonusAttribute`. An item with no `requiredLevel` counts
 * as level 1. Shared by the loot filter (2.3) and auto-sell (2.3 L6).
 */
export function matchesItemRule(
  rule: LootRuleLike,
  item: Pick<BagItemLike, 'category' | 'requiredLevel'>,
  bonuses: readonly { attribute: string }[],
): boolean {
  return (
    (rule.category === undefined || rule.category === item.category) &&
    (rule.minRequiredLevel === undefined || (item.requiredLevel ?? 1) >= rule.minRequiredLevel) &&
    (rule.bonusAttribute === undefined || bonuses.some((b) => b.attribute === rule.bonusAttribute))
  );
}

/**
 * Whether a character picks an item up (design 2.3, decisions L8). A disabled filter picks up everything. An enabled
 * one picks up an item that matches at least one rule, and nothing when it has no rules.
 */
export function matchesLootFilter(
  filter: LootFilterLike,
  item: Pick<BagItemLike, 'category' | 'requiredLevel'>,
  bonuses: readonly { attribute: string }[],
): boolean {
  if (!filter.enabled) return true;
  return filter.rules.some((rule) => matchesItemRule(rule, item, bonuses));
}
