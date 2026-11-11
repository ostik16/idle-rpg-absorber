// The only place that creates signals (ADR 0001). `connectEngine` publishes engine state into them; `send` is the way back.
import { batch, computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { constantSection, type GameData } from '../data/game-data';
import type { Command } from '../engine/commands';
import type { Engine } from '../engine/engine';
import type { EngineEvent } from '../engine/events';
import { bagLimitsFor, type EquipmentItemRow } from '../game/equipment';
import { baseMovementSeconds, targetingMultiplier } from '../game/farming';
import { usedCells } from '../game/inventory';
import type { ProficiencyId } from '../game/proficiency';
import { respawnSeconds } from '../game/progression';
import { characterNameError as nameErrorFn, type Attributes } from '../game/stats';
import { derivedStats, outOfPotions, sendRefusal, type DerivedStats } from '../state/selectors';
import type {
  CharacterState,
  CityHealingMode,
  ItemRuleSet,
  ItemStack,
  OfflineSummary,
  Phase,
  RestockEntry,
  WarehouseTab,
} from '../state/types';
import { formatGold } from './format';
import { iconBodies, type IconName } from './icons';
import { DEFAULT_ROUTE, watchHash, type Route } from './router';

/** Re-export so UI sources that cannot reach into `state/` can still name a phase. */
export type { CityHealingMode, ItemRule, ItemRuleSet, Phase, RestockEntry } from '../state/types';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

export const route = signal<Route>(DEFAULT_ROUTE);

/** Keeps `route` in step with the URL hash. Call once at startup. */
export function startRouteSync(): () => void {
  return watchHash((next) => {
    route.value = next;
  });
}

/**
 * One character, one signal per live value (ADR 0001), so a change updates only what is bound to that value.
 * Health, mana and XP are whole numbers rounded up: the engine's are fractional, and a living character never reads 0.
 * The loot feed joins this when the engine reports drops.
 */
export interface CharacterView {
  readonly id: string;
  readonly name: string;
  readonly health: ReadonlySignal<number>;
  readonly maxHealth: ReadonlySignal<number>;
  readonly mana: ReadonlySignal<number>;
  readonly maxMana: ReadonlySignal<number>;
  readonly level: ReadonlySignal<number>;
  readonly xpInLevel: ReadonlySignal<number>;
  readonly gold: ReadonlySignal<number>;
  readonly activity: ReadonlySignal<Phase>;
  /** Why "Send" is refused now, the engine's own words, or null when it can go (decisions A2). */
  readonly sendRefusal: ReadonlySignal<string | null>;
  /** Time in the current phase, in the design system's formats: `12s`, `3m 12s`, `7h 42m`. */
  readonly timeInActivity: ReadonlySignal<string>;
  readonly bag: ReadonlySignal<readonly ItemStack[]>;
  /** No health potion left in the bag: with automation off it can now die from it (decisions A1). */
  readonly noPotions: ReadonlySignal<boolean>;
  /** What is worn, by slot id. */
  readonly equipment: ReadonlySignal<Record<string, ItemStack>>;
  /** Bag cells and the stack size of stackable items, both set by the equipped backpack (design 2.1). */
  readonly bagCapacity: ReadonlySignal<number>;
  readonly bagMaxStack: ReadonlySignal<number>;
  readonly bagUsedCells: ReadonlySignal<number>;
  /** The area the character farms, or null when it has none (design 3.2). */
  readonly areaId: ReadonlySignal<string | null>;
  /** The enemy type it targets, or null when it fights whatever it finds (design 3.3). */
  readonly targetEnemyId: ReadonlySignal<string | null>;
  readonly attributes: ReadonlySignal<Attributes>;
  readonly derived: ReadonlySignal<DerivedStats>;
  readonly unspentPoints: ReadonlySignal<number>;
  /** Hidden numbers (design 4.6): screens show titles only. */
  readonly proficiency: ReadonlySignal<Record<ProficiencyId, number>>;
  readonly phaseElapsedMs: ReadonlySignal<number>;
  /** Length of the current phase when it is known (a dead character's respawn wait), else null. */
  readonly phaseTotalMs: ReadonlySignal<number | null>;
  /** Newest first, at most `LOOT_LIMIT` lines. */
  readonly loot: ReadonlySignal<readonly LootEntry[]>;
  /** Per-character settings (design 3.2, 2.3), changed with the `set…` commands. */
  readonly returnHealthThreshold: ReadonlySignal<number>;
  readonly cityHealing: ReadonlySignal<CityHealingMode>;
  readonly restockList: ReadonlySignal<readonly RestockEntry[]>;
  /** Item id to auto-use fraction. An item not listed uses its own default. */
  readonly potionThresholds: ReadonlySignal<Readonly<Record<string, number>>>;
  readonly lootFilter: ReadonlySignal<ItemRuleSet>;
  readonly autoSell: ReadonlySignal<ItemRuleSet>;
}

export type LootKind = 'kill' | 'xp' | 'gold' | 'item' | 'levelUp' | 'death' | 'xpLost' | 'bagFull';

/** One line of the loot feed (design system "LootFeed"). `amount` is already formatted. */
export interface LootEntry {
  readonly id: number;
  readonly kind: LootKind;
  readonly icon: IconName;
  readonly text: string;
  readonly amount: string | null;
}

const LOOT_LIMIT = 20;
let lootCounter = 0;

const rosterSignal = signal<readonly CharacterView[]>([]);
const warehouseTabsSignal = signal<readonly ReadonlySignal<WarehouseTab>[]>([]);
const pendingSummarySignal = signal<OfflineSummary | null>(null);
const noticeSignal = signal<string | null>(null);
const lastingNoticesSignal = signal<readonly string[]>([]);
const unlockedSlotsSignal = signal(0);
const maxSlotsSignal = signal(0);
const selectedIdSignal = signal<string | null>(null);
const creationOpenSignal = signal(false);
const pendingDeleteIdSignal = signal<string | null>(null);
const viewedIdSignal = signal<string | null>(null);
const openAreaIdSignal = signal<string | null>(null);
const openShopIdSignal = signal<string | null>(null);
const settingsIdSignal = signal<string | null>(null);
const warehouseOpenSignal = signal(false);
/** The game data the engine runs on, exposed to screens that read names (areas) or validate input. */
let gameData: GameData | null = null;

/** Changes only when a character joins or leaves. */
export const roster: ReadonlySignal<readonly CharacterView[]> = rosterSignal;
/** One signal per warehouse tab. The list changes only when the number of tabs does. */
export const warehouseTabs: ReadonlySignal<readonly ReadonlySignal<WarehouseTab>[]> = warehouseTabsSignal;
/** The Welcome back screen's data, until the player has seen it. */
export const pendingSummary: ReadonlySignal<OfflineSummary | null> = pendingSummarySignal;
/** The latest answer from the engine: a refused command or a clock rewind. The next command clears it. */
export const notice: ReadonlySignal<string | null> = noticeSignal;
/** The character whose detail screen is pushed over the current screen, or null. */
export const viewedCharacterId: ReadonlySignal<string | null> = viewedIdSignal;
/** The area whose send sheet is open on the World screen, or null. */
export const openAreaId: ReadonlySignal<string | null> = openAreaIdSignal;

/** The shop whose screen is pushed over the City, or null. */
export const openShopId: ReadonlySignal<string | null> = openShopIdSignal;
/** The character whose settings screen is pushed over the current screen, or null. */
export const settingsCharacterId: ReadonlySignal<string | null> = settingsIdSignal;
/** True while the warehouse screen is pushed over the City. */
export const warehouseOpen: ReadonlySignal<boolean> = warehouseOpenSignal;

/** Lines that stay on screen until the page reloads: what the save load found, or that the game stopped. */
export const lastingNotices: ReadonlySignal<readonly string[]> = lastingNoticesSignal;
/** How many of the 4 slots are unlocked. Design 4.1, decisions L17. */
export const unlockedSlots: ReadonlySignal<number> = unlockedSlotsSignal;
/** The maximum roster size (design 4.1, `constants.characters.maxSlots`). */
export const maxSlots: ReadonlySignal<number> = maxSlotsSignal;
/** The character whose numbers feed the app bar (decisions L18). Null before the roster has anyone. */
export const selectedCharacterId: ReadonlySignal<string | null> = selectedIdSignal;
/** The character behind the app bar's gold pill, or null. */
export const selectedCharacter: ReadonlySignal<CharacterView | null> = computed(() => {
  const id = selectedIdSignal.value;
  if (id === null) return null;
  return rosterSignal.value.find((view) => view.id === id) ?? null;
});
/** True while the character creation screen is pushed over the roster. */
export const creationOpen: ReadonlySignal<boolean> = creationOpenSignal;
/** The character the player is about to delete (design 4.1), or null. */
export const pendingDeleteId: ReadonlySignal<string | null> = pendingDeleteIdSignal;

/** Adds lines to `lastingNotices`. Works before `connectEngine`, because a load finishes before the engine exists. */
export function showLastingNotices(lines: readonly string[]): void {
  if (lines.length > 0) lastingNoticesSignal.value = [...lastingNoticesSignal.value, ...lines];
}

export interface SendOptions {
  /** The command cannot be undone, so save once it has been applied (ADR 0003 "Writing"). */
  saveAfter?: boolean;
}

let dispatchCommand: ((command: Command, options: SendOptions) => void) | null = null;

/** Sends a command to the engine. This is the only way the UI changes the game. */
export function send(command: Command, options: SendOptions = {}): void {
  if (dispatchCommand === null) throw new Error('send() called before connectEngine()');
  noticeSignal.value = null;
  dispatchCommand(command, options);
}

/** `12s`, `3m 12s`, `7h 42m`: the design system's duration format. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  if (totalMinutes === 0) return `${seconds}s`;
  if (totalMinutes < MINUTES_PER_HOUR) return `${totalMinutes}m ${seconds}s`;
  return `${Math.floor(totalMinutes / MINUTES_PER_HOUR)}h ${totalMinutes % MINUTES_PER_HOUR}m`;
}

/**
 * Returns a function that copies a part of state into `target`, writing only when that part changed. State is mutated
 * in place and is plain JSON by contract, so the JSON text is both the change check and the copy, and the UI never
 * holds a live reference to state.
 */
function copyInto<T>(target: Signal<T>): (source: T) => void {
  let shown: string | undefined;
  return (source) => {
    const text = JSON.stringify(source);
    if (text === shown) return;
    shown = text;
    target.value = JSON.parse(text) as T;
  };
}

interface CharacterBinding {
  readonly view: CharacterView;
  addLoot(entry: Omit<LootEntry, 'id'>): void;
  refresh(character: CharacterState): void;
}

/** The item reader the game helpers take, over `data.items`. An unknown id reads as a 1-cell item, so a stale save cannot stop the screen. */
function itemRowOf(data: GameData): (id: string) => EquipmentItemRow {
  return (id) => {
    const row = data.items.find((entry) => entry.id === id);
    return (row ?? { id, size: 1 }) as unknown as EquipmentItemRow;
  };
}

function bindCharacter(first: CharacterState, data: GameData): CharacterBinding {
  const health = signal(0);
  const maxHealth = signal(0);
  const mana = signal(0);
  const maxMana = signal(0);
  const level = signal(0);
  const xpInLevel = signal(0);
  const gold = signal(0);
  const activity = signal(first.phase);
  const refusal = signal<string | null>(null);
  const timeInActivity = signal('');
  const bag = signal<readonly ItemStack[]>([]);
  const noPotions = signal(false);
  const equipment = signal<Record<string, ItemStack>>({});
  const bagCapacity = signal(0);
  const bagMaxStack = signal(0);
  const bagUsedCells = signal(0);
  const areaId = signal<string | null>(first.areaId);
  const targetEnemyId = signal<string | null>(first.targetEnemyId);
  const attributes = signal<Attributes>(first.attributes);
  const derived = signal<DerivedStats>(derivedStats(first, data));
  const unspentPoints = signal(0);
  const proficiency = signal(first.proficiency);
  const phaseElapsedMs = signal(0);
  const phaseTotalMs = signal<number | null>(null);
  const loot = signal<readonly LootEntry[]>([]);
  const returnHealthThreshold = signal(first.settings.returnHealthThreshold);
  const cityHealing = signal<CityHealingMode>(first.settings.cityHealing);
  const restockList = signal<readonly RestockEntry[]>([]);
  const potionThresholds = signal<Readonly<Record<string, number>>>({});
  const lootFilter = signal<ItemRuleSet>({ enabled: false, rules: [] });
  const autoSell = signal<ItemRuleSet>({ enabled: false, rules: [] });
  const copyRestockList = copyInto(restockList);
  const copyPotionThresholds = copyInto(potionThresholds);
  const copyLootFilter = copyInto(lootFilter);
  const copyAutoSell = copyInto(autoSell);
  const copyBag = copyInto(bag);
  const copyEquipment = copyInto(equipment);
  const itemOf = itemRowOf(data);
  const inventory = constantSection(data, 'inventory');
  const copyAttributes = copyInto(attributes);
  const copyDerived = copyInto(derived);
  const copyProficiency = copyInto(proficiency);
  const death = constantSection(data, 'death');

  const binding: CharacterBinding = {
    view: {
      id: first.id,
      name: first.name,
      health,
      maxHealth,
      mana,
      maxMana,
      level,
      xpInLevel,
      gold,
      activity,
      sendRefusal: refusal,
      timeInActivity,
      bag,
      noPotions,
      equipment,
      bagCapacity,
      bagMaxStack,
      bagUsedCells,
      areaId,
      targetEnemyId,
      attributes,
      derived,
      unspentPoints,
      proficiency,
      phaseElapsedMs,
      phaseTotalMs,
      loot,
      returnHealthThreshold,
      cityHealing,
      restockList,
      potionThresholds,
      lootFilter,
      autoSell,
    },
    addLoot(entry) {
      lootCounter += 1;
      loot.value = [{ id: lootCounter, ...entry }, ...loot.value].slice(0, LOOT_LIMIT);
    },
    refresh(character) {
      const stats = derivedStats(character, data);
      health.value = Math.ceil(character.health);
      maxHealth.value = Math.ceil(stats.maxHealth);
      mana.value = Math.ceil(character.mana);
      maxMana.value = Math.ceil(stats.maxMana);
      level.value = character.level;
      xpInLevel.value = Math.ceil(character.xpInLevel);
      gold.value = character.gold;
      activity.value = character.phase;
      refusal.value = sendRefusal(character);
      timeInActivity.value = formatDuration(character.timeInPhaseMs);
      areaId.value = character.areaId;
      targetEnemyId.value = character.targetEnemyId;
      unspentPoints.value = character.points.characterUnspent;
      phaseElapsedMs.value = character.timeInPhaseMs;
      phaseTotalMs.value = character.phase === 'dead' ? respawnSeconds(character.level, death) * MS_PER_SECOND : null;
      copyBag(character.bag);
      noPotions.value = outOfPotions(character, data);
      copyEquipment(character.equipment);
      const limits = bagLimitsFor(character.equipment, itemOf, inventory);
      bagCapacity.value = limits.capacity;
      bagMaxStack.value = limits.maxStack;
      bagUsedCells.value = usedCells(character.bag, itemOf);
      copyAttributes(character.attributes);
      copyDerived(stats);
      copyProficiency(character.proficiency);
      returnHealthThreshold.value = character.settings.returnHealthThreshold;
      cityHealing.value = character.settings.cityHealing;
      copyRestockList(character.settings.restockList);
      copyPotionThresholds(character.settings.potionThresholds);
      copyLootFilter(character.settings.lootFilter);
      copyAutoSell(character.settings.autoSell);
    },
  };
  binding.refresh(first);
  return binding;
}

function noticeFor(event: EngineEvent): string | null {
  switch (event.type) {
    case 'commandRejected':
      return event.reason;
    case 'clockRewind':
      return 'Clock moved back. No time was added.';
    default:
      return null;
  }
}

function nameIn(data: GameData, table: 'enemies' | 'items' | 'traits', id: string): string {
  const row = data[table].find((entry) => entry.id === id);
  return typeof row?.name === 'string' ? row.name : id;
}

/** The loot feed line for an event, or null when the event is not loot. */
function lootFor(event: EngineEvent, data: GameData): Omit<LootEntry, 'id'> | null {
  switch (event.type) {
    case 'enemyKilled':
      return { kind: 'kill', icon: 'farming', text: `${nameIn(data, 'enemies', event.enemyId)} slain`, amount: null };
    case 'xpGained':
      return { kind: 'xp', icon: 'absorption', text: 'XP', amount: `+${event.amount}` };
    case 'goldGained':
      return { kind: 'gold', icon: 'gold', text: 'Gold', amount: `+${formatGold(event.amount)}` };
    case 'itemPickedUp':
      return {
        kind: 'item',
        icon: 'rareItem',
        text: nameIn(data, 'items', event.itemId),
        amount: event.qty > 1 ? `×${event.qty}` : null,
      };
    case 'levelUp':
      return { kind: 'levelUp', icon: 'upgrade', text: `Reached Lv ${event.level}`, amount: null };
    case 'characterDied':
      return { kind: 'death', icon: 'dead', text: `Fell to ${nameIn(data, 'enemies', event.enemyId)}`, amount: null };
    case 'xpLost':
      return { kind: 'xpLost', icon: 'dead', text: 'XP lost', amount: `−${event.amount}` };
    case 'bagFull':
      return {
        kind: 'bagFull',
        icon: 'bag',
        text: `Bag full — left ${event.qty} ${nameIn(data, 'items', event.itemId)}`,
        amount: null,
      };
    default:
      return null;
  }
}

/**
 * Connects the signals to the engine and publishes its state. Returns `refresh`, which brings every signal in line
 * with state and reads the events since the last call. The store is the only reader of `drainEvents`.
 * `onSaveDue` runs after the `refresh` that follows a `saveAfter` command being applied.
 */
export function connectEngine(
  engine: Pick<Engine, 'state' | 'dispatch' | 'drainEvents'>,
  data: GameData,
  onSaveDue: () => void = () => {},
): () => void {
  const bindings = new Map<string, CharacterBinding>();
  const copySummary = copyInto(pendingSummarySignal);
  let copyTabs: ((source: WarehouseTab) => void)[] = [];
  let saveWanted = false;
  let simulatedAt = engine.state.clock.lastSimulatedAt;

  function refreshRoster(): void {
    const characters = engine.state.roster;
    const ids = characters.map((character) => character.id);
    for (const id of bindings.keys()) if (!ids.includes(id)) bindings.delete(id);
    for (const character of characters) {
      const binding = bindings.get(character.id);
      if (binding) binding.refresh(character);
      else bindings.set(character.id, bindCharacter(character, data));
    }
    const shown = rosterSignal.value;
    if (shown.length !== ids.length || shown.some((view, i) => view.id !== ids[i])) {
      rosterSignal.value = ids.map((id) => (bindings.get(id) as CharacterBinding).view);
    }
    unlockedSlotsSignal.value = engine.state.account.unlockedSlots;
    const currentSelected = selectedIdSignal.value;
    if (currentSelected !== null && !ids.includes(currentSelected)) selectedIdSignal.value = null;
    if (selectedIdSignal.value === null && ids.length > 0) selectedIdSignal.value = ids[0] as string;
    if (pendingDeleteIdSignal.value !== null && !ids.includes(pendingDeleteIdSignal.value)) {
      pendingDeleteIdSignal.value = null;
    }
    if (viewedIdSignal.value !== null && !ids.includes(viewedIdSignal.value)) viewedIdSignal.value = null;
    if (settingsIdSignal.value !== null && !ids.includes(settingsIdSignal.value)) settingsIdSignal.value = null;
  }

  function refreshWarehouse(): void {
    const source = engine.state.account.warehouse.tabs;
    if (source.length !== copyTabs.length) {
      const tabs = source.map((tab) => signal(tab));
      copyTabs = tabs.map(copyInto);
      warehouseTabsSignal.value = tabs;
    }
    source.forEach((tab, i) => copyTabs[i]?.(tab));
  }

  /**
   * The engine applies queued commands before a step or an estimate, and both move the clock forward. A clock
   * rewind moves it back and leaves them queued, and a call with no whole step due leaves it where it was.
   */
  function commandsApplied(): boolean {
    const previous = simulatedAt;
    simulatedAt = engine.state.clock.lastSimulatedAt;
    return simulatedAt > previous;
  }

  function refresh(): void {
    const applied = commandsApplied();
    batch(() => {
      refreshRoster();
      refreshWarehouse();
      copySummary(engine.state.pendingSummary);
      for (const event of engine.drainEvents()) {
        const message = noticeFor(event);
        if (message !== null) noticeSignal.value = message;
        const line = 'characterId' in event ? lootFor(event, data) : null;
        if (line !== null) bindings.get((event as { characterId: string }).characterId)?.addLoot(line);
      }
    });
    if (applied && saveWanted) {
      saveWanted = false;
      onSaveDue();
    }
  }

  rosterSignal.value = [];
  noticeSignal.value = null;
  selectedIdSignal.value = null;
  creationOpenSignal.value = false;
  pendingDeleteIdSignal.value = null;
  viewedIdSignal.value = null;
  openAreaIdSignal.value = null;
  openShopIdSignal.value = null;
  settingsIdSignal.value = null;
  warehouseOpenSignal.value = false;
  maxSlotsSignal.value = constantSection(data, 'characters').maxSlots;
  gameData = data;
  dispatchCommand = (command, options) => {
    if (options.saveAfter) saveWanted = true;
    engine.dispatch(command);
  };
  refresh();
  return refresh;
}

/** The game's data, once the engine is connected. Screens read it for area names and creation validation. */
export function requireGameData(): GameData {
  if (gameData === null) throw new Error('requireGameData() called before connectEngine()');
  return gameData;
}

/** Opens the character creation screen (design 4.1). No-op when no slot is free. */
export function openCreation(): void {
  if (rosterSignal.value.length >= unlockedSlotsSignal.value) return;
  creationOpenSignal.value = true;
}

/** Closes the character creation screen without creating anyone. */
export function closeCreation(): void {
  creationOpenSignal.value = false;
}

/** Marks a character as pending deletion. The confirm step runs before the command is sent (design 4.1). */
export function openDeleteConfirm(characterId: string): void {
  pendingDeleteIdSignal.value = characterId;
}

export function closeDeleteConfirm(): void {
  pendingDeleteIdSignal.value = null;
}

/** Points the app bar at a character (decisions L18). Null is only valid for an empty roster. */
export function selectCharacter(characterId: string): void {
  selectedIdSignal.value = characterId;
}

/** Pushes a character's detail screen (design system "Mobile and layout"). */
export function openCharacter(characterId: string): void {
  viewedIdSignal.value = characterId;
}

export function closeCharacter(): void {
  viewedIdSignal.value = null;
}

/** Opens the send sheet for an area on the World screen. */
export function openArea(areaId: string): void {
  openAreaIdSignal.value = areaId;
}

export function closeArea(): void {
  openAreaIdSignal.value = null;
}

export function openShop(shopId: string): void {
  openShopIdSignal.value = shopId;
}

export function closeShop(): void {
  openShopIdSignal.value = null;
}

/** Pushes a character's settings screen (design 3.2, 2.3). */
export function openSettings(characterId: string): void {
  settingsIdSignal.value = characterId;
}

export function closeSettings(): void {
  settingsIdSignal.value = null;
}

export function openWarehouse(): void {
  warehouseOpenSignal.value = true;
}

export function closeWarehouse(): void {
  warehouseOpenSignal.value = false;
}

export interface AreaSummary {
  readonly id: string;
  readonly name: string;
  readonly levelMin: number;
  readonly levelMax: number;
}

/** Looks up an area by id; the roster row uses it to print "{name} · Lv {min}–{max}". */
export function areaOf(areaId: string): AreaSummary | null {
  const data = requireGameData();
  const row = (data.areas as readonly { id: string }[]).find((entry) => entry.id === areaId);
  if (row === undefined) return null;
  const area = row as unknown as { id: string; name: string; levelRange: { min: number; max: number } };
  return { id: area.id, name: area.name, levelMin: area.levelRange.min, levelMax: area.levelRange.max };
}

/** Rules behind a character name, so the creation screen stays in step with the engine (design 4.1). */
export interface CreationNameLimits {
  readonly minLength: number;
  readonly maxLength: number;
}

export function creationNameLimits(): CreationNameLimits {
  const creation = constantSection(requireGameData(), 'creation');
  return { minLength: creation.nameMinLength, maxLength: creation.nameMaxLength };
}

/** Returns null when the name is fine, or the design-system-voice error (design 4.1). */
export function creationNameError(name: string): string | null {
  const data = requireGameData();
  const creation = constantSection(data, 'creation');
  const existing = rosterSignal.value.map((view) => view.name);
  // Imported from the game layer, not state, so the UI boundary test is happy (tests/ui-boundary.test.ts).
  return nameErrorFn(name, existing, creation);
}


export interface AreaListEntry extends AreaSummary {
  readonly distanceFromCity: number;
  /** Seconds of movement between fights before targeting (design 3.3). */
  readonly searchSeconds: number;
}

interface AreaRow {
  id: string;
  name: string;
  levelRange: { min: number; max: number };
  distanceFromCity: number;
  movementSecondsBetweenEnemies?: number;
  enemies: readonly { enemyId: string }[];
}

function areaRows(): readonly AreaRow[] {
  return requireGameData().areas as unknown as readonly AreaRow[];
}

/** Every area in data order, for the World screen. */
export function listAreas(): readonly AreaListEntry[] {
  return areaRows().map((area) => ({
    id: area.id,
    name: area.name,
    levelMin: area.levelRange.min,
    levelMax: area.levelRange.max,
    distanceFromCity: area.distanceFromCity,
    searchSeconds: baseMovementSeconds(area),
  }));
}

export interface AreaEnemyView {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly type: string;
  readonly targetingMultiplier: number;
  readonly traits: readonly { name: string; value: number; magical: boolean }[];
  /** The highest base chance in the enemy's drop table, 0 to 1; 0 without a table. Multiply by the level modifier. */
  readonly topDropChanceBase: number;
}

interface EnemyRow {
  id: string;
  name: string;
  level: number;
  type: string;
  targetingMultiplier?: number;
  traits: readonly { id: string; value: number; magical: boolean }[];
  dropTableId?: string;
}

/** The enemies listed in an area's spawn table (mini-boss and boss rows come later). */
export function areaEnemies(areaId: string): readonly AreaEnemyView[] {
  const data = requireGameData();
  const area = areaRows().find((row) => row.id === areaId);
  if (area === undefined) return [];
  return area.enemies.flatMap(({ enemyId }) => {
    const enemy = data.enemies.find((row) => row.id === enemyId) as unknown as EnemyRow | undefined;
    if (enemy === undefined) return [];
    const table = data.dropTables.find((row) => row.id === enemy.dropTableId) as unknown as
      | { entries: readonly { baseChance: number }[] }
      | undefined;
    return [
      {
        id: enemy.id,
        name: enemy.name,
        level: enemy.level,
        type: enemy.type,
        targetingMultiplier: targetingMultiplier(enemy),
        traits: enemy.traits.map((trait) => ({
          name: nameIn(data, 'traits', trait.id),
          value: trait.value,
          magical: trait.magical,
        })),
        topDropChanceBase: Math.max(0, ...(table?.entries.map((entry) => entry.baseChance) ?? [])),
      },
    ];
  });
}

export interface ItemInfo {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  readonly category: string;
  /** Bag cells one stack takes (L7). */
  readonly size: number;
  readonly stackable: boolean;
  readonly requiredLevel: number | null;
  readonly equipmentType: string | null;
  readonly sellPrice: number;
  readonly buyPrice: number | null;
  /** Health fraction a potion drinks at unless the player sets one (design 2.6), or null for items that are not auto-used. */
  readonly autoUseDefaultThreshold: number | null;
}

interface ItemRow {
  id: string;
  name: string;
  icon?: string;
  category: string;
  size: number;
  stackable: boolean;
  requiredLevel?: number;
  equipmentType?: string;
  sellPrice: number;
  buyPrice?: number | null;
  autoUseDefaultThreshold?: number;
}

/** Name, icon, size and prices for an item id, from data. A missing row falls back to the id so a screen never throws. */
export function itemInfo(itemId: string): ItemInfo {
  const row = requireGameData().items.find((entry) => entry.id === itemId) as unknown as ItemRow | undefined;
  if (row === undefined) {
    return { id: itemId, name: itemId, icon: 'bag', category: 'unknown', size: 1, stackable: false, requiredLevel: null, equipmentType: null, sellPrice: 0, buyPrice: null, autoUseDefaultThreshold: null };
  }
  return {
    id: row.id,
    name: row.name,
    icon: row.icon !== undefined && row.icon in iconBodies ? (row.icon as IconName) : 'rareItem',
    category: row.category,
    size: row.size,
    stackable: row.stackable,
    requiredLevel: row.requiredLevel ?? null,
    equipmentType: row.equipmentType ?? null,
    sellPrice: row.sellPrice,
    buyPrice: row.buyPrice ?? null,
    autoUseDefaultThreshold: row.autoUseDefaultThreshold ?? null,
  };
}

/** Every consumable in data order: the rows of the restock and drink-at lists (the engine accepts any consumable). */
export function restockablePotions(): readonly ItemInfo[] {
  return (requireGameData().items as unknown as readonly ItemRow[]).filter((row) => row.category === 'consumable').map((row) => itemInfo(row.id));
}

export interface RuleCategory {
  readonly id: string;
  readonly label: string;
  readonly sub: string;
  /** True for the category whose rule carries a minimum required level. */
  readonly hasMinLevel: boolean;
}

/** The item categories a loot-filter or auto-sell rule can name, in display order (Loot-Filter sketch, plus Valuables: decisions R12). */
export function ruleCategories(): readonly RuleCategory[] {
  return [
    { id: 'equipment', label: 'Equipment', sub: 'Required level at or above this', hasMinLevel: true },
    { id: 'material', label: 'Materials', sub: 'Upgrade materials', hasMinLevel: false },
    { id: 'rare', label: 'Rare items', sub: 'Dropped by bosses and cursed objects', hasMinLevel: false },
    { id: 'consumable', label: 'Consumables', sub: 'Potions and boosts', hasMinLevel: false },
    { id: 'valuable', label: 'Valuables', sub: 'Silver and gold bars', hasMinLevel: false },
  ];
}

export interface ShopInfo {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
}

/** Every shop in data order. */
export function listShops(): readonly ShopInfo[] {
  return (requireGameData().shops as unknown as readonly ShopInfo[]).map(({ id, name, purpose }) => ({ id, name, purpose }));
}

/** What a shop sells, with its prices. */
export function shopItems(shopId: string): readonly { itemId: string; price: number }[] {
  const shop = requireGameData().shops.find((row) => row.id === shopId) as unknown as { itemList: readonly { itemId: string; price: number }[] } | undefined;
  return shop?.itemList ?? [];
}

export interface SlotInfo {
  readonly id: string;
  readonly label: string;
  readonly allowedTypes: readonly string[];
}

/** The paper-doll's order (Character-Gear sketch). Which slots exist and what they take comes from data. */
const SLOT_ORDER = ['head', 'body', 'hands', 'legs', 'feet', 'main-hand', 'off-hand', 'necklace', 'ring-1', 'ring-2', 'special-item-slot', 'backpack'];

export function equipmentSlots(): readonly SlotInfo[] {
  const rows = requireGameData().equipmentSlots as unknown as readonly { id: string; name: string; allowedTypes: readonly string[] }[];
  const rank = (id: string) => SLOT_ORDER.indexOf(id);
  return rows
    .map((row) => ({ id: row.id, label: row.name, allowedTypes: row.allowedTypes }))
    .sort((a, b) => rank(a.id) - rank(b.id));
}
