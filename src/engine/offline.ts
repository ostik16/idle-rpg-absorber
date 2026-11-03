/**
 * The offline estimator seam (ADR 0002 "Offline estimator"). The engine calls an `EstimateOffline`
 * for absences longer than `offline.stepSimMaxSeconds`. The real estimator is a later issue.
 */
import type { GameData } from '../data/game-data';
import type { CharacterSummary, GameState, OfflineSummary } from '../state/types';
import { compareCharacterIds } from './character';

/** What an estimator returns. The engine adds the seconds covered and the seconds discarded. */
export type OfflineEstimate = Pick<OfflineSummary, 'characters'>;

/**
 * Estimates `seconds` of farming for every character and applies the result to `state` (XP, items, ...).
 * `seconds` is already capped at `offline.capHours`. Yields are multiplied by `offline.efficiency` here, not
 * by the engine. The engine writes each character's stream states to `character.rng` before the call and
 * reads them back after it, so an estimator draws by restoring those states and saves them again when done.
 * Returns one summary per character.
 */
export type EstimateOffline = (state: GameState, seconds: number, data: GameData) => OfflineEstimate;

export function emptyCharacterSummary(characterId: string): CharacterSummary {
  return { characterId, kills: 0, xp: 0, gold: 0, items: {} };
}

/**
 * STUB, not the estimator. Changes nothing and reports zero yields for every character, so the
 * Welcome back flow can be wired before the estimator exists. The later issue replaces it
 * and keeps the `EstimateOffline` signature.
 */
export const stubEstimateOffline: EstimateOffline = (state) => ({
  characters: [...state.roster].sort(compareCharacterIds).map((character) => emptyCharacterSummary(character.id)),
});

function addItems(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const total = { ...a };
  for (const [itemId, quantity] of Object.entries(b)) total[itemId] = (total[itemId] ?? 0) + quantity;
  return total;
}

/**
 * Adds a new offline summary to one the player has not seen yet (ADR 0003 "pendingSummary"), so a second
 * absence on top of an unseen Welcome back screen loses nothing. Per character, in id order.
 */
export function mergeSummaries(pending: OfflineSummary | null, next: OfflineSummary): OfflineSummary {
  if (pending === null) return next;
  const byId = new Map<string, CharacterSummary>();
  for (const summary of [...pending.characters, ...next.characters]) {
    const earlier = byId.get(summary.characterId);
    byId.set(
      summary.characterId,
      earlier
        ? {
            characterId: summary.characterId,
            kills: earlier.kills + summary.kills,
            xp: earlier.xp + summary.xp,
            gold: earlier.gold + summary.gold,
            items: addItems(earlier.items, summary.items),
          }
        : { ...summary, items: { ...summary.items } },
    );
  }
  return {
    seconds: pending.seconds + next.seconds,
    discardedSeconds: pending.discardedSeconds + next.discardedSeconds,
    characters: [...byId.values()].sort((a, b) => compareCharacterIds({ id: a.characterId }, { id: b.characterId })),
  };
}
