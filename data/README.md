# Game data

All game content lives here as JSON tables (design [5.1](../design/05-dev-tools.md)). Changing a number here changes the game. Run `npm run validate:data` after editing.

Rules: every table except `constants.json` is an array of entries with a unique string `id`. Tables refer to each other by id.

| File | Design | Fields to include (from the design's **Data** lines) | State |
|---|---|---|---|
| `constants.json` | all | global constants. `null` means not decided yet. Sections `stats`, `progression`, `enemyScaling`, `proficiency`, `potions`, `creation` hold the core numbers | decided and default values filled |
| `items.json` | [2.1](../design/02-items-and-city.md), 2.6, 2.8 | the single items table: id, name, category (equipment, consumable, material, rare), size, stackLimit, requiredLevel, baseStats, bonusAttributePool (attribute, min, max, chance), buyPrice (null = not purchasable), sellPrice, icon. Equipment also `equipmentType`, `upgradeGroup` (null for a backpack), weapons `scaling` (attribute, requiredValue), backpacks `bagCells` and `stackLimitMultiplier`. Consumables have `effect` (potion: heal-over-time with a `tier` from `constants.potions.tiers`, plus autoUseDefaultThreshold; buff: stat, amount, durationSeconds). Rare items have `use` (equip, upgrade, consume), `effect`, `dropSources` (boss or cursed object ids), and `equipmentType: "special-item"` when equipped | slice filled (Mossfang Glade) |
| `equipment-slots.json` | 2.2 | slot list, allowed categories per slot, weapon scaling (attribute, requiredValue, penaltyCurve) | slice filled (Mossfang Glade) |
| `shops.json` | 2.5 | id, purpose, itemList, prices. Rare goods: rotationInterval, itemPool with weights, priceRange, itemsPerRotation | slice filled (Mossfang Glade) |
| `upgrades.json` | 2.7 | per upgrade group: id, itemGroup, level 1 to 9, goldCost, materials (list of itemId, amount; empty below `constants.upgrade.materialsStartAtLevel`, 1 or 2 entries from it), statBonus (10% of base stats per level) | slice filled (Mossfang Glade) |
| `areas.json` | [3.1](../design/03-world.md) | id, name, theme, levelRange, enemies (enemyId, spawnWeight), miniBoss/boss/cursedObject spawn chances, distanceFromCity (seconds), optional movementSecondsBetweenEnemies (overrides `constants.farming`) | slice filled (Mossfang Glade) |
| `teleporters.json` | 3.2 | destinations, fees | empty |
| `enemies.json` | 3.5 | id, name, level, type, health, damage, attackSpeed, defence, traits (id, value, magical), targetingMultiplier (1 to `constants.farming.targeting.maxMultiplier`; normal 2, mini-boss and boss 10), xpReward, moneyRange, dropTableId, areas. Baseline stats by level are in `constants.enemyScaling` | slice filled (Mossfang Glade) |
| `drop-tables.json` | 3.8 | id, entries (itemId, baseChance 0..1, minQuantity, maxQuantity), optional guaranteedPools (id, entries of itemId, weight, minQuantity, maxQuantity): every kill yields exactly one entry from each pool, chosen by weight, not level modified | slice filled (Mossfang Glade) |
| `attributes.json` | [4.2](../design/04-characters-and-progression.md) | id, name, feeds. Derived stat coefficients are in `constants.stats` | four decided attributes |
| `xp-table.json` | 4.3 | id, level, xpToNext (XP to go from that level to the next), levels 1 to 30 | default values filled |
| `spells.json` | 4.5 | id, kind, requiredLevel, manaCost, cooldown, effectPerRank, maxRank, rareItemPerRankAbove10 | slice filled (Mossfang Glade) |
| `proficiencies.json` | 4.6 | id, name, trainedBy. Gain per action, the diminishing curve, effect per point and title thresholds are in `constants.proficiency` | six skills named, each with a training action |
| `traits.json` | 4.7 | id, name, effect, magical | slice filled (Mossfang Glade) |
| `bestiary-thresholds.json` | 4.8 | kills needed per reveal | decided |

The validator checks references and ranges: there is no `consumables.json` or `rare-items.json` (it fails if they exist); enemy to drop table, area and traits; drop table and pool to item ids; area to enemy; shop, upgrade material, rare item drop source and spell item ids; creation constants (starting equipment and items empty or valid); min <= max; chances in 0..1; pool weights above 0; levels inside the area range. It also checks: potion tier exists and potion requiredLevel is 1; rare items have use, effect and dropSources that are bosses or cursed objects; backpacks have bagCells and stackLimitMultiplier >= 1; weapons use `requiredValue`; every equipment item has `upgradeGroup` and every group has upgrade rows for levels 1 to 9 (gold only below the material start level, 1 or 2 material items from it); targetingMultiplier within the ceiling; at least 2 normal enemies per level in each area's range; a mini-boss has a guaranteed pool with materials, a boss one with rare items; no `guaranteed: true` entries; slot names.

Slice conventions:
- One items table. `category` is equipment, consumable, material or rare. There is no starting gear: Rusty sword and Ragged tunic are ordinary drops and shop items, and a new character fights bare-handed.
- Potions have no level requirement (`requiredLevel` 1); higher tiers heal more. Amount and duration live in `constants.potions.tiers`. They queue, not stack (`constants.potions.stacking`). Effective stack limit with a backpack is floor(item.stackLimit x stackLimitMultiplier).
- Ordinary enemies drop potions, equipment, hide scrap (a plain filler) and upgrade materials at a very low chance (0.3% to 1%). The mini-boss drops a guaranteed pool of upgrade materials; the boss a guaranteed pool of rare items. Rare items drop only from bosses and cursed objects.
- Upgrade groups: one-handed-weapon, two-handed-weapon, body-armour, light-armour (helm, boots), jewellery (necklace). Each has its own four materials: +6, +7, +8 and +9 (+9 uses the +8 and +9 materials). Materials for +8 and +9 do not drop in the slice and wait for later areas.
- `areas.distanceFromCity` is seconds of walking (10). `movementSecondsBetweenEnemies` may override the farming constant per area; Area 1 does not set it.
- The rare goods shop is not in the slice.
See decisions S1 to S8 and the owner changes that followed.

Placeholder names used by the UI sketches (Warding Seal, Waystone, Tome of Insight, Arcane Shard, Scroll of Unlearning, Sigil of Embers, the eight sketch spells, the nine sketch areas) are partly in these tables now (Warding Seal, Tome of Insight, Arcane Shard, Sigil of Embers, three spells). See `design/06-ui-design-system.md`, "Assumed by the sketches".
