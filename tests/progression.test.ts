import { describe, expect, it } from 'vitest';
import xpTable from '../data/xp-table.json';
import {
  characterPointsEarned,
  killsToClearLevel,
  levelForTotalXp,
  skillPointsEarned,
  totalXpForLevel,
  xpReward,
  xpToNextLevel,
} from '../src/game/progression';

// The table is 100 x L^1.5 x 1.1^(L-1), rounded to 3 significant figures (design 4.3).
describe('XP table (design 4.3)', () => {
  it('has a row for each level 1 to 30', () => {
    expect(xpTable).toHaveLength(30);
    xpTable.forEach((row, i) => expect(row.level).toBe(i + 1));
  });

  it('matches hand-computed values', () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(2)).toBe(311); // 100 x 2.828 x 1.1
    expect(xpToNextLevel(10)).toBe(7460); // 100 x 31.62 x 2.358
    expect(xpToNextLevel(20)).toBe(54700); // 100 x 89.44 x 6.116
    expect(xpToNextLevel(30)).toBe(261000); // 100 x 164.3 x 15.86
  });

  it('rises every level', () => {
    for (let level = 2; level <= 30; level++) {
      expect(xpToNextLevel(level)).toBeGreaterThan(xpToNextLevel(level - 1));
    }
  });

  it('rejects a level with no row', () => {
    expect(() => xpToNextLevel(31)).toThrow(RangeError);
    expect(() => xpToNextLevel(0)).toThrow(RangeError);
  });

  it('adds up the total XP for a level', () => {
    expect(totalXpForLevel(1)).toBe(0);
    expect(totalXpForLevel(2)).toBe(100);
    expect(totalXpForLevel(3)).toBe(411);
  });

  it('finds the level for a lifetime XP total', () => {
    expect(levelForTotalXp(0)).toBe(1);
    expect(levelForTotalXp(99)).toBe(1);
    expect(levelForTotalXp(100)).toBe(2);
    expect(levelForTotalXp(410)).toBe(2);
    expect(levelForTotalXp(411)).toBe(3);
  });

  it('stops at the level cap', () => {
    expect(levelForTotalXp(1e12)).toBe(30);
  });
});

describe('XP reward (design 3.5)', () => {
  it('is 10 at level 1 and grows 10% per level', () => {
    expect(xpReward(1)).toBe(10);
    expect(xpReward(5)).toBe(15); // 14.64
    expect(xpReward(10)).toBe(24); // 23.58
    expect(xpReward(30)).toBe(159); // 158.6
  });

  it('rejects an invalid level', () => {
    expect(() => xpReward(0)).toThrow(RangeError);
  });
});

describe('no level-gap penalty (design 4.3)', () => {
  it('needs 10 level 1 kills for the first level', () => {
    expect(killsToClearLevel(1, 1)).toBe(10);
  });

  it('takes twice the kills at level 10 from a level 3 enemy as from a level 10 enemy', () => {
    expect(killsToClearLevel(10, 3)).toBe(622); // 7460 / 12
    expect(killsToClearLevel(10, 10)).toBe(311); // 7460 / 24
  });

  it('makes a level 3 enemy about 5 times too small for a level 20 character', () => {
    expect(killsToClearLevel(20, 3) / killsToClearLevel(20, 20)).toBeGreaterThan(5);
  });

  it('slows the best level 1-5 enemy sharply by level 8', () => {
    // 1640 / 15 = 110 kills at level 5, 4410 / 15 = 294 kills at level 8
    expect(killsToClearLevel(5, 5)).toBe(110);
    expect(killsToClearLevel(8, 5)).toBe(294);
  });
});

describe('character and skill points (design 4.4, 4.5)', () => {
  it('awards 1 point at each of 25%, 50% and 75% of a level', () => {
    expect(characterPointsEarned(1, 0)).toBe(0);
    expect(characterPointsEarned(1, 24)).toBe(0);
    expect(characterPointsEarned(1, 25)).toBe(1);
    expect(characterPointsEarned(1, 50)).toBe(2);
    expect(characterPointsEarned(1, 75)).toBe(3);
    expect(characterPointsEarned(1, 99)).toBe(3);
  });

  it('keeps the 3 points of each finished level', () => {
    expect(characterPointsEarned(2, 0)).toBe(3);
    expect(characterPointsEarned(2, 78)).toBe(4); // 25% of 311 is 77.75
    expect(characterPointsEarned(10, 0)).toBe(27);
  });

  it('gives 87 points by level 30', () => {
    expect(characterPointsEarned(30, 0)).toBe(87);
    expect(characterPointsEarned(30, 100000)).toBe(87);
  });

  it('gives 1 skill point per level gained', () => {
    expect(skillPointsEarned(1)).toBe(0);
    expect(skillPointsEarned(2)).toBe(1);
    expect(skillPointsEarned(30)).toBe(29);
  });
});
