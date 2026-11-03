# 4. Characters and Progression

Managing multiple characters and improving each one.

Template per system: **Purpose**, **Rules** (decided), **Proposed** (not yet decided), **Data**, **Open questions**. [Added] = not in the original brief.

---

## 4.1 Character Management

**Purpose.** Create, switch between and manage multiple characters.

**Rules.**
- Players can create multiple characters.
- All characters farm at the same time, online and offline.
- Players start with 4 character slots (`constants.characters.startingSlots`).
- When a character reaches level 20 it receives a ticket that unlocks a new character slot. Each character gives one ticket, once (`constants.characters`). Assumed: the ticket is applied automatically, it is not a bag item. This will change as content is added.
- All characters share the warehouse.
- Character creation:
  - The player types a name (1 to 16 characters, unique in the roster, case-insensitive). There are no free points to spend.
  - Every attribute starts at the default of 5 (total 20). There is no class, no race and no weapon choice.
  - A new character is level 1 with 0 gold, no gear and no items. Everything is farmed. Assumed: this includes potions, so no starting potions.
  - The first enemies must be killable bare-handed. Unarmed damage is `constants.stats.unarmedDamage` (2).
  - Example: all attributes 5 gives 6 damage unarmed (1 + 0.6 × 5 + 2), 0.9 attacks per second and 70 health.

**Proposed.**
- A roster screen showing each character's level, current area and status (farming, travelling, in city, dead).
- When a character is deleted, its inventory and equipment go to the warehouse if there is space.

**Data.** starting slots, slot ticket level and tickets per character (`constants.characters`), base attributes, free points (0), name length, starting gold, gear and items (`constants.creation`).

---

## 4.2 Attributes and Derived Stats

**Purpose.** The numbers that define a character.

**Rules.**
- Visible stats: health, mana. Endurance was a visible stat that set travel speed. It is now redundant with the speed skill (4.6) and is under review: the owner decides whether to drop it or give it another job (decisions I1). Until then it has no effect.
- Travel and between-enemy movement time come from the speed skill, not from a visible stat.
- Main attributes (final):

| Attribute | Feeds |
|---|---|
| Strength | physical damage |
| Dexterity | attack speed, critical chance |
| Vitality | health, defence |
| Intelligence | mana, spell damage |

- Character points (4.4) raise attributes. Equipment and proficiency add bonuses on top.
- Derived stat formulas. STR, DEX, VIT and INT are the attribute totals; gear and proficiency are added as shown:

| Stat | Formula | At 5 / at 50 points |
|---|---|---|
| Physical damage per hit | (1 + 0.6 × Strength + weapon damage × weapon penalty multiplier) × (1 + weapon proficiency bonus). Unarmed uses `unarmedDamage` as weapon damage | 4 / 31 (plus weapon) |
| Attack speed (attacks per second) | (0.8 + 0.02 × Dexterity) × (1 + weapon-style bonus + combat bonus) | 0.9 / 1.8 |
| Attack interval | 1000 ms ÷ attack speed, rounded to a whole 100 ms tick, at least one tick | 1100 ms / 600 ms (at 1.8, 556 ms is 5.6 ticks) |
| Critical chance | 2% + 0.2% × Dexterity + bonus, capped at 50% | 3% / 12% |
| Health | (30 + 8 × Vitality) × (1 + toughness bonus) + gear | 70 / 430 |
| Defence | 0.25 × Vitality + gear | 1.25 / 12.5 |
| Mana | 20 + 4 × Intelligence + gear | 40 / 220 |
| Spell damage | spell damage × (1 + 0.02 × Intelligence) | ×1.10 / ×2.00 |
| Movement speed | 1 + 0.005 × speed skill points | ×1.025 / ×1.25 |

- The weapon penalty (2.2) is assumed to apply to the weapon's own damage ("1% of the weapon's stats"), then the weapon proficiency bonus (4.6) multiplies the total. Movement speed divides travel time and the time between enemies (3.3). Gear is meant to give most of a character's damage and defence: as a target, the weapon at required level L has about 3 + 1.8 × (L − 1) damage and a full set of armour adds about 1 + 0.9 × (L − 1) defence.

**Data.** attribute list, derived stat formulas (`constants.stats`).

---

## 4.3 Leveling System

**Purpose.** Long-term progression and the source of skill and character points.

**Rules.**
- Characters gain XP from kills.
- Each level grants 1 skill point and 3 character points (4.4).
- Level cap 30. It will rise with new content.
- No XP penalty for level gap. Rising XP requirements already push characters to higher-level enemies: a low-level enemy's XP becomes too small to progress at a normal rate.
- XP to go from level L to L + 1 is about 100 × L^1.5 × 1.1^(L−1), rounded to 3 significant figures, and stored as a table in `data/xp-table.json`. It is built so a level takes about 10 kills of a same-level enemy at level 1, 110 at level 5, 310 at level 10, 900 at level 20 and 1,560 at level 29.
- XP per kill is 10 × 1.1^(L−1) for an enemy of level L, rounded (3.5). It does not depend on the character's level.

