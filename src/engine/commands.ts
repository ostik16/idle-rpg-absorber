/**
 * Commands from the UI (architecture "Data flow" 5). `dispatch` only queues them; the engine applies
 * them between steps, never in the middle of one (ADR 0002). The UI never mutates state itself.
 * Later issues add the rest of the list.
 */
import { constantSection, requireRow, type GameData } from '../data/game-data';
import {
  bagLimitsFor,
  twoHandedBlocks,
  type EquipmentItemRow,
  type SlotRow,
} from '../game/equipment';
import { spawnsInArea } from '../game/farming';
import { addToBag, warehouseStackLimit, type BagStackLike } from '../game/inventory';
import { firstSlotTicketLevel, type LevelUpRewardRow } from '../game/progression';
import { characterNameError, type Attributes } from '../game/stats';
import { createCharacterState } from '../state/factory';
import { derivedStats } from '../state/selectors';
import type { CharacterState, GameState, ItemRuleSet, ItemStack } from '../state/types';
import type { EngineEvent } from './events';
import type { StepContext } from './step-context';
import { returnToCity, sendToArea, type AreaRow } from './travel';

export type Command =
  /** Name rules and slots are in design 4.1. The engine picks the id. */
  | { type: 'createCharacter'; name: string }
  /** Removes a character and everything it carried (design 4.1). Shared state (warehouse, bestiary reveals) is kept. */
  | { type: 'deleteCharacter'; characterId: string }
  /** Raises an attribute (design 4.4). Spending is final; respec needs a rare item. */
  | { type: 'spendCharacterPoints'; characterId: string; attribute: keyof Attributes; amount: number }
  /** The player has seen the Welcome back screen. */
  | { type: 'dismissSummary' }
  /** Sets out from the city to farm an area (3.2). */
  | { type: 'sendToArea'; characterId: string; areaId: string }
  /** Farm only this enemy, or whatever turns up with null (3.3). */
  | { type: 'setTarget'; characterId: string; enemyId: string | null }
  /** Heads home and stays there. In a fight it flees first (L5). */
  | { type: 'returnToCity'; characterId: string }
  /** Buys `qty` of an item from a shop at that shop's price. The whole amount must fit the bag (design 2.5, L16). */
  | { type: 'buyItem'; characterId: string; shopId: string; itemId: string; qty: number }
  /** Sells `qty` from `bagIndex` at the item's sell price (design 2.5, 2.9). Gold goes to the acting character. */
  | { type: 'sellItem'; characterId: string; bagIndex: number; qty: number }
  /** Moves the stack at `bagIndex` from the bag into `slot` (design 2.2). Whatever was in the slot goes back to the bag. */
  | { type: 'equipItem'; characterId: string; bagIndex: number; slot: string }
  /** Moves the item in `slot` back to the bag. Refused when the bag has no room for it. */
  | { type: 'unequipItem'; characterId: string; slot: string }
  /** Moves `qty` from `bagIndex` into warehouse `tabIndex` (design 2.4, L13). City only. */
  | { type: 'warehouseDeposit'; characterId: string; bagIndex: number; tabIndex: number; qty: number }
  /** Moves `qty` from the warehouse stack to the bag, split to fit the bag's max stack (design 2.3, 2.4). */
  | { type: 'warehouseWithdraw'; characterId: string; tabIndex: number; stackIndex: number; qty: number }
  /** Replaces the auto-sell rule set (design 2.3 L6). */
  | { type: 'setAutoSell'; characterId: string; autoSell: ItemRuleSet };

/** Why a character cannot be created, in the design system's voice, or null when it can. */
function createCharacterError(state: GameState, name: string, data: GameData): string | null {
  if (state.roster.length >= state.account.unlockedSlots) {
    const level = firstSlotTicketLevel(data.levelUpRewards as unknown as readonly LevelUpRewardRow[]);
    return level === null
      ? 'No free slot.'
      : `No free slot. A character earns a slot ticket at Lv ${level}.`;
  }
  const names = state.roster.map((character) => character.name);
  return characterNameError(name, names, constantSection(data, 'creation'));
}

