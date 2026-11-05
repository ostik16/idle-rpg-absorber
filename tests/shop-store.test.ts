import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { CharacterState } from '../src/state/types';
import { connectEngine, equipmentSlots, itemInfo, listShops, roster, shopItems, type CharacterView } from '../src/ui/store';

const data = loadGameData();

function connect() {
  const state = createGameState(7, 1_000_000, data);
  state.roster.push(createCharacterState('c1', 'Kaela', data));
  const refresh = connectEngine({ state, dispatch: () => {}, drainEvents: () => [] }, data);
  return { refresh, character: state.roster[0] as CharacterState };
}

describe('item and shop selectors', () => {
  it('describes an item from data', () => {
    connect();
    expect(itemInfo('rusty-sword')).toMatchObject({
      name: 'Rusty sword',
      icon: 'sword',
      category: 'equipment',
      size: 3,
      stackable: false,
      sellPrice: 10,
      equipmentType: 'one-handed-weapon',
      requiredLevel: 1,
    });
  });

  it('falls back to the id for an unknown item', () => {
    connect();
    expect(itemInfo('no-such-item')).toMatchObject({ name: 'no-such-item', icon: 'bag' });
  });

  it('gives every item in data a known icon', () => {
    connect();
    for (const row of data.items) expect(itemInfo(row.id as string).icon).not.toBe('rareItem');
  });

  it('lists shops and their stock with prices', () => {
    connect();
    expect(listShops().map((s) => s.id)).toEqual(expect.arrayContaining(['general-store', 'alchemist']));
    expect(shopItems('alchemist')).toContainEqual({ itemId: 'minor-health-potion', price: 12 });
    expect(shopItems('no-shop')).toEqual([]);
  });

  it('lists the 12 equipment slots in paper-doll order', () => {
    connect();
    const slots = equipmentSlots();
    expect(slots).toHaveLength(12);
    expect(slots.slice(0, 2).map((s) => s.id)).toEqual(['head', 'body']);
    expect(slots.find((s) => s.id === 'main-hand')?.allowedTypes).toContain('one-handed-weapon');
  });
});

describe('bag limits on a character view', () => {
  it('reads 36 cells and max stack 20 without a backpack, and the pack when one is worn', () => {
    const { refresh, character } = connect();
    const view = roster.value[0] as CharacterView;
    const before = view.bagUsedCells.value;
    expect([view.bagCapacity.value, view.bagMaxStack.value]).toEqual([36, 20]);
    character.bag.push({ itemId: 'rusty-sword', bonuses: [], upgradeLevel: 0, qty: 1 });
    character.equipment['backpack'] = { itemId: 'leather-pack', bonuses: [], upgradeLevel: 0, qty: 1 };
    refresh();
    expect([view.bagCapacity.value, view.bagMaxStack.value, view.bagUsedCells.value]).toEqual([42, 60, before + 3]);
    expect(view.equipment.value['backpack']?.itemId).toBe('leather-pack');
  });
});
