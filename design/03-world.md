# 3. World

Where the character farms: areas, travel, enemies, combat and drops.

Template per system: **Purpose**, **Rules** (decided), **Proposed** (not yet decided), **Data**, **Open questions**. [Added] = not in the original brief.

---

## 3.1 Area System

**Purpose.** Places where enemies spawn continuously.

**Rules.**
- Each area has an enemy level range. Ranges overlap: area 1 is levels 1-5, area 2 is 3-8, area 3 is 5-10.
- Areas go up to level 30.
- No final boss.
- Each area has a small chance to spawn mini-bosses, bosses or cursed objects.
- No unlock conditions. A character can enter any area, but will probably die if it is too weak.
- Nine areas cover levels 1 to 30, from level 1-5 up to level 25-30 (default, revisit after playtesting).
- Magical traits belong to enemies, not areas. Areas can still have their own visual or thematic identity.

**Data.** id, name, theme, level range, enemy list with spawn weights, mini-boss/boss/cursed object spawn chances, distance from city.

---

## 3.2 Travel System

**Purpose.** Moving between the city and areas.

**Rules.**
- Travel takes real time based on distance. The endurance stat sets travel speed (4.2).
- Travel can be skipped with a rare item (2.8).
- A teleporter in the city moves the character to far areas for a fee.
- Returning to the city restocks used consumables for a fee. Restocking is not free.

**Proposed.**
- Automatic return to the city when the inventory is full, potions run out, or health drops below a threshold. After restocking, the character goes back to the same area.
- If there is not enough gold to restock, the character restocks what it can afford.

**Data.** distance between city and each area, teleporter destinations and fees, return triggers and their defaults.

---

## 3.3 Farming System

**Purpose.** The core idle loop.

**Loop.** Travel to area → move to enemy → fight → loot → repeat → return when a trigger fires → restock → travel back.

**Rules.**
- Between fights the character moves to the next enemy. This takes time and trains endurance.
- The player can target one enemy type. This means fewer fights per hour, because the character has to search for that enemy. Targeting doubles the time between fights (default, revisit after playtesting).

**Data.** movement time between enemies, extra time when targeting.

---

## 3.4 Offline Progress [Added]

**Purpose.** An idle game has to keep progressing when the browser is closed.

**Rules.**
- All characters progress offline (4.1).
- Offline efficiency is lower than active play, but not by much: 90% of active kill rate (default, revisit after playtesting).
- The offline cap is 12 hours (default, revisit after playtesting).
- Offline time has a cap, so one character cannot collect too much gold. The cap is set through playtesting.
- Proficiencies grow offline at a reduced rate: 50% of the active rate (default, revisit after playtesting).

**Proposed.**
- On return, the game calculates the time away instead of simulating every fight. It estimates kills per hour from the character's stats and the area, then rolls XP, drops and absorption in bulk.
- A summary screen on return: XP, levels, loot, absorption gained, per character.

**Data.** offline efficiency %, offline proficiency rate %, offline cap (hours).

---

## 3.5 Enemy System

**Purpose.** What the character fights.

**Rules.**
- Each enemy has fixed stats and a level.
- Types: normal, mini-boss, boss, cursed object.
- A cursed object must be destroyed and spawns enemies that defend it.
- Each enemy can have traits. Each trait is magical (absorbable) or physical.

- Baseline stats by level (default, revisit after playtesting). Enemies keep fixed stats in the data table; these formulas give the starting point an author tunes from and the line the balance tools compare against (`constants.enemyScaling`):

| Stat | Formula | Level 1 | Level 5 | Level 10 | Level 20 | Level 30 |
|---|---|---|---|---|---|---|
| Health | 24 × 1.11^(L−1) | 24 | 36 | 61 | 174 | 495 |
| Damage per hit | 5 × 1.07^(L−1) | 5.0 | 6.6 | 9.2 | 18.1 | 35.6 |
| Defence | 0.5 × (L−1)^1.2 | 0 | 2.6 | 7.0 | 17.1 | 28.4 |
| Attack speed (per second) | 0.8 + 0.015 × (L−1) | 0.80 | 0.86 | 0.94 | 1.09 | 1.24 |
| XP per kill | 10 × 1.1^(L−1) | 10 | 15 | 24 | 61 | 159 |
| Gold per kill (average) | 5 × 1.1^(L−1), range ±50% | 5 | 7 | 12 | 31 | 79 |

