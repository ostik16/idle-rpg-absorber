/**
 * The reconcile pass after a load (ADR 0003): a data table change can leave ids in a save that no longer exist.
 * Unknown item ids move to a "Recovered items" warehouse tab, whole stacks with their bonuses and upgrades.
 * Unknown area or enemy ids leave active state and the character goes back to the city.
 * Mutates the state it is given, which at that point is the fresh copy parsed from the record.
 */
import type { CharacterState, GameState, ItemStack, WarehouseTab } from '../state/types';

export const RECOVERED_TAB_NAME = 'Recovered items';

/** The extra tab. It only exists once something has been recovered, and holds whatever it holds, known or not. */
export interface RecoveredTab extends WarehouseTab {
  name: typeof RECOVERED_TAB_NAME;
}

export function isRecoveredTab(tab: WarehouseTab): tab is RecoveredTab {
  return (tab as Partial<RecoveredTab>).name === RECOVERED_TAB_NAME;
}

/** The tables reconcile reads, by id only. `GameData` fits; `save/` does not import `data/` (architecture). */
export interface ReconcileTables {
  readonly items: readonly { readonly id: string }[];
  readonly enemies: readonly { readonly id: string }[];
  readonly areas: readonly { readonly id: string }[];
}

export interface RecoveredItem {
  itemId: string;
  qty: number;
}

export interface ReturnedCharacter {
  characterId: string;
  name: string;
  /** The ids that no longer exist. */
  unknownIds: string[];
}

export interface ReconcileReport {
  /** Stacks moved this time. */
  recovered: RecoveredItem[];
  returned: ReturnedCharacter[];
}

function idsOf(table: readonly { readonly id: string }[]): ReadonlySet<string> {
  return new Set(table.map((row) => row.id));
}

/** Keeps the stacks with a known item and hands the rest to `recover`. */
function keepKnown(stacks: readonly ItemStack[], known: ReadonlySet<string>, recover: (stack: ItemStack) => void) {
  return stacks.filter((stack) => {
    if (known.has(stack.itemId)) return true;
    recover(stack);
    return false;
  });
}

/**
 * Drops what no longer exists and sends the character home. A dead character stays dead, so its respawn still
 * runs. The area and target that do still exist are kept: they are the player's choice.
 */
function returnIfUnknown(character: CharacterState, tables: ReconcileTables): ReturnedCharacter | null {
  const enemies = idsOf(tables.enemies);
  const unknownIds: string[] = [];
  if (character.fight !== null && !enemies.has(character.fight.enemyId)) unknownIds.push(character.fight.enemyId);
  if (character.targetEnemyId !== null && !enemies.has(character.targetEnemyId)) {
    unknownIds.push(character.targetEnemyId);
    character.targetEnemyId = null;
  }
  if (character.areaId !== null && !idsOf(tables.areas).has(character.areaId)) {
    unknownIds.push(character.areaId);
    character.areaId = null;
  }
  if (unknownIds.length === 0) return null;

  character.fight = null;
  if (character.phase !== 'dead') {
    character.phase = 'idle';
    character.timeInPhaseMs = 0;
    character.stayInCity = false; // It has arrived. `dead` keeps it, so a character called home still stays there.
  }
  return { characterId: character.id, name: character.name, unknownIds: [...new Set(unknownIds)] };
}

export function reconcile(state: GameState, tables: ReconcileTables): ReconcileReport {
  const known = idsOf(tables.items);
  const moved: ItemStack[] = [];
  const recover = (stack: ItemStack): void => void moved.push(stack);

  const returned: ReturnedCharacter[] = [];
  for (const character of state.roster) {
    character.bag = keepKnown(character.bag, known, recover);
    for (const [slot, stack] of Object.entries(character.equipment)) {
      if (known.has(stack.itemId)) continue;
      recover(stack);
      delete character.equipment[slot];
    }
    // Settings that name an item, not items the player owns, so they are dropped and not recovered.
    const { settings } = character;
    settings.restockList = settings.restockList.filter((entry) => known.has(entry.itemId));
    settings.potionThresholds = Object.fromEntries(
      Object.entries(settings.potionThresholds).filter(([itemId]) => known.has(itemId)),
    );
    const back = returnIfUnknown(character, tables);
    if (back !== null) returned.push(back);
  }
  const { tabs } = state.account.warehouse;
  for (const tab of tabs) {
    if (!isRecoveredTab(tab)) tab.items = keepKnown(tab.items, known, recover);
  }
  state.shops.buyback = keepKnown(state.shops.buyback, known, recover);
  // Only a report for the Welcome back screen, which looks items up by id. The stacks themselves are moved above.
  for (const summary of state.pendingSummary?.characters ?? []) {
    summary.items = Object.fromEntries(Object.entries(summary.items).filter(([itemId]) => known.has(itemId)));
  }

  if (moved.length > 0) {
    let target = tabs.find(isRecoveredTab);
    if (target === undefined) {
      target = { name: RECOVERED_TAB_NAME, cells: 0, items: [] };
      tabs.push(target);
    }
    target.items.push(...moved);
    // An unknown item's size is gone with its row, so each stack is counted as one cell, and nothing is ever cut.
    target.cells = Math.max(target.cells, target.items.length);
  }
  return { recovered: moved.map(({ itemId, qty }) => ({ itemId, qty })), returned };
}
