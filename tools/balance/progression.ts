/** Progression curve (design 5.3): time to reach each level. Run: npm run balance:progression -- --help */
import constants from '../../data/constants.json';
import { baselineEnemy, enemyOrBaseline, referenceFightSeconds } from './combat';
import { intFlag, parseFlags, usage, type FlagSpec } from './args';
import { runCli } from './cli';
import { levelCurve } from './curve';
import { areaAverageXp, areaMovementSeconds, areaSecondsPerKill, enemyXp, type Pace } from './drops';
import { duration, num, table } from './format';
import { BalanceError, findArea, findEnemy, loadBalanceData, targetingMultiplier, type EnemyEntry } from './load-data';
import { xpReward } from '../../src/game/progression';

const SPEC: FlagSpec = {
  area: { kind: 'string', help: 'area id: the character kills this area\'s spawn mix at every level' },
  'enemy-level': { kind: 'number', help: 'always kill enemies of this baseline level' },
  'seconds-per-kill': { kind: 'number', help: 'fix the seconds from one kill to the next, fight and moving (default: fight + movement)' },
  'fight-seconds': { kind: 'number', help: 'seconds of fighting per kill (default: simulated with the reference build of each level, mean time to kill)' },
  'movement-seconds': { kind: 'number', help: 'seconds of movement between enemies (default: the area\'s movementSecondsBetweenEnemies, else constants.farming)' },
  target: { kind: 'string', help: 'with --area: farm only this enemy; movement seconds are multiplied by its targetingMultiplier (3.3)' },
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
  const fixedSeconds = flags.number('seconds-per-kill');
  const fixedFight = flags.number('fight-seconds');
  const movementFlag = flags.number('movement-seconds');
  const areaId = flags.string('area');
  const fixedLevel = flags.number('enemy-level');
  if (areaId !== undefined && fixedLevel !== undefined) throw new BalanceError('Pass --area or --enemy-level, not both.');
  const targetId = flags.string('target');
  if (targetId !== undefined && areaId === undefined) throw new BalanceError('--target needs --area.');
  const data = loadBalanceData();

  let xpPerKill: (characterLevel: number) => number;
  let secondsPerKill: (characterLevel: number) => number;
  let label: string;
  const movementOutsideArea = movementFlag ?? constants.farming.movementSecondsBetweenEnemies;
  if (areaId !== undefined) {
    const area = findArea(data.areas, areaId);
    const paceAt = (characterLevel: number): Pace => ({
      fightSeconds: (enemy: EnemyEntry) =>
        fixedFight ?? referenceFightSeconds(characterLevel, enemyOrBaseline(enemy), `"${enemy.id}"`),
      ...(movementFlag === undefined ? {} : { movementSeconds: movementFlag }),
    });
    if (targetId === undefined) {
      const average = areaAverageXp(area, data.enemies);
      xpPerKill = () => average;
      secondsPerKill = (characterLevel) => areaSecondsPerKill(area, data.enemies, paceAt(characterLevel));
      label = `area ${areaId}, ${num(average, 1)} XP per kill`;
    } else {
      if (!area.enemies.some((e) => e.enemyId === targetId)) throw new BalanceError(`Enemy "${targetId}" does not spawn in area "${area.id}".`);
      const foe = findEnemy(data.enemies, targetId);
      const multiplier = targetingMultiplier(foe);
      xpPerKill = () => enemyXp(foe);
      secondsPerKill = (characterLevel) => {
        const pace = paceAt(characterLevel);
        const fight = typeof pace.fightSeconds === 'number' ? pace.fightSeconds : pace.fightSeconds(foe);
        return fight + areaMovementSeconds(area, pace) * multiplier;
      };
      label = `area ${areaId}, targeting ${targetId} (movement x${multiplier}), ${num(enemyXp(foe), 1)} XP per kill`;
    }
  } else if (fixedLevel !== undefined) {
    const level = intFlag(flags, 'enemy-level', 1, 1);
    xpPerKill = () => xpReward(level);
    secondsPerKill = (characterLevel) =>
      (fixedFight ?? referenceFightSeconds(characterLevel, baselineEnemy(level), `a level ${level} baseline enemy`)) + movementOutsideArea;
    label = `baseline level ${level} enemies, ${xpReward(level)} XP per kill`;
  } else {
    xpPerKill = (characterLevel) => xpReward(characterLevel);
    secondsPerKill = (characterLevel) =>
      (fixedFight ?? referenceFightSeconds(characterLevel, baselineEnemy(characterLevel), 'the baseline enemy of its own level')) + movementOutsideArea;
    label = 'enemies of the same level as the character';
  }
  const perKill = fixedSeconds === undefined ? secondsPerKill : () => fixedSeconds;
  const paceText =
    fixedSeconds !== undefined
      ? `${num(fixedSeconds, 1)} s per kill (fixed)`
      : `fight ${fixedFight === undefined ? 'simulated with the reference build' : `${num(fixedFight, 1)} s`} + movement ${areaId !== undefined && movementFlag === undefined ? 'from the area' : `${num(movementOutsideArea, 1)} s`}`;

  const steps = levelCurve({ fromLevel: from, toLevel: to, xpPerKill, secondsPerKill: perKill, table: data.xpTable });
  return [
    `Time to level up: ${label}, ${paceText}`,
    '',
    table(
      ['Reach', 'XP needed', 'XP/kill', 's/kill', 'Kills', 'Time', 'Total'],
      steps.map((s) => [`Lv ${s.level + 1}`, num(s.xpToNext, 0), num(s.xpPerKill, 1), num(s.secondsPerKill, 1), num(s.kills, 0), duration(s.seconds), duration(s.cumulativeSeconds)]),
    ),
  ].join('\n');
}

runCli(main);
