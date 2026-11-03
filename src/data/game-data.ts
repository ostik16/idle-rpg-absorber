/**
 * Game data for the engine (ADR 0002 "Reading data", design 5.1).
 * Builds one frozen `GameData` from the tables in data/*.json and reads constants by dotted path.
 * No game logic here. Tests build a small `GameData` from fixtures with `createGameData`.
 */
import constantsJson from '../../data/constants.json';
import areasJson from '../../data/areas.json';
import attributesJson from '../../data/attributes.json';
import bestiaryThresholdsJson from '../../data/bestiary-thresholds.json';
import dropTablesJson from '../../data/drop-tables.json';
import enemiesJson from '../../data/enemies.json';
import equipmentSlotsJson from '../../data/equipment-slots.json';
import itemsJson from '../../data/items.json';
import proficienciesJson from '../../data/proficiencies.json';
import shopsJson from '../../data/shops.json';
import spellsJson from '../../data/spells.json';
import teleportersJson from '../../data/teleporters.json';
import traitsJson from '../../data/traits.json';
import upgradesJson from '../../data/upgrades.json';
import xpTableJson from '../../data/xp-table.json';

/** Any value data/constants.json can hold. `null` means undecided (CLAUDE.md). */
export type ConstantValue =
  | number
  | string
  | boolean
  | null
  | readonly ConstantValue[]
  | { readonly [key: string]: ConstantValue };

/** The whole of data/constants.json. */
export interface Constants {
  readonly [key: string]: ConstantValue;
}

/** One entry of a table. Every table except constants is an array of entries with a unique string id (data/README.md). */
export interface TableRow {
  readonly id: string;
  readonly [field: string]: unknown;
}

export type Table = readonly TableRow[];

/** Every table in data/ except constants.json, named after its file in camelCase (xp-table.json is `xpTable`). */
export type TableName =
  | 'areas'
  | 'attributes'
  | 'bestiaryThresholds'
  | 'dropTables'
  | 'enemies'
  | 'equipmentSlots'
  | 'items'
  | 'proficiencies'
  | 'shops'
  | 'spells'
  | 'teleporters'
  | 'traits'
  | 'upgrades'
  | 'xpTable';

/** All game data, deeply frozen. Rows stay loosely typed until the systems that read them are built. */
export type GameData = { readonly constants: Constants } & { readonly [name in TableName]: Table };

const TABLE_NAMES: readonly TableName[] = [
  'areas',
  'attributes',
  'bestiaryThresholds',
  'dropTables',
  'enemies',
  'equipmentSlots',
  'items',
  'proficiencies',
  'shops',
  'spells',
  'teleporters',
  'traits',
  'upgrades',
  'xpTable',
];

/** What `createGameData` accepts: constants, plus any tables the caller cares about. Missing tables are empty. */
export type GameDataInput = { readonly constants: Constants } & { readonly [name in TableName]?: Table };

/**
 * Copies a value and freezes every object and array in the copy. A copy, so the JSON modules that
 * `src/game` imports directly are left alone, and a test fixture stays editable after it is passed in.
 */
function freezeCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy)) as T;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, v]) => [key, freezeCopy(v)] as const);
    return Object.freeze(Object.fromEntries(entries)) as T;
  }
  return value;
}

/** Builds a frozen `GameData`. Tables left out are empty, so a fixture lists only what its test reads. */
export function createGameData(input: GameDataInput): GameData {
  const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, input[name] ?? []]));
  return freezeCopy({ ...tables, constants: input.constants } as GameData);
}

/** Loads the real tables from data/*.json. The shape is checked by `npm run validate:data`, not here. */
export function loadGameData(): GameData {
  return createGameData({
    constants: constantsJson,
    areas: areasJson,
    attributes: attributesJson,
    bestiaryThresholds: bestiaryThresholdsJson,
    dropTables: dropTablesJson,
    enemies: enemiesJson,
    equipmentSlots: equipmentSlotsJson,
    items: itemsJson,
    proficiencies: proficienciesJson,
    shops: shopsJson,
    spells: spellsJson,
    teleporters: teleportersJson,
    traits: traitsJson,
    upgrades: upgradesJson,
    xpTable: xpTableJson,
  });
}

/**
 * Value at a dotted path in data/constants.json, for example `requireConstant(data, 'combat.tickMs')`.
 * Throws, naming the path, when the value is `null` (undecided) or missing.
 */
export function requireConstant(data: GameData, path: string): Exclude<ConstantValue, null> {
  const keys = path.split('.');
  let current: ConstantValue = data.constants;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as string;
    const next: ConstantValue | undefined =
      typeof current === 'object' && current !== null && Object.hasOwn(current, key)
        ? (current as { readonly [key: string]: ConstantValue })[key]
        : undefined;
    if (next === undefined) {
      throw new Error(
        `constant "${path}" is missing from data/constants.json (nothing at "${keys.slice(0, i + 1).join('.')}")`,
      );
    }
    current = next;
  }
  if (current === null) {
    throw new Error(`constant "${path}" is null (undecided) in data/constants.json; decide it before using it`);
  }
  return current;
}

/**
 * A whole top-level section of data/constants.json, typed as that file is. Throws like `requireConstant`
 * when the section is null or missing. Its contents are checked by `npm run validate:data`, not here.
 */
export function constantSection<K extends keyof typeof constantsJson>(
  data: GameData,
  section: K,
): (typeof constantsJson)[K] {
  return requireConstant(data, section) as unknown as (typeof constantsJson)[K];
}

/** Like `requireConstant`, and the value must also be a finite number. */
export function requireNumberConstant(data: GameData, path: string): number {
  const value = requireConstant(data, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`constant "${path}" must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}
