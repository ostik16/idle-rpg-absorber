/**
 * Which potion to drink in a fight, and how much healing is already on its way (design 2.6, decisions L9).
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
