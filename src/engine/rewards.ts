/**
 * XP from kills (design 4.3, 4.4). XP belongs to one character, so it is applied in that character's step and not
 * through the shared event list (ADR 0002 "Multiple characters").
 */
import { constantSection, requireNumberConstant, requireRow, type GameData } from '../data/game-data';
import { gainXp, killXp, type XpTable } from '../game/progression';
import type { CharacterState } from '../state/types';
import type { StepContext } from './step-context';

export function xpTableOf(data: GameData): XpTable {
  return data.xpTable as unknown as XpTable;
}

/** Gives the XP of one kill, with the character points and levels it earns. Nothing at the level cap. */
export function grantKillXp(character: CharacterState, enemyId: string, ctx: StepContext): void {
  const levelCap = requireNumberConstant(ctx.data, 'levelCap');
  if (character.level >= levelCap) return;
  const enemy = requireRow(ctx.data, 'enemies', enemyId) as unknown as Parameters<typeof killXp>[0];
  const amount = killXp(enemy, constantSection(ctx.data, 'progression'));
  const previousLevel = character.level;
  const gain = gainXp(character, amount, levelCap, xpTableOf(ctx.data), constantSection(ctx.data, 'points'));

  character.level = gain.level;
  character.xpInLevel = gain.xpInLevel;
  character.highestMarkReached = gain.highestMarkReached;
  character.points.characterUnspent += gain.characterPoints;
  character.points.skillUnspent += gain.skillPoints;

  ctx.emit({ type: 'xpGained', characterId: character.id, amount });
  for (let level = previousLevel + 1; level <= gain.level; level++) {
    ctx.emit({ type: 'levelUp', characterId: character.id, level });
  }
}
