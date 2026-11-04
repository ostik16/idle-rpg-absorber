/**
 * Bestiary reveals (design 4.8). Kills are counted per character; what they reveal is shared, so a reveal is
 * stored as the highest tier reached and never goes down.
 */

/** A row of data/bestiary-thresholds.json: the kills that unlock a tier. Rows run from the lowest to the highest. */
export interface BestiaryThreshold {
  kills: number;
}

/** Tiers a kill count has reached: 0 before the first threshold, the number of thresholds at the top. */
export function bestiaryTier(kills: number, thresholds: readonly BestiaryThreshold[]): number {
  return thresholds.filter((threshold) => kills >= threshold.kills).length;
}
