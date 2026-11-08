/**
 * The offline estimator against the live step loop (ADR 0002 "Validating the estimator against the step sim", issue 29).
 * Every seed runs the step loop and the estimator from identical states and the same master seed, with
 * `offline.efficiency` and `offline.proficiencyRate` at 1, and compares means and standard deviations over the seeds.
 * The tolerances live here, not in game data. The ADR names the cap length; stepping 12 hours over 200 seeds is too slow
 * for a test run, so the fixtures use `SECONDS` and `npm run balance:offline` is the tool for the full cap.
 */
import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import { createGameData, loadGameData, type GameData, type GameDataInput, type TableName } from '../src/data/game-data';
import { createEngine } from '../src/engine/engine';
import { estimateOffline, mergeSummaries } from '../src/engine/offline';
import { createCharacterState, createGameState } from '../src/state/factory';
import { respawnSeconds } from '../src/game/progression';
import { createCharacterStreams } from '../src/engine/streams';
import type { CharacterState, CharacterSummary, GameState } from '../src/state/types';

const MEAN_TOLERANCE = 0.03;
const SD_TOLERANCE = 0.2;
/** Items whose mean count per run is below this are too rare for a 3% comparison over a few hundred seeds. */
const MIN_ITEM_MEAN = 5;
const SECONDS = 1800;
const T0 = 1_000_000;
const CHUNK_MS = 60_000; // 600 steps, one frame (engine.maxStepsPerFrame)
const AREA = 'mossfang-glade';

type Mutable = { -readonly [K in keyof GameDataInput]: GameDataInput[K] };
type Constants = Record<string, Record<string, unknown>>;

/** The real tables with the offline rates at 1 (the parity is checked at full efficiency) and edits for a fixture. */
function dataWith(edit: (input: Mutable) => void = () => {}): GameData {
  const input: Mutable = {
    ...loadGameData(),
    constants: { ...constants, offline: { ...constants.offline, efficiency: 1, proficiencyRate: 1 } },
  };
  edit(input);
  return createGameData(input);
}

function editConstants(input: Mutable, section: string, change: Record<string, unknown>): void {
  const all = input.constants as unknown as Constants;
  input.constants = { ...all, [section]: { ...all[section], ...change } } as unknown as Mutable['constants'];
}

/** Changes one row of a table, on a copy. */
function editRow(input: Mutable, table: TableName, id: string, change: (row: Record<string, unknown>) => void): void {
  input[table] = (input[table] ?? []).map((row) => {
    if (row.id !== id) return row;
    const copy = JSON.parse(JSON.stringify(row)) as Record<string, unknown> & { id: string };
    change(copy);
    return copy as typeof row;
  });
}

interface Totals {
  kills: number;
  xp: number;
  gold: number;
  deaths: number;
  items: Record<string, number>;
}

type Configure = (character: CharacterState) => void;

function startState(seed: number, data: GameData, configure: Configure, characters = 1): GameState {
  const state = createGameState(seed, T0, data);
  for (let i = 1; i <= characters; i++) {
    const character = createCharacterState(`c${i}`, `Ysolde ${i}`, data);
    character.areaId = AREA;
    character.phase = 'travelling';
    configure(character);
    state.roster.push(character);
  }
  return state;
}

function runSteps(seed: number, seconds: number, data: GameData, configure: Configure, characters: number): Totals {
  const state = startState(seed, data, configure, characters);
  const engine = createEngine({ data, state });
  const totals: Totals = { kills: 0, xp: 0, gold: 0, deaths: 0, items: {} };
  const goldAtStart = sum(state.roster.map((c) => c.gold));
  for (let ms = 0; ms < seconds * 1000; ms += CHUNK_MS) {
    engine.advanceTo(T0 + Math.min(ms + CHUNK_MS, seconds * 1000));
    for (const event of engine.drainEvents()) {
      if (event.type === 'enemyKilled') totals.kills += 1;
      else if (event.type === 'xpGained') totals.xp += event.amount;
      else if (event.type === 'characterDied') totals.deaths += 1;
      else if (event.type === 'itemPickedUp') totals.items[event.itemId] = (totals.items[event.itemId] ?? 0) + event.qty;
    }
  }
  totals.gold = sum(state.roster.map((c) => c.gold)) - goldAtStart;
  return totals;
}

