/** Progression curve (design 4.3, 5.3): time to clear each character level at an assumed pace. Pure. */
import { xpToNextLevel } from '../../src/game/progression';
import { BalanceError, type XpRow } from './load-data';

export interface LevelStep {
  /** Level being cleared; the character reaches `level + 1` at the end of the step. */
  level: number;
  xpToNext: number;
  /** XP of one kill at this character level. */
  xpPerKill: number;
  /** Kills needed, rounded up. */
  kills: number;
  seconds: number;
  cumulativeSeconds: number;
}

export interface CurveInput {
  fromLevel: number;
  /** Highest level to reach. Steps cover fromLevel up to toLevel - 1. */
  toLevel: number;
  /** Average XP per kill when the character is at `characterLevel`. */
  xpPerKill: (characterLevel: number) => number;
  secondsPerKill: number;
  table: readonly XpRow[];
}

/** Kills = ceil(xpToNext / xpPerKill), time = kills x secondsPerKill. XP is not reduced by level gap (3.5). */
export function levelCurve(input: CurveInput): LevelStep[] {
  const { fromLevel, toLevel, secondsPerKill, table } = input;
  if (!(secondsPerKill > 0)) throw new BalanceError(`Seconds per kill must be above 0, got ${secondsPerKill}.`);
  if (fromLevel >= toLevel) throw new BalanceError(`--from (${fromLevel}) must be below --to (${toLevel}).`);
  const steps: LevelStep[] = [];
  let cumulativeSeconds = 0;
  for (let level = fromLevel; level < toLevel; level++) {
    const xpToNext = xpToNextLevel(level, table);
    const xpPerKill = input.xpPerKill(level);
    if (!(xpPerKill > 0)) throw new BalanceError(`No XP per kill at level ${level}.`);
    const kills = Math.ceil(xpToNext / xpPerKill - 1e-9);
    const seconds = kills * secondsPerKill;
    cumulativeSeconds += seconds;
    steps.push({ level, xpToNext, xpPerKill, kills, seconds, cumulativeSeconds });
  }
  return steps;
}
