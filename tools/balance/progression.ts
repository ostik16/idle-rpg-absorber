/** Progression curve (design 5.3): time to reach each level. Run: npm run balance:progression -- --help */
import constants from '../../data/constants.json';
import { intFlag, parseFlags, usage, type FlagSpec } from './args';
import { runCli } from './cli';
import { levelCurve } from './curve';
import { areaAverageXp } from './drops';
import { duration, num, table } from './format';
import { BalanceError, defaultSecondsPerKill, findArea, loadBalanceData } from './load-data';
import { xpReward } from '../../src/game/progression';

const SPEC: FlagSpec = {
  area: { kind: 'string', help: 'area id: the character kills this area\'s spawn mix at every level' },
  'enemy-level': { kind: 'number', help: 'always kill enemies of this baseline level' },
  'seconds-per-kill': { kind: 'number', help: 'seconds from one kill to the next (default: constants.farming.secondsPerKill, else 12)' },
  from: { kind: 'number', help: 'first level (default 1)' },
  to: { kind: 'number', help: 'last level to reach (default: the level cap)' },
  help: { kind: 'boolean', help: 'show this text' },
};

function main(argv: string[]): string {
  const flags = parseFlags(argv, SPEC);
  if (flags.bool('help')) {
    return usage('balance:progression', 'time to reach each level; with neither --area nor --enemy-level the enemy matches the character level', SPEC);
  }
  const from = intFlag(flags, 'from', 1, 1);
  const to = intFlag(flags, 'to', constants.levelCap, 2);
  const secondsPerKill = flags.number('seconds-per-kill') ?? defaultSecondsPerKill();
  const areaId = flags.string('area');
  const fixedLevel = flags.number('enemy-level');
  if (areaId !== undefined && fixedLevel !== undefined) throw new BalanceError('Pass --area or --enemy-level, not both.');

  let xpPerKill: (characterLevel: number) => number;
  let label: string;
  if (areaId !== undefined) {
    const data = loadBalanceData();
    const average = areaAverageXp(findArea(data.areas, areaId), data.enemies);
    xpPerKill = () => average;
    label = `area ${areaId}, ${num(average, 1)} XP per kill`;
  } else if (fixedLevel !== undefined) {
    const level = intFlag(flags, 'enemy-level', 1, 1);
    xpPerKill = () => xpReward(level);
    label = `baseline level ${level} enemies, ${xpReward(level)} XP per kill`;
  } else {
    xpPerKill = (characterLevel) => xpReward(characterLevel);
    label = 'enemies of the same level as the character';
  }

  const steps = levelCurve({ fromLevel: from, toLevel: to, xpPerKill, secondsPerKill, table: loadBalanceData().xpTable });
  return [
    `Time to level up: ${label}, ${num(secondsPerKill, 1)} s per kill`,
    '',
    table(
      ['Reach', 'XP needed', 'XP/kill', 'Kills', 'Time', 'Total'],
      steps.map((s) => [`Lv ${s.level + 1}`, num(s.xpToNext, 0), num(s.xpPerKill, 1), num(s.kills, 0), duration(s.seconds), duration(s.cumulativeSeconds)]),
    ),
  ].join('\n');
}

runCli(main);
