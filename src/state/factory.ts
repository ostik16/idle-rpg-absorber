/**
 * Starting values for state. Pure: the caller supplies the time, the seed and the data.
 * Every starting number comes from data/constants.json (design 4.1, 5.1).
 */
import { constantSection, type GameData } from '../data/game-data';
import type { ProficiencyId } from '../game/proficiency';
import { startingAttributes } from '../game/stats';
import { derivedStats } from './selectors';
import type { CharacterState, CityHealingMode, GameState, ItemStack } from './types';

function newStack(itemId: string, qty: number): ItemStack {
  return { itemId, bonuses: [], upgradeLevel: 0, qty };
}

/** A new character (design 4.1): idle, at full health and mana, streams left for the engine to derive. */
export function createCharacterState(id: string, name: string, data: GameData): CharacterState {
  const creation = constantSection(data, 'creation');
  const startingEquipment: Readonly<Record<string, string>> = creation.startingEquipment;
  const skills = Object.keys(constantSection(data, 'proficiency').gainPerAction) as ProficiencyId[];

  const character: CharacterState = {
    id,
    name,
    gold: creation.startingGold,
    level: creation.startingLevel,
    xpInLevel: 0,
    points: { characterUnspent: 0, characterSpent: 0, skillUnspent: 0, skillSpent: 0 },
    attributes: startingAttributes(undefined, creation),
    proficiency: Object.fromEntries(skills.map((skill) => [skill, 0])) as Record<ProficiencyId, number>,
    spells: { ranks: {}, autoCastOrder: [] },
    equipment: Object.fromEntries(
      Object.entries(startingEquipment).map(([slot, itemId]) => [slot, newStack(itemId, 1)]),
    ),
    bag: creation.startingItems.map((item) => newStack(item.itemId, item.quantity)),
    health: 0,
    mana: 0,
    potions: { queue: [], ticksDone: 0, msIntoTick: 0 },
    fight: null,
    areaId: null,
    targetEnemyId: null,
    stayInCity: false,
    phase: 'idle',
    timeInPhaseMs: 0,
    settings: {
      returnHealthThreshold: constantSection(data, 'returnTriggers').healthThreshold,
      restockList: constantSection(data, 'restock').defaultList.map((entry) => ({ ...entry })),
      cityHealing: constantSection(data, 'cityHealing').defaultMode as CityHealingMode,
      potionThresholds: {},
      lootFilter: { enabled: false, rules: [] },
      autoSell: { enabled: false, rules: [] },
    },
    absorption: {},
  };
  const stats = derivedStats(character, data);
  character.health = stats.maxHealth;
  character.mana = stats.maxMana;
  return character;
}

/** State for a new game that starts at `nowMs`, with an empty roster. */
export function createGameState(masterSeed: number, nowMs: number, data: GameData): GameState {
  const storage = constantSection(data, 'storage');
  return {
    clock: { lastSimulatedAt: nowMs, savedAt: nowMs, masterSeed, diagnostics: { clockRewind: 0 } },
    account: {
      nextCharacterNumber: 1,
      unlockedSlots: constantSection(data, 'characters').startingUnlockedSlots,
      warehouse: {
        tabs: Array.from({ length: storage.startingTabs }, () => ({ cells: storage.cellsPerTab, items: [] })),
      },
      settings: {},
    },
    roster: [],
    bestiary: { kills: {}, revealed: {} },
    shops: { rareGoods: null, buyback: [] },
    pendingSummary: null,
  };
}
