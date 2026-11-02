// Validates the JSON tables in data/ (design 5.1, 5.2).
// Errors fail the run. Undecided constants (null) are listed but do not fail it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const errors = [];
const tables = {};

for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort()) {
  const name = file.replace(/\.json$/, '');
  try {
    tables[name] = JSON.parse(readFileSync(resolve(dataDir, file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: invalid JSON (${e.message})`);
  }
}

// Every table except constants is an array of entries with a unique string id.
for (const [name, rows] of Object.entries(tables)) {
  if (name === 'constants') continue;
  if (!Array.isArray(rows)) {
    errors.push(`${name}.json: expected an array of entries`);
    continue;
  }
  const seen = new Set();
  rows.forEach((row, i) => {
    if (typeof row?.id !== 'string' || row.id === '') errors.push(`${name}.json[${i}]: missing string id`);
    else if (seen.has(row.id)) errors.push(`${name}.json: duplicate id "${row.id}"`);
    else seen.add(row.id);
  });
}

const ids = (name) => new Set((tables[name] ?? []).map((r) => r.id));
const ref = (from, where, value, target) => {
  if (value != null && !ids(target).has(value)) errors.push(`${from}: ${where} "${value}" not found in ${target}.json`);
};

// Cross-table references (design 5.1: tables refer to each other by id).
for (const e of tables['enemies'] ?? []) ref(`enemies.${e.id}`, 'dropTableId', e.dropTableId, 'drop-tables');
for (const d of tables['drop-tables'] ?? []) {
  for (const entry of d.entries ?? []) {
    ref(`drop-tables.${d.id}`, 'itemId', entry.itemId, 'items');
    if (typeof entry.baseChance === 'number' && (entry.baseChance < 0 || entry.baseChance > 1)) {
      errors.push(`drop-tables.${d.id}: baseChance ${entry.baseChance} is outside 0..1`);
    }
    if (entry.minQuantity > entry.maxQuantity) errors.push(`drop-tables.${d.id}: minQuantity above maxQuantity`);
  }
}
for (const a of tables['areas'] ?? []) {
  for (const spawn of a.enemies ?? []) ref(`areas.${a.id}`, 'enemyId', spawn.enemyId, 'enemies');
}

// Undecided constants.
const undecided = [];
const walk = (obj, path) => {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === null) undecided.push([...path, k].join('.'));
    else if (typeof v === 'object' && !Array.isArray(v)) walk(v, [...path, k]);
  }
};
walk(tables['constants'], []);

if (undecided.length) console.log(`Undecided constants (null, ${undecided.length}): ${undecided.join(', ')}`);
if (errors.length) {
  console.error(errors.map((e) => `ERROR ${e}`).join('\n'));
  process.exit(1);
}
console.log(`Data OK: ${Object.keys(tables).length} tables`);
