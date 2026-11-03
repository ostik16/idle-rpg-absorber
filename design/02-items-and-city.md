# 2. Items and City

The city is the hub. Characters return here to restock, buy, upgrade, sell and store. Each service is its own shop or building.

Each system uses the same template: **Purpose**, **Rules** (decided), **Proposed** (suggestions, not yet decided), **Data** (what the dev tools need), **Open questions**. Systems marked [Added] were not in the original brief.

---

## 2.1 Item System [Added]

**Purpose.** One shared definition for everything that can drop, be bought, be equipped or be stored. Every other system in this document reads from it.

**Rules.**
- Categories: equipment, consumable, material (upgrade materials) and rare. Money is not an item.
- Every item lives in one items table (5.1), with a category and fields for its effect. Consumables (2.6) and rare items (2.8) are design sections only; they are stored in that table.
- No rarity tiers. "Rare items" is a category, not a tier (2.8).
- Each piece of equipment has a required level to equip. Most follow steps of 1, 5, 10, 15, … but an item can have any level. Potions and other consumables have no required level (2.6).
- The gap between item levels must be large enough that upgrading each item is worth it before replacing it.
- Base values are fixed per item (attack range, defence, …).
- Items can also have bonus attributes. Each bonus has a fixed range, and the actual value is rolled within that range when the item drops.
- Each item has a size in slots and is either stackable or not. There is no per-item stack limit: the container sets the max stack, and all stackable items stack to it (2.3, 2.4).
- An item can roll up to 3 bonus attributes for now. Each pool entry rolls on its own chance.
- More bonus attributes will be added later, together with two rare items: one adds attribute slots to an item and one rerolls all its bonus attributes at once (2.8).

**Data.** id, name, category (equipment, consumable, material, rare), size (slots), stackable (yes/no), required level, base stats, bonus attribute pool (attribute, min, max, chance), buy price, sell price, icon. Effect fields by category: the slot types an equipment item fits, the effect of a consumable or rare item (amount, duration, use), backpack cells and backpack max stack.

---

## 2.2 Equipment System [Added]

**Purpose.** What the character wears. Most combat stats come from equipped items.

**Rules.**
- Items require only a level.
- Each weapon benefits from different attributes and lists a required value for each. A character below a required value gets a penalty with that weapon. There is no hard cut.
- Penalty: each point a scaling attribute is below the weapon's required value costs 1% of the weapon's stats, added up across all its scaling attributes and capped at 50%. Multiplier = 1 − min(50%, 1% × total missing points). The weapon never drops below half strength.
- Example: a weapon requiring 20 Strength and 20 Dexterity, used with 10 Strength and 15 Dexterity, is 10 + 5 = 15 points short, so it works at 1 − 0.15 = 85%. At 50 or more missing points it stays at 50%. A weapon with no scaling, or no weapon, has no penalty.
- Slots: main hand, off hand, head, body, hands, legs, feet, necklace, ring 1, ring 2 (default, revisit after playtesting), the special-item-slot and the backpack.
- The special-item-slot accepts only items that can be placed there, usually rare items (2.8).
- The backpack slot holds a backpack. A backpack adds bag cells and sets the bag's max stack, so a better backpack allows larger stacks of potions and materials (2.3).
- A two-handed weapon blocks the off hand (default, revisit after playtesting).

**Proposed.**
- The equipped weapon decides which proficiency is trained: one-handed, two-handed, or unarmed when no weapon is equipped.

**Data.** slot list, which equipment types each slot accepts, weapon scaling (attribute, required value), penalty per missing point and cap (`constants.combat.weaponPenalty`).

---

## 2.3 Inventory System

**Purpose.** What a character carries while farming.

**Rules.**
- Each character has their own inventory.
- The base bag is 36 cells (`constants.inventory.baseCells`). A backpack in the backpack slot (2.2) adds cells and sets the max stack of that character's bag.
- The bag has a max stack, and all stackable items stack to that amount. Without a backpack the base max stack is 20 (`constants.inventory.baseMaxStack`). A backpack sets a higher max stack for that character's bag only. A stack moved from the warehouse is split to fit the bag's max stack.
- Loot filter: the player chooses what to pick up.
- Auto-sell is a later upgrade.
- The loot filter is the idle trade-off: keep space for rare equipment, or farm only for XP and money.

