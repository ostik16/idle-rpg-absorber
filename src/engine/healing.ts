/**
 * Health regeneration and potions (design 2.6, decisions T10, N11, L9). Regeneration and running potions
 * work in every phase except `dead`; a character only starts a potion on its own in a fight.
 */
import { constantSection, type GameData } from '../data/game-data';
import { chooseAutoPotion, pendingHeal, type HeldPotion } from '../game/potions';
import { healthRegenPerSecond, potionHealPerTick, potionTickCount, type PotionTier } from '../game/stats';
import { derivedStats } from '../state/selectors';
import type { CharacterState } from '../state/types';
import type { StepContext } from './step-context';

const MS_PER_SECOND = 1000;

/** The item's fields a potion needs. A consumable with a different effect has no tier. */
interface PotionItem {
  id: string;
  effect?: { type?: string; tier?: string };
  autoUseDefaultThreshold?: number;
}

function findPotionItem(itemId: string, data: GameData): PotionItem | undefined {
  return data.items.find((row) => row.id === itemId) as PotionItem | undefined;
}

/** Amount and duration of a potion item (constants.potions.tiers), or null when the item is not a potion. */
function tierOfItem(item: PotionItem | undefined, data: GameData): PotionTier | null {
  if (item?.effect?.type !== 'heal-over-time') return null;
  return constantSection(data, 'potions').tiers.find((tier) => tier.id === item.effect?.tier) ?? null;
}

function potionTierOf(itemId: string, data: GameData): PotionTier | null {
  return tierOfItem(findPotionItem(itemId, data), data);
}

function queuedTiers(character: CharacterState, data: GameData): PotionTier[] {
  return character.potions.queue.flatMap((itemId) => potionTierOf(itemId, data) ?? []);
}

/** Adds to the queue. It starts when the potion before it ends (design 2.6). */
export function drinkPotion(character: CharacterState, itemId: string): void {
  character.potions.queue.push(itemId);
}

function runPotions(character: CharacterState, maxHealth: number, ctx: StepContext): void {
  const { tickMs: potionTickMs } = constantSection(ctx.data, 'potions');
  const { potions } = character;
  if (potions.queue.length === 0) return;
  potions.msIntoTick += ctx.tickMs;
  while (potions.msIntoTick >= potionTickMs && potions.queue.length > 0) {
    potions.msIntoTick -= potionTickMs;
    const tier = potionTierOf(potions.queue[0] as string, ctx.data);
    if (tier !== null) {
      character.health = Math.min(maxHealth, character.health + potionHealPerTick(tier, { tickMs: potionTickMs }));
      potions.ticksDone += 1;
    }
    if (tier === null || potions.ticksDone >= potionTickCount(tier.durationSeconds, potionTickMs)) {
      potions.queue.shift();
      potions.ticksDone = 0;
    }
  }
  if (potions.queue.length === 0) potions.msIntoTick = 0;
}

/** One step of regeneration and of the running potion. Health never goes above the maximum. */
export function stepHealing(character: CharacterState, ctx: StepContext): void {
  const { maxHealth } = derivedStats(character, ctx.data);
  const regen = healthRegenPerSecond(maxHealth, constantSection(ctx.data, 'stats')) * (ctx.tickMs / MS_PER_SECOND);
  character.health = Math.min(maxHealth, character.health + regen);
  runPotions(character, maxHealth, ctx);
}

/** The potions in the bag, once per item, with the threshold the player set or the item's default. */
function heldPotions(character: CharacterState, data: GameData): HeldPotion[] {
  const held = new Map<string, HeldPotion>();
  for (const { itemId, qty } of character.bag) {
    if (qty <= 0 || held.has(itemId)) continue;
    const item = findPotionItem(itemId, data);
    const tier = tierOfItem(item, data);
    if (tier === null) continue;
    const threshold = character.settings.potionThresholds[itemId] ?? item?.autoUseDefaultThreshold ?? 0;
    held.set(itemId, { itemId, amount: tier.amount, threshold });
  }
  return [...held.values()];
}

function takeFromBag(character: CharacterState, itemId: string): void {
  const index = character.bag.findIndex((stack) => stack.itemId === itemId && stack.qty > 0);
  const stack = character.bag[index];
  if (stack === undefined) return;
  stack.qty -= 1;
  if (stack.qty === 0) character.bag.splice(index, 1);
}

/** Drinks at most one potion, if the rules in `chooseAutoPotion` call for one. */
export function autoUsePotion(character: CharacterState, ctx: StepContext): void {
  const pending = pendingHeal(
    queuedTiers(character, ctx.data),
    character.potions.ticksDone,
    constantSection(ctx.data, 'potions').tickMs,
  );
  const { maxHealth } = derivedStats(character, ctx.data);
  const itemId = chooseAutoPotion(character.health, maxHealth, pending, heldPotions(character, ctx.data));
  if (itemId === null) return;
  takeFromBag(character, itemId);
  drinkPotion(character, itemId);
}
