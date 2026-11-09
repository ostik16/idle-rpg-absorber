/**
 * Developer actions for playtesting (#74). They arrive as the `dev` command, which `applyCommand` refuses outside a
 * dev build, so they are applied between steps like any command and a production bundle carries none of this.
 * Time is not here: the dev panel moves the clock `advanceTo` is given, so the normal step always does the work.
 */
import { constantSection, requireNumberConstant, type GameData } from '../data/game-data';
import { bestiaryTier } from '../game/formulas';
import { bagLimitsFor, type EquipmentItemRow } from '../game/equipment';
import { addToBag, type BagItemLike } from '../game/inventory';
import { xpToNextLevel } from '../game/progression';
import { derivedStats } from '../state/selectors';
import type { GameState, ItemStack } from '../state/types';
import type { StepContext } from './step-context';
import { grantXp, xpTableOf } from './rewards';

export type DevAction =
  /** Raises the level, paying the XP, points and base stats of each level on the way. Lowering is not offered. */
  | { kind: 'setLevel'; characterId: string; level: number }
  | { kind: 'giveXp'; characterId: string; amount: number }
  | { kind: 'giveGold'; characterId: string; amount: number }
  | { kind: 'giveItem'; characterId: string; itemId: string; qty: number }
  /** Empties every stack of the item from the bag, for example a potion stack. */
  | { kind: 'removeItem'; characterId: string; itemId: string }
  /** Health as a fraction of maximum, above 0 so the character is not killed outside a fight. */
  | { kind: 'setHealth'; characterId: string; fraction: number }
  /** Sets the character's kills of an enemy type and reveals the bestiary tier they reach. */
  | { kind: 'setKills'; characterId: string; enemyId: string; kills: number }
  /** Swaps the whole game state (import, new game). The caller has validated it; the engine reloads its streams. */
  | { kind: 'replaceState'; state: GameState };

const wholeAbove = (value: number, min: number): boolean => Number.isInteger(value) && value >= min;

/** Applies one dev action. Returns why it cannot be applied, or null when done. */
export function applyDevAction(
  state: GameState,
  action: DevAction,
  data: GameData,
  contextOf: (characterId: string) => StepContext | undefined,
): string | null {
  if (action.kind === 'replaceState') {
    Object.assign(state, action.state);
    return null;
  }
  const character = state.roster.find((c) => c.id === action.characterId);
  const ctx = contextOf(action.characterId);
  if (character === undefined || ctx === undefined) return `No character "${action.characterId}".`;

  switch (action.kind) {
    case 'setLevel': {
      const cap = requireNumberConstant(data, 'levelCap');
      if (!wholeAbove(action.level, character.level + 1) || action.level > cap) {
        return `Pick a level from ${character.level + 1} to ${cap}.`;
      }
      let xp = -character.xpInLevel;
      for (let level = character.level; level < action.level; level++) xp += xpToNextLevel(level, xpTableOf(data));
      grantXp(character, xp, ctx);
      return null;
    }
    case 'giveXp':
      if (!wholeAbove(action.amount, 1)) return 'Give at least 1 whole XP.';
      grantXp(character, action.amount, ctx);
      return null;
    case 'giveGold':
      if (!wholeAbove(action.amount, 1)) return 'Give at least 1 whole gold.';
      character.gold += action.amount;
      return null;
    case 'giveItem': {
      const row = data.items.find((r) => r.id === action.itemId) as unknown as (BagItemLike & EquipmentItemRow) | undefined;
      if (row === undefined) return `No item "${action.itemId}".`;
      if (!wholeAbove(action.qty, 1)) return 'Give at least 1 whole item.';
      const itemOf = (id: string) => data.items.find((r) => r.id === id) as unknown as BagItemLike & EquipmentItemRow;
      const limits = bagLimitsFor(character.equipment, itemOf, constantSection(data, 'inventory'));
      const stack: ItemStack = { itemId: action.itemId, bonuses: [], upgradeLevel: 0, qty: action.qty };
      const result = addToBag(character.bag, stack, row, limits, itemOf);
      if (result.added === 0) return 'The bag has no room.';
      character.bag = result.bag as ItemStack[];
      return null;
    }
    case 'removeItem': {
      const kept = character.bag.filter((s) => s.itemId !== action.itemId);
      if (kept.length === character.bag.length) return `No "${action.itemId}" in the bag.`;
      character.bag = kept;
      return null;
    }
    case 'setHealth': {
      if (!(action.fraction > 0 && action.fraction <= 1)) return 'Set health between 1% and 100%.';
      character.health = derivedStats(character, data).maxHealth * action.fraction;
      return null;
    }
    case 'setKills': {
      if (!data.enemies.some((r) => r.id === action.enemyId)) return `No enemy "${action.enemyId}".`;
      if (!wholeAbove(action.kills, 0)) return 'Set kills to a whole number, 0 or more.';
      (state.bestiary.kills[character.id] ??= {})[action.enemyId] = action.kills;
      const tier = bestiaryTier(action.kills, data.bestiaryThresholds as unknown as { kills: number }[]);
      state.bestiary.revealed[action.enemyId] = Math.max(state.bestiary.revealed[action.enemyId] ?? 0, tier);
      return null;
    }
  }
}
