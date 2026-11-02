# Idle RPG Absorber: Design Document

## 1. Introduction

Idle RPG Absorber is a browser-based idle RPG. Farming and grinding are the core of the game.

You create a character at level 1 and send it into an area. It fights on its own. You decide where it farms, how it grows, and what it becomes.

### Core pillars

**1. Growth through doing.**
Characters improve by acting, as in Kenshi. Fighting raises weapon proficiency, taking hits raises toughness, moving raises endurance. Hidden skills (unarmed, one-handed, two-handed, toughness, endurance, speed) feed back into damage, attack speed, movement speed and health.

**2. Growth through choice.**
Each level gives 1 skill point for spells. It also gives 3 character points, awarded at 25%, 50% and 75% of the level. A character can be a balanced all-rounder or a specialist who stacks one attribute for massive damage.

**3. Absorption.**
Characters can absorb the magical strengths of normal enemies, such as life steal or magic affinities. Each kill grants 1% of the enemy's value, up to that value.

**4. Areas, enemies and loot.**
Areas up to level 30, each with a range of enemy levels. Areas can spawn bosses, mini-bosses or cursed objects. Enemies drop money, equipment and upgrade materials. Bosses, mini-bosses and cursed objects drop rare items.

**5. Gear that cannot be fully maxed.**
Upgrades go to +9. Early levels cost only money, later levels need rare materials, and a failed upgrade destroys the item. One playthrough or one character cannot max every item.

**6. Many characters, one warehouse.**
Players create multiple characters that all farm at the same time, and move items between them through a shared warehouse with limited space.

**7. Low levels matter.**
Item drop rates fall by 10 percentage points for each level the character is above the enemy. The materials high-level gear needs only drop from low-level enemies, so players must farm with low-level characters and pass the results up.

### Design intent

The best farmer is often the weakest character. The roster is the build, and progression is spread across many characters instead of one.

### Document map

| Section | Systems |
|---|---|
| 2. Items and City | Items, Equipment, Inventory, Storage, Shops, Consumables, Upgrading, Rare Items, Economy |
| 3. World | Areas, Travel, Farming, Offline Progress, Enemies, Combat, Death, Drop Rates |
| 4. Characters and Progression | Character Management, Attributes, Leveling, Character Points, Skill Points and Spells, Proficiency, Absorption, Bestiary |
| 5. Developer Tools and Data | Data Tables, Content Editor, Balance Tools, Debug Tools, Save System |

Detailed rules and open questions for each system live in its section.
