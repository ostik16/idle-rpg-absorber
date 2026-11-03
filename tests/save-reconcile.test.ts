import { describe, expect, it } from 'vitest';
import { isRecoveredTab, reconcile, RECOVERED_TAB_NAME, type RecoveredTab } from '../src/save/reconcile';
import type { GameState, ItemStack } from '../src/state/types';
import { data, newState } from './save-helpers';

const KNOWN_ITEM = 'minor-health-potion';
const KNOWN_ENEMY = data.enemies[0]!.id;
const KNOWN_AREA = data.areas[0]!.id;

function gone(itemId = 'removed-item', qty = 1): ItemStack {
  return { itemId, bonuses: [{ attribute: 'strength', value: 3 }], upgradeLevel: 4, qty };
}

function recoveredTab(state: GameState): RecoveredTab | undefined {
  return state.account.warehouse.tabs.find(isRecoveredTab);
}

describe('unknown item ids (ADR 0003 reconcile)', () => {
  it('changes nothing when every id is known, and adds no tab', () => {
    const state = newState();
    const before = structuredClone(state);
    expect(reconcile(state, data)).toEqual({ recovered: [], returned: [] });
    expect(state).toEqual(before);
    expect(recoveredTab(state)).toBeUndefined();
  });

  it('moves a whole stack from a bag to a "Recovered items" tab, bonuses and upgrade included', () => {
    const state = newState();
    state.roster[0]!.bag.push(gone('removed-item', 7));
    const report = reconcile(state, data);

    expect(report.recovered).toEqual([{ itemId: 'removed-item', qty: 7 }]);
    expect(state.roster[0]!.bag.map((stack) => stack.itemId)).toEqual([KNOWN_ITEM]);
    expect(recoveredTab(state)).toMatchObject({ name: RECOVERED_TAB_NAME, items: [gone('removed-item', 7)] });
  });

  it('collects from equipment, every warehouse tab and the buyback list', () => {
    const state = newState();
    state.roster[0]!.equipment['main-hand'] = gone('old-sword');
    state.account.warehouse.tabs[0]!.items.push(gone('old-ore'), { ...gone(KNOWN_ITEM), bonuses: [] });
    state.shops.buyback.push(gone('old-ring'));
    reconcile(state, data);

    expect(state.roster[0]!.equipment).toEqual({});
    expect(state.account.warehouse.tabs[0]!.items.map((stack) => stack.itemId)).toEqual([KNOWN_ITEM]);
    expect(state.shops.buyback).toEqual([]);
    expect(recoveredTab(state)!.items.map((stack) => stack.itemId).sort()).toEqual(['old-ore', 'old-ring', 'old-sword']);
  });

  it('adds the tab after the bought tabs, so they keep their place', () => {
    const state = newState();
    state.roster[0]!.bag.push(gone());
    reconcile(state, data);
    expect(state.account.warehouse.tabs).toHaveLength(2);
    expect(isRecoveredTab(state.account.warehouse.tabs[0]!)).toBe(false);
    expect(isRecoveredTab(state.account.warehouse.tabs[1]!)).toBe(true);
  });

  it('has room for every stack it holds', () => {
    const state = newState();
    state.roster[0]!.bag.push(gone('a'), gone('b'), gone('c'));
    reconcile(state, data);
    expect(recoveredTab(state)!.cells).toBe(3);
  });

  it('adds to the tab on a later load, and does not report what is already there', () => {
    const state = newState();
    state.roster[0]!.bag.push(gone('first'));
    reconcile(state, data);
    expect(reconcile(state, data).recovered).toEqual([]);

    state.roster[0]!.bag.push(gone('second'));
    expect(reconcile(state, data).recovered).toEqual([{ itemId: 'second', qty: 1 }]);
    expect(state.account.warehouse.tabs).toHaveLength(2);
    expect(recoveredTab(state)!.items.map((stack) => stack.itemId)).toEqual(['first', 'second']);
  });

  it('survives a trip through JSON, as the save takes it', () => {
    const state = newState();
    state.roster[0]!.bag.push(gone());
    reconcile(state, data);
    const reloaded = JSON.parse(JSON.stringify(state)) as GameState;
    expect(recoveredTab(reloaded)?.name).toBe(RECOVERED_TAB_NAME);
    expect(reconcile(reloaded, data).recovered).toEqual([]);
  });
});

describe('unknown enemy and area ids (ADR 0003 reconcile)', () => {
  function farming(): GameState {
    const state = newState();
    Object.assign(state.roster[0]!, {
      areaId: KNOWN_AREA,
      targetEnemyId: KNOWN_ENEMY,
      phase: 'fighting',
      timeInPhaseMs: 500,
      fight: { enemyId: KNOWN_ENEMY, enemyHp: 10, ticks: 5 },
    });
    return state;
  }

  it('leaves a character alone when its ids are known', () => {
    const state = farming();
    const before = structuredClone(state);
    expect(reconcile(state, data).returned).toEqual([]);
    expect(state).toEqual(before);
  });

  it('an unknown enemy in the fight: the fight ends and the character returns to the city, area kept', () => {
    const state = farming();
    state.roster[0]!.fight!.enemyId = 'removed-enemy';
    expect(reconcile(state, data).returned).toEqual([{ characterId: 'c1', name: 'Kaela', unknownIds: ['removed-enemy'] }]);
    expect(state.roster[0]).toMatchObject({ fight: null, phase: 'idle', timeInPhaseMs: 0, areaId: KNOWN_AREA, targetEnemyId: KNOWN_ENEMY });
  });

  it('an unknown target: dropped, and the character returns to the city', () => {
    const state = farming();
    state.roster[0]!.targetEnemyId = 'removed-enemy';
    reconcile(state, data);
    expect(state.roster[0]).toMatchObject({ targetEnemyId: null, fight: null, phase: 'idle', areaId: KNOWN_AREA });
  });

  it('an unknown area: dropped, with the fight there, and the character returns to the city', () => {
    const state = farming();
    state.roster[0]!.areaId = 'removed-area';
    const report = reconcile(state, data);
    expect(report.returned[0]?.unknownIds).toEqual(['removed-area']);
    expect(state.roster[0]).toMatchObject({ areaId: null, fight: null, phase: 'idle', targetEnemyId: KNOWN_ENEMY });
  });

  it('lists an id once when the fight and the target both name it', () => {
    const state = farming();
    state.roster[0]!.fight!.enemyId = 'removed-enemy';
    state.roster[0]!.targetEnemyId = 'removed-enemy';
    expect(reconcile(state, data).returned[0]?.unknownIds).toEqual(['removed-enemy']);
  });

  it('a dead character stays dead, so its respawn still runs', () => {
    const state = newState();
    Object.assign(state.roster[0]!, { areaId: 'removed-area', phase: 'dead', timeInPhaseMs: 900 });
    reconcile(state, data);
    expect(state.roster[0]).toMatchObject({ areaId: null, phase: 'dead', timeInPhaseMs: 900 });
  });
});