function estimate(state: GameState, seconds: number, data: GameData): CharacterSummary {
  const [summary] = estimateOffline(state, seconds, data).characters;
  if (summary === undefined) throw new Error('no summary');
  return summary;
}

function runEstimate(seed: number, seconds: number, data: GameData, configure: Configure, characters: number): Totals {
  const totals: Totals = { kills: 0, xp: 0, gold: 0, deaths: 0, items: {} };
  for (const c of estimateOffline(startState(seed, data, configure, characters), seconds, data).characters) {
    totals.kills += c.kills;
    totals.xp += c.xp;
    totals.gold += c.gold;
    totals.deaths += c.deaths ?? 0;
    for (const [id, qty] of Object.entries(c.items)) totals.items[id] = (totals.items[id] ?? 0) + qty;
  }
  return totals;
}

const sum = (values: number[]): number => values.reduce((total, v) => total + v, 0);
const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
const sd = (values: number[]): number => {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
};

interface Drift {
  metric: string;
  step: number;
  estimate: number;
  meanDrift: number;
  sdDrift: number;
}

/** Steps and estimates `seeds` runs and lists the drift of every metric. A metric the step loop never moves is skipped. */
function driftOver(seeds: number, seconds: number, data: GameData, configure: Configure = () => {}, characters = 1): Drift[] {
  const steps: Totals[] = [];
  const estimates: Totals[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    steps.push(runSteps(seed, seconds, data, configure, characters));
    estimates.push(runEstimate(seed, seconds, data, configure, characters));
  }
  const itemIds = new Set(steps.flatMap((t) => Object.keys(t.items)));
  const metrics: [string, (t: Totals) => number][] = [
    ['kills', (t) => t.kills],
    ['xp', (t) => t.xp],
    ['gold', (t) => t.gold],
    ...[...itemIds].map((id): [string, (t: Totals) => number] => [`item ${id}`, (t) => t.items[id] ?? 0]),
  ];
  const drifts: Drift[] = [];
  for (const [metric, read] of metrics) {
    const a = steps.map(read);
    const b = estimates.map(read);
    if (metric.startsWith('item ') && mean(a) < MIN_ITEM_MEAN) continue;
    drifts.push({
      metric,
      step: mean(a),
      estimate: mean(b),
      meanDrift: Math.abs(mean(b) - mean(a)) / Math.abs(mean(a)),
      sdDrift: Math.abs(sd(b) - sd(a)) / sd(a),
    });
  }
  return drifts;
}

function expectParity(drifts: Drift[], metrics: readonly string[]): void {
  const report = drifts
    .map((d) => `${d.metric}: step ${d.step.toFixed(1)}, estimate ${d.estimate.toFixed(1)}, mean ${(d.meanDrift * 100).toFixed(2)}%, sd ${(d.sdDrift * 100).toFixed(1)}%`)
    .join('\n');
  if (process.env.OFFLINE_REPORT) process.stderr.write(`\n${report}\n`);
  for (const metric of metrics) expect(drifts.map((d) => d.metric), report).toContain(metric);
  for (const d of drifts) {
    expect(d.meanDrift, `mean of ${d.metric}\n${report}`).toBeLessThanOrEqual(MEAN_TOLERANCE);
    expect(d.sdDrift, `sd of ${d.metric}\n${report}`).toBeLessThanOrEqual(SD_TOLERANCE);
  }
}

const BASIC = ['kills', 'xp', 'gold'];
const SELL_EVERYTHING = { enabled: true, rules: [{ category: 'material' }, { category: 'equipment' }, { category: 'valuable' }, { category: 'rare' }] };

