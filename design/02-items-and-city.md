# 2. Items and City

The city is the hub. Characters return here to restock, buy, upgrade, sell and store. Each service is its own shop or building.

Each system uses the same template: **Purpose**, **Rules** (decided), **Proposed** (suggestions, not yet decided), **Data** (what the dev tools need), **Open questions**. Systems marked [Added] were not in the original brief.

---

## 2.1 Item System [Added]

**Purpose.** One shared definition for everything that can drop, be bought, be equipped or be stored. Every other system in this document reads from it.

**Rules.**
- Categories: equipment, consumables, upgrade materials, rare items, money.
- No rarity tiers. "Rare items" is a category, not a tier (2.8).
- Each item has a required level to equip. Most items follow steps of 1, 5, 10, 15, … but an item can have any level.
- The gap between item levels must be large enough that upgrading each item is worth it before replacing it.
- Base values are fixed per item (attack range, defence, …).
- Items can also have bonus attributes. Each bonus has a fixed range, and the actual value is rolled within that range when the item drops.
- Each item has a size in slots and a stack limit.

**Data.** id, name, category, size (slots), stack limit, required level, base stats, bonus attribute pool (attribute, min, max, chance), buy price, sell price, icon.

**Open questions.**
- How many bonus attributes can one item roll?

---

## 2.2 Equipment System [Added]

**Purpose.** What the character wears. Most combat stats come from equipped items.

**Rules.**
- Items require only a level.
- Each weapon benefits from different attributes. A character without enough points in those attributes gets a penalty with that weapon.
- One designated slot for rare items. Only some rare items can be equipped there (2.8).

**Proposed.**
- Slots: main hand, off hand, head, body, hands, legs, feet, necklace, ring ×2, rare item slot.
- The equipped weapon decides which proficiency is trained: one-handed, two-handed, or unarmed when no weapon is equipped.
- A two-handed weapon blocks the off hand.
- Each weapon lists its scaling attributes and a recommended value per attribute. Below that value, damage is reduced in proportion.

**Data.** slot list, allowed item categories per slot, weapon scaling (attribute, recommended value, penalty curve).

**Open questions.**
- How harsh is the weapon penalty: a gradual loss of damage, or a hard cut?

---

## 2.3 Inventory System

**Purpose.** What a character carries while farming.

**Rules.**
- Each character has their own inventory.
- The inventory can be expanded later in progression.
- Loot filter: the player chooses what to pick up.
- Auto-sell is a later upgrade.
- The loot filter is the idle trade-off: keep space for rare equipment, or farm only for XP and money.

**Proposed.**
- Same slot and size rules as the warehouse: large items take 2-3 slots, materials stack.
- A full inventory triggers a return to the city (see 3.2 Travel).
- Filter rules by category, required level and bonus attributes.

**Data.** base inventory size, expansion steps and how they unlock, auto-sell unlock condition.

---

## 2.4 Storage System (Warehouse)

**Purpose.** Shared storage across all characters. The way items move between characters.

**Rules.**
- Tabs, each with a grid.
- Limited slots.
- Large items take more space. A weapon takes 2-3 slots.
- Materials take 1 slot and stack up to 100.

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
- Items are sold to shops for gold.

**Rare goods shop.**
- Rotating stock.
- Items are rare and expensive.
- Stock can include rare items normally dropped by bosses, mini-bosses and cursed objects, equipment upgraded to a high level, and equipment with good bonus attributes.
- Gives late-game gold a use, and gives players without luck a slow route to rare items.

**Proposed.**
- Buyback for recently sold items, to undo mistakes.

**Data.** shop id, purpose, item list, prices. Rare goods shop: rotation interval, item pool with weights, price range, number of items per rotation.

**Open questions.**
- How often does the rare goods shop rotate?
- Does its stock depend on the level of the player's characters?

---

## 2.6 Consumables

**Purpose.** Potions and boosts that support farming without the player.

**Rules.**
- Health potions heal over time. Better potions heal more, and faster.
- No cooldowns. The heal-over-time rate is the limit.
- Boosts that improve move speed, attack speed, critical rate, defence and similar are rare drops.
- XP and drop-rate boosts are rare items (2.8).

**Proposed.**
- Mana potions work the same way as health potions.
- Auto-use thresholds set by the player, for example drink a health potion below 40% health.

**Data.** effect type, amount, duration, tick rate, auto-use default threshold.

**Open questions.**
- Is a drop-rate boost applied before or after the level-gap penalty (3.8)? If before, a boost cannot rescue a character too far above the enemy.

---

## 2.7 Upgrading System

**Purpose.** Improve items over time. The main long-term goal for gear.

**Rules.**
- Levels +0 to +9 for now.
- Each level improves the item.
- Early levels cost money only. Later levels need rare materials.
- Upgrades can fail. A failed upgrade destroys the item.
- An upgrade protection item makes a failed upgrade lower the level by one instead (2.8).
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

**Data.** upgrade table per item group: level, gold cost, material id, material amount, stat bonus. Success chance from the global constants (start 90%, factor 0.9).

**Open questions.**
- At which level do materials start?

---

## 2.8 Rare Items [Added]

**Purpose.** One list of the rare items that bend the rules. Several systems rely on them, so they get one definition.

**Rules.**
- Dropped by bosses, mini-bosses and cursed objects.
- Some are sold in the rare goods shop (2.5).
- Each rare item has one use: equipped in the rare item slot, used for upgrading, or consumed.

| Rare item | Use | Effect | Section |
|---|---|---|---|
| Rare-slot items | Equip | Equipped in the rare item slot | 2.2 |
| Upgrade protection | Upgrade | A failed upgrade lowers the level instead of destroying the item | 2.7 |
| Spell upgrade material | Upgrade | Raise a spell above rank 10 | 4.5 |
| XP boost | Consume | More XP for a time | 2.6 |
| Drop-rate boost | Consume | Higher drop chance for a time | 2.6, 3.8 |
| Travel skip | Consume | Instant travel | 3.2 |
| XP protection | Consume | No XP lost on death | 3.7 |
| Character respec | Consume | Reset character points | 4.4 |
| Spell respec | Consume | Reset skill points | 4.5 |
| Trait forgetting | Consume | Remove an absorbed trait | 4.7 |

**Data.** use (equip, upgrade, consume), effect, drop sources.

---

## 2.9 Economy

**Purpose.** Keep money meaningful for the whole game.

**Rules.**
- One currency: gold.
- Items are only sold for gold. There is no salvage.
- Low-level items are worth collecting and selling for low-level characters, and worthless for high-level ones.

**Sources.** Enemy money drops, selling items.

**Sinks.** Consumables, basic equipment, upgrades, restocking on return to the city (3.2), teleporter fees (3.2), spell respec (4.5), warehouse tabs, rare goods shop (2.5).

**Proposed.**
- Track gold in and out per hour in the dev tools (5.3) to tune.
