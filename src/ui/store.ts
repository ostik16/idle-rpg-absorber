// The only place that creates signals (ADR 0001). `connectEngine` publishes engine state into them; `send` is the way back.
import { batch, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { GameData } from '../data/game-data';
import type { Command } from '../engine/commands';
import type { Engine } from '../engine/engine';
import type { EngineEvent } from '../engine/events';
import { derivedStats } from '../state/selectors';
import type { CharacterState, ItemStack, OfflineSummary, Phase, WarehouseTab } from '../state/types';
import { DEFAULT_ROUTE, watchHash, type Route } from './router';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export const route = signal<Route>(DEFAULT_ROUTE);

/** Keeps `route` in step with the URL hash. Call once at startup. */
export function startRouteSync(): () => void {
  return watchHash((next) => {
    route.value = next;
  });
}

/**
 * One character, one signal per live value (ADR 0001), so a change updates only what is bound to that value.
 * Health and mana are whole numbers rounded up: the engine's are fractional, and a living character never reads 0.
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
  /** Time in the current phase, in the design system's format: `3m 12s`. */
  readonly timeInActivity: ReadonlySignal<string>;
  readonly bag: ReadonlySignal<readonly ItemStack[]>;
}

const rosterSignal = signal<readonly CharacterView[]>([]);
const warehouseTabsSignal = signal<readonly ReadonlySignal<WarehouseTab>[]>([]);
const pendingSummarySignal = signal<OfflineSummary | null>(null);
const noticeSignal = signal<string | null>(null);

/** Changes only when a character joins or leaves. */
export const roster: ReadonlySignal<readonly CharacterView[]> = rosterSignal;
/** One signal per warehouse tab. The list changes only when the number of tabs does. */
export const warehouseTabs: ReadonlySignal<readonly ReadonlySignal<WarehouseTab>[]> = warehouseTabsSignal;
/** The Welcome back screen's data, until the player has seen it. */
export const pendingSummary: ReadonlySignal<OfflineSummary | null> = pendingSummarySignal;
/** The latest one-line message: a refused command or a clock rewind. The next command clears it. */
export const notice: ReadonlySignal<string | null> = noticeSignal;

let dispatchCommand: ((command: Command) => void) | null = null;

/** Sends a command to the engine. This is the only way the UI changes the game. */
export function send(command: Command): void {
  if (dispatchCommand === null) throw new Error('send() called before connectEngine()');
  noticeSignal.value = null;
  dispatchCommand(command);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
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
  refresh(character: CharacterState): void;
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
  const timeInActivity = signal('');
  const bag = signal<readonly ItemStack[]>([]);
  const copyBag = copyInto(bag);

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
      timeInActivity,
      bag,
    },
    refresh(character) {
      const stats = derivedStats(character, data);
      health.value = Math.ceil(character.health);
      maxHealth.value = Math.ceil(stats.maxHealth);
      mana.value = Math.ceil(character.mana);
      maxMana.value = Math.ceil(stats.maxMana);
      level.value = character.level;
      xpInLevel.value = character.xpInLevel;
      gold.value = character.gold;
      activity.value = character.phase;
      timeInActivity.value = formatDuration(character.timeInPhaseMs);
      copyBag(character.bag);
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

/**
 * Connects the signals to the engine and publishes its state. Returns `refresh`, which brings every signal in line
 * with state and reads the events since the last call. The store is the only reader of `drainEvents`.
 */
export function connectEngine(engine: Pick<Engine, 'state' | 'dispatch' | 'drainEvents'>, data: GameData): () => void {
  const bindings = new Map<string, CharacterBinding>();
  const copySummary = copyInto(pendingSummarySignal);
  let copyTabs: ((source: WarehouseTab) => void)[] = [];

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

  function refresh(): void {
    batch(() => {
      refreshRoster();
      refreshWarehouse();
      copySummary(engine.state.pendingSummary);
      for (const event of engine.drainEvents()) {
        const message = noticeFor(event);
        if (message !== null) noticeSignal.value = message;
      }
    });
  }

  rosterSignal.value = [];
  noticeSignal.value = null;
  dispatchCommand = (command) => engine.dispatch(command);
  refresh();
  return refresh;
}
