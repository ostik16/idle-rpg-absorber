/**
 * Commands from the UI (architecture "Data flow" 5). `dispatch` only queues them; the engine applies
 * them between steps, never in the middle of one (ADR 0002). The UI never mutates state itself.
 * These two are the start of the list; later issues add the rest (send to an area, recall, spend points...).
 */
import { createCharacterState } from '../state/factory';
import type { GameState } from '../state/types';
import type { EngineEvent } from './events';

export type Command =
  /** Name rules (design 4.1) arrive with character creation; for now any name is accepted. */
  | { type: 'addCharacter'; id: string; name: string }
  /** The player has seen the Welcome back screen. */
  | { type: 'dismissSummary' };

/**
 * Applies one command to `state`. Returns the event to publish, or null. A command that cannot be
 * applied changes nothing and returns a `commandRejected` event; it never throws.
 */
export function applyCommand(state: GameState, command: Command): EngineEvent | null {
  switch (command.type) {
    case 'addCharacter': {
      if (command.id === '') return { type: 'commandRejected', command, reason: 'character id is empty' };
      if (state.roster.some((character) => character.id === command.id)) {
        return { type: 'commandRejected', command, reason: `a character with id "${command.id}" already exists` };
      }
      state.roster.push(createCharacterState(command.id, command.name));
      return { type: 'characterAdded', characterId: command.id };
    }
    case 'dismissSummary':
      state.pendingSummary = null;
      return null;
  }
}
