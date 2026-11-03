/**
 * The `restocking` phase, the character's time in the city (design 3.2, decisions T11, L10). For now it only heals:
 * selling and restocking go ahead of the healing with #27.
 */
import { constantSection } from '../data/game-data';
import { derivedStats } from '../state/selectors';
import type { CharacterState } from '../state/types';
import { drinkInCity } from './healing';
import { enterPhase, type StepContext } from './step-context';

/** Where a healed character goes. Stops at `idle` until the travel phases of #22 can take it back to its area. */
function goBackToFarming(character: CharacterState, ctx: StepContext): void {
  enterPhase(character, 'idle', ctx);
}

/** Stays until health is full, drinking as the character's healing choice says. Regeneration runs by itself. */
export function stepCityHealing(character: CharacterState, ctx: StepContext): void {
  const { maxHealth } = derivedStats(character, ctx.data);
  const mustHeal = constantSection(ctx.data, 'death').mustHealToFullBeforeFarming;
  if (!mustHeal || character.health >= maxHealth) {
    goBackToFarming(character, ctx);
    return;
  }
  drinkInCity(character, ctx);
}
