/**
 * Commands from the UI (architecture "Data flow" 5). `dispatch` only queues them; the engine applies
 * them between steps, never in the middle of one (ADR 0002). The UI never mutates state itself.
 * These two are the start of the list; later issues add the rest (send to an area, recall, spend points...).
 */
import { constantSection, type GameData } from '../data/game-data';
import { characterNameError } from '../game/stats';
import { createCharacterState } from '../state/factory';
import type { GameState } from '../state/types';
import type { EngineEvent } from './events';

export type Command =
  /** Name rules and slots are in design 4.1. The engine picks the id. */
  | { type: 'createCharacter'; name: string }
  /** The player has seen the Welcome back screen. */
  | { type: 'dismissSummary' };

/** Why a character cannot be created, in the design system's voice, or null when it can. */
function createCharacterError(state: GameState, name: string, data: GameData): string | null {
  if (state.roster.length >= state.account.unlockedSlots) {
    const { slotTicketLevel } = constantSection(data, 'characters');
    return `No free slot. A character earns a slot ticket at Lv ${slotTicketLevel}.`;
  }
  const names = state.roster.map((character) => character.name);
  return characterNameError(name, names, constantSection(data, 'creation'));
}

/**
 * Applies one command to `state`. Returns the event to publish, or null. A command that cannot be
 * applied changes nothing and returns a `commandRejected` event; it never throws.
 */
export function applyCommand(state: GameState, command: Command, data: GameData): EngineEvent | null {
  switch (command.type) {
    case 'createCharacter': {
      const reason = createCharacterError(state, command.name, data);
      if (reason !== null) return { type: 'commandRejected', command, reason };
      const id = `c${state.account.nextCharacterNumber}`;
      state.account.nextCharacterNumber += 1;
      state.roster.push(createCharacterState(id, command.name.trim(), data));
      return { type: 'characterCreated', characterId: id };
    }
    case 'dismissSummary':
      state.pendingSummary = null;
      return null;
  }
}