/** Spends the points, or returns why it cannot, in the design system's voice. */
function spendCharacterPoints(
  state: GameState,
  command: Extract<Command, { type: 'spendCharacterPoints' }>,
): string | null {
  const { attribute, amount } = command;
  const character = state.roster.find((c) => c.id === command.characterId);
  if (character === undefined) return 'That character no longer exists.';
  if (!Object.hasOwn(character.attributes, attribute)) return `No attribute called ${attribute}.`;
  if (!Number.isInteger(amount) || amount < 1) return 'Spend at least 1 whole point.';
  const { characterUnspent } = character.points;
  if (amount > characterUnspent) return `${characterUnspent} of ${amount} character points available.`;
  character.attributes[attribute] += amount;
  character.points.characterUnspent -= amount;
  character.points.characterSpent += amount;
  return null;
}

function findArea(areaId: string, data: GameData): AreaRow | undefined {
  return data.areas.find((row) => row.id === areaId) as AreaRow | undefined;
}

function sendToAreaError(character: CharacterState, areaId: string, data: GameData): string | null {
  if (findArea(areaId, data) === undefined) return `No area "${areaId}".`;
  switch (character.phase) {
    case 'idle':
      break;
    case 'dead':
      return `${character.name} is dead.`;
    case 'restocking':
      return `${character.name} is busy in the city.`;
    default:
      return `${character.name} has to be in the city first.`;
  }
  return character.health < derivedStats(character, data).maxHealth ? `${character.name} needs full health to set out.` : null;
}

function setTargetError(character: CharacterState, enemyId: string | null, data: GameData): string | null {
  if (character.areaId === null) return `${character.name} has no area to search.`;
  if (enemyId === null) return null;
  if (character.stayInCity || character.phase === 'fleeing' || character.phase === 'returning') {
    return `${character.name} is on the way back.`;
  }
  const area = findArea(character.areaId, data);
  return area !== undefined && spawnsInArea(area, enemyId) ? null : `No "${enemyId}" in this area.`;
}

function returnToCityError(character: CharacterState, data: GameData): string | null {
  switch (character.phase) {
    case 'travelling':
    case 'searching':
    case 'fighting':
    case 'looting':
      // Only a save from older data gets here without a known area (ADR 0003 "reconcile").
      if (character.areaId === null || findArea(character.areaId, data) === undefined) {
        return `${character.name} has no area to return from.`;
      }
      return null;
    case 'fleeing':
    case 'returning':
      return `${character.name} is already on the way back.`;
    case 'dead':
    case 'restocking':
      return character.areaId === null || character.stayInCity ? `${character.name} is already staying in the city.` : null;
    case 'idle':
      return `${character.name} is already in the city.`;
  }
}

/** True when the character is in the city, so it can shop, swap gear and use the warehouse. */
function inCity(character: CharacterState): boolean {
  return character.phase === 'idle' || character.phase === 'restocking';
}

interface ItemDataRow extends EquipmentItemRow {
  stackable: boolean;
  sellPrice: number;
}

function itemRow(data: GameData, itemId: string): ItemDataRow {
  return requireRow(data, 'items', itemId) as unknown as ItemDataRow;
}

function knownItem(data: GameData, itemId: string): ItemDataRow | null {
  return data.items.some((row) => row.id === itemId) ? itemRow(data, itemId) : null;
}

/** Shallow copy of a bag that keeps the original untouched until a change is committed. */
function copyBag(bag: readonly BagStackLike[]): ItemStack[] {
  return bag.map((stack) => ({ ...stack, bonuses: stack.bonuses.map((b) => ({ ...b })) }));
}

function removeFromBag(bag: ItemStack[], index: number, qty: number): void {
  const stack = bag[index];
  if (stack === undefined) return;
  stack.qty -= qty;
  if (stack.qty <= 0) bag.splice(index, 1);
}

interface ShopRow {
  id: string;
  itemList: readonly { itemId: string; price: number }[];
}

function shopRow(data: GameData, shopId: string): ShopRow | null {
  const row = data.shops.find((r) => r.id === shopId);
  return row === undefined ? null : (row as unknown as ShopRow);
}

