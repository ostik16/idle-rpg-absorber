/**
 * One character's state machine (ADR 0002 "Multiple characters"). A character is independent: it shares
 * nothing with the others except through the events it emits, which the engine applies at the end of the step.
 */
import type { CharacterState, Phase } from '../state/types';
import { stepFighting, stepFleeing } from './fight';
import { autoUsePotion, stepHealing } from './healing';
import type { StepContext } from './step-context';
import { stepLooting, stepReturning, stepSearching, stepTravelling } from './travel';

export { enterPhase, type StepContext } from './step-context';

/** Stable order for characters: plain string comparison, not locale-aware, so every machine agrees. */
export function compareCharacterIds(a: { readonly id: string }, b: { readonly id: string }): number {
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

type PhaseStep = (character: CharacterState, ctx: StepContext) => void;

const stayInPhase: PhaseStep = () => {};

/**
 * What each phase does in one step. The other transitions (returning to restocking, and leaving `dead`) come
 * with the issues that build those phases. They will call `enterPhase`.
 */
const PHASE_STEPS: Readonly<Record<Phase, PhaseStep>> = {
  travelling: stepTravelling,
  searching: stepSearching,
  fighting: stepFighting,
  fleeing: stepFleeing,
  looting: stepLooting,
  returning: stepReturning,
  restocking: stayInPhase,
  dead: stayInPhase,
  idle: stayInPhase,
};

/**
 * Advances one character by exactly one step: the phase first, so a killing blow lands before any healing on
 * the same tick, then regeneration and potions, then the choice to drink in a fight.
 */
export function stepCharacter(character: CharacterState, ctx: StepContext): void {
  character.timeInPhaseMs += ctx.tickMs;
  PHASE_STEPS[character.phase](character, ctx);
  if (character.phase === 'dead') return;
  stepHealing(character, ctx);
  if (character.phase === 'fighting' || character.phase === 'fleeing') autoUsePotion(character, ctx);
}
