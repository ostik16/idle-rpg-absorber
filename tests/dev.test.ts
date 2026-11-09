/** Developer actions (#74): `applyCommand` with `{ type: 'dev' }`, and the dev clock. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import constants from '../data/constants.json';
import { loadGameData } from '../src/data/game-data';
import { devNow, getSpeed, setSpeed, skipTime } from '../src/dev/clock';
import { applyCommand } from '../src/engine/commands';
import type { DevAction } from '../src/engine/dev';
import { createEngine } from '../src/engine/engine';
import type { EngineEvent } from '../src/engine/events';
import type { StepContext } from '../src/engine/step-context';
import { createCharacterState, createGameState } from '../src/state/factory';
import { derivedStats } from '../src/state/selectors';
import type { GameState } from '../src/state/types';

const data = loadGameData();
const events: EngineEvent[] = [];
const ctx = { data, emit: (event: EngineEvent) => events.push(event) } as unknown as StepContext;

function makeState(): GameState {
  const state = createGameState(1, 0, data);
  state.roster.push(createCharacterState('a', 'Ada', data));
  return state;
}

/** Applies a dev action; returns the rejection reason, or null when it was applied. */
function dev(state: GameState, action: DevAction): string | null {
  const event = applyCommand(state, { type: 'dev', action }, data, () => ctx);
  return event?.type === 'commandRejected' ? event.reason : null;
}

const character = (state: GameState) => state.roster[0] as GameState['roster'][number];
const potion = String(data.items.find((row) => row.category === 'consumable')?.id);
const enemyId = String(data.enemies[0]?.id);

describe('dev actions', () => {
  it('setLevel pays the XP, points and base stats of each level, and emits level ups', () => {
    events.length = 0;
    const state = makeState();
    const before = { ...character(state).attributes };
    expect(dev(state, { kind: 'setLevel', characterId: 'a', level: 5 })).toBeNull();
    const c = character(state);
    expect(c.level).toBe(5);
    expect(c.xpInLevel).toBe(0);
    expect(events.filter((e) => e.type === 'levelUp').map((e) => (e as { level: number }).level)).toEqual([2, 3, 4, 5]);
    expect(c.points.characterUnspent).toBeGreaterThan(0);
    expect(c.attributes).not.toEqual(before);
  });

  it('setLevel refuses a level that is not higher, or above the cap', () => {
    const state = makeState();
    expect(dev(state, { kind: 'setLevel', characterId: 'a', level: character(state).level })).toMatch(/Pick a level/);
    expect(dev(state, { kind: 'setLevel', characterId: 'a', level: constants.levelCap + 1 })).toMatch(/Pick a level/);
  });

  it('giveXp and giveGold add to the character; bad amounts change nothing', () => {
    const state = makeState();
    const gold = character(state).gold;
    expect(dev(state, { kind: 'giveGold', characterId: 'a', amount: 250 })).toBeNull();
    expect(character(state).gold).toBe(gold + 250);
    expect(dev(state, { kind: 'giveXp', characterId: 'a', amount: 7 })).toBeNull();
    expect(character(state).xpInLevel).toBe(7);
    expect(dev(state, { kind: 'giveGold', characterId: 'a', amount: -1 })).toMatch(/at least 1/);
    expect(dev(state, { kind: 'giveXp', characterId: 'a', amount: 1.5 })).toMatch(/at least 1/);
  });

  it('giveItem stacks into the bag, and removeItem empties every stack of it', () => {
    const state = makeState();
    const held = () => character(state).bag.filter((s) => s.itemId === potion).reduce((n, s) => n + s.qty, 0);
    const start = held();
    expect(dev(state, { kind: 'giveItem', characterId: 'a', itemId: potion, qty: 3 })).toBeNull();
    expect(held()).toBe(start + 3);
    expect(dev(state, { kind: 'removeItem', characterId: 'a', itemId: potion })).toBeNull();
    expect(held()).toBe(0);
    expect(dev(state, { kind: 'removeItem', characterId: 'a', itemId: potion })).toMatch(/in the bag/);
    expect(dev(state, { kind: 'giveItem', characterId: 'a', itemId: 'no-such-item', qty: 1 })).toMatch(/No item/);
  });

  it('setHealth sets a fraction of maximum health and refuses 0 or less', () => {
    const state = makeState();
    expect(dev(state, { kind: 'setHealth', characterId: 'a', fraction: 0.25 })).toBeNull();
    expect(character(state).health).toBeCloseTo(derivedStats(character(state), data).maxHealth * 0.25);
    expect(dev(state, { kind: 'setHealth', characterId: 'a', fraction: 0 })).toMatch(/between 1% and 100%/);
  });

  it('setKills sets the count and reveals the tier it reaches', () => {
    const state = makeState();
    expect(dev(state, { kind: 'setKills', characterId: 'a', enemyId, kills: 50 })).toBeNull();
    expect(state.bestiary.kills['a']?.[enemyId]).toBe(50);
    expect(state.bestiary.revealed[enemyId]).toBeGreaterThan(0);
    expect(dev(state, { kind: 'setKills', characterId: 'a', enemyId: 'no-such-enemy', kills: 1 })).toMatch(/No enemy/);
    expect(dev(state, { kind: 'setKills', characterId: 'a', enemyId, kills: -1 })).toMatch(/whole number/);
  });

  it('refuses an unknown character', () => {
    expect(dev(makeState(), { kind: 'giveGold', characterId: 'zz', amount: 1 })).toMatch(/No character/);
  });

  it('replaceState swaps the state in place and the engine runs the new characters', () => {
    const state = makeState();
    const engine = createEngine({ data, state });
    const next = createGameState(9, 5000, data);
    next.roster.push(createCharacterState('b', 'Bea', data));
    engine.dispatch({ type: 'dev', action: { kind: 'replaceState', state: next } });
    engine.dispatch({ type: 'dev', action: { kind: 'giveGold', characterId: 'b', amount: 10 } });
    engine.advanceTo(5000 + constants.combat.tickMs);
    expect(engine.state).toBe(state);
    expect(state.roster.map((c) => c.id)).toEqual(['b']);
    expect(engine.drainEvents().filter((e) => e.type === 'commandRejected')).toEqual([]);
    expect(state.roster[0]?.rng).toBeDefined();
  });
});

describe('production build', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses every dev action and changes nothing', () => {
    vi.stubEnv('DEV', false);
    const state = makeState();
    const gold = character(state).gold;
    expect(dev(state, { kind: 'giveGold', characterId: 'a', amount: 5 })).toMatch(/not in this build/);
    expect(character(state).gold).toBe(gold);
  });
});

describe('dev clock', () => {
  afterEach(() => {
    vi.useRealTimers();
    setSpeed(1);
  });

  it('skipTime moves the clock ahead, and speed makes it run faster', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const start = devNow();
    skipTime(60_000);
    expect(devNow() - start).toBe(60_000);
    setSpeed(10);
    expect(getSpeed()).toBe(10);
    const before = devNow();
    vi.advanceTimersByTime(1000);
    expect(devNow() - before).toBe(10_000);
  });
});