/** Applies a buy, or returns why it cannot. Atomic: refuses if the whole quantity does not fit. */
function applyBuyItem(
  character: CharacterState,
  command: Extract<Command, { type: 'buyItem' }>,
  data: GameData,
): string | null {
  if (!inCity(character)) return `${character.name} has to be in the city to shop.`;
  if (!Number.isInteger(command.qty) || command.qty < 1) return 'Buy at least 1.';
  const shop = shopRow(data, command.shopId);
  if (shop === null) return `No shop "${command.shopId}".`;
  const listed = shop.itemList.find((entry) => entry.itemId === command.itemId);
  if (listed === undefined) return `${shop.id} does not sell "${command.itemId}".`;
  const item = knownItem(data, command.itemId);
  if (item === null) return `No item "${command.itemId}".`;
  const cost = listed.price * command.qty;
  if (character.gold < cost) return `${character.name} has ${character.gold} gold, needs ${cost}.`;

  const itemOf = (id: string): ItemDataRow => itemRow(data, id);
  const limits = bagLimitsFor(character.equipment, itemOf, constantSection(data, 'inventory'));
  const newStack: ItemStack = { itemId: command.itemId, bonuses: [], upgradeLevel: 0, qty: command.qty };
  const result = addToBag(character.bag, newStack, item, limits, itemOf);
  if (result.refused > 0) return `${character.name}'s bag has no room for ${command.qty} ${command.itemId}.`;

  character.gold -= cost;
  character.bag = result.bag as ItemStack[];
  return null;
}

/** Sells `qty` at the item's `sellPrice`. Gold goes to the acting character (L16). */
function applySellItem(
  character: CharacterState,
  command: Extract<Command, { type: 'sellItem' }>,
  data: GameData,
): string | null {
  if (!inCity(character)) return `${character.name} has to be in the city to sell.`;
  if (!Number.isInteger(command.qty) || command.qty < 1) return 'Sell at least 1.';
  const stack = character.bag[command.bagIndex];
  if (stack === undefined) return `No stack in bag slot ${command.bagIndex}.`;
  if (command.qty > stack.qty) return `Only ${stack.qty} of ${command.qty} in that stack.`;
  const item = knownItem(data, stack.itemId);
  if (item === null) return `No item "${stack.itemId}".`;

  const newBag = copyBag(character.bag);
  removeFromBag(newBag, command.bagIndex, command.qty);
  character.bag = newBag;
  character.gold += item.sellPrice * command.qty;
  return null;
}

/** Equips the stack at `bagIndex` in `slot`; whatever was there goes back to the bag. */
function applyEquipItem(
  character: CharacterState,
  command: Extract<Command, { type: 'equipItem' }>,
  data: GameData,
): string | null {
  if (!inCity(character)) return `${character.name} has to be in the city to change gear.`;
  const stack = character.bag[command.bagIndex];
  if (stack === undefined) return `No stack in bag slot ${command.bagIndex}.`;
  const slots = data.equipmentSlots as unknown as readonly SlotRow[];
  const slot = slots.find((s) => s.id === command.slot);
  if (slot === undefined) return `No slot "${command.slot}".`;
  const item = knownItem(data, stack.itemId);
  if (item === null) return `No item "${stack.itemId}".`;
  if (item.category !== 'equipment') return `${item.id} is not equipment.`;
  if (item.equipmentType === undefined || !slot.allowedTypes.includes(item.equipmentType)) {
    return `${item.id} does not fit the ${slot.id} slot.`;
  }
  if ((item.requiredLevel ?? 1) > character.level) {
    return `${character.name} needs level ${item.requiredLevel ?? 1} for ${item.id}.`;
  }
  const itemOf = (id: string): ItemDataRow => itemRow(data, id);
  if (twoHandedBlocks(character.equipment, slot, item, slots, itemOf)) {
    return item.equipmentType === 'two-handed-weapon'
      ? `${character.name} must unequip the off hand first.`
      : `${character.name} must unequip the two-handed weapon first.`;
  }

  // Remove the one item from the bag, make room on the same bag for the item coming out of the slot.
  // The bag limits for that must reflect the slot's new occupant, so a backpack swap uses the new pack's size.
  const workingBag = copyBag(character.bag);
  removeFromBag(workingBag, command.bagIndex, 1);
  const previous = character.equipment[slot.id];
  const newEquipment: Record<string, ItemStack> = {
    ...character.equipment,
    [slot.id]: { itemId: stack.itemId, bonuses: stack.bonuses.map((b) => ({ ...b })), upgradeLevel: stack.upgradeLevel, qty: 1 },
  };
  if (previous !== undefined) {
    const prevItem = knownItem(data, previous.itemId);
    if (prevItem === null) return `No item "${previous.itemId}".`;
    const limits = bagLimitsFor(newEquipment, itemOf, constantSection(data, 'inventory'));
    const result = addToBag(workingBag, previous, prevItem, limits, itemOf);
    if (result.refused > 0) return `No bag room to unequip ${previous.itemId}.`;
    character.bag = result.bag as ItemStack[];
  } else {
    character.bag = workingBag;
  }

  character.equipment = newEquipment;
  return null;
}

