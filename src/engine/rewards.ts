/**
 * What a kill gives (design 4.3, 4.4, 3.8, 2.3): XP, gold and drops. They belong to one character, so they are applied
 * in that character's step and not through the shared event list (ADR 0002 "Multiple characters").
 */
import { constantSection, requireNumberConstant, requireRow, type GameData } from '../data/game-data';
import { rollDrops, type BonusPoolEntry, type DropTableLike } from '../game/drops';
import { enemyMoneyRange, type MoneyRange } from '../game/enemies';
import { addToBag, bagCells, bagMaxStack, matchesLootFilter, type BagItemLike } from '../game/inventory';
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
  const previousLevel = character.level;
  const xp = killXp(enemy, constantSection(ctx.data, 'progression'));
  const gain = gainXp(character, xp, levelCap, xpTableOf(ctx.data), constantSection(ctx.data, 'points'));

  character.level = gain.level;
  character.xpInLevel = gain.xpInLevel;
  character.highestMarkReached = gain.highestMarkReached;
  character.points.characterUnspent += gain.characterPoints;
  character.points.skillUnspent += gain.skillPoints;

  ctx.emit({ type: 'xpGained', characterId: character.id, amount: gain.xpGained });
  for (let level = previousLevel + 1; level <= gain.level; level++) {
    ctx.emit({ type: 'levelUp', characterId: character.id, level });
  }
}

interface ItemRow extends BagItemLike {
  id: string;
  bonusAttributePool?: readonly BonusPoolEntry[];
  bagCells?: number;
  maxStack?: number;
}

function itemRow(data: GameData, itemId: string): ItemRow {
  return requireRow(data, 'items', itemId) as unknown as ItemRow;
}

/** Bag capacity and stack size from the equipped backpack, or the base values without one (design 2.3). */
function bagLimits(character: CharacterState, data: GameData): { capacity: number; maxStack: number } {
  const stack = character.equipment['backpack'];
  const pack = stack === undefined ? null : (itemRow(data, stack.itemId) as Required<Pick<ItemRow, 'bagCells' | 'maxStack'>>);
  if (stack !== undefined && pack !== null && !(pack.bagCells > 0 && pack.maxStack > 0)) {
    throw new Error(`Item "${stack.itemId}" in the backpack slot has no bagCells or maxStack.`);
  }
  const inventory = constantSection(data, 'inventory');
  return { capacity: bagCells(pack, inventory), maxStack: bagMaxStack(pack, inventory) };
}

/**
 * Gold and drops of one kill. Gold is a separate roll from the enemy's `moneyRange` (or the baseline for its level),
 * never reduced by the level gap (3.8), and arrives with a full bag (decisions L2). The drops are rolled from the
 * enemy's table with the character's level, then each is picked up if the loot filter takes it and the bag has room;
 * what does not fit is left behind and reported as `bagFull`. Everything is rolled before the filter and the bag are
 * looked at, so the drops stream takes the same draws whatever the bag holds.
 */
export function grantKillLoot(
  character: CharacterState,
  enemyId: string,
  ctx: StepContext,
  levelAtKill: number = character.level,
): void {
  const enemy = requireRow(ctx.data, 'enemies', enemyId) as unknown as {
    level: number;
    moneyRange?: MoneyRange;
    dropTableId?: string;
  };
  const rng = ctx.streams.drops;

  const range = enemy.moneyRange ?? enemyMoneyRange(enemy.level, constantSection(ctx.data, 'enemyScaling'));
  const gold = rng.nextInt(range.min, range.max);
  character.gold += gold;
  if (gold > 0) ctx.emit({ type: 'goldGained', characterId: character.id, amount: gold });

  if (enemy.dropTableId === undefined) return;
  const table = requireRow(ctx.data, 'dropTables', enemy.dropTableId) as unknown as DropTableLike;
  const drops = rollDrops(table, levelAtKill, enemy.level, rng, {
    bonusPoolOf: (itemId) => itemRow(ctx.data, itemId).bonusAttributePool ?? [],
    maxBonusAttributes: requireNumberConstant(ctx.data, 'items.maxBonusAttributes'),
  });

  const limits = bagLimits(character, ctx.data);
  const itemOf = (itemId: string): ItemRow => itemRow(ctx.data, itemId);
  for (const drop of drops) {
    const item = itemOf(drop.itemId);
    if (!matchesLootFilter(character.settings.lootFilter, item, drop.bonuses)) continue;
    const stack = { itemId: drop.itemId, bonuses: drop.bonuses, upgradeLevel: 0, qty: drop.qty };
    const result = addToBag(character.bag, stack, item, limits, itemOf);
    character.bag = result.bag;
    if (result.added > 0) {
      ctx.emit({ type: 'itemPickedUp', characterId: character.id, itemId: drop.itemId, qty: result.added, bonuses: drop.bonuses });
    }
    if (result.refused > 0) {
      ctx.emit({ type: 'bagFull', characterId: character.id, itemId: drop.itemId, qty: result.refused });
    }
  }
}
