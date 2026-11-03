/**
 * Plain serialisable game state (ADR 0002, ADR 0003, architecture "state/").
 * Numbers, strings, booleans, null, arrays and plain objects only, so a save is `JSON.stringify(state)`.
 * The payload shape is in ADR 0003 "Contents of payload". Parts the first batch does not use yet (spells,
 * buyback, the rare goods rotation) are there, empty, so their issues only fill them in.
 */
import type { Attributes } from '../game/stats';
import type { ProficiencyId } from '../game/proficiency';

/** The farming loop a character is in (ADR 0002 "Multiple characters"). `idle` means not farming. */
export const PHASES = [
  'travelling',
  'searching',
  'fighting',
  'looting',
  'returning',
  'restocking',
  'dead',
  'idle',
] as const;

export type Phase = (typeof PHASES)[number];

/** The random streams every character has, one per purpose (ADR 0002 "RNG"). */
export type StreamName = 'combat' | 'drops' | 'search';

/** The four 32-bit words of one sfc32 stream. Same shape as `RngState` in game/rng.ts. */
export type StreamState = readonly [number, number, number, number];

/** Saved state of all of one character's streams (ADR 0003 "roster[]"). */
export type CharacterRngState = Readonly<Record<StreamName, StreamState>>;

/** A bonus attribute rolled when the item dropped (design 2.1). */
export interface RolledBonus {
  attribute: string;
  value: number;
}

/**
 * Items are stored by id, never as copies of table data, so a rebalance applies to existing saves (ADR 0003).
 * A stack takes the item's `size` in cells; position does not matter (decisions L7).
 */
export interface ItemStack {
  itemId: string;
  bonuses: RolledBonus[];
  upgradeLevel: number;
  qty: number;
}

/** One rule of a loot filter or auto-sell list (design 2.3). Fields left out match any item. */
export interface ItemRule {
  category?: string;
  minRequiredLevel?: number;
  bonusAttribute?: string;
}

/** While `enabled` is false the rules do nothing: a loot filter picks up everything, auto-sell sells nothing. */
export interface ItemRuleSet {
  enabled: boolean;
  rules: ItemRule[];
}

export interface RestockEntry {
  itemId: string;
  quantity: number;
}

export type CityHealingMode = 'fast' | 'balanced' | 'slow';

/** What the player can change per character. A new character takes the defaults from data/constants.json. */
export interface CharacterSettings {
  /** Fraction of maximum health below which the character goes home (design 3.2). */
  returnHealthThreshold: number;
  /** Potions to top up to in the city, in buying order (design 3.2). */
  restockList: RestockEntry[];
  cityHealing: CityHealingMode;
  /** Item id to auto-use threshold. An item not listed uses its own `autoUseDefaultThreshold` (design 2.6). */
  potionThresholds: Record<string, number>;
  lootFilter: ItemRuleSet;
  autoSell: ItemRuleSet;
}

/** Points earned and not yet spent, and points spent (design 4.4). */
export interface PointsState {
  characterUnspent: number;
  characterSpent: number;
  skillUnspent: number;
  skillSpent: number;
}

/** Spell rank by spell id, and the auto-cast order (design 4.5). Conditions arrive with spells. */
export interface SpellsState {
  ranks: Record<string, number>;
  autoCastOrder: string[];
}

export interface CharacterState {
  /** Unique and never reused. Step order, merge order and stream seeds all follow it. */
  id: string;
  name: string;
  /** Each character has its own gold (decisions L16). */
  gold: number;
  level: number;
  xpInLevel: number;
  points: PointsState;
  attributes: Attributes;
  /** Hidden numbers, shown only as titles (design 4.6). */
  proficiency: Record<ProficiencyId, number>;
  spells: SpellsState;
  /** Slot id to the item worn there. An empty slot is left out. */
  equipment: Record<string, ItemStack>;
  bag: ItemStack[];
  health: number;
  mana: number;
  /** The area the character farms, or null when it has none. */
  areaId: string | null;
  /** The enemy type it targets, or null when it fights whatever it finds (design 3.3). */
  targetEnemyId: string | null;
  phase: Phase;
  /** Time spent in the current phase, in ms. Grows by `combat.tickMs` every step. */
  timeInPhaseMs: number;
  settings: CharacterSettings;
  /** Absorbed value by trait id (design 4.7). */
  absorption: Record<string, number>;
  /** Stream states. Absent on a new character: the engine derives them from `clock.masterSeed` and the id. */
  rng?: CharacterRngState;
}

export interface WarehouseTab {
  cells: number;
  items: ItemStack[];
}

export interface AccountState {
  /** The number in the next character's id. It only grows, so an id is never reused after a deletion. */
  nextCharacterNumber: number;
  unlockedSlots: number;
  /** Shared by all characters (design 2.4). */
  warehouse: { tabs: WarehouseTab[] };
  /** Filled by the settings screen. */
  settings: Record<string, never>;
}

/** Stored, not derived, so deleting a character cannot hide knowledge that was shared (design 4.8). */
export interface BestiaryState {
  /** Character id to enemy id to kills. */
  kills: Record<string, Record<string, number>>;
  /** Enemy id to the highest threshold tier reached by any character. */
  revealed: Record<string, number>;
}

/** Both come after the first batch (decisions L14). */
export interface ShopsState {
  rareGoods: null;
  buyback: ItemStack[];
}

export interface ClockState {
  /**
   * End of the last whole step, in wall-clock ms (ADR 0002 "Catch-up"). It moves in steps of `combat.tickMs`,
   * so `now - lastSimulatedAt` is also the sub-step remainder still waiting for its step.
   * After an offline estimate or a clock rewind it is set to `now`.
   */
  lastSimulatedAt: number;
  /** When the state was last saved, in wall-clock ms. The save code writes it. */
  savedAt: number;
  /** Seed all streams are derived from. Stored in the save so a run is reproducible. */
  masterSeed: number;
  diagnostics: {
    /** How many times the clock went backwards (ADR 0002 "Clock going backwards"). */
    clockRewind: number;
  };
}

/** What one character gained while the player was away. Fields follow design 3.4; levels and absorption come with the estimator. */
export interface CharacterSummary {
  characterId: string;
  kills: number;
  xp: number;
  gold: number;
  /** Item id to quantity. */
  items: Record<string, number>;
}

/** The Welcome back screen's data (design 3.4, 6), kept until the player has seen it. */
export interface OfflineSummary {
  /** Seconds the estimate covered, after the cap. */
  seconds: number;
  /** Seconds of absence past `offline.capHours`, thrown away. The screen says so. */
  discardedSeconds: number;
  /** One entry per character, in id order. */
  characters: CharacterSummary[];
}

export interface GameState {
  clock: ClockState;
  account: AccountState;
  /** Any order; the engine steps characters in id order. */
  roster: CharacterState[];
  bestiary: BestiaryState;
  shops: ShopsState;
  /** An offline summary not yet shown, so closing the tab on the Welcome back screen loses nothing (ADR 0003). */
  pendingSummary: OfflineSummary | null;
}