describe('offline estimator against the step loop (ADR 0002)', () => {
  it('a new character in the first area, 200 seeds: kills, XP, gold and drops', { timeout: 300_000 }, () => {
    expectParity(driftOver(200, SECONDS, dataWith()), [...BASIC, 'item hide-scrap', 'item minor-health-potion']);
  });

  it('a bag filling early: the character goes home to sell and comes back', { timeout: 300_000 }, () => {
    const data = dataWith((input) => editConstants(input, 'inventory', { baseCells: 8 }));
    const drifts = driftOver(100, SECONDS, data, (c) => {
      c.settings.autoSell = SELL_EVERYTHING;
    });
    expectParity(drifts, BASIC);
  });

  it('a bag staying full: XP and gold only', { timeout: 300_000 }, () => {
    const data = dataWith((input) => editConstants(input, 'inventory', { baseCells: 3 }));
    expectParity(driftOver(100, SECONDS, data), BASIC);
  });

  it('potions running out with nothing to restock: health alone sends it home', { timeout: 300_000 }, () => {
    const drifts = driftOver(100, SECONDS, dataWith(), (c) => {
      c.settings.restockList = [];
      c.bag = c.bag.map((stack) => ({ ...stack, qty: 3 }));
    });
    expectParity(drifts, BASIC);
  });

  it('boss and mini-boss spawns in the area', { timeout: 300_000 }, () => {
    const data = dataWith((input) => {
      editRow(input, 'areas', AREA, (row) => {
        row.miniBossId = 'old-mossfang';
        row.miniBossSpawnChance = 0.04;
        row.bossId = 'mossfang-matriarch';
        row.bossSpawnChance = 0.01;
      });
    });
    const drifts = driftOver(100, SECONDS, data, (c) => {
      c.attributes = { strength: 25, dexterity: 15, vitality: 30, intelligence: 5 };
      c.health = 270;
    });
    expectParity(drifts, BASIC);
  });

  it('a character that starts dead with a full bag: respawn, sell, restock, heal, then farm', { timeout: 300_000 }, () => {
    const data = dataWith((input) => editConstants(input, 'inventory', { baseCells: 8 }));
    const drifts = driftOver(100, SECONDS, data, (c) => {
      c.settings.autoSell = SELL_EVERYTHING;
      c.phase = 'dead';
      c.health = 0;
      c.bag = [
        ...c.bag,
        ...['hide-scrap', 'hide-scrap', 'hide-scrap'].map((itemId) => ({ itemId, bonuses: [], upgradeLevel: 0, qty: 5 })),
      ];
    });
    expectParity(drifts, BASIC);
  });

  it('two characters farming at once: kills, XP and gold summed over the roster', { timeout: 300_000 }, () => {
    expectParity(driftOver(100, SECONDS, dataWith(), () => {}, 2), BASIC);
  });

  it('absorbed regeneration and life steal: the continuous rate against the live pulse', { timeout: 300_000 }, () => {
    const drifts = driftOver(300, SECONDS, dataWith(), (c) => {
      c.absorption = { regeneration: 5, 'life-steal': 5 };
    });
    expectParity(drifts, BASIC);
  });
});

