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
const C = tables['constants'] ?? {};
const inRange01 = (from, what, v) => {
  if (typeof v !== 'number' || v < 0 || v > 1) errors.push(`${from}: ${what} ${v} is outside 0..1`);
};
const minMax = (from, what, min, max) => {
  if (typeof min !== 'number' || typeof max !== 'number') errors.push(`${from}: ${what} needs numeric min and max`);
  else if (min > max) errors.push(`${from}: ${what} min ${min} is above max ${max}`);
};
const anyItem = (id) => ids('items').has(id) || ids('rare-items').has(id);
const itemRef = (from, where, id) => {
  if (id != null && !anyItem(id)) errors.push(`${from}: ${where} "${id}" not found in items.json or rare-items.json`);
};

// Enemies.
const areaById = Object.fromEntries((tables['areas'] ?? []).map((a) => [a.id, a]));
const traitById = Object.fromEntries((tables['traits'] ?? []).map((t) => [t.id, t]));
for (const e of tables['enemies'] ?? []) {
  const from = `enemies.${e.id}`;
  ref(from, 'dropTableId', e.dropTableId, 'drop-tables');
  minMax(from, 'moneyRange', e.moneyRange?.min, e.moneyRange?.max);
  for (const a of e.areas ?? []) {
    ref(from, 'area', a, 'areas');
    const range = areaById[a]?.levelRange;
    if (range && (e.level < range.min || e.level > range.max)) errors.push(`${from}: level ${e.level} is outside ${a} range ${range.min}-${range.max}`);
  }
  for (const t of e.traits ?? []) {
    ref(from, 'trait id', t.id, 'traits');
    const def = traitById[t.id];
    if (def && def.magical !== t.magical) errors.push(`${from}: trait "${t.id}" magical flag ${t.magical} differs from traits.json (${def.magical})`);
    if (typeof t.value !== 'number' || t.value <= 0) errors.push(`${from}: trait "${t.id}" needs a value above 0`);
  }
}

// Drop tables.
for (const d of tables['drop-tables'] ?? []) {
  for (const entry of d.entries ?? []) {
    const from = `drop-tables.${d.id}`;
    itemRef(from, 'itemId', entry.itemId);
    inRange01(from, 'baseChance', entry.baseChance);
    minMax(from, 'quantity', entry.minQuantity, entry.maxQuantity);
    if (entry.guaranteed && entry.baseChance !== 1) errors.push(`${from}: guaranteed entry "${entry.itemId}" must have baseChance 1`);
  }
}

// Areas.
for (const a of tables['areas'] ?? []) {
  const from = `areas.${a.id}`;
  minMax(from, 'levelRange', a.levelRange?.min, a.levelRange?.max);
  let weights = 0;
  for (const spawn of a.enemies ?? []) {
    ref(from, 'enemyId', spawn.enemyId, 'enemies');
    if (typeof spawn.spawnWeight !== 'number' || spawn.spawnWeight <= 0) errors.push(`${from}: spawnWeight for "${spawn.enemyId}" must be above 0`);
    else weights += spawn.spawnWeight;
    const e = (tables['enemies'] ?? []).find((x) => x.id === spawn.enemyId);
    if (e && !(e.areas ?? []).includes(a.id)) errors.push(`${from}: enemy "${spawn.enemyId}" does not list this area`);
    if (e && (e.level < a.levelRange?.min || e.level > a.levelRange?.max)) errors.push(`${from}: enemy "${spawn.enemyId}" level ${e.level} is outside the area range`);
    if (e && e.type !== 'normal') errors.push(`${from}: spawn list enemy "${spawn.enemyId}" must be of type normal`);
  }
  if (!weights) errors.push(`${from}: needs at least one enemy with a spawn weight`);
  for (const [idKey, chanceKey] of [['miniBossId', 'miniBossSpawnChance'], ['bossId', 'bossSpawnChance'], ['cursedObjectId', 'cursedObjectSpawnChance']]) {
    inRange01(from, chanceKey, a[chanceKey]);
    ref(from, idKey, a[idKey], 'enemies');
    if (a[chanceKey] > 0 && a[idKey] == null) errors.push(`${from}: ${chanceKey} is above 0 but ${idKey} is empty`);
  }
}