| Level | XP to next level | XP per kill of a same-level enemy | Kills |
|---|---|---|---|
| 1 | 100 | 10 | 10 |
| 5 | 1,640 | 15 | 110 |
| 10 | 7,460 | 24 | 311 |
| 20 | 54,700 | 61 | 897 |
| 29 | 225,000 | 145 | 1,563 |
| 30 | 261,000 | 159 | 1,642 |

- Total XP from level 1 to level 30 is about 1.49 million. The times below assume 12 seconds per kill (travel included). Movement is now 6 seconds by default (3.3), so a kill takes nearer 10 seconds and levels come about 15% faster; the balance tools should re-run this. At 12 seconds, a level takes 2 minutes at level 1, 20 minutes at level 5, an hour at level 10 and 5 hours near the cap.
- Area 1 (levels 1-5, an average kill gives about 12 XP) is outgrown at about level 6 to 8, where a level takes 40 to 70 minutes there. At level 20, a level 3 enemy needs 4,559 kills for a level, five times the kills of a level 20 enemy.
- Level cap is 30. The table has a level 30 row for when the cap is raised.

**Data.** XP required per level (`data/xp-table.json`), XP reward base and growth (`constants.progression`).

---

## 4.4 Character Point System

**Purpose.** Manual stat building.

**Rules.**
- 3 character points per level, awarded at 25%, 50% and 75% of the level.
- The points are awarded while progressing through a level: one point each when XP first reaches 25%, 50% and 75% of that level's XP, so a level 1 character has 3 points before level 2 and 87 by level 30.
- A point is never awarded twice. XP lost on death cannot fall below the highest mark already passed in the level (3.7).
- Characters start with no free points; attributes start at 5 (4.1).
- Spent on attributes (4.2). A character can be balanced or specialise in one attribute.
- Respec only with a rare item (2.8).

---

## 4.5 Skill Point and Spell System

**Purpose.** Active abilities.

**Rules.**
- 1 skill point per level, spent on spells.
- One shared spell pool for all characters. No classes.
- A flat list of spells, in three kinds: offensive, defensive, support.
- Spells can be raised to rank 10 with skill points. Ranks above 10 need rare items (2.8), up to rank 20.
- Spell respec costs gold scaled by character level (300 gold × level), or a rare item. The formula may be adjusted by the economy.

**Proposed.**
- Spells auto-cast in a priority order set by the player (3.6).
- Absorbed magical traits empower related spells, for example a fire affinity boosts fire spells. This links absorption and spells.

**Data.** spell id, kind (offensive, defensive, support), required level, mana cost, cooldown, effect per rank, max rank, rare item needed per rank above 10.

---

## 4.6 Proficiency System

**Purpose.** Improve by doing.

**Rules.**
- Hidden skills are raised by actions: fighting raises the weapon skill in use and the combat skill, taking hits raises toughness, moving raises speed.
- Hidden skills: unarmed, one-handed, two-handed, toughness, speed, combat. (Lock picking and sneak removed for now. Endurance is removed from the skill list pending the owner's decision, I1.)
- Speed is trained by moving, between locations and between enemies. It lowers the time to travel between locations and enemies.
- Combat is trained by attacking, with any weapon or none. Attack speed grows with fighting: it comes from the weapon-style proficiency in use plus the combat skill.
- They improve damage, attack speed, movement speed, health and more.
- Gains slow down as a skill rises, relative to the enemy's level. Fighting weak enemies trains a high skill very little.
- Points run from 0 to 100. Each action adds gain = G × min(1, A ÷ R)², where A is the level of the enemy fought or hit by (for moving, the level of the area), R = max(1, 0.3 × points) is the enemy level the skill is at home with, and G is the gain per action. Training against enemies at level R or above gives the full gain. A skill at 90 points (R = 27) fighting level 9 enemies gains a ninth of G.
- Gain per action G: weapon skills 0.003 per hit, toughness 0.003 per hit taken, combat 0.0015 per attack, speed 0.001 per second moved. Offline gain is 50% (3.4). In round numbers, a weapon skill takes about 35 hours of hitting at the right level to reach 100.
- Effect per point: one-handed, two-handed and unarmed +0.3% damage with that weapon type and +0.1% attack speed; combat +0.1% attack speed (no damage effect); toughness +0.3% health; speed +0.5% movement speed. At 100 points that is +30% damage, +30% health, +50% movement speed, and +10% attack speed from the weapon style plus +10% from combat.
- Exact values are hidden. The UI shows a title for each skill (Novice, Apprentice, Adept, Expert, Master). Titles start at 0, 15, 35, 60 and 85 points on a 0 to 100 scale.

**Proposed.**
- Small "+" notices when a skill reaches a new title.

**Data.** skill id, training actions, gain per action, diminishing-return curve against enemy level, effect per point, title thresholds. The numbers are in `constants.proficiency`.

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
- When the enemy is above the character, absorption works as usual: modifier 1, no penalty and no bonus.
- Defenders spawned by a cursed object are normal enemies and can be absorbed. The cursed object itself cannot.
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
