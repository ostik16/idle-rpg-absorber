import { describe, expect, it } from 'vitest';
import constants from '../data/constants.json';
import xpTable from '../data/xp-table.json';
import {
  characterPointsEarned,
  gainXp,
  killsToClearLevel,
  killXp,
  levelForTotalXp,
  newlyAwardedPoints,
  pointMarks,
  pointsAwardedAt,
  respawnHealth,
  respawnSeconds,
  unlockedSlots,
  lockedSlots,
  slotTicketsEarned,
  xpAfterDeath,
  xpFloor,
  xpLossFractionFromRoll,
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

// A level that needs 100 XP has marks at 25, 50 and 75.
describe('point marks and the death floor (design 3.7, 4.4)', () => {
  it('puts marks at 25%, 50% and 75% of the level', () => {
    expect(pointMarks(100)).toEqual([25, 50, 75]);
    expect(pointMarks(311)[0]).toBeCloseTo(77.75, 10);
    expect(pointMarks(311)[2]).toBeCloseTo(233.25, 10);
  });

  it('counts the marks passed', () => {
    expect(pointsAwardedAt(0, 100)).toBe(0);
    expect(pointsAwardedAt(24.9, 100)).toBe(0);
    expect(pointsAwardedAt(25, 100)).toBe(1);
    expect(pointsAwardedAt(74, 100)).toBe(2);
    expect(pointsAwardedAt(75, 100)).toBe(3);
    expect(pointsAwardedAt(99, 100)).toBe(3);
  });

  it('floors XP at the highest mark passed, 0 below the first', () => {
    expect(xpFloor(0, 100)).toBe(0);
    expect(xpFloor(24, 100)).toBe(0);
    expect(xpFloor(25, 100)).toBe(25);
    expect(xpFloor(74, 100)).toBe(50);
    expect(xpFloor(76, 100)).toBe(75);
  });

  it('loses up to 25% of the level requirement but never passes the floor (maximum roll)', () => {
    expect(xpAfterDeath(74, 100, 0.25)).toBe(50); // min(25, 74 - 50) = 24 lost
    expect(xpAfterDeath(76, 100, 0.25)).toBe(75); // min(25, 76 - 75) = 1 lost
    expect(xpAfterDeath(20, 100, 0.25)).toBe(0); // min(25, 20) = 20 lost
    expect(xpAfterDeath(99, 100, 0.25)).toBe(75); // min(25, 24)
  });

  it('loses the rolled share when the floor is not reached', () => {
    expect(xpAfterDeath(74, 100, 0.1)).toBe(64); // 10 lost
    expect(xpAfterDeath(60, 100, 0)).toBe(60);
    expect(xpAfterDeath(0, 100, 0.25)).toBe(0);
    expect(xpAfterDeath(25, 100, 0.25)).toBe(25); // exactly on a mark
  });

  it('never ends below the floor or above the starting XP', () => {
    for (let xp = 0; xp < 100; xp++) {
      for (const f of [0, 0.05, 0.1, 0.25]) {
        const after = xpAfterDeath(xp, 100, f);
        expect(after >= xpFloor(xp, 100)).toBe(true);
        expect(after <= xp).toBe(true);
      }
    }
  });

  it('rejects a loss fraction outside 0..1', () => {
    expect(() => xpAfterDeath(50, 100, -0.1)).toThrow(RangeError);
    expect(() => xpAfterDeath(50, 100, 1.5)).toThrow(RangeError);
  });

  it('turns a roll into a fraction between 0 and 25%', () => {
    expect(xpLossFractionFromRoll(0)).toBe(0);
    expect(xpLossFractionFromRoll(0.5)).toBeCloseTo(0.125, 10);
    expect(xpLossFractionFromRoll(1)).toBeCloseTo(0.25, 10);
  });
});

describe('awarding points once (design 4.4)', () => {
  it('awards a point per new mark', () => {
    expect(newlyAwardedPoints(10, 100, 0)).toEqual({ points: 0, highestMarkReached: 0 });
    expect(newlyAwardedPoints(30, 100, 0)).toEqual({ points: 1, highestMarkReached: 1 });
    expect(newlyAwardedPoints(80, 100, 0)).toEqual({ points: 3, highestMarkReached: 3 });
    expect(newlyAwardedPoints(60, 100, 1)).toEqual({ points: 1, highestMarkReached: 2 });
  });

  it('does not award a mark again when XP falls and rises', () => {
    // 74 XP: 2 marks reached. Death takes it to 55.5 (above the floor of 50), then it climbs back to 76.
    expect(newlyAwardedPoints(74, 100, 0).highestMarkReached).toBe(2);
    expect(newlyAwardedPoints(55.5, 100, 2)).toEqual({ points: 0, highestMarkReached: 2 });
    expect(newlyAwardedPoints(70, 100, 2)).toEqual({ points: 0, highestMarkReached: 2 });
    expect(newlyAwardedPoints(76, 100, 2)).toEqual({ points: 1, highestMarkReached: 3 });
    expect(newlyAwardedPoints(76, 100, 3)).toEqual({ points: 0, highestMarkReached: 3 });
  });

  it('keeps the highest mark even if XP is below it', () => {
    expect(newlyAwardedPoints(40, 100, 3)).toEqual({ points: 0, highestMarkReached: 3 });
  });
});

describe('respawn time (design 3.7)', () => {
  it('is 2 minutes per character level', () => {
    expect(respawnSeconds(1)).toBe(4);
    expect(respawnSeconds(14)).toBe(56);
    expect(respawnSeconds(30)).toBe(120);
  });

  it('rejects an invalid level', () => {
    expect(() => respawnSeconds(0)).toThrow(RangeError);
    expect(() => respawnSeconds(2.5)).toThrow(RangeError);
  });
});

describe('slot tickets (design 4.1)', () => {
  it('gives 1 ticket on first reaching level 20', () => {
    expect(slotTicketsEarned(19, 20)).toBe(1);
    expect(slotTicketsEarned(1, 30)).toBe(1); // jumping past 20 still counts once
  });

  it('gives nothing before 20 or after it was reached', () => {
    expect(slotTicketsEarned(5, 19)).toBe(0);
    expect(slotTicketsEarned(20, 21)).toBe(0);
    expect(slotTicketsEarned(20, 20)).toBe(0);
    expect(slotTicketsEarned(25, 30)).toBe(0);
  });

  it('gives 1 ticket in total over a whole career', () => {
    let total = 0;
    for (let level = 2; level <= 30; level++) total += slotTicketsEarned(level - 1, level);
    expect(total).toBe(1);
  });
});

describe('respawn health (design 3.7)', () => {
  it('is 10% of max health, rounded up, at least 1', () => {
    expect(constants.death.respawnHealthFraction).toBe(0.1);
    expect(constants.death.mustHealToFullBeforeFarming).toBe(true);
    expect(respawnHealth(70)).toBe(7); // exact: no float round-up to 8
    expect(respawnHealth(110)).toBe(11);
    expect(respawnHealth(75)).toBe(8); // 7.5 rounds up
    expect(respawnHealth(5)).toBe(1); // 0.5 -> 1
    expect(respawnHealth(0.2)).toBe(1); // at least 1
  });

  it('rejects a max health of 0 or less', () => {
    expect(() => respawnHealth(0)).toThrow(RangeError);
  });
});

describe('roster slots (design 4.1)', () => {
  it('starts with 1 of 4 slots unlocked', () => {
    expect(constants.characters.maxSlots).toBe(4);
    expect(constants.characters.startingUnlockedSlots).toBe(1);
    expect(unlockedSlots(0)).toBe(1);
    expect(lockedSlots(0)).toBe(3);
  });

  it('each ticket unlocks one slot, up to the maximum', () => {
    expect(unlockedSlots(1)).toBe(2);
    expect(lockedSlots(2)).toBe(1);
    expect(unlockedSlots(3)).toBe(4);
    expect(lockedSlots(3)).toBe(0);
    expect(unlockedSlots(10)).toBe(4);
    expect(lockedSlots(10)).toBe(0);
  });

  it('rejects a negative or fractional ticket count', () => {
    expect(() => unlockedSlots(-1)).toThrow(RangeError);
    expect(() => unlockedSlots(0.5)).toThrow(RangeError);
  });
});

describe('killXp (design 3.5)', () => {
  it("uses the enemy's own reward, or the formula when it has none", () => {
    expect(killXp({ level: 1, xpReward: 9 })).toBe(9);
    expect(killXp({ level: 5 })).toBe(15);
  });
});

describe('gainXp (design 4.3, 4.4)', () => {
  const start = { level: 1, xpInLevel: 0, highestMarkReached: 0 };

  it('pays one character point per mark, on reaching it', () => {
    expect(gainXp(start, 24)).toMatchObject({ xpInLevel: 24, characterPoints: 0, highestMarkReached: 0 });
    expect(gainXp(start, 25)).toMatchObject({ xpInLevel: 25, characterPoints: 1, highestMarkReached: 1 });
    expect(gainXp(start, 75)).toMatchObject({ xpInLevel: 75, characterPoints: 3, highestMarkReached: 3, level: 1 });
  });

  it('a level 1 character has 3 points before level 2, and the level pays 1 skill point', () => {
    expect(gainXp(start, 99)).toMatchObject({ level: 1, characterPoints: 3, skillPoints: 0 });
    expect(gainXp(start, 100)).toEqual({
      level: 2,
      xpInLevel: 0,
      highestMarkReached: 0,
      characterPoints: 3,
      skillPoints: 1,
      levelsGained: 1,
    });
  });

  it('carries XP into the next level and pays that level its marks', () => {
    // Level 2 needs 311, so 100 + 78 is past its first mark at 77.75.
    expect(gainXp(start, 178)).toMatchObject({ level: 2, xpInLevel: 78, characterPoints: 4, highestMarkReached: 1 });
  });

  it('crosses several levels in one go', () => {
    const gain = gainXp(start, totalXpForLevel(4));
    expect(gain).toMatchObject({ level: 4, xpInLevel: 0, characterPoints: 9, skillPoints: 3, levelsGained: 3 });
  });

  it('does not pay a mark twice when XP has fallen and rises again', () => {
    const after = gainXp({ level: 1, xpInLevel: 50, highestMarkReached: 3 }, 26);
    expect(after).toMatchObject({ xpInLevel: 76, characterPoints: 0, highestMarkReached: 3 });
  });

  it('stops at the level cap with no XP: 87 character points and 29 skill points in all', () => {
    let progress = start;
    let characterPoints = 0;
    let skillPoints = 0;
    while (progress.level < constants.levelCap) {
      const gain = gainXp(progress, 1000);
      characterPoints += gain.characterPoints;
      skillPoints += gain.skillPoints;
      progress = gain;
    }
    expect(progress).toMatchObject({ level: 30, xpInLevel: 0 });
    expect(characterPoints).toBe(87);
    expect(characterPoints).toBe(characterPointsEarned(30, 0));
    expect(skillPoints).toBe(skillPointsEarned(30));
    expect(gainXp(progress, 1_000_000)).toMatchObject({ level: 30, xpInLevel: 0, characterPoints: 0, skillPoints: 0 });
  });
});
