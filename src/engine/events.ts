/**
 * What the engine reports (ADR 0002, architecture "Data flow"). The UI reads them with `drainEvents()`.
 * Events a character step emits are also the ordered list that carries shared effects at the end of the step
 * (ADR 0002 "Multiple characters").
 */
import type { Attributes } from '../game/stats';
import type { Phase } from '../state/types';
import type { Command } from './commands';

export type EngineEvent =
  /** The clock went backwards: `lastSimulatedAt` was `from`, now is `to`. The UI shows a one-line notice. */
  | { type: 'clockRewind'; from: number; to: number }
  /** An offline summary was added to `state.pendingSummary`. */
  | { type: 'summaryReady' }
  | { type: 'characterCreated'; characterId: string }
  /** A character won a fight. XP, drops and absorption hang off this. */
  | { type: 'enemyKilled'; characterId: string; enemyId: string }
  | { type: 'xpGained'; characterId: string; amount: number }
  /** One per level, so a kill worth two levels emits two. */
  | { type: 'levelUp'; characterId: string; level: number }
  | { type: 'characterDied'; characterId: string; enemyId: string }
  | { type: 'xpLost'; characterId: string; amount: number }
  | { type: 'characterPointsSpent'; characterId: string; attribute: keyof Attributes; amount: number }
  /** A command could not be applied. Nothing changed. */
  | { type: 'commandRejected'; command: Command; reason: string }
  /** Emitted through `enterPhase`, by a character step or a command. */
  | { type: 'phaseChanged'; characterId: string; from: Phase; to: Phase };

/**
 * End of a step: publishes the events the characters emitted, in the order they were emitted
 * (characters run in id order, so the order never depends on roster order), then empties `stepEvents`.
 * Changes to shared state (warehouse deposits, bestiary reveals) are applied here, one case per
 * event type, by the issues that add them. None exist yet, so this only publishes.
 */
export function publishStepEvents(stepEvents: EngineEvent[], outbox: EngineEvent[]): void {
  for (const event of stepEvents) outbox.push(event);
  stepEvents.length = 0;
}
