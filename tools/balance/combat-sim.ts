/** Combat simulator (design 5.3): a build against an enemy, N seeded fights. Run: npm run balance:combat -- --help */
import { createStream } from '../../src/game/rng';
import constants from '../../data/constants.json';
import { intFlag, parseFlags, usage, type FlagSpec } from './args';
import {
  baselineEnemy,
  buildPlayer,
  defaultBuild,
  enemyFromData,
  referenceBuild,
  runFights,
  type Combatant,
  type PlayerBuild,
  type WeaponType,
} from './combat';
import { runCli } from './cli';
import { num, pct, table } from './format';
import { BalanceError, findEnemy, loadBalanceData } from './load-data';

const SPEC: FlagSpec = {
  level: { kind: 'number', help: 'character level (default 1). Sets the enemy level when no enemy is given' },
  str: { kind: 'number', help: 'strength' },
  dex: { kind: 'number', help: 'dexterity' },
  vit: { kind: 'number', help: 'vitality' },
  int: { kind: 'number', help: 'intelligence' },
  weapon: { kind: 'number', help: 'weapon damage (default 0)' },
  armour: { kind: 'number', help: 'armour defence (default 0)' },
  'weapon-type': { kind: 'string', help: 'unarmed, one-handed (default) or two-handed: which proficiency adds damage' },
  'prof-weapon': { kind: 'number', help: 'weapon proficiency points 0-100 (default 0)' },
  'prof-toughness': { kind: 'number', help: 'toughness proficiency points 0-100 (default 0)' },
  'prof-speed': { kind: 'number', help: 'speed proficiency points 0-100 (default 0)' },
  reference: { kind: 'boolean', help: 'start from the reference build for --level (decisions N6); other flags override it' },
  enemy: { kind: 'string', help: 'enemy id from data/enemies.json' },
  'enemy-level': { kind: 'number', help: 'baseline enemy of this level (constants.enemyScaling). Default: --level' },
  runs: { kind: 'number', help: 'number of fights (default 1000)' },
  seed: { kind: 'number', help: 'master seed (default 1)' },
  'max-seconds': { kind: 'number', help: 'a fight longer than this counts as a timeout (default 600)' },
  help: { kind: 'boolean', help: 'show this text' },
};

const WEAPON_TYPES: readonly WeaponType[] = ['unarmed', 'one-handed', 'two-handed'];

export function main(argv: string[]): string {
  const flags = parseFlags(argv, SPEC);
  if (flags.bool('help')) return usage('balance:combat', 'time to kill, damage taken and win rate for a build against an enemy', SPEC);

  const level = intFlag(flags, 'level', 1, 1);
  const base: PlayerBuild = flags.bool('reference') ? referenceBuild(level) : defaultBuild(level);
  const weaponType = (flags.string('weapon-type') ?? base.weaponType) as WeaponType;
  if (!WEAPON_TYPES.includes(weaponType)) throw new BalanceError(`--weapon-type must be one of ${WEAPON_TYPES.join(', ')}.`);
  const build: PlayerBuild = {
    ...base,
    attributes: {
      strength: flags.number('str') ?? base.attributes.strength,
      dexterity: flags.number('dex') ?? base.attributes.dexterity,
      vitality: flags.number('vit') ?? base.attributes.vitality,
      intelligence: flags.number('int') ?? base.attributes.intelligence,
    },
    weaponDamage: flags.number('weapon') ?? base.weaponDamage,
    armourDefence: flags.number('armour') ?? base.armourDefence,
    weaponType,
    weaponProficiency: flags.number('prof-weapon') ?? base.weaponProficiency,
    toughnessProficiency: flags.number('prof-toughness') ?? base.toughnessProficiency,
    speedProficiency: flags.number('prof-speed') ?? base.speedProficiency,
  };
  const runs = intFlag(flags, 'runs', 1000, 1);
  const seed = flags.number('seed') ?? 1;
  const maxSeconds = flags.number('max-seconds') ?? 600;

  let enemy: Combatant;
  let enemyLabel: string;
  const enemyId = flags.string('enemy');
  if (enemyId !== undefined) {
    const entry = findEnemy(loadBalanceData().enemies, enemyId);
    enemy = enemyFromData(entry);
    enemyLabel = `${entry.name ?? entry.id} (level ${entry.level}, data/enemies.json)`;
  } else {
    const enemyLevel = intFlag(flags, 'enemy-level', level, 1);
    enemy = baselineEnemy(enemyLevel);
    enemyLabel = `baseline level ${enemyLevel} (constants.enemyScaling)`;
  }

  const player = buildPlayer(build);
  const summary = runFights(player, enemy, runs, createStream(seed, 'balance', 'combat'), { maxSeconds });
  const a = build.attributes;
  const describe = (c: Combatant): string =>
    `HP ${num(c.maxHp, 1)} | damage ${num(c.damage)} | defence ${num(c.defence)} | ${num(1000 / c.intervalMs)} attacks/s (${c.intervalMs} ms)` +
    (c.critChance > 0 ? ` | crit ${pct(c.critChance)}` : '');

  const lines = [
    `Player  level ${build.level} | STR ${num(a.strength)} DEX ${num(a.dexterity)} VIT ${num(a.vitality)} INT ${num(a.intelligence)} | weapon ${num(build.weaponDamage)} armour ${num(build.armourDefence)}`,
    `        ${describe(player)}`,
    `Enemy   ${enemyLabel}`,
    `        ${describe(enemy)}`,
    `${runs} fights, seed ${seed}, tick ${constants.combat.tickMs} ms`,
    '',
  ];
  const rows: string[][] = [
    ['Win rate', pct(summary.winRate)],
    ['Losses', String(summary.losses)],
    ['Timeouts', String(summary.timeouts)],
  ];
  const t = summary.timeToKill;
  if (t) {
    rows.push(['Time to kill, mean', `${num(t.mean)} s`], ['Time to kill, median', `${num(t.median)} s`], ['Time to kill, 95th percentile', `${num(t.p95)} s`]);
  } else {
    rows.push(['Time to kill', 'no wins']);
  }
  rows.push(
    ['Damage taken per fight', num(summary.meanDamageTaken)],
    ['HP lost per fight', `${pct(summary.meanHpLostFraction)} of max health`],
    ['Fights per full health bar', num(summary.fightsPerFullHealth, 1)],
  );
  lines.push(table(['Result', 'Value'], rows));
  return lines.join('\n');
}

runCli(main);
