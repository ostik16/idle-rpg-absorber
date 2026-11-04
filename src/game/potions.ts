/**
 * Which potion to drink, in a fight or in the city, and how much healing is already on its way (design 2.6,
 * decisions L9, L10).
 * Pure functions.
 */
import { potionHealPerTick, type PotionTier } from './stats';

type PotionAmount = Pick<PotionTier, 'amount' | 'durationSeconds'>;

/**
 * Health the running and queued potions will still restore. `queue` is in drinking order with the running potion
 * first, and `ticksDone` counts the heal ticks that potion has delivered.
 */
export function pendingHeal(queue: readonly PotionAmount[], ticksDone: number, potionTickMs: number): number {
  return queue.reduce((total, potion, i) => {
    const delivered = i === 0 ? potionHealPerTick(potion, { tickMs: potionTickMs }) * ticksDone : 0;
    return total + potion.amount - delivered;
  }, 0);
}

export interface HeldPotion {
  itemId: string;
  /** Total health the potion restores. */
  amount: number;
  /** Fraction of maximum health at or below which it is drunk even if it overheals. */
  threshold: number;
}

/**
 * The potion to drink now, or null. Health that `pending` will restore counts as healed, so potions do not pile up.
 *  1. Missing health is greater than what a potion heals: the largest such potion, so nothing is wasted.
 *  2. Otherwise, at or below a potion's threshold: the smallest such potion, even though it overheals.
 * On a tie the potion listed first wins.
 */
export function chooseAutoPotion(
  health: number,
  maxHealth: number,
  pending: number,
  held: readonly HeldPotion[],
): string | null {
  const expected = health + pending;
  let best: HeldPotion | null = null;
  for (const potion of held) {
    if (maxHealth - expected > potion.amount && (best === null || potion.amount > best.amount)) best = potion;
  }
  if (best !== null) return best.itemId;
  for (const potion of held) {
    if (expected <= potion.threshold * maxHealth && (best === null || potion.amount < best.amount)) best = potion;
  }
  return best?.itemId ?? null;
}

/**
 * Share of maximum health that potions heal to in the city (decisions L10): all of it when fast, `balancedFraction`
 * when balanced, none when slow. Regeneration does the rest.
 */
export function cityPotionTarget(mode: 'fast' | 'balanced' | 'slow', balancedFraction: number): number {
  if (mode === 'fast') return 1;
  return mode === 'balanced' ? balancedFraction : 0;
}

/**
 * The potion to drink in the city, or null at or above `targetFraction` of maximum health. Assumed, like L9: the
 * largest potion that fits what is missing up to the target, or the smallest when none fits.
 */
export function chooseCityPotion(
  health: number,
  maxHealth: number,
  targetFraction: number,
  held: readonly HeldPotion[],
): string | null {
  const target = targetFraction * maxHealth;
  if (health >= target) return null;
  return chooseAutoPotion(health, target, 0, held.map((potion) => ({ ...potion, threshold: 1 })));
}