// Items.
const attributeIds = ids('attributes');
const stackMax = C.storage?.materialStackSize;
const slotTypes = new Set((tables['equipment-slots'] ?? []).flatMap((s) => s.allowedTypes ?? []));
const maxBonus = C.items?.maxBonusAttributes;
for (const it of tables['items'] ?? []) {
  const from = `items.${it.id}`;
  for (const k of ['name', 'category', 'icon']) if (typeof it[k] !== 'string' || !it[k]) errors.push(`${from}: missing ${k}`);
  for (const k of ['size', 'stackLimit', 'requiredLevel', 'buyPrice', 'sellPrice']) if (!Number.isInteger(it[k]) || it[k] < (k === 'buyPrice' || k === 'sellPrice' ? 0 : 1)) errors.push(`${from}: ${k} must be a whole number`);
  if (it.sellPrice > it.buyPrice) errors.push(`${from}: sellPrice is above buyPrice`);
  if (it.requiredLevel > (C.levelCap ?? Infinity)) errors.push(`${from}: requiredLevel is above the level cap`);
  if (it.category === 'material' && stackMax != null && it.stackLimit > stackMax) errors.push(`${from}: stackLimit ${it.stackLimit} is above storage.materialStackSize ${stackMax}`);
  if (it.category === 'equipment') {
    if (it.stackLimit !== 1) errors.push(`${from}: equipment must have stackLimit 1`);
    if (!slotTypes.has(it.equipmentType)) errors.push(`${from}: equipmentType "${it.equipmentType}" is not allowed in any slot of equipment-slots.json`);
  }
  if (!Array.isArray(it.bonusAttributePool)) errors.push(`${from}: bonusAttributePool must be an array`);
  for (const b of it.bonusAttributePool ?? []) {
    if (!attributeIds.has(b.attribute)) errors.push(`${from}: bonus attribute "${b.attribute}" not found in attributes.json`);
    minMax(from, `bonus ${b.attribute}`, b.min, b.max);
    inRange01(from, `bonus ${b.attribute} chance`, b.chance);
  }
  if (maxBonus != null && (it.bonusAttributePool ?? []).length > 0 && maxBonus < 1) errors.push(`${from}: has a bonus pool but items.maxBonusAttributes is ${maxBonus}`);
  const isWeapon = /weapon$/.test(it.equipmentType ?? '');
  if (isWeapon) {
    if (typeof it.baseStats?.damage !== 'number') errors.push(`${from}: weapon needs baseStats.damage`);
    if (!Array.isArray(it.scaling) || it.scaling.length === 0) errors.push(`${from}: weapon needs scaling attributes`);
    for (const s of it.scaling ?? []) {
      if (!attributeIds.has(s.attribute)) errors.push(`${from}: scaling attribute "${s.attribute}" not found in attributes.json`);
      if (typeof s.recommendedValue !== 'number' || s.recommendedValue <= 0) errors.push(`${from}: scaling "${s.attribute}" needs a recommendedValue above 0`);
    }
  }
}

// Consumables.
const potionTiers = Object.fromEntries((C.potions?.tiers ?? []).map((t) => [t.id, t]));
for (const c of tables['consumables'] ?? []) {
  const from = `consumables.${c.id}`;
  ref(from, 'item id', c.id, 'items');
  const tier = potionTiers[c.tier];
  if (c.tier != null && !tier) errors.push(`${from}: tier "${c.tier}" not found in constants.potions.tiers`);
  if (tier && (tier.amount !== c.amount || tier.durationSeconds !== c.durationSeconds)) errors.push(`${from}: amount/duration differ from constants.potions tier "${c.tier}"`);
  inRange01(from, 'autoUseDefaultThreshold', c.autoUseDefaultThreshold);
}

// Equipment slots.
for (const s of tables['equipment-slots'] ?? []) {
  ref(`equipment-slots.${s.id}`, 'twoHandedBlocks', s.twoHandedBlocks, 'equipment-slots');
}