- Money is not reduced by level gap (3.8).
- Check: a level 1 character with STR 8, DEX 6, VIT 6 and a 3-damage starter sword hits a level 1 enemy for 8.8 and kills it in 3 hits, about 3 seconds, and loses about 8% of its health (counting 1 defence from the starter tunic). A level 5 enemy takes 6 hits.

**Proposed.**
- Cursed objects have health but no attack. They spawn waves of defenders until destroyed and drop bonus loot when destroyed.

**Data.** id, name, level, type, health, damage, attack speed, defence, traits (id, value, magical yes/no), XP reward, money range, drop table id, areas. Baseline scaling coefficients are in `constants.enemyScaling` and `constants.progression`.

---

## 3.6 Combat System [Added]

**Purpose.** Resolves fights automatically. Gear, attributes, proficiency, spells and absorption all feed into it.

**Rules.**
- Real-time. Attack speed decides how often each side attacks.
- Damage = attacker's damage − defender's defence, as flat numbers. May change later.
- A hit always counts for at least 1 damage (default, revisit after playtesting).
- Critical hits deal 1.5 times damage (default, revisit after playtesting).
- Combat resolves in ticks of 100 ms (default, revisit after playtesting).
- A critical hit multiplies the damage dealt, after defence and the minimum, by 1.5. Attack intervals are rounded to whole ticks, at least one (default, revisit after playtesting).

**Proposed.**
- A minimum damage of 1, so a hit always counts.
- Critical hits multiply damage (crit rate exists through boosts, 2.6).
- Spells auto-cast in a priority order set by the player, when mana allows.
- Absorbed traits apply on hit, for example life steal heals.
- Every combat event feeds proficiency: hitting with a weapon trains that weapon type, taking a hit trains toughness.

**Data.** global formula constants (minimum damage, crit multiplier, tick length).

---

## 3.7 Death and Recovery [Added]

**Purpose.** What happens at 0 health. The player is often away, so the outcome has to be safe.

**Rules.**
- The character returns to the city and is back on its feet after 2 minutes (default, revisit after playtesting).
- It keeps its inventory and equipment. Nothing is lost except XP (default, revisit after playtesting).
- A random XP loss between 0% and 25%, taken from the XP earned in the current level.
- A character can never lose a level. At most, XP drops to the start of the current level.
- An XP protection item prevents the loss (2.8).

**Proposed.**
- The auto-retreat threshold (3.2) lets players avoid death.

**Data.** XP loss range (0-25%).

---

## 3.8 Drop Rate System

**Purpose.** Decides what an enemy drops and how often.

**Rules.**
- Only item drops are affected by level gap. XP and money are not, because high-level characters already earn far more from high-level enemies.
- Each level the character is above the enemy lowers the level modifier by 0.1, which is 10% of the base chance, not 10 points subtracted from it (a 5% drop at 1 level above is 4.5%, not 4.9%). At 10 or more levels above, the drop rate is 0%.
- Enemy 1-19 levels above the character: base drop rate.
- Enemy 20 or more levels above the character: 0%.
- Bosses, mini-bosses and cursed objects drop rare items (2.8).
- Drop rates are shown to the player (revealed through the bestiary, 4.8).

**Formula.**
- final chance = base chance × level modifier
- diff = character level − enemy level
- diff ≥ 0: level modifier = max(0, 1 − 0.1 × diff)
- −19 ≤ diff ≤ −1: level modifier = 1
- diff ≤ −20: level modifier = 0

Absorption uses a different, gentler curve (4.7).

**Proposed.**
- Each enemy has a drop table: a list of entries with item, base chance and quantity range.
- Money is a separate roll.
- Bosses get one guaranteed drop plus normal rolls.
- The drop rate shown to the player already includes their level modifier, so they can see when a character has outgrown an enemy.

**Data.** drop table id, entries (item id, base chance, min/max quantity).