**Proposed.**
- Same slot and size rules as the warehouse: large items take 2-3 slots, materials stack.
- A full inventory triggers a return to the city (see 3.2 Travel).
- Filter rules by category, required level and bonus attributes.

**Data.** base inventory size (`constants.inventory`), base max stack (`constants.inventory.baseMaxStack`), backpack cells and backpack max stack (on the backpack item), auto-sell unlock condition.

---

## 2.4 Storage System (Warehouse)

**Purpose.** Shared storage across all characters. The way items move between characters.

**Rules.**
- Tabs, each with a grid.
- Limited slots.
- Large items take more space. A weapon takes 2-3 slots.
- Stackable items (materials, potions and other consumables) take 1 slot per stack. The warehouse stacks all of them to 100 (`constants.storage.maxStack`).

**Proposed.**
- More tabs bought with gold. Acts as a long-term gold sink.
- Accessible only in the city, so moving items means a trip back.

**Data.** grid size per tab, starting tabs, tab costs.

---

## 2.5 Shop System

**Purpose.** Buy consumables, equipment and rare goods. Sell loot for money.

**Rules.**
- Separate shops, each with its own purpose: general store, alchemist, blacksmith, upgrade smith, warehouse, teleporter, rare goods shop.
- Every shop except the rare goods shop has fixed stock.
- Potions have no level requirement. Any character can buy and use any potion. Amounts are fixed, so a strong potion is wasteful and expensive for a low-level character.
- Items are sold to shops for gold.

**Rare goods shop.**
- Rotating stock. It rotates every hour.
- A rotation can be forced with a rare "Rotation token" (placeholder name) or with gold: 5,000 (`constants.shops.rareGoodsRefreshGoldCost`, owner approved, can be adjusted later). A forced rotation restarts the hourly timer (assumption).
- The pool does not depend on the level of the player's characters. All characters share one stock.
- Items are rare and expensive.
- Stock can include rare items normally dropped by bosses and cursed objects, equipment upgraded to a high level, and equipment with good bonus attributes.
- Gives late-game gold a use, and gives players without luck a slow route to rare items.

**Proposed.**
- Buyback for recently sold items, to undo mistakes.

**Data.** shop id, purpose, item list, prices. Rare goods shop: rotation interval, forced-rotation gold cost, item pool with weights, price range, number of items per rotation.

---

## 2.6 Consumables

**Purpose.** Potions and boosts that support farming without the player. Consumables are stored in the items table (2.1).

**Rules.**
- Health potions heal over time. Better potions heal more, and faster.
- Potions have no level requirement. Amounts are fixed, so a strong potion is wasted on a low-level character.
- No cooldowns. The heal-over-time rate is the limit.
- Potions are the fast way to heal. Natural health regeneration (4.2) is slow and does not replace them; it only lets a character with no money or potions heal up, in the city or in the field.
- Potion effects do not add up. A potion used while another is healing is queued and starts when the first ends (`constants.potions.stacking` = queue).
- A potion restores its amount evenly over its duration in ticks of 500 ms (`constants.potions`). Reference tiers: minor 40 over 10 s (4 per second), lesser 120 over 9 s (13), standard 320 over 8 s (40), greater 800 over 7 s (114), grand 1,800 over 6 s (300). These are the formula's reference points; potion items set their own amount and duration.
- Boost items are consumables like potions, but they grant a timed buff instead of health: move speed, attack speed, critical rate, defence, XP, drop rate and similar. They are rare items (2.8).
- Boost equipment is a different thing: equipment that gives boost-type bonuses while worn (2.8).
- A drop-rate boost is applied after the level-gap modifier (3.8): final chance = base chance × level modifier × boost. A boost cannot rescue a character that is too far above the enemy, because a modifier of 0 stays 0.

**Proposed.**
- Mana potions work the same way as health potions.
- Auto-use thresholds set by the player, for example drink a health potion below 40% health.

**Data.** effect type (heal, buff), amount, duration, tick rate, auto-use default threshold.

---

## 2.7 Upgrading System

**Purpose.** Improve items over time. The main long-term goal for gear.

