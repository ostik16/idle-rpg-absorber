/**
 * What a character gets better at while it acts: proficiency (design 4.6), absorbed traits (4.7) and what those
 * traits do (decisions L12). All of it belongs to one character, so it is applied in that character's step.
 */
import { constantSection, requireRow, type GameData } from '../data/game-data';
import { absorbOnKill } from '../game/formulas';
import { addProficiency, proficiencyGain, type ProficiencyId } from '../game/proficiency';
import { LIFE_STEAL, REGENERATION, lifeStealHeal, regenerationHeal } from '../game/traits';
import { derivedStats } from '../state/selectors';
import type { CharacterState } from '../state/types';
import type { StepContext } from './step-context';

const MS_PER_SECOND = 1000;

interface EnemyRow {
  level: number;
  type: string;
  traits?: { id: string; value: number }[];
}

interface SlotRow {
  id: string;
  trainsProficiency?: Record<string, string>;
}

/** The skill a hit trains (decisions L11): the weapon in the main hand decides, no weapon means unarmed. */
export function trainedWeaponSkill(character: CharacterState, data: GameData): ProficiencyId {
  const slot = data.equipmentSlots.find((row) => (row as unknown as SlotRow).id === 'main-hand') as SlotRow | undefined;
  const weapon = character.equipment['main-hand'];
  const type = weapon === undefined ? undefined : (requireRow(data, 'items', weapon.itemId) as { equipmentType?: string }).equipmentType;
  const trains = slot?.trainsProficiency ?? {};
  return (trains[type ?? 'empty'] ?? trains['empty'] ?? 'unarmed') as ProficiencyId;
}

function train(character: CharacterState, skill: ProficiencyId, level: number, units: number, ctx: StepContext): void {
  const c = constantSection(ctx.data, 'proficiency');
  const points = character.proficiency[skill];
  character.proficiency[skill] = addProficiency(points, proficiencyGain(skill, points, level, c) * units, c);
}

/** One hit of the player on an enemy of `enemyLevel`: trains the weapon style and combat. */
export function trainOnHit(character: CharacterState, enemyLevel: number, ctx: StepContext): void {
  train(character, trainedWeaponSkill(character, ctx.data), enemyLevel, 1, ctx);
  train(character, 'combat', enemyLevel, 1, ctx);
}

/** One hit taken from an enemy of `enemyLevel`: trains toughness. */
export function trainOnHitTaken(character: CharacterState, enemyLevel: number, ctx: StepContext): void {
  train(character, 'toughness', enemyLevel, 1, ctx);
}

/**
 * One step of walking in the character's area: trains speed by the seconds the step covers. The level of an area
 * is the top of its level range (recorded in docs/pre-development-checklist.md).
 */
export function trainOnMove(character: CharacterState, ctx: StepContext): void {
  if (character.areaId === null) return;
  const area = requireRow(ctx.data, 'areas', character.areaId) as unknown as { levelRange: { max: number } };
  train(character, 'speed', area.levelRange.max, ctx.tickMs / MS_PER_SECOND, ctx);
}

/**
 * Absorption on a kill (4.7): normal enemies only, magical traits only, per trait and per character. The level is
 * the character's level when the fight ended, before the kill's XP.
 */
export function absorbOnEnemyKill(character: CharacterState, enemyId: string, ctx: StepContext): void {
  const enemy = requireRow(ctx.data, 'enemies', enemyId) as unknown as EnemyRow;
  if (enemy.type !== 'normal') return;
  const magical = new Set(
    ctx.data.traits.filter((row) => (row as unknown as { magical: boolean }).magical).map((row) => (row as unknown as { id: string }).id),
  );
  const c = constantSection(ctx.data, 'absorption');
  for (const trait of enemy.traits ?? []) {
    if (!magical.has(trait.id)) continue;
    character.absorption[trait.id] = absorbOnKill(character.absorption[trait.id] ?? 0, trait.value, character.level, enemy.level, c);
  }
}

/** Life steal: the character heals a share of what one hit dealt. */
export function applyLifeSteal(character: CharacterState, damageDealt: number, ctx: StepContext): void {
  const percent = character.absorption[LIFE_STEAL] ?? 0;
  if (percent <= 0 || damageDealt <= 0) return;
  const { maxHealth } = derivedStats(character, ctx.data);
  character.health = Math.min(maxHealth, character.health + lifeStealHeal(damageDealt, percent));
}

/** Regeneration: every `traits.regenerationIntervalSeconds` it restores a share of maximum health. */
export function stepRegenerationTrait(character: CharacterState, ctx: StepContext): void {
  const percent = character.absorption[REGENERATION] ?? 0;
  if (percent <= 0) return;
  const intervalMs = constantSection(ctx.data, 'traits').regenerationIntervalSeconds * MS_PER_SECOND;
  const elapsed = (character.traitRegenMs ?? 0) + ctx.tickMs;
  if (elapsed < intervalMs) {
    character.traitRegenMs = elapsed;
    return;
  }
  character.traitRegenMs = elapsed - intervalMs;
  const { maxHealth } = derivedStats(character, ctx.data);
  character.health = Math.min(maxHealth, character.health + regenerationHeal(maxHealth, percent));
}
