/**
 * Commands from the UI (architecture "Data flow" 5). `dispatch` only queues them; the engine applies
 * them between steps, never in the middle of one (ADR 0002). The UI never mutates state itself.
 * Later issues add the rest of the list (spend points...).
 */
import { constantSection, type GameData } from '../data/game-data';
import { spawnsInArea } from '../game/farming';
import { characterNameError } from '../game/stats';
import { createCharacterState } from '../state/factory';
import type { CharacterState, GameState } from '../state/types';
import type { EngineEvent } from './events';
import type { StepContext } from './step-context';
import { returnToCity, sendToArea, type AreaRow } from './travel';

export type Command =
  /** Name rules and slots are in design 4.1. The engine picks the id. */
  | { type: 'createCharacter'; name: string }
  /** The player has seen the Welcome back screen. */
  | { type: 'dismissSummary' }
  /** Sets out from the city to farm an area (3.2). */
  | { type: 'sendToArea'; characterId: string; areaId: string }
  /** Farm only this enemy, or whatever turns up with null (3.3). */
  | { type: 'setTarget'; characterId: string; enemyId: string | null }
  /** Heads home and stays there. In a fight it flees first (L5). */
  | { type: 'returnToCity'; characterId: string };

/** Why a character cannot be created, in the design system's voice, or null when it can. */
function createCharacterError(state: GameState, name: string, data: GameData): string | null {
  if (state.roster.length >= state.account.unlockedSlots) {
    const { slotTicketLevel } = constantSection(data, 'characters');
    return `No free slot. A character earns a slot ticket at Lv ${slotTicketLevel}.`;
  }
  const names = state.roster.map((character) => character.name);
  return characterNameError(name, names, constantSection(data, 'creation'));
}

function findArea(areaId: string, data: GameData): AreaRow | undefined {
  return data.areas.find((row) => row.id === areaId) as AreaRow | undefined;
}

function sendToAreaError(character: CharacterState, areaId: string, data: GameData): string | null {
  if (findArea(areaId, data) === undefined) return `No area "${areaId}".`;
  return character.phase === 'idle' ? null : `${character.name} has to be in the city first.`;
}

function setTargetError(character: CharacterState, enemyId: string | null, data: GameData): string | null {
  if (character.areaId === null) return `${character.name} has no area to search.`;
  if (enemyId === null) return null;
  const area = findArea(character.areaId, data);
  return area !== undefined && spawnsInArea(area, enemyId) ? null : `No "${enemyId}" in this area.`;
}

function returnToCityError(character: CharacterState): string | null {
  switch (character.phase) {
    case 'travelling':
    case 'searching':
    case 'fighting':
    case 'looting':
      return null;
    case 'fleeing':
    case 'returning':
      return `${character.name} is already on the way back.`;
    case 'dead':
      return `${character.name} is dead.`;
    case 'restocking':
    case 'idle':
      return `${character.name} is already in the city.`;
  }
}

/**
 * Applies one command to `state`. Returns the event to publish, or null. A command that cannot be
 * applied changes nothing and returns a `commandRejected` event; it never throws.
 * `contextOf` gives the step context of a character in the roster, for commands that change its phase.
 */
export function applyCommand(
  state: GameState,
  command: Command,
  data: GameData,
  contextOf: (characterId: string) => StepContext | undefined,
): EngineEvent | null {
  const rejected = (reason: string): EngineEvent => ({ type: 'commandRejected', command, reason });

  switch (command.type) {
    case 'createCharacter': {
      const reason = createCharacterError(state, command.name, data);
      if (reason !== null) return rejected(reason);
      const id = `c${state.account.nextCharacterNumber}`;
      state.account.nextCharacterNumber += 1;
      state.roster.push(createCharacterState(id, command.name.trim(), data));
      return { type: 'characterCreated', characterId: id };
    }
    case 'dismissSummary':
      state.pendingSummary = null;
      return null;
    case 'sendToArea':
    case 'setTarget':
    case 'returnToCity': {
      const character = state.roster.find((c) => c.id === command.characterId);
      const ctx = contextOf(command.characterId);
      if (character === undefined || ctx === undefined) return rejected(`No character "${command.characterId}".`);
      if (command.type === 'sendToArea') {
        const reason = sendToAreaError(character, command.areaId, data);
        if (reason !== null) return rejected(reason);
        sendToArea(character, command.areaId, ctx);
      } else if (command.type === 'setTarget') {
        const reason = setTargetError(character, command.enemyId, data);
        if (reason !== null) return rejected(reason);
        character.targetEnemyId = command.enemyId;
      } else {
        const reason = returnToCityError(character);
        if (reason !== null) return rejected(reason);
        returnToCity(character, ctx);
      }
      return null;
    }
  }
}
