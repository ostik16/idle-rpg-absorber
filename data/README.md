# Game data

All game content lives here as JSON tables (design [5.1](../design/05-dev-tools.md)). Changing a number here changes the game. Run `npm run validate:data` after editing.

Rules: every table except `constants.json` is an array of entries with a unique string `id`. Tables refer to each other by id.

| File | Design | Fields to include (from the design's **Data** lines) | State |
|---|---|---|---|
| `constants.json` | all | global constants. `null` means not decided yet. Sections `stats`, `progression`, `enemyScaling`, `proficiency`, `potions`, `creation` hold the core numbers | decided and default values filled |
| `items.json` | [2.1](../design/02-items-and-city.md) | id, name, category, size, stackLimit, requiredLevel, baseStats, bonusAttributePool (attribute, min, max, chance), buyPrice, sellPrice, icon | empty |
| `equipment-slots.json` | 2.2 | slot list, allowed categories per slot, weapon scaling (attribute, recommendedValue, penaltyCurve) | empty |
| `shops.json` | 2.5 | id, purpose, itemList, prices. Rare goods: rotationInterval, itemPool with weights, priceRange, itemsPerRotation | empty |
| `consumables.json` | 2.6 | effectType, amount, duration, tickRate, autoUseDefaultThreshold. Tick rate and reference tiers are in `constants.potions` | empty |
| `upgrades.json` | 2.7 | per item group: level, goldCost, materialId, materialAmount, statBonus | empty |
| `rare-items.json` | 2.8 | use (equip, upgrade, consume), effect, dropSources | empty |
| `areas.json` | [3.1](../design/03-world.md) | id, name, theme, levelRange, enemies (enemyId, spawnWeight), miniBoss/boss/cursedObject spawn chances, distanceFromCity | empty |
| `teleporters.json` | 3.2 | destinations, fees | empty |
| `enemies.json` | 3.5 | id, name, level, type, health, damage, attackSpeed, defence, traits (id, value, magical), xpReward, moneyRange, dropTableId, areas. Baseline stats by level are in `constants.enemyScaling` | empty |
| `drop-tables.json` | 3.8 | id, entries (itemId, baseChance 0..1, minQuantity, maxQuantity) | empty |
| `attributes.json` | [4.2](../design/04-characters-and-progression.md) | id, name, feeds. Derived stat coefficients are in `constants.stats` | four decided attributes |
| `xp-table.json` | 4.3 | id, level, xpToNext (XP to go from that level to the next), levels 1 to 30 | default values filled |
| `spells.json` | 4.5 | id, kind, requiredLevel, manaCost, cooldown, effectPerRank, maxRank, rareItemPerRankAbove10 | empty |
| `proficiencies.json` | 4.6 | id, name, trainedBy. Gain per action, the diminishing curve, effect per point and title thresholds are in `constants.proficiency` | six skills named, each with a training action |
| `traits.json` | 4.7 | id, name, effect, magical | empty |
| `bestiary-thresholds.json` | 4.8 | kills needed per reveal | decided |

The validator also checks references that exist today: enemy to drop table, drop table to item, area to enemy.

Placeholder names used by the UI sketches (Warding Seal, Waystone, Tome of Insight, Arcane Shard, Scroll of Unlearning, Sigil of Embers, the eight sketch spells, the nine sketch areas) are not in these tables yet. See `design/06-ui-design-system.md`, "Assumed by the sketches".
