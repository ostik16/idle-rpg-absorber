/**
 * What absorbed traits do (design 4.7, decisions L12). Pure: values in, values out.
 * The trait ids are the rows of data/traits.json; their numbers are percent.
 */

export const LIFE_STEAL = 'life-steal';
export const REGENERATION = 'regeneration';

/** Health a hit heals with `percent` life steal: that share of the damage it dealt. */
export function lifeStealHeal(damageDealt: number, percent: number): number {
  return (Math.max(0, damageDealt) * Math.max(0, percent)) / 100;
}

/** Health one regeneration pulse restores with `percent` regeneration: that share of maximum health. */
export function regenerationHeal(maxHealth: number, percent: number): number {
  return (maxHealth * Math.max(0, percent)) / 100;
}
