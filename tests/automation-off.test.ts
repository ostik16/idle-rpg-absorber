/**
 * Automation off (issue #66, decisions A1): no auto-sell, restock, loot filter, return triggers or city routine. The
 * character drinks potions on its own in a fight, comes home only when recalled or dead, and then stays.
 */
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../src/data/game-data';
import { createEngine } from '../src/engine/engine';
import { estimateOffline } from '../src/engine/offline';
import { createCharacterState, createGameState } from '../src/state/factory';
import { derivedStats, outOfPotions } from '../src/state/selectors';
import type { CharacterState } from '../src/state/types';

const T0 = 1_000_000;
const TICK = 100;
const AREA = 'mossfang-glade';
const MINOR = 'minor-health-potion';
const HIDE = 'hide-scrap';
const SELL_ALL = { enabled: true, rules: [{ category: 'material' }, { category: 'consumable' }] };

function setup(configure: (character: CharacterState) => void = () => {}) {
  const data = loadGameData();
  const state = createGameState(7, T0, data);
  const character = createCharacterState('c1', 'Ysolde', data);
  configure(character);
  state.roster.push(character);
  const engine = createEngine({ data, state });
  let now = T0;
  const advance = (ms: number): void => {
    for (let left = ms; left > 0; left -= 60_000) {
      now += Math.min(left, 60_000);
      engine.advanceTo(now);
    }
  };
  return { data, engine, character, advance };
}

const potions = (character: CharacterState): number =>
  character.bag.filter((s) => s.itemId === MINOR).reduce((sum, s) => sum + s.qty, 0);

describe('automation off (decisions A1)', () => {
  it('is off in the data', () => {
    expect(loadGameData().constants['automation']).toEqual({ enabled: false });
  });

  it('no health or bag trigger: it keeps fighting until it dies, still drinking potions', () => {
    const { engine, character, advance } = setup((c) => {
      c.settings.returnHealthThreshold = 1; // would send it home on the first hit
      c.settings.lootFilter = { enabled: true, rules: [] }; // would pick up nothing
    });
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    const phases = new Set<string>();
    let picked = 0;
    for (let ms = 0; ms < 3_600_000 && character.phase !== 'dead'; ms += 1000) {
      advance(1000);
      phases.add(character.phase);
      picked += engine.drainEvents().filter((e) => e.type === 'itemPickedUp').length;
    }
    expect(phases.has('fleeing') || phases.has('returning')).toBe(false);
    expect(character.phase).toBe('dead');
    expect(potions(character)).toBe(0);
    expect(picked).toBeGreaterThan(0);
  });

  it('after a death it waits in the city: no sale, no restock, no potions, regeneration only', () => {
    const { data, character, advance } = setup((c) => {
      c.areaId = AREA;
      c.phase = 'dead';
      c.bag.push({ itemId: HIDE, bonuses: [], upgradeLevel: 0, qty: 5 });
      c.settings.autoSell = SELL_ALL;
      c.settings.cityHealing = 'fast';
      c.gold = 100;
    });
    const bag = structuredClone(character.bag);
    advance(4000 + TICK); // level 1 respawns after 4 s
    expect(character.phase).toBe('idle');
    expect(character.areaId).toBeNull();
    expect(character.bag).toEqual(bag);
    expect(character.gold).toBe(100);
    const health = character.health;
    advance(10_000);
    expect(character.phase).toBe('idle');
    expect(character.bag).toEqual(bag);
    expect(character.potions.queue).toEqual([]);
    expect(character.health).toBeGreaterThan(health);
    expect(character.health).toBeLessThan(derivedStats(character, data).maxHealth);
  });

  it('recalled, it walks home and stays without selling', () => {
    const { engine, character, advance } = setup((c) => {
      c.bag.push({ itemId: HIDE, bonuses: [], upgradeLevel: 0, qty: 5 });
      c.settings.autoSell = SELL_ALL;
    });
    engine.dispatch({ type: 'sendToArea', characterId: 'c1', areaId: AREA });
    advance(2000);
    engine.dispatch({ type: 'returnToCity', characterId: 'c1' });
    advance(120_000);
    expect(character.phase).toBe('idle');
    expect(character.areaId).toBeNull();
    expect(character.bag.some((s) => s.itemId === HIDE)).toBe(true);
  });

  it('a save in the old restocking phase settles in the city on the next step', () => {
    const { character, advance } = setup((c) => {
      c.areaId = AREA;
      c.phase = 'restocking';
      c.health = 1;
    });
    advance(TICK);
    expect(character.phase).toBe('idle');
    expect(character.areaId).toBeNull();
  });

  it('the offline estimate brings a dead character home and leaves it there', () => {
    const data = loadGameData();
    const state = createGameState(7, T0, data);
    const character = createCharacterState('c1', 'Ysolde', data);
    character.areaId = AREA;
    character.phase = 'dead';
    state.roster.push(character);
    const [summary] = estimateOffline(state, 3600, data).characters;
    expect(summary?.kills).toBe(0);
    expect(character.phase).toBe('idle');
    expect(character.areaId).toBeNull();
    expect(potions(character)).toBe(10);
  });
});

describe('out of potions (decisions A1)', () => {
  it('is true only when the bag holds no health potion', () => {
    const data = loadGameData();
    const character = createCharacterState('c1', 'Ysolde', data);
    expect(outOfPotions(character, data)).toBe(false);
    character.bag = [{ itemId: HIDE, bonuses: [], upgradeLevel: 0, qty: 1 }];
    expect(outOfPotions(character, data)).toBe(true);
  });
});

describe('drinkPotion command (decisions A1)', () => {
  it('takes one from the bag and queues it', () => {
    const { engine, character, advance } = setup((c) => {
      c.health = 10;
    });
    engine.dispatch({ type: 'drinkPotion', characterId: 'c1', itemId: MINOR });
    advance(TICK);
    expect(potions(character)).toBe(9);
    expect(character.potions.queue).toEqual([MINOR]);
    expect(engine.drainEvents().some((e) => e.type === 'commandRejected')).toBe(false);
  });

  it.each([
    ['a dead character', (c: CharacterState) => void (c.phase = 'dead'), MINOR, 'Ysolde is dead.'],
    ['an item that is no potion', () => {}, HIDE, `No potion called ${HIDE}.`],
    ['a potion not in the bag', (c: CharacterState) => void (c.bag = []), MINOR, `Ysolde has no ${MINOR}.`],
  ])('refuses %s', (_, configure, itemId, reason) => {
    const { engine, character, advance } = setup(configure);
    const bag = structuredClone(character.bag);
    engine.dispatch({ type: 'drinkPotion', characterId: 'c1', itemId });
    advance(TICK);
    expect(character.bag).toEqual(bag);
    expect(engine.drainEvents()).toContainEqual(expect.objectContaining({ type: 'commandRejected', reason }));
  });
});
