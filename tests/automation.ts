/** Automation is off in the data (decisions A1). Tests of the routine it gates run on these instead. */
import realConstants from '../data/constants.json';
import { createGameData, loadGameData, type GameData } from '../src/data/game-data';

export const constantsWithAutomation = { ...realConstants, automation: { enabled: true } };

export function withAutomation(data: GameData = loadGameData()): GameData {
  return createGameData({ ...data, constants: { ...data.constants, automation: { enabled: true } } });
}