/** Moves the item in `slot` back to the bag. Refused when the bag has no room for it. */
function applyUnequipItem(
  character: CharacterState,
  command: Extract<Command, { type: 'unequipItem' }>,
  data: GameData,
): string | null {
  if (!inCity(character)) return `${character.name} has to be in the city to change gear.`;
  const stack = character.equipment[command.slot];
  if (stack === undefined) return `Slot ${command.slot} is empty.`;
  const item = knownItem(data, stack.itemId);
  if (item === null) return `No item "${stack.itemId}".`;
  const itemOf = (id: string): ItemDataRow => itemRow(data, id);
  const afterRemove = { ...character.equipment };
  delete afterRemove[command.slot];
  const limits = bagLimitsFor(afterRemove, itemOf, constantSection(data, 'inventory'));
  const workingBag = copyBag(character.bag);
  const result = addToBag(workingBag, stack, item, limits, itemOf);
  if (result.refused > 0) return `No bag room to unequip ${stack.itemId}.`;
  character.bag = result.bag as ItemStack[];
  character.equipment = afterRemove;
  return null;
}

/** Warehouse put: moves `qty` of bag[bagIndex] into tab `tabIndex`, atomic. */
function applyWarehouseDeposit(
  state: GameState,
  character: CharacterState,
  command: Extract<Command, { type: 'warehouseDeposit' }>,
  data: GameData,
): string | null {
  if (!inCity(character)) return `${character.name} has to be in the city to use the warehouse.`;
  if (!Number.isInteger(command.qty) || command.qty < 1) return 'Deposit at least 1.';
  const stack = character.bag[command.bagIndex];
  if (stack === undefined) return `No stack in bag slot ${command.bagIndex}.`;
  if (command.qty > stack.qty) return `Only ${stack.qty} of ${command.qty} in that stack.`;
  const tab = state.account.warehouse.tabs[command.tabIndex];
  if (tab === undefined) return `No warehouse tab ${command.tabIndex}.`;
  const item = knownItem(data, stack.itemId);
  if (item === null) return `No item "${stack.itemId}".`;
  const itemOf = (id: string): ItemDataRow => itemRow(data, id);

  const toDeposit: BagStackLike = { itemId: stack.itemId, bonuses: stack.bonuses, upgradeLevel: stack.upgradeLevel, qty: command.qty };
  const maxStack = warehouseStackLimit(item);
  const addResult = addToBag(tab.items, toDeposit, item, { capacity: tab.cells, maxStack }, itemOf);
  if (addResult.refused > 0) return `No warehouse room for ${command.qty} ${stack.itemId}.`;

  tab.items = addResult.bag as ItemStack[];
  const newBag = copyBag(character.bag);
  removeFromBag(newBag, command.bagIndex, command.qty);
  character.bag = newBag;
  return null;
}

/** Warehouse take: moves `qty` of tabs[tab].items[stackIndex] into the bag, split to the bag max stack. */
function applyWarehouseWithdraw(
  state: GameState,
  character: CharacterState,
  command: Extract<Command, { type: 'warehouseWithdraw' }>,
  data: GameData,
): string | null {
  if (!inCity(character)) return `${character.name} has to be in the city to use the warehouse.`;
  if (!Number.isInteger(command.qty) || command.qty < 1) return 'Withdraw at least 1.';
  const tab = state.account.warehouse.tabs[command.tabIndex];
  if (tab === undefined) return `No warehouse tab ${command.tabIndex}.`;
  const source = tab.items[command.stackIndex];
  if (source === undefined) return `No stack in warehouse slot ${command.stackIndex}.`;
  if (command.qty > source.qty) return `Only ${source.qty} of ${command.qty} in that stack.`;
  const item = knownItem(data, source.itemId);
  if (item === null) return `No item "${source.itemId}".`;
  const itemOf = (id: string): ItemDataRow => itemRow(data, id);
  const limits = bagLimitsFor(character.equipment, itemOf, constantSection(data, 'inventory'));

  const toTake: BagStackLike = {
    itemId: source.itemId,
    bonuses: source.bonuses,
    upgradeLevel: source.upgradeLevel,
    qty: command.qty,
  };
  const addResult = addToBag(character.bag, toTake, item, limits, itemOf);
  if (addResult.refused > 0) return `${character.name}'s bag has no room for ${command.qty} ${source.itemId}.`;

  character.bag = addResult.bag as ItemStack[];
  const newTab = tab.items.map((s) => ({ ...s, bonuses: s.bonuses.map((b) => ({ ...b })) }));
  removeFromBag(newTab, command.stackIndex, command.qty);
  tab.items = newTab;
  return null;
}

