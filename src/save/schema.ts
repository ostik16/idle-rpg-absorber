/**
 * The current payload schema (ADR 0003: a load "validates against the current schema").
 * Checks are typed against `GameState`, so a new state field does not compile until it is listed here.
 * That is the reminder: a shape change needs this schema, a new save version and a migration.
 * Extra fields are allowed. Ranges and table ids are not checked: reconcile handles ids, the engine the rest.
 */
import {
  PHASES,
  type AccountState,
  type BestiaryState,
  type CharacterSettings,
  type CharacterState,
  type CharacterSummary,
  type CityHealingMode,
  type ClockState,
  type FightState,
  type GameState,
  type ItemRule,
  type ItemRuleSet,
  type ItemStack,
  type OfflineSummary,
  type Phase,
  type PointsState,
  type PotionsState,
  type RestockEntry,
  type RolledBonus,
  type ShopsState,
  type SpellsState,
  type StreamState,
  type WarehouseTab,
} from '../state/types';

/** A check returns what is wrong at `path`, or null. `type` only carries `T` for the compiler. */
interface Check<T> {
  (value: unknown, path: string): string | null;
  readonly type?: T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const num: Check<number> = (value, path) =>
  typeof value === 'number' && Number.isFinite(value) ? null : `${path} must be a number`;

const str: Check<string> = (value, path) => (typeof value === 'string' ? null : `${path} must be a string`);

const bool: Check<boolean> = (value, path) => (typeof value === 'boolean' ? null : `${path} must be true or false`);

const alwaysNull: Check<null> = (value, path) => (value === null ? null : `${path} must be null`);

const anyObject: Check<Record<string, never>> = (value, path) => (isObject(value) ? null : `${path} must be an object`);

function oneOf<T extends string>(allowed: readonly T[]): Check<T> {
  return (value, path) => (allowed.includes(value as T) ? null : `${path} must be one of ${allowed.join(', ')}`);
}

function nullable<T>(check: Check<T>): Check<T | null> {
  return (value, path) => (value === null ? null : check(value, path));
}

function optional<T>(check: Check<T>): Check<T | undefined> {
  return (value, path) => (value === undefined ? null : check(value, path));
}

function list<T>(check: Check<T>): Check<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) return `${path} must be a list`;
    for (const [index, entry] of value.entries()) {
      const problem = check(entry, `${path}[${index}]`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

function record<T>(check: Check<T>): Check<Record<string, T>> {
  return (value, path) => {
    if (!isObject(value)) return `${path} must be an object`;
    for (const [key, entry] of Object.entries(value)) {
      const problem = check(entry, `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

function shape<T>(fields: { readonly [K in keyof T]-?: Check<T[K]> }): Check<T> {
  return (value, path) => {
    if (!isObject(value)) return `${path} must be an object`;
    for (const key of Object.keys(fields) as (keyof T & string)[]) {
      const problem = fields[key](value[key], `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

const streamState: Check<StreamState> = (value, path) =>
  Array.isArray(value) && value.length === 4 && value.every((word) => num(word, path) === null)
    ? null
    : `${path} must be 4 numbers`;

const rolledBonus = shape<RolledBonus>({ attribute: str, value: num });

const itemStack = shape<ItemStack>({ itemId: str, bonuses: list(rolledBonus), upgradeLevel: num, qty: num });

const itemRule = shape<ItemRule>({
  category: optional(str),
  minRequiredLevel: optional(num),
  bonusAttribute: optional(str),
});

const itemRuleSet = shape<ItemRuleSet>({ enabled: bool, rules: list(itemRule) });

const restockEntry = shape<RestockEntry>({ itemId: str, quantity: num });

const cityHealing: Check<CityHealingMode> = oneOf<CityHealingMode>(['fast', 'balanced', 'slow']);

const characterSettings = shape<CharacterSettings>({
  returnHealthThreshold: num,
  restockList: list(restockEntry),
  cityHealing,
  potionThresholds: record(num),
  lootFilter: itemRuleSet,
  autoSell: itemRuleSet,
});

const points = shape<PointsState>({ characterUnspent: num, characterSpent: num, skillUnspent: num, skillSpent: num });

const spells = shape<SpellsState>({ ranks: record(num), autoCastOrder: list(str) });

const fight = shape<FightState>({ enemyId: str, enemyHp: num, ticks: num });

const potions = shape<PotionsState>({ queue: list(str), ticksDone: num, msIntoTick: num });

const character = shape<CharacterState>({
  id: str,
  name: str,
  gold: num,
  level: num,
  xpInLevel: num,
  highestMarkReached: num,
  points,
  attributes: shape({ strength: num, dexterity: num, vitality: num, intelligence: num }),
  // Which skills exist is in the tables, and this layer does not read those: a new skill is a migration.
  proficiency: record(num) as Check<CharacterState['proficiency']>,
  spells,
  equipment: record(itemStack),
  bag: list(itemStack),
  health: num,
  mana: num,
  potions,
  fight: nullable(fight),
  areaId: nullable(str),
  targetEnemyId: nullable(str),
  stayInCity: bool,
  phase: oneOf<Phase>(PHASES),
  timeInPhaseMs: num,
  settings: characterSettings,
  absorption: record(num),
  traitRegenMs: optional(num),
  rng: optional(shape({ combat: streamState, drops: streamState, search: streamState, death: streamState })),
});

const warehouseTab = shape<WarehouseTab>({ cells: num, items: list(itemStack) });

const account = shape<AccountState>({
  nextCharacterNumber: num,
  unlockedSlots: num,
  warehouse: shape({ tabs: list(warehouseTab) }),
  settings: anyObject,
});

const bestiary = shape<BestiaryState>({ kills: record(record(num)), revealed: record(num) });

const shops = shape<ShopsState>({ rareGoods: alwaysNull, buyback: list(itemStack) });

const clock = shape<ClockState>({
  lastSimulatedAt: num,
  savedAt: num,
  masterSeed: num,
  diagnostics: shape({ clockRewind: num }),
});

const characterSummary = shape<CharacterSummary>({ characterId: str, kills: num, xp: num, gold: num, items: record(num) });

const offlineSummary = shape<OfflineSummary>({ seconds: num, discardedSeconds: num, characters: list(characterSummary) });

const gameState = shape<GameState>({
  clock,
  account,
  roster: list(character),
  bestiary,
  shops,
  pendingSummary: nullable(offlineSummary),
});

/** What is wrong with a payload, or null when it fits the current schema. */
export function validatePayload(payload: unknown): string | null {
  const problem = gameState(payload, 'payload');
  if (problem !== null) return problem;
  const ids = (payload as GameState).roster.map((entry) => entry.id);
  // The engine refuses duplicate ids (engine.ts), so such a record could not be played.
  return new Set(ids).size === ids.length ? null : 'payload.roster has a duplicate character id';
}