describe('offline estimator results', () => {
  const data = dataWith();

  it('a character with no area, or one that stays in the city, earns nothing', () => {
    const idle = startState(1, data, (c) => {
      c.areaId = null;
      c.phase = 'idle';
    });
    expect(estimate(idle, 3600, data)).toMatchObject({ kills: 0, xp: 0, gold: 0, deaths: 0, items: {} });
    const home = startState(1, data, (c) => {
      c.stayInCity = true;
    });
    expect(estimate(home, 3600, data).kills).toBe(0);
  });

  it('applies kills, XP, bestiary and the stream states to the state', () => {
    const state = startState(5, data, () => {});
    const before = JSON.stringify(state.roster[0]?.rng);
    const summary = estimate(state, 1800, data);
    const character = state.roster[0] as CharacterState;
    const killed = Object.values(state.bestiary.kills['c1'] ?? {}).reduce((sum, n) => sum + n, 0);
    expect(summary.kills).toBeGreaterThan(50);
    expect(killed).toBe(summary.kills);
    expect(character.level).toBeGreaterThan(1);
    expect(JSON.stringify(character.rng)).not.toBe(before);
    expect(character.proficiency.speed).toBeGreaterThan(0);
  });

  it('offline.efficiency scales the farming time', () => {
    const full = estimate(startState(7, data, () => {}), 3600, data).kills;
    const lower = dataWith((input) => editConstants(input, 'offline', { efficiency: 0.5 }));
    const half = estimate(startState(7, lower, () => {}), 3600, lower).kills;
    expect(half / full).toBeGreaterThan(0.45);
    expect(half / full).toBeLessThan(0.55);
  });

  it('a character that cannot win dies with the 3.7 penalty, counted in the summary', () => {
    const doomed = dataWith((input) =>
      editRow(input, 'areas', AREA, (row) => {
        row.bossId = 'mossfang-matriarch';
        row.bossSpawnChance = 1;
      }),
    );
    const state = startState(3, doomed, (c) => {
      c.xpInLevel = 100;
      c.settings.returnHealthThreshold = 0; // it never flees
    });
    const summary = estimate(state, 600, doomed);
    expect(summary.deaths).toBeGreaterThan(0);
    expect(summary.kills).toBe(0);
    expect((state.roster[0] as CharacterState).xpInLevel).toBeLessThan(100);
  });

  it('merging two summaries adds the deaths', () => {
    const a = { characterId: 'c1', kills: 1, xp: 1, gold: 1, items: {}, deaths: 1 };
    const b = { characterId: 'c1', kills: 1, xp: 1, gold: 1, items: {}, deaths: 2 };
    const merged = mergeSummaries({ seconds: 1, discardedSeconds: 0, characters: [a] }, { seconds: 1, discardedSeconds: 0, characters: [b] });
    expect(merged.characters[0]?.deaths).toBe(3);
  });

  it('a summary with no deaths stays without the field when merged', () => {
    const a = { characterId: 'c1', kills: 1, xp: 1, gold: 1, items: {} };
    const merged = mergeSummaries({ seconds: 1, discardedSeconds: 0, characters: [a] }, { seconds: 1, discardedSeconds: 0, characters: [a] });
    expect(merged.characters[0]).not.toHaveProperty('deaths');
  });

  it('two characters: each gets a summary, the shared bestiary and account add up', () => {
    const state = startState(9, data, () => {}, 2);
    const result = estimateOffline(state, 1800, data).characters;
    expect(result.map((c) => c.characterId)).toEqual(['c1', 'c2']);
    for (const c of result) {
      expect(c.kills).toBeGreaterThan(50);
      expect(Object.values(state.bestiary.kills[c.characterId] ?? {}).reduce((total, n) => total + n, 0)).toBe(c.kills);
    }
    expect(Object.keys(state.bestiary.revealed).length).toBeGreaterThan(0);
    expect(result[0]?.kills).not.toBe(result[1]?.kills); // separate streams
  });

  it('a character that starts dead sells its bag on arriving in the city, after the respawn timer', () => {
    const settle = (waitSeconds: number): CharacterSummary => {
      const state = startState(2, data, (c) => {
        c.settings.autoSell = SELL_EVERYTHING;
        c.phase = 'dead';
        c.bag = [{ itemId: 'hide-scrap', bonuses: [], upgradeLevel: 0, qty: 5 }];
      });
      return estimate(state, waitSeconds, data);
    };
    const wait = respawnSeconds(1, constants.death);
    expect(settle(wait - 1).gold).toBe(0);
    expect(settle(wait + 1).gold).toBeGreaterThan(0);
  });

  it('a fight cut off by the end of the time leaves the combat stream where it was', () => {
    const fresh = createCharacterStreams(11, 'c1');
    // The first budget at which the search stream has moved is one where the search fit but its fight did not.
    for (let seconds = 1; seconds < 300; seconds += 0.25) {
      const state = startState(11, data, () => {});
      state.clock.masterSeed = 11;
      estimate(state, seconds, data);
      const rng = (state.roster[0] as CharacterState).rng;
      if (JSON.stringify(rng?.search) === JSON.stringify(fresh.search.getState())) continue;
      expect(rng?.combat).toEqual(fresh.combat.getState());
      return;
    }
    throw new Error('search never ran');
  });
});
