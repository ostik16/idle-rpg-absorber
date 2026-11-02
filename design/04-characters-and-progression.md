# 4. Characters and Progression

Managing multiple characters and improving each one.

Template per system: **Purpose**, **Rules** (decided), **Proposed** (not yet decided), **Data**, **Open questions**. [Added] = not in the original brief.

---

## 4.1 Character Management

**Purpose.** Create, switch between and manage multiple characters.

**Rules.**
- Players can create multiple characters.
- All characters farm at the same time, online and offline.
- Extra character slots unlock when a character reaches level 30. This will change as content is added.
- All characters share the warehouse.

**Proposed.**
- A roster screen showing each character's level, current area and status (farming, travelling, in city, dead).
- When a character is deleted, its inventory and equipment go to the warehouse if there is space.

**Data.** starting slots, slot unlock conditions.

**Open questions.**
- How many slots unlock at level 30: one, or several?

---

## 4.2 Attributes and Derived Stats

**Purpose.** The numbers that define a character.

**Rules.**
- Visible stats: health, mana, endurance.
- Endurance is not used up. It sets how fast the character travels between locations.
- Main attributes (final):

| Attribute | Feeds |
|---|---|
| Strength | physical damage |
| Dexterity | attack speed, critical chance |
| Vitality | health, defence |
| Intelligence | mana, spell damage |

- Character points (4.4) raise attributes. Equipment and proficiency add bonuses on top.

**Data.** attribute list, derived stat formulas.

---

## 4.3 Leveling System

**Purpose.** Long-term progression and the source of skill and character points.

**Rules.**
- Characters gain XP from kills.
- Each level grants 1 skill point and 3 character points (4.4).
- Level cap 30. It will rise with new content.
- No XP penalty for level gap. Rising XP requirements already push characters to higher-level enemies: a low-level enemy's XP becomes too small to progress at a normal rate.

**Data.** XP required per level.

---

## 4.4 Character Point System

**Purpose.** Manual stat building.

**Rules.**
- 3 character points per level, awarded at 25%, 50% and 75% of the level.
- Spent on attributes (4.2). A character can be balanced or specialise in one attribute.
- Respec only with a rare item (2.8).

---

## 4.5 Skill Point and Spell System

**Purpose.** Active abilities.

**Rules.**
- 1 skill point per level, spent on spells.
- One shared spell pool for all characters. No classes.
- A flat list of spells, in three kinds: offensive, defensive, support.
- Spells can be raised to rank 10 with skill points. Ranks above 10 need rare items (2.8).
- Spell respec costs gold scaled by character level, or a rare item.

**Proposed.**
- Spells auto-cast in a priority order set by the player (3.6).
- Absorbed magical traits empower related spells, for example a fire affinity boosts fire spells. This links absorption and spells.

**Data.** spell id, kind (offensive, defensive, support), required level, mana cost, cooldown, effect per rank, max rank, rare item needed per rank above 10.

**Open questions.**
- Max rank above 10?
- Respec gold formula.

---

## 4.6 Proficiency System

**Purpose.** Improve by doing.

**Rules.**
- Hidden skills are raised by actions: fighting raises the weapon skill in use, taking hits raises toughness, moving raises endurance.
- Hidden skills: unarmed, one-handed, two-handed, toughness, endurance, speed. (Lock picking and sneak removed for now.)
- They improve damage, attack speed, movement speed, health and more.
- Gains slow down as a skill rises, relative to the enemy's level. Fighting weak enemies trains a high skill very little.
- Exact values are hidden. The UI shows a title for each skill (for example Novice, Adept, Expert, Master).

**Proposed.**
- Small "+" notices when a skill reaches a new title.

**Data.** skill id, training actions, gain per action, diminishing-return curve against enemy level, effect per point, title thresholds.

---

## 4.7 Absorption System

**Purpose.** Gain magical strengths from enemies.

**Rules.**
- Only magical traits can be absorbed, such as life steal or magic affinities. Physical traits cannot.
- Only normal enemies can be absorbed. Bosses, mini-bosses and cursed objects cannot.
- Each kill grants 1% of the enemy's trait value.
- A trait can never exceed the value of the enemy it is absorbed from.
- Example: an enemy has 10% life steal. Each kill grants 0.1%. After 100 kills the character has 10% and cannot gain more from that enemy. Only an enemy with higher life steal can raise it further.
- Level gap reduces absorption with diminishing steps: each level the character is above the enemy multiplies the gain by 0.9. It never reaches 0.
- An absorbed trait can be forgotten with a rare item (2.8).

**Formula.**
- diff = character level − enemy level
- diff ≥ 0: absorption modifier = 0.9^diff

| Levels above enemy | Absorption rate |
|---|---|
| 0 | 100% |
| 1 | 90% |
| 5 | 59% |
| 10 | 35% |
| 20 | 12% |

Unlike drops, a high-level character can still absorb from low-level enemies, just slowly.

**Proposed.**
- Absorption is tracked per character, per trait.

**Data.** trait id, name, effect, magical flag. Absorption factor (0.9) in the global constants.

**Open questions.**
- Does absorption change when the enemy is above the character?
- Do cursed-object defenders count as normal enemies?

---

## 4.8 Bestiary [Added]

**Purpose.** A record of every enemy met. Information unlocks with kills, so the player learns an enemy by farming it.

**Rules.**
- Kills are counted per character.
- Unlocked information is shared across all characters. Once any character reaches a threshold, every character sees it.

| Kills | Revealed |
|---|---|
| 1 | name, level, areas |
| 10 | stats |
| 25 | traits and absorption progress |
| 50 | drop list |
| 100 | exact drop rates |

**Data.** reveal thresholds. Everything else is read from the enemy, trait and drop tables.