/**
 * Applies one command to `state`. Returns the event to publish, or null. A command that cannot be
 * applied changes nothing and returns a `commandRejected` event; it never throws.
 * `contextOf` gives the step context of a character in the roster, for commands that change its phase.
 */
export function applyCommand(
  state: GameState,
  command: Command,
  data: GameData,
  contextOf: (characterId: string) => StepContext | undefined,
): EngineEvent | null {
  const rejected = (reason: string): EngineEvent => ({ type: 'commandRejected', command, reason });
  const findCharacter = (): CharacterState | undefined =>
    state.roster.find((c) => c.id === (command as { characterId?: string }).characterId);

  switch (command.type) {
    case 'createCharacter': {
      const reason = createCharacterError(state, command.name, data);
      if (reason !== null) return rejected(reason);
      const id = `c${state.account.nextCharacterNumber}`;
      state.account.nextCharacterNumber += 1;
      state.roster.push(createCharacterState(id, command.name.trim(), data));
      return { type: 'characterCreated', characterId: id };
    }
    case 'deleteCharacter': {
      const index = state.roster.findIndex((c) => c.id === command.characterId);
      if (index < 0) return rejected(`No character "${command.characterId}".`);
      const [removed] = state.roster.splice(index, 1);
      delete state.bestiary.kills[command.characterId];
      return { type: 'characterDeleted', characterId: (removed as CharacterState).id };
    }
    case 'spendCharacterPoints': {
      const reason = spendCharacterPoints(state, command);
      if (reason !== null) return rejected(reason);
      const { characterId, attribute, amount } = command;
      return { type: 'characterPointsSpent', characterId, attribute, amount };
    }
    case 'dismissSummary':
      state.pendingSummary = null;
      return null;
    case 'sendToArea':
    case 'setTarget':
    case 'returnToCity': {
      const character = findCharacter();
      const ctx = contextOf(command.characterId);
      if (character === undefined || ctx === undefined) return rejected(`No character "${command.characterId}".`);
      if (command.type === 'sendToArea') {
        const reason = sendToAreaError(character, command.areaId, data);
        if (reason !== null) return rejected(reason);
        sendToArea(character, command.areaId, ctx);
      } else if (command.type === 'setTarget') {
        const reason = setTargetError(character, command.enemyId, data);
        if (reason !== null) return rejected(reason);
        character.targetEnemyId = command.enemyId;
      } else {
        const reason = returnToCityError(character, data);
        if (reason !== null) return rejected(reason);
        returnToCity(character, ctx);
      }
      return null;
    }
    case 'buyItem': {
      const character = findCharacter();
      if (character === undefined) return rejected(`No character "${command.characterId}".`);
      const reason = applyBuyItem(character, command, data);
      return reason === null ? null : rejected(reason);
    }
    case 'sellItem': {
      const character = findCharacter();
      if (character === undefined) return rejected(`No character "${command.characterId}".`);
      const reason = applySellItem(character, command, data);
      return reason === null ? null : rejected(reason);
    }
    case 'equipItem': {
      const character = findCharacter();
      if (character === undefined) return rejected(`No character "${command.characterId}".`);
      const reason = applyEquipItem(character, command, data);
      return reason === null ? null : rejected(reason);
    }
    case 'unequipItem': {
      const character = findCharacter();
      if (character === undefined) return rejected(`No character "${command.characterId}".`);
      const reason = applyUnequipItem(character, command, data);
      return reason === null ? null : rejected(reason);
    }
    case 'warehouseDeposit': {
      const character = findCharacter();
      if (character === undefined) return rejected(`No character "${command.characterId}".`);
      const reason = applyWarehouseDeposit(state, character, command, data);
      return reason === null ? null : rejected(reason);
    }
    case 'warehouseWithdraw': {
      const character = findCharacter();
      if (character === undefined) return rejected(`No character "${command.characterId}".`);
      const reason = applyWarehouseWithdraw(state, character, command, data);
      return reason === null ? null : rejected(reason);
    }
    case 'setAutoSell': {
      const character = findCharacter();
      if (character === undefined) return rejected(`No character "${command.characterId}".`);
      character.settings.autoSell = {
        enabled: command.autoSell.enabled,
        rules: command.autoSell.rules.map((rule) => ({ ...rule })),
      };
      return null;
    }
  }
}
