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
