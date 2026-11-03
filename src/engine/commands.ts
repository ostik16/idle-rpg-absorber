/**
 * Commands from the UI (architecture "Data flow" 5). `dispatch` only queues them; the engine applies
 * them between steps, never in the middle of one (ADR 0002). The UI never mutates state itself.
 * This is the start of the list; later issues add the rest (send to an area, recall...).
 */
import { constantSection, type GameData } from '../data/game-data';
import { characterNameError, type Attributes } from '../game/stats';
import { createCharacterState } from '../state/factory';
import type { GameState } from '../state/types';
import type { EngineEvent } from './events';

export type Command =
  /** Name rules and slots are in design 4.1. The engine picks the id. */
  | { type: 'createCharacter'; name: string }
  /** Raises an attribute (design 4.4). Spending is final; respec needs a rare item. */
  | { type: 'spendCharacterPoints'; characterId: string; attribute: keyof Attributes; amount: number }
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
    case 'spendCharacterPoints': {
      const reason = spendCharacterPoints(state, command);
      if (reason !== null) return { type: 'commandRejected', command, reason };
      const { characterId, attribute, amount } = command;
      return { type: 'characterPointsSpent', characterId, attribute, amount };
    }
    case 'dismissSummary':
      state.pendingSummary = null;
      return null;
  }
}
