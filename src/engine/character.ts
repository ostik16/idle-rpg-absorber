/**
 * One character's state machine (ADR 0002 "Multiple characters"). A character is independent: it shares
 * nothing with the others except through the events it emits, which the engine applies at the end of the step.
 */
import { derivedStats } from '../state/selectors';
import type { CharacterState, Phase } from '../state/types';
import { isBagFull, stepCityHealing } from './city';
import { stepDead } from './death';
import { stepFighting, stepFleeing } from './fight';
import { stepRegenerationTrait } from './growth';
import { autoUsePotion, stepHealing } from './healing';
import type { StepContext } from './step-context';
import { autoReturnToCity, stepLooting, stepReturning, stepSearching, stepTravelling } from './travel';

export { enterPhase, type StepContext } from './step-context';

/** Stable order for characters: plain string comparison, not locale-aware, so every machine agrees. */
export function compareCharacterIds(a: { readonly id: string }, b: { readonly id: string }): number {
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

type PhaseStep = (character: CharacterState, ctx: StepContext) => void;

const stayInPhase: PhaseStep = () => {};

/**
 * What each phase does in one step. They change phase through `enterPhase`.
 */
const PHASE_STEPS: Readonly<Record<Phase, PhaseStep>> = {
  travelling: stepTravelling,
  searching: stepSearching,
  fighting: stepFighting,
  fleeing: stepFleeing,
  looting: stepLooting,
  returning: stepReturning,
  restocking: stepCityHealing,
  dead: stepDead,
  idle: stayInPhase,
};

/** Field phases where the auto-return trigger watches health and bag space (design 3.2, 2.3 L2). */
const FIELD_PHASES: ReadonlySet<Phase> = new Set(['travelling', 'searching', 'fighting', 'looting']);

/**
 * Checks the auto-return triggers (design 3.2 L1, 2.3 L2): health below the character's threshold, or a full bag.
 * In a fight the health trigger goes through fleeing (L5). The bag-full trigger stays off until the bag has space
 * again, so a character sent back out with a still-full bag does not bounce (2.3 L2).
 */
function checkReturnTriggers(character: CharacterState, ctx: StepContext): void {
  if (character.stayInCity || character.areaId === null || !FIELD_PHASES.has(character.phase)) return;
  const { maxHealth } = derivedStats(character, ctx.data);
  if (character.health < character.settings.returnHealthThreshold * maxHealth) {
    autoReturnToCity(character, ctx);
    return;
  }
  const full = isBagFull(character, ctx.data);
  if (!full) {
    if (character.blockBagFullReturn) character.blockBagFullReturn = false;
    return;
  }
  if (character.blockBagFullReturn) return;
  autoReturnToCity(character, ctx);
}

/**
 * Advances one character by exactly one step: the phase first, so a killing blow lands before any healing on
 * the same tick, then regeneration and potions, then the choice to drink in a fight.
 */
export function stepCharacter(character: CharacterState, ctx: StepContext): void {
  character.timeInPhaseMs += ctx.tickMs;
  PHASE_STEPS[character.phase](character, ctx);
  if (character.phase === 'dead') return;
  stepHealing(character, ctx);
  stepRegenerationTrait(character, ctx);
  if (character.phase === 'fighting' || character.phase === 'fleeing') autoUsePotion(character, ctx);
  checkReturnTriggers(character, ctx);
}
