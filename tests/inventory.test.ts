import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import { bagCells, bagMaxStack, effectiveStackLimit, warehouseStackLimit } from '../src/game/inventory';

const potion = { stackable: true };
const sword = { stackable: false };
const backpack = { bagCells: 12, maxStack: 50 };

describe('bag stacking (design 2.3)', () => {
  it('without a backpack: 36 cells and stacks of 20', () => {
    expect(constants.inventory.baseCells).toBe(36);
    expect(constants.inventory.baseMaxStack).toBe(20);
    expect(bagCells(null)).toBe(36);
    expect(bagMaxStack(null)).toBe(20);
  });

  it('a backpack adds cells and sets the stack size', () => {
    expect(bagCells(backpack)).toBe(48);
    expect(bagMaxStack(backpack)).toBe(50);
  });

  it('every stackable item uses the one stack size, others are 1', () => {
    expect(effectiveStackLimit(potion, null)).toBe(20);
    expect(effectiveStackLimit(potion, backpack)).toBe(50);
    expect(effectiveStackLimit(sword, backpack)).toBe(1);
    expect(effectiveStackLimit(sword, null)).toBe(1);
  });
});

describe('warehouse stacking (design 2.3)', () => {
  it('stackable items stack to 100 whatever the backpack', () => {
    expect(constants.storage.maxStack).toBe(100);
    expect(warehouseStackLimit(potion)).toBe(100);
    expect(warehouseStackLimit(sword)).toBe(1);
  });
});
