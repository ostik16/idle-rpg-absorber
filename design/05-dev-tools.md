# 5. Developer Tools and Data

**Goal.** See every item, enemy and related value in one place and tweak it without touching code.

[Added] = not in the original brief.

---

## 5.1 Data-Driven Content

**Purpose.** All game content lives in data tables, not in code. Changing a number in a table changes the game.

**Rules.**
- Tables are JSON files, loaded by the browser game.
- Each content type is a table. Each entry has a unique id.
- Tables refer to each other by id. For example, an enemy has a drop table id, and the drop table lists item ids.
- Every item lives in one items table, with a category (equipment, consumable, material, rare) and fields for its effect. There is no separate consumables or rare items table, so nothing is defined twice.

**Tables.**

| Table | Defined in |
|---|---|
| Items (equipment, consumables 2.6, materials and rare items 2.8, backpacks) | 2.1 |
| Equipment slots and weapon scaling | 2.2 |
| Shops (incl. rare goods rotation pool) | 2.5 |
| Upgrade tables (per equipment type and level) | 2.7 |
| Areas | 3.1 |
| Teleporter destinations | 3.2 |
| Enemies | 3.5 |
| Drop tables | 3.8 |
| Attributes | 4.2 |
| XP table | 4.3 |
| Spells | 4.5 |
| Proficiencies | 4.6 |
| Traits | 4.7 |
| Bestiary thresholds | 4.8 |
| Global constants | all (10-point drop falloff, 0.9 absorption factor, 1% absorption per kill, upgrade chance 90% × 0.9, warehouse max stack 100, base bag max stack 20, health regeneration, respawn time and health, slot limits, death XP loss 0-25%, base bag cells, weapon penalty, targeting multipliers, offline efficiency, …) |

**Proposed.**
- Keep the JSON files in a version-controlled repository, so every balance change is tracked.

---

## 5.2 Content Editor

**Purpose.** A separate dev-only tool to browse and edit all tables.

**Rules.**
- Separate from the game. It reads and writes the same JSON files.

**Proposed.**
- One list per table with search, filter and sort.
- Edit values inline.
- Show references: which enemies drop this item, which areas contain this enemy.
- Duplicate an entry to make variants quickly.
- Validation: broken ids, missing values, impossible numbers (for example a drop chance above 100% or a bonus range with min above max).

---

## 5.3 Balance Tools

**Purpose.** Check what a change does before players find out.

**Proposed.**
- Drop calculator: pick a character level and an area, get expected drops per hour.
- Combat simulator: pick a build and an enemy, get time to kill and win rate.
- Progression curve: time to reach each level.
- Economy report: gold in and out per hour (2.9).
- Upgrade simulator: expected gold, materials and destroyed items to reach each upgrade level (2.7).
- Offline report: what a character earns at the offline cap (3.4).

---

## 5.4 Debug Tools

**Purpose.** Test any state quickly.

**Proposed.**
- Set level, attributes, proficiencies.
- Give items, materials and gold.
- Spawn an enemy, mini-boss, boss or cursed object.
- Force a rare goods shop rotation (the in-game forced rotation costs a Rotation token or gold, 2.5).
- Time skip, to test offline progress (3.4).
- Game speed multiplier.

---

## 5.5 Save System [Added]

**Purpose.** Store progress in the browser.

**Rules.**
- Local only for now.

**Proposed.**
- Export and import, so a player can back up or move a save.
- Save version number, so old saves can be migrated when data tables change.
