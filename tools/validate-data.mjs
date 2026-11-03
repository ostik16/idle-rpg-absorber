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

// Single items table: the old split tables must not exist.
for (const old of ['consumables', 'rare-items']) {
  if (old in tables) errors.push(`${old}.json must not exist: all items live in items.json`);
}
const itemById = Object.fromEntries((tables['items'] ?? []).map((i) => [i.id, i]));
const itemRef = (from, where, id) => {
  if (id != null && !itemById[id]) errors.push(`${from}: ${where} "${id}" not found in items.json`);
};

// Enemies.
const areaById = Object.fromEntries((tables['areas'] ?? []).map((a) => [a.id, a]));
const traitById = Object.fromEntries((tables['traits'] ?? []).map((t) => [t.id, t]));
const enemyById = Object.fromEntries((tables['enemies'] ?? []).map((e) => [e.id, e]));
const enemyTypes = ['normal', 'mini-boss', 'boss', 'cursed-object'];
const maxTarget = C.farming?.targeting?.maxMultiplier;
for (const e of tables['enemies'] ?? []) {
  const from = `enemies.${e.id}`;
  if (!enemyTypes.includes(e.type)) errors.push(`${from}: type must be one of ${enemyTypes.join(', ')}`);
  ref(from, 'dropTableId', e.dropTableId, 'drop-tables');
  minMax(from, 'moneyRange', e.moneyRange?.min, e.moneyRange?.max);
  if (typeof e.targetingMultiplier !== 'number' || e.targetingMultiplier < 1 || (maxTarget != null && e.targetingMultiplier > maxTarget)) {
    errors.push(`${from}: targetingMultiplier ${e.targetingMultiplier} must be between 1 and farming.targeting.maxMultiplier (${maxTarget})`);
  }
  if (e.type === 'normal' && e.targetingMultiplier < (C.farming?.targeting?.commonMultiplier ?? 1)) errors.push(`${from}: normal enemy targetingMultiplier is below farming.targeting.commonMultiplier`);
  for (const k of ['health', 'damage', 'attackSpeed', 'xpReward']) if (typeof e[k] !== 'number' || e[k] <= 0) errors.push(`${from}: ${k} must be above 0`);
  if (typeof e.defence !== 'number' || e.defence < 0) errors.push(`${from}: defence must be 0 or more`);
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
const dropTableById = Object.fromEntries((tables['drop-tables'] ?? []).map((d) => [d.id, d]));
for (const d of tables['drop-tables'] ?? []) {
  const from = `drop-tables.${d.id}`;
  for (const entry of d.entries ?? []) {
    itemRef(from, 'itemId', entry.itemId);
    inRange01(from, 'baseChance', entry.baseChance);
    minMax(from, 'quantity', entry.minQuantity, entry.maxQuantity);
    if ('guaranteed' in entry) errors.push(`${from}: "guaranteed" entries are gone, use guaranteedPools (entry "${entry.itemId}")`);
  }
  if (d.guaranteedPools != null && !Array.isArray(d.guaranteedPools)) errors.push(`${from}: guaranteedPools must be an array`);
  const poolIds = new Set();
  for (const pool of d.guaranteedPools ?? []) {
    if (typeof pool.id !== 'string' || !pool.id) errors.push(`${from}: guaranteed pool needs an id`);
    else if (poolIds.has(pool.id)) errors.push(`${from}: duplicate guaranteed pool id "${pool.id}"`);
    else poolIds.add(pool.id);
    if (!Array.isArray(pool.entries) || pool.entries.length === 0) errors.push(`${from}: pool "${pool.id}" needs entries`);
    for (const entry of pool.entries ?? []) {
      itemRef(from, `pool "${pool.id}" itemId`, entry.itemId);
      if (typeof entry.weight !== 'number' || entry.weight <= 0) errors.push(`${from}: pool "${pool.id}" weight for "${entry.itemId}" must be above 0`);
      minMax(from, `pool "${pool.id}" quantity`, entry.minQuantity, entry.maxQuantity);
    }
  }
}
// Mini-boss and boss drop rules.
const poolItems = (d) => (d?.guaranteedPools ?? []).flatMap((p) => p.entries ?? []).map((x) => itemById[x.itemId]).filter(Boolean);
for (const e of tables['enemies'] ?? []) {
  const d = dropTableById[e.dropTableId];
  if (e.type === 'mini-boss' && !poolItems(d).some((i) => i.category === 'material')) errors.push(`enemies.${e.id}: a mini-boss drop table needs a guaranteed pool with material items`);
  if (e.type === 'boss' && !poolItems(d).some((i) => i.category === 'rare')) errors.push(`enemies.${e.id}: a boss drop table needs a guaranteed pool with rare items`);
  if (e.type === 'mini-boss' && poolItems(d).some((i) => i.category === 'rare')) errors.push(`enemies.${e.id}: a mini-boss guaranteed pool must not hold rare items`);
  if (e.type === 'normal' && (d?.guaranteedPools ?? []).length) errors.push(`enemies.${e.id}: ordinary enemies have no guaranteed pools`);
}

// Areas.
for (const a of tables['areas'] ?? []) {
  const from = `areas.${a.id}`;
  minMax(from, 'levelRange', a.levelRange?.min, a.levelRange?.max);
  if (typeof a.distanceFromCity !== 'number' || a.distanceFromCity <= 0) errors.push(`${from}: distanceFromCity must be above 0 (seconds)`);
  if ('movementSecondsBetweenEnemies' in a && !(typeof a.movementSecondsBetweenEnemies === 'number' && a.movementSecondsBetweenEnemies > 0)) errors.push(`${from}: movementSecondsBetweenEnemies must be above 0 when set`);
  let weights = 0;
  const perLevel = {};
  for (const spawn of a.enemies ?? []) {
    ref(from, 'enemyId', spawn.enemyId, 'enemies');
    if (typeof spawn.spawnWeight !== 'number' || spawn.spawnWeight <= 0) errors.push(`${from}: spawnWeight for "${spawn.enemyId}" must be above 0`);
    else weights += spawn.spawnWeight;
    const e = enemyById[spawn.enemyId];
    if (e) perLevel[e.level] = (perLevel[e.level] ?? 0) + 1;
    if (e && !(e.areas ?? []).includes(a.id)) errors.push(`${from}: enemy "${spawn.enemyId}" does not list this area`);
    if (e && (e.level < a.levelRange?.min || e.level > a.levelRange?.max)) errors.push(`${from}: enemy "${spawn.enemyId}" level ${e.level} is outside the area range`);
    if (e && e.type !== 'normal') errors.push(`${from}: spawn list enemy "${spawn.enemyId}" must be of type normal`);
  }
  if (!weights) errors.push(`${from}: needs at least one enemy with a spawn weight`);
  for (let l = a.levelRange?.min; l <= a.levelRange?.max; l++) {
    if ((perLevel[l] ?? 0) < 2) errors.push(`${from}: level ${l} has ${perLevel[l] ?? 0} normal enemies in the spawn list, needs at least 2`);
  }
  for (const [idKey, chanceKey, type] of [['miniBossId', 'miniBossSpawnChance', 'mini-boss'], ['bossId', 'bossSpawnChance', 'boss'], ['cursedObjectId', 'cursedObjectSpawnChance', 'cursed-object']]) {
    inRange01(from, chanceKey, a[chanceKey]);
    ref(from, idKey, a[idKey], 'enemies');
    if (a[chanceKey] > 0 && a[idKey] == null) errors.push(`${from}: ${chanceKey} is above 0 but ${idKey} is empty`);
    if (a[idKey] != null && enemyById[a[idKey]] && enemyById[a[idKey]].type !== type) errors.push(`${from}: ${idKey} "${a[idKey]}" must be of type ${type}`);
  }
}

// Items.
const attributeIds = ids('attributes');
const stackMax = C.storage?.materialStackSize;
const slotTypes = new Set((tables['equipment-slots'] ?? []).flatMap((s) => s.allowedTypes ?? []));
const maxBonus = C.items?.maxBonusAttributes;
const categories = ['equipment', 'consumable', 'material', 'rare'];
const potionTiers = Object.fromEntries((C.potions?.tiers ?? []).map((t) => [t.id, t]));
const isInt = (v, min) => Number.isInteger(v) && v >= min;
const itemGroups = new Set();
for (const it of tables['items'] ?? []) {
  const from = `items.${it.id}`;
  for (const k of ['name', 'category', 'icon']) if (typeof it[k] !== 'string' || !it[k]) errors.push(`${from}: missing ${k}`);
  if (!categories.includes(it.category)) errors.push(`${from}: category must be one of ${categories.join(', ')}`);
  for (const k of ['size', 'stackLimit', 'requiredLevel']) if (!isInt(it[k], 1)) errors.push(`${from}: ${k} must be a whole number of 1 or more`);
  if (!isInt(it.sellPrice, 0)) errors.push(`${from}: sellPrice must be a whole number of 0 or more`);
  if (it.buyPrice !== null && !isInt(it.buyPrice, 0)) errors.push(`${from}: buyPrice must be a whole number of 0 or more, or null when not purchasable`);
  if (it.buyPrice !== null && it.sellPrice > it.buyPrice) errors.push(`${from}: sellPrice is above buyPrice`);
  if (it.requiredLevel > (C.levelCap ?? Infinity)) errors.push(`${from}: requiredLevel is above the level cap`);
  if (typeof it.baseStats !== 'object' || it.baseStats === null) errors.push(`${from}: baseStats must be an object`);
  if (!Array.isArray(it.bonusAttributePool)) errors.push(`${from}: bonusAttributePool must be an array`);
  for (const b of it.bonusAttributePool ?? []) {
    if (!attributeIds.has(b.attribute)) errors.push(`${from}: bonus attribute "${b.attribute}" not found in attributes.json`);
    minMax(from, `bonus ${b.attribute}`, b.min, b.max);
    inRange01(from, `bonus ${b.attribute} chance`, b.chance);
  }
  if (maxBonus != null && (it.bonusAttributePool ?? []).length > 0 && maxBonus < 1) errors.push(`${from}: has a bonus pool but items.maxBonusAttributes is ${maxBonus}`);
  if (it.category === 'material' && stackMax != null && it.stackLimit > stackMax) errors.push(`${from}: stackLimit ${it.stackLimit} is above storage.materialStackSize ${stackMax}`);
  if (it.category !== 'equipment' && it.category !== 'rare' && 'equipmentType' in it) errors.push(`${from}: only equipment and equip-use rare items have equipmentType`);
  if ('scaling' in it && it.category !== 'equipment') errors.push(`${from}: only equipment has scaling`);

  if (it.category === 'equipment') {
    if (it.stackLimit !== 1) errors.push(`${from}: equipment must have stackLimit 1`);
    if (!slotTypes.has(it.equipmentType)) errors.push(`${from}: equipmentType "${it.equipmentType}" is not allowed in any slot of equipment-slots.json`);
    if (it.equipmentType === 'special-item') errors.push(`${from}: special-item belongs to rare items, not equipment`);
    if (!('upgradeGroup' in it)) errors.push(`${from}: equipment needs upgradeGroup (null for a backpack)`);
    else if (it.upgradeGroup === null) {
      if (it.equipmentType !== 'backpack') errors.push(`${from}: only a backpack may have upgradeGroup null`);
    } else if (typeof it.upgradeGroup !== 'string') errors.push(`${from}: upgradeGroup must be a string`);
    else itemGroups.add(it.upgradeGroup);
    const isWeapon = /weapon$/.test(it.equipmentType ?? '');
    if (isWeapon) {
      if (typeof it.baseStats?.damage !== 'number') errors.push(`${from}: weapon needs baseStats.damage`);
      if (!Array.isArray(it.scaling) || it.scaling.length === 0) errors.push(`${from}: weapon needs scaling attributes`);
    }
    for (const s of it.scaling ?? []) {
      if (!attributeIds.has(s.attribute)) errors.push(`${from}: scaling attribute "${s.attribute}" not found in attributes.json`);
      if ('recommendedValue' in s) errors.push(`${from}: scaling "${s.attribute}" uses recommendedValue, renamed requiredValue`);
      if (typeof s.requiredValue !== 'number' || s.requiredValue <= 0) errors.push(`${from}: scaling "${s.attribute}" needs a requiredValue above 0`);
    }
    if (it.equipmentType === 'backpack') {
      if (!isInt(it.bagCells, 1)) errors.push(`${from}: backpack needs bagCells, a whole number of 1 or more`);
      if (typeof it.stackLimitMultiplier !== 'number' || it.stackLimitMultiplier < 1) errors.push(`${from}: backpack needs stackLimitMultiplier of 1 or more`);
    } else if ('bagCells' in it || 'stackLimitMultiplier' in it) errors.push(`${from}: bagCells and stackLimitMultiplier belong to backpacks only`);
  }

  if (it.category === 'consumable') {
    const eff = it.effect;
    if (!eff || typeof eff.type !== 'string') errors.push(`${from}: consumable needs an effect with a type`);
    else if (eff.type === 'heal-over-time') {
      if (!potionTiers[eff.tier]) errors.push(`${from}: potion tier "${eff.tier}" not found in constants.potions.tiers`);
      if (it.requiredLevel !== 1) errors.push(`${from}: potions have no level requirement, requiredLevel must be 1`);
      inRange01(from, 'autoUseDefaultThreshold', it.autoUseDefaultThreshold);
      if ('amount' in eff || 'durationSeconds' in eff) errors.push(`${from}: potion amount and duration come from constants.potions.tiers, not the item`);
    } else if (eff.type === 'buff') {
      if (typeof eff.stat !== 'string' || typeof eff.amount !== 'number' || !(eff.durationSeconds > 0)) errors.push(`${from}: buff needs stat, amount and durationSeconds above 0`);
    }
  }

  if (it.category === 'rare') {
    if (!['equip', 'upgrade', 'consume'].includes(it.use)) errors.push(`${from}: use must be equip, upgrade or consume`);
    if (!it.effect || typeof it.effect.type !== 'string') errors.push(`${from}: rare item needs an effect with a type`);
    if (!Array.isArray(it.dropSources)) errors.push(`${from}: dropSources must be an array (empty when not dropped)`);
    for (const src of it.dropSources ?? []) {
      ref(from, 'dropSource', src, 'enemies');
      const t = enemyById[src]?.type;
      if (t && t !== 'boss' && t !== 'cursed-object') errors.push(`${from}: dropSource "${src}" is a ${t}, rare items drop from bosses and cursed objects only`);
    }
    if (it.use === 'equip' && it.equipmentType !== 'special-item') errors.push(`${from}: equip-use rare item needs equipmentType "special-item"`);
    if (it.use !== 'equip' && 'equipmentType' in it) errors.push(`${from}: only equip-use rare items have equipmentType`);
    if (it.effect?.type === 'upgrade-protection' && it.effect.consumedOnEveryAttempt !== C.upgrade?.protectionConsumedOnSuccess) {
      errors.push(`${from}: consumedOnEveryAttempt differs from constants.upgrade.protectionConsumedOnSuccess`);
    }
  }
}
// Every rare item that has drop sources is actually in a boss or cursed object drop table (not required for ticket-style items with none).
const droppable = new Set();
for (const d of tables['drop-tables'] ?? []) for (const x of [...(d.entries ?? []), ...(d.guaranteedPools ?? []).flatMap((p) => p.entries ?? [])]) droppable.add(`${d.id}:${x.itemId}`);
for (const it of tables['items'] ?? []) {
  if (it.category !== 'rare') continue;
  for (const src of it.dropSources ?? []) {
    const tid = enemyById[src]?.dropTableId;
    if (tid && !droppable.has(`${tid}:${it.id}`)) errors.push(`items.${it.id}: dropSource "${src}" does not list it in drop table "${tid}"`);
  }
}

// Equipment slots.
const slotById = Object.fromEntries((tables['equipment-slots'] ?? []).map((s) => [s.id, s]));
for (const s of tables['equipment-slots'] ?? []) ref(`equipment-slots.${s.id}`, 'twoHandedBlocks', s.twoHandedBlocks, 'equipment-slots');
for (const need of ['special-item-slot', 'backpack']) if (!slotById[need]) errors.push(`equipment-slots: missing slot "${need}"`);
if (slotById['rare-item']) errors.push('equipment-slots: slot "rare-item" was renamed special-item-slot');
if (slotById['special-item-slot'] && JSON.stringify(slotById['special-item-slot'].allowedTypes) !== '["special-item"]') errors.push('equipment-slots.special-item-slot: allowedTypes must be ["special-item"]');
if (slotById['backpack'] && JSON.stringify(slotById['backpack'].allowedTypes) !== '["backpack"]') errors.push('equipment-slots.backpack: allowedTypes must be ["backpack"]');

// Shops.
for (const s of tables['shops'] ?? []) {
  const from = `shops.${s.id}`;
  for (const row of s.itemList ?? []) {
    ref(from, 'itemId', row.itemId, 'items');
    const it = itemById[row.itemId];
    if (it && it.buyPrice === null) errors.push(`${from}: "${row.itemId}" is not purchasable (buyPrice null)`);
    else if (it && row.price !== it.buyPrice) errors.push(`${from}: price ${row.price} for "${row.itemId}" differs from its buyPrice ${it.buyPrice}`);
    if (it && it.category === 'rare') errors.push(`${from}: rare item "${row.itemId}" cannot be sold in a fixed shop`);
  }
}

// Upgrades: rows { id, itemGroup, level, goldCost, materials, statBonus }, levels 1..maxLevel per group.
const upgradeGroups = {};
const startAt = C.upgrade?.materialsStartAtLevel ?? Infinity;
for (const u of tables['upgrades'] ?? []) {
  const from = `upgrades.${u.id}`;
  (upgradeGroups[u.itemGroup] ??= []).push(u);
  if (!itemGroups.has(u.itemGroup)) errors.push(`${from}: itemGroup "${u.itemGroup}" is not the upgradeGroup of any equipment item`);
  for (const k of ['materialId', 'materialAmount']) if (k in u) errors.push(`${from}: "${k}" is gone, use materials`);
  if (!Array.isArray(u.materials)) { errors.push(`${from}: materials must be an array`); continue; }
  if (u.materials.length > 2) errors.push(`${from}: at most 2 materials per row`);
  const seen = new Set();
  for (const m of u.materials) {
    itemRef(from, 'material', m.itemId);
    if (itemById[m.itemId] && itemById[m.itemId].category !== 'material') errors.push(`${from}: "${m.itemId}" must be a material item`);
    if (!isInt(m.amount, 1)) errors.push(`${from}: material amount for "${m.itemId}" must be a whole number of 1 or more`);
    if (seen.has(m.itemId)) errors.push(`${from}: duplicate material "${m.itemId}"`);
    seen.add(m.itemId);
  }
  if (u.level < startAt && u.materials.length) errors.push(`${from}: level ${u.level} must be gold only (materials start at ${startAt})`);
  if (u.level >= startAt && u.materials.length < 1) errors.push(`${from}: level ${u.level} needs at least 1 material (materials start at ${startAt})`);
  if (typeof u.goldCost !== 'number' || u.goldCost < 0) errors.push(`${from}: goldCost must be 0 or more`);
  if (typeof u.statBonus !== 'number' || u.statBonus < 0) errors.push(`${from}: statBonus must be 0 or more`);
}
for (const g of itemGroups) if (!upgradeGroups[g]) errors.push(`upgrades: no rows for group "${g}" used by equipment`);
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

// Starting gear from constants.creation: empty, or valid ids in the right slots.
const creation = C.creation ?? {};
if (typeof creation.startingEquipment !== 'object' || creation.startingEquipment === null || Array.isArray(creation.startingEquipment)) errors.push('constants.creation: startingEquipment must be an object (empty for no starting gear)');
if (!Array.isArray(creation.startingItems)) errors.push('constants.creation: startingItems must be an array (empty for none)');
for (const [slot, itemId] of Object.entries(creation.startingEquipment ?? {})) {
  if (!slotById[slot]) errors.push(`constants.creation: startingEquipment slot "${slot}" not found in equipment-slots.json`);
  itemRef('constants.creation', `startingEquipment.${slot}`, itemId);
  const it = itemById[itemId];
  if (it && slotById[slot] && !(slotById[slot].allowedTypes ?? []).includes(it.equipmentType)) errors.push(`constants.creation: "${itemId}" does not fit slot "${slot}"`);
}
for (const s of creation.startingItems ?? []) {
  itemRef('constants.creation', 'startingItems', s.itemId);
  if (!isInt(s.quantity ?? 1, 1)) errors.push(`constants.creation: startingItems quantity for "${s.itemId}" must be a whole number of 1 or more`);
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
