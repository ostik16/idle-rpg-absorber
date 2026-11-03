/** Drop calculator (design 5.3): expected drops, XP and gold per hour in an area. Run: npm run balance:drops -- --help */
import { enemyOrBaseline, referenceFightSeconds } from './combat';
import { intFlag, parseFlags, usage, type FlagSpec } from './args';
import { runCli } from './cli';
import { areaReport, type Pace } from './drops';
import { num, pct, table } from './format';
import { BalanceError, findArea, levelRangeText, loadBalanceData, type EnemyEntry } from './load-data';

const SPEC: FlagSpec = {
  level: { kind: 'number', help: 'character level (default 1)' },
  area: { kind: 'string', help: 'area id from data/areas.json (omit to list the areas)' },
  'fight-seconds': { kind: 'number', help: 'seconds of fighting per kill, for every enemy (default: simulated with the reference build for --level, mean time to kill)' },
  'movement-seconds': { kind: 'number', help: 'seconds of movement between enemies (default: the area\'s movementSecondsBetweenEnemies, else constants.farming)' },
  'prof-speed': { kind: 'number', help: 'speed skill points 0-100: shortens the movement time (default 0)' },
  target: { kind: 'string', help: 'farm only this enemy id; multiplies the movement seconds by that enemy\'s targetingMultiplier (3.3)' },
  help: { kind: 'boolean', help: 'show this text' },
};

/** Mean time to kill each enemy for the reference build of `level`; enemies without full stats use the baseline enemy of their level. */
function simulatedFightSeconds(level: number): (enemy: EnemyEntry) => number {
  return (entry) => referenceFightSeconds(level, enemyOrBaseline(entry), `"${entry.id}"`);
}

function main(argv: string[]): string {
  const flags = parseFlags(argv, SPEC);
  if (flags.bool('help')) return usage('balance:drops', 'expected drops, absorption, XP and gold per hour in an area', SPEC);
  const data = loadBalanceData();
  const areaId = flags.string('area');
  if (areaId === undefined) {
    if (data.areas.length === 0) throw new BalanceError('data/areas.json is empty, so there is nothing to calculate yet.');
    return ['Pass --area <id>. Areas:', ...data.areas.map((a) => `  ${a.id}  ${a.name ?? ''}  level ${levelRangeText(a.levelRange)}`)].join('\n');
  }
  const level = intFlag(flags, 'level', 1, 1);
  const targetEnemyId = flags.string('target');
  const fixedFight = flags.number('fight-seconds');
  const movement = flags.number('movement-seconds');
  const speed = flags.number('prof-speed');
  const pace: Pace = {
    fightSeconds: fixedFight ?? simulatedFightSeconds(level),
    ...(movement === undefined ? {} : { movementSeconds: movement }),
    ...(speed === undefined ? {} : { speedPoints: speed }),
  };
  const report = areaReport(data, areaId, level, pace, targetEnemyId === undefined ? {} : { targetEnemyId });
  const area = findArea(data.areas, areaId);

  const out: string[] = [
    `${report.areaName} (${report.areaId}), levels ${levelRangeText(area.levelRange) || 'n/a'} | character level ${level}`,
    `${num(report.secondsPerKill, 1)} s per kill = ${num(report.fightSeconds, 1)} s fight + ${num(report.movementSeconds, 1)} s movement` +
      (report.targetEnemyId ? ` (targeting ${report.targetEnemyId}, movement x${report.targetingMultiplier})` : '') +
      ` = ${num(report.killsPerHour, 1)} kills per hour`,
    fixedFight === undefined ? `Fight time simulated with the reference build for level ${level} (pass --fight-seconds to fix it)` : `Fight time fixed at ${num(fixedFight, 1)} s`,
    '',
    table(
      ['Enemy', 'Lvl', 'Share', 'Kills/h', 'Drop mod', 'Absorb mod', 'XP/kill', 'XP/h', 'Gold/kill', 'Gold/h'],
      report.enemies.map((e) => [
        e.name, String(e.level), pct(e.share, 0), num(e.killsPerHour, 1), num(e.dropModifier),
        e.absorbable ? num(e.absorptionModifier) : 'no', num(e.xpPerKill, 0), num(e.xpPerHour, 0), num(e.goldPerKill, 1), num(e.goldPerHour, 0),
      ]),
    ),
  ];
  for (const e of report.enemies) {
    out.push('', `${e.name} (level ${e.level}, ${e.type})`);
    if (e.drops.length === 0) out.push('  no drops');
    else {
      out.push(
        ...table(
          ['  Item', 'Base', 'Final', 'Avg qty', 'Per kill', 'Per hour'],
          e.drops.map((d) => [`  ${d.itemName}${d.poolId === null ? '' : ` [every kill, pool ${d.poolId}]`}`, pct(d.baseChance), pct(d.finalChance, 2), num(d.avgQuantity), num(d.dropsPerKill, 3), num(d.dropsPerHour, 2)]),
        ).split('\n'),
      );
    }
    if (!e.absorbable) out.push('  absorption: not absorbable');
    else if (e.traits.length === 0) out.push(`  absorption: rate ${pct(e.absorptionModifier, 0)}, no magical traits`);
    for (const t of e.traits) {
      out.push(`  absorption: ${t.traitId} ${num(t.value)}, rate ${pct(e.absorptionModifier, 0)}, +${num(t.perKill, 3)} per kill, ${t.killsToCap} kills (${num(t.hoursToCap, 1)} h) to reach the enemy's value`);
    }
  }
  out.push('', 'Totals per hour');
  out.push(`  XP     ${num(report.xpPerHour, 0)}`, `  Gold   ${num(report.goldPerHour, 0)} (money drops)`);
  if (report.dropValuePerHour > 0) out.push(`  Items  ${num(report.dropValuePerHour, 0)} gold if sold`);
  if (report.items.length > 0) {
    out.push('', table(['Item', 'Drops/h'], report.items.map((i) => [i.itemName, num(i.dropsPerHour, 2)])));
  }
  return out.join('\n');
}

runCli(main);
