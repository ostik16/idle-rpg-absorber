/**
 * The city routine (design 3.2, 2.3, 2.6, decisions L4, L6, L10): what a character does on arriving in the city.
 * Order from 3.2: sell by the auto-sell rules, restock, heal. Selling pays for the restock.
 */
import { constantSection, requireRow, type GameData } from '../data/game-data';
import { bagLimitsFor, type EquipmentItemRow } from '../game/equipment';
import { addToBag, matchesItemRule, type BagItemLike, type BagStackLike } from '../game/inventory';
import { derivedStats } from '../state/selectors';
import type { CharacterState, ItemStack } from '../state/types';
import { drinkInCity } from './healing';
import { enterPhase, type StepContext } from './step-context';
import { settleInCity } from './travel';

interface SellableItem extends BagItemLike {
  sellPrice?: number;
}

interface PotionEffect {
  type?: string;
}

interface RestockableItem extends BagItemLike {
  effect?: PotionEffect;
}

function itemRow(data: GameData, itemId: string): SellableItem & RestockableItem {
  return requireRow(data, 'items', itemId) as unknown as SellableItem & RestockableItem;
}

/** Auto-sells every bag stack that matches the character's rules (design 2.3 L6). Gold goes to this character (L16). */
export function autoSellBag(character: CharacterState, data: GameData): void {
  const rules = character.settings.autoSell;
  if (!rules.enabled || rules.rules.length === 0) return;
  const kept: ItemStack[] = [];
  let gold = 0;
  for (const stack of character.bag) {
    const item = itemRow(data, stack.itemId);
    if (rules.rules.some((rule) => matchesItemRule(rule, item, stack.bonuses))) {
      gold += (item.sellPrice ?? 0) * stack.qty;
    } else kept.push(stack);
  }
  character.bag = kept;
  character.gold += gold;
}

interface ShopListing {
  itemId: string;
  price: number;
}

interface ShopRow {
  itemList: readonly ShopListing[];
}

/** Lowest shop price for an item, or null when no shop sells it. */
function shopPriceOf(itemId: string, data: GameData): number | null {
  let price: number | null = null;
  for (const shop of data.shops as unknown as readonly ShopRow[]) {
    for (const listing of shop.itemList) {
      if (listing.itemId === itemId && (price === null || listing.price < price)) price = listing.price;
    }
  }
  return price;
}

/** True for a health potion: heal-over-time effect.
 * shortcut: mana potions are not in the data yet; when they are, distinguish them by their effect stat. */
function isHealthPotion(item: RestockableItem): boolean {
  return item.effect?.type === 'heal-over-time';
}

/** Buys up to `want` of `itemId` at `price`, adding to the bag until the gold or bag runs out. */
function buyUpTo(character: CharacterState, itemId: string, want: number, price: number, data: GameData): void {
  if (want <= 0 || price < 0) return;
  const item = itemRow(data, itemId);
  const itemOf = (id: string): EquipmentItemRow => requireRow(data, 'items', id) as unknown as EquipmentItemRow;
  const limits = bagLimitsFor(character.equipment, itemOf, constantSection(data, 'inventory'));
  const canAfford = price === 0 ? want : Math.floor(character.gold / price);
  const qty = Math.min(want, canAfford);
  if (qty === 0) return;
  const stack: BagStackLike = { itemId, bonuses: [], upgradeLevel: 0, qty };
  const result = addToBag(character.bag, stack, item, limits, itemOf);
  const bought = result.added;
  if (bought === 0) return;
  character.bag = result.bag as ItemStack[];
  character.gold -= bought * price;
}

/**
 * Tops up the character's restock list to each entry's quantity (design 3.2, decisions L4). Buys at the shop price.
 * With too little gold it buys as many as it can, in list order, health potions first.
 */
export function restockPotions(character: CharacterState, data: GameData): void {
  const list = character.settings.restockList;
  if (list.length === 0) return;
  const ordered = [...list].sort((a, b) => {
    const aHealth = isHealthPotion(itemRow(data, a.itemId)) ? 0 : 1;
    const bHealth = isHealthPotion(itemRow(data, b.itemId)) ? 0 : 1;
    return aHealth - bHealth;
  });
  for (const entry of ordered) {
    const held = character.bag
      .filter((stack) => stack.itemId === entry.itemId)
      .reduce((sum, stack) => sum + stack.qty, 0);
    const want = entry.quantity - held;
    if (want <= 0) continue;
    const price = shopPriceOf(entry.itemId, data);
    if (price === null) continue;
    buyUpTo(character, entry.itemId, want, price, data);
  }
}

/** True when the bag has no free cells (design 2.3 L2). */
export function isBagFull(character: CharacterState, data: GameData): boolean {
  const itemOf = (id: string): EquipmentItemRow => requireRow(data, 'items', id) as unknown as EquipmentItemRow;
  const limits = bagLimitsFor(character.equipment, itemOf, constantSection(data, 'inventory'));
  const used = character.bag.reduce((sum, stack) => sum + itemOf(stack.itemId).size, 0);
  return used >= limits.capacity;
}

/** A healed character walks back to the same area with the same target, unless the player called it home. */
function goBackToFarming(character: CharacterState, ctx: StepContext): void {
  if (character.stayInCity || character.areaId === null) {
    settleInCity(character, ctx);
    return;
  }
  character.blockBagFullReturn = isBagFull(character, ctx.data);
  enterPhase(character, 'travelling', ctx);
}

/**
 * Arriving in the city (design 3.2): sell, restock, then either heal to full or leave at once. Called in the same
 * tick as the arrival, so a character that is already at full health leaves in that tick with no restocking phase.
 */
export function arriveInCity(character: CharacterState, ctx: StepContext): void {
  autoSellBag(character, ctx.data);
  restockPotions(character, ctx.data);
  const { maxHealth } = derivedStats(character, ctx.data);
  const mustHeal = constantSection(ctx.data, 'death').mustHealToFullBeforeFarming;
  if (!mustHeal || character.health >= maxHealth) {
    goBackToFarming(character, ctx);
    return;
  }
  enterPhase(character, 'restocking', ctx);
}

/** Stays until health is full, drinking as the character's healing choice says. Regeneration runs by itself. */
export function stepCityHealing(character: CharacterState, ctx: StepContext): void {
  const { maxHealth } = derivedStats(character, ctx.data);
  const mustHeal = constantSection(ctx.data, 'death').mustHealToFullBeforeFarming;
  if (!mustHeal || character.health >= maxHealth) {
    goBackToFarming(character, ctx);
    return;
  }
  drinkInCity(character, ctx);
}