**Rules.**
- Levels +0 to +9 for now.
- Each level improves the item.
- Early levels cost money only. Later levels need upgrade materials.
- Upgrades can fail. A failed upgrade destroys the item.
- An upgrade protection item makes a failed upgrade lower the level by one instead (2.8).
- Upgrades up to +5 cost only gold. Upgrades to +6 and above also need upgrade materials (`constants.upgrade.materialsStartAtLevel` = 6).
- Different equipment types need different upgrade items and amounts, and each upgrade level can need a different item. There is no single material for all levels.
- Upgrade items have a small drop chance (3.8).
- Every upgrade material has at least one low-level source: an enemy of level 10 or below that can drop it (`constants.balance.upgradeMaterialLowLevelSourceMaxEnemyLevel`, 3.8). High-level gear needs materials that a high-level character cannot farm itself, so it relies on the rest of the roster.
- A protection item is used up on every attempt it is applied to, whether the upgrade succeeds or fails.
- Success chance starts at 90% and each level is 90% of the previous one.
- One playthrough or one character cannot max every item.

| Upgrade | Success chance |
|---|---|
| +0 → +1 | 90.0% |
| +1 → +2 | 81.0% |
| +2 → +3 | 72.9% |
| +3 → +4 | 65.6% |
| +4 → +5 | 59.0% |
| +5 → +6 | 53.1% |
| +6 → +7 | 47.8% |
| +7 → +8 | 43.0% |
| +8 → +9 | 38.7% |

Without protection, an item has about a 0.9% chance to go from +0 to +9 without being destroyed. High-level items are valuable and protection items matter.

**Proposed.**
- Each level adds a fixed % to the item's base stats.

**Data.** upgrade table per equipment type: level, gold cost, material id, material amount, stat bonus. The material can differ per level. Success chance from the global constants (start 90%, factor 0.9).

---

## 2.8 Rare Items [Added]

**Purpose.** One list of the rare items that bend the rules. Several systems rely on them, so they get one definition. Stored in the items table (2.1) with category rare.

**Rules.**
- Dropped by bosses and cursed objects, from a guaranteed pool of rare items. They also roll their ordinary drop table, so they drop ordinary items too. Mini-bosses drop upgrade materials from a guaranteed pool, plus normal rolls (3.8).
- Some are sold in the rare goods shop (2.5).
- Each rare item has one use: equipped in the special-item-slot, used for upgrading, or consumed.
- Names marked as placeholders will change.

| Rare item | Use | Effect | Section |
|---|---|---|---|
| Special-slot items | Equip | Equipped in the special-item-slot | 2.2 |
| Boost equipment | Equip | Equipment with boost bonuses (move speed, attack speed, critical rate, defence) | 2.6 |
| Upgrade protection | Upgrade | A failed upgrade lowers the level instead of destroying the item | 2.7 |
| Spell upgrade material | Upgrade | Raise a spell above rank 10, up to 20 | 4.5 |
| Attribute slot stone (placeholder) | Upgrade | Adds attribute slots to one item, beyond the base 3 | 2.1 |
| Attribute reroll stone (placeholder) | Upgrade | Rerolls all bonus attributes of one item at once | 2.1 |
| XP boost | Consume | More XP for a time | 2.6 |
| Drop-rate boost | Consume | Higher drop chance for a time | 2.6, 3.8 |
| Combat boosts (move speed, attack speed, critical rate, defence) | Consume | Stronger stat for a time, as a buff | 2.6 |
| Travel skip | Consume | Instant travel | 3.2 |
| Rotation token (placeholder) | Consume | Forces a rare goods shop rotation | 2.5 |
| XP protection | Consume | No XP lost on death | 3.7 |
| Character respec | Consume | Reset character points | 4.4 |
| Spell respec | Consume | Reset skill points | 4.5 |
| Trait forgetting | Consume | Remove an absorbed trait | 4.7 |

**Data.** use (equip, upgrade, consume), effect, drop sources. Same items table as everything else (2.1).

---

## 2.9 Economy

**Purpose.** Keep money meaningful for the whole game.

**Rules.**
- One currency: gold.
- Items are only sold for gold. There is no salvage.
- Low-level items are worth collecting and selling for low-level characters, and worthless for high-level ones.

**Sources.** Enemy money drops, selling items.

**Sinks.** Consumables, basic equipment, upgrades, restocking on return to the city (3.2), teleporter fees (3.2), spell respec (4.5), warehouse tabs, rare goods shop and its forced rotation (2.5).

**Proposed.**
- Track gold in and out per hour in the dev tools (5.3) to tune.