// Shops.
for (const s of tables['shops'] ?? []) {
  const from = `shops.${s.id}`;
  const items = Object.fromEntries((tables['items'] ?? []).map((i) => [i.id, i]));
  for (const row of s.itemList ?? []) {
    ref(from, 'itemId', row.itemId, 'items');
    if (items[row.itemId] && row.price !== items[row.itemId].buyPrice) errors.push(`${from}: price ${row.price} for "${row.itemId}" differs from its buyPrice ${items[row.itemId].buyPrice}`);
  }
}

// Rare items.
for (const r of tables['rare-items'] ?? []) {
  const from = `rare-items.${r.id}`;
  if (!['equip', 'upgrade', 'consume'].includes(r.use)) errors.push(`${from}: use must be equip, upgrade or consume`);
  if (r.use === 'equip') ref(from, 'slot', r.slot, 'equipment-slots');
  for (const src of r.dropSources ?? []) ref(from, 'dropSource', src, 'enemies');
  if (r.effect?.type === 'upgrade-protection' && r.effect.consumedOnEveryAttempt !== C.upgrade?.protectionConsumedOnSuccess) {
    errors.push(`${from}: consumedOnEveryAttempt differs from constants.upgrade.protectionConsumedOnSuccess`);
  }
}

// Upgrades: one table per item group, levels 1..maxLevel with no gaps.
const upgradeGroups = {};
for (const u of tables['upgrades'] ?? []) {
  const from = `upgrades.${u.id}`;
  (upgradeGroups[u.itemGroup] ??= []).push(u);
  if (!(tables['items'] ?? []).some((i) => i.equipmentType === u.itemGroup)) errors.push(`${from}: itemGroup "${u.itemGroup}" matches no item equipmentType`);
  ref(from, 'materialId', u.materialId, 'items');
  const needsMaterial = u.level >= (C.upgrade?.materialsStartAtLevel ?? Infinity);
  if (needsMaterial && (u.materialId == null || !(u.materialAmount > 0))) errors.push(`${from}: level ${u.level} needs a material (materials start at ${C.upgrade.materialsStartAtLevel})`);
  if (!needsMaterial && (u.materialId != null || u.materialAmount)) errors.push(`${from}: level ${u.level} must be gold only`);
  if (typeof u.goldCost !== 'number' || u.goldCost < 0) errors.push(`${from}: goldCost must be 0 or more`);
  if (typeof u.statBonus !== 'number' || u.statBonus < 0) errors.push(`${from}: statBonus must be 0 or more`);
}
for (const [group, rows] of Object.entries(upgradeGroups)) {
  const levels = rows.map((r) => r.level).sort((a, b) => a - b);
  const max = C.upgrade?.maxLevel;
  if (levels.some((l, i) => l !== i + 1) || (max != null && levels.length !== max)) errors.push(`upgrades: group "${group}" must have levels 1 to ${max} with no gaps`);
}

// Spells.
for (const s of tables['spells'] ?? []) {
  const from = `spells.${s.id}`;
  if (!['offensive', 'defensive', 'support'].includes(s.kind)) errors.push(`${from}: kind must be offensive, defensive or support`);
  if (s.maxRank > (C.spells?.baseMaxRank ?? Infinity)) errors.push(`${from}: maxRank above spells.baseMaxRank`);
  if (!Array.isArray(s.effectPerRank) || s.effectPerRank.length !== s.maxRank) errors.push(`${from}: effectPerRank needs one value per rank (1 to ${s.maxRank})`);
  else if (s.effectPerRank.some((v, i) => typeof v !== 'number' || (i > 0 && v < s.effectPerRank[i - 1]))) errors.push(`${from}: effectPerRank must be numbers that do not fall with rank`);
  if (s.requiredLevel > (C.levelCap ?? Infinity)) errors.push(`${from}: requiredLevel above the level cap`);
  if (!(s.manaCost >= 0) || !(s.cooldown >= 0)) errors.push(`${from}: manaCost and cooldown must be 0 or more`);
  itemRef(from, 'rareItemPerRankAbove10', s.rareItemPerRankAbove10?.itemId);
}

// Starter items from constants.creation exist.
const creation = C.creation ?? {};
for (const [slot, itemId] of Object.entries(creation.startingEquipment ?? {})) ref('constants.creation', `startingEquipment.${slot}`, itemId, 'items');
for (const s of creation.startingItems ?? []) ref('constants.creation', 'startingItems', s.itemId, 'items');

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
