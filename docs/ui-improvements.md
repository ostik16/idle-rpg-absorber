# UI improvements

Backlog of UI fixes to apply later. One checkbox per issue. Tick when done and leave it in place so the same thing is not re-implemented. New issues appended at the bottom.

Priority: **P1** blocks a screen or breaks the voice / design rules, **P2** noticeable rough edge, **P3** polish.

Every UI change here is checked against the screen sketches in `design/ui/screens/*.dc.html` before it ships.

## Roster

- [x] **P2** — Empty unlocked slots are invisible. Show every unlocked slot (filled or empty); tapping an empty slot opens the create flow, same as the Create character button. Today only locked slots show; empty unlocked slots are hidden. [src/ui/Roster.tsx](src/ui/Roster.tsx)
- [ ] **P3** — Empty unlocked slot reuses the dashed locked style (no new CSS allowed in this pass). Not compared in a browser at 390px. [src/ui/Roster.tsx](src/ui/Roster.tsx)

## Character creation

- [x] **P2** — "Starting character" details are low value and cause friction. Remove the block. On mobile the player has to dismiss the keyboard to see past it before they can tap Create. [src/ui/CharacterCreate.tsx](src/ui/CharacterCreate.tsx)

## Delete character

- [x] **P1** — Delete confirmation is too easy to tap by accident. Require typing the character name to confirm (or, as a fallback, hold a 2–3 s delay before Delete arms). [src/ui/DeleteConfirm.tsx](src/ui/DeleteConfirm.tsx)
- [ ] **P1** — Deferred, not verified in a browser at 390px (sheet uses `app__sheet--tall`). Delete button sits off-screen on narrow viewports and some of the text is clipped. Fix layout so the sheet fits at 390 px. [src/ui/DeleteConfirm.tsx](src/ui/DeleteConfirm.tsx)
- [ ] **P2** — Deferred, not verified in a browser. Padding on the delete confirmation sheet is inconsistent (title, body, actions). Align to the design system spacing tokens. [src/ui/DeleteConfirm.tsx](src/ui/DeleteConfirm.tsx)


## World and character screens (#33, deferred)

- [ ] **P2** — Trip, search and flee progress bars and "arrives in {total}". Needs a pure duration helper in `src/game`; the engine's duration functions are off-limits to the UI, so only elapsed time and the respawn countdown show. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P3** — Loot feed relative timestamps ("now", "31s", "1m"). The time column is empty. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P2** — Absorption: the Farm "now absorbing" line and the Stats "absorbed traits" card. The engine exposes no absorption event or maximum yet. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P3** — Derived stats: damage range and health and mana regeneration rows. `DerivedStats` does not expose them. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P2** — World character switcher. The screen uses the selected character. [src/ui/World.tsx](src/ui/World.tsx)
- [ ] **P3** — Send sheet: Walk / Teleporter control (teleporters are a later service) and a speed-adjusted arrival time. [src/ui/World.tsx](src/ui/World.tsx)
- [ ] **P2** — Character screen: Spells tab. Farm, Stats and Gear show. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P3** — Area sheet: mini-boss, boss and cursed-object rows. Only listed spawns show. [src/ui/World.tsx](src/ui/World.tsx)
- [ ] **P3** — Farm screen: "Returns to city when" and "Recovery" blocks (editing thresholds is #34), and the area card's "farming here" gold edge. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P3** — World area card: 4px level-range bar with a marker at the character's level.
- [ ] **P3** — World area card: "{name} fell here {age} ago" line for a character that died in that area.
- [ ] **P3** — World-Area sheet: second threat pill "Enemies up to +N levels".
- [ ] **P3** — Farm: "Now fighting" card (enemy name, Lv, drop%, trait chips, live enemy-HP bar, kill count and kills per minute). Needs fight state and bestiary exposure in the store.
- [ ] **P3** — Farm state row: gold-per-hour rate. Needs rate tracking; shows the gold total for now.
- [ ] **P3** — Stats: per-attribute "+N gear" suffix. Needs a per-attribute gear-bonus breakdown.
- [ ] **P3** — Dead and Farm: "Health potions · N left" row. Needs potion-count exposure.
- [ ] **P3** — Dead: XP before and after ("X% → Y%") and the loss segment on the bar. Needs pre-death XP.
- [ ] **P3** — Travelling: destination explainer card and "On arrival" (target / between-fights) card.
- [ ] **P3** — Persistent vitals: XP and Health bars kept visible across the Farm and Stats tabs and on the Fell screen (currently inside the Farm card body).

## City, shop, warehouse and gear (#34 core slice)

Built in the settings pass (#34): a pushed Settings screen per character, with the shared rule editor.

- [x] **P2** — Gear: "Loot filter" button, the loot-filter editor and the auto-sell list. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx), [src/ui/RuleEditor.tsx](src/ui/RuleEditor.tsx)
- [x] **P2** — City: "Restock on return" card and its Edit, plus city-healing, return-threshold and potion-threshold editing. [src/ui/City.tsx](src/ui/City.tsx), [src/ui/Settings.tsx](src/ui/Settings.tsx)
- [ ] **P3** — Settings: no sketch exists, so the screen is unreviewed against one. The "Drink at" row cannot be turned off, only set or reset to the item's default, because the engine's `null` removes the override. The loot-filter bonus-attribute row is not built (undecided in design 2.3). The "Restock on return" card shows the shopping character only. [src/ui/Settings.tsx](src/ui/Settings.tsx)
- [ ] **P3** — Rule editor: the sketch's separate summary card and rules card are one card here, and the on/off switch is added (decisions R12). Not checked in a browser at 390px. [src/ui/RuleEditor.tsx](src/ui/RuleEditor.tsx)

Still deferred:

- [ ] **P3** — City: Upgrade Smith, Teleporter and Rare Goods cards (services not built), and a "Shopping as" picker beside the Shops header (today a "Shop as" button on each city row). [src/ui/City.tsx](src/ui/City.tsx)
- [ ] **P3** — Shop: effect line per row (potion heal, weapon damage), "Bag after" and a "Fill to restock targets" button, and the Buyback tab (L14). [src/ui/Shop.tsx](src/ui/Shop.tsx)
- [ ] **P3** — Warehouse: side-by-side layout with → and ← on desktop, drag and drop, partial-quantity transfer, a status line under the buttons saying what moved (refusals show as the top notice), and extra tabs (L13). Only tab 1 shows. [src/ui/Warehouse.tsx](src/ui/Warehouse.tsx)
- [ ] **P3** — Bag grids: tallest-first ordering, an item sheet instead of the inline Equip button, and required-attribute and damage-penalty lines on the equipped weapon. [src/ui/ItemSlot.tsx](src/ui/ItemSlot.tsx)
- [ ] **P3** — Item grids use as many 44px cells as fit (6 across on a 390px phone), not the sketch's 7, because the card padding leaves 326px. [src/ui/shell.css](src/ui/shell.css)
- [ ] **P3** — Opening a shop or the warehouse stays pushed when a tab-bar destination is tapped; same as the character detail screen. [src/ui/App.tsx](src/ui/App.tsx)

Sketch-fidelity gaps found comparing #34 core to the sketches (behaviour is correct; these are layout/copy):

- [ ] **P3** — City: Shops should be a two-column card grid (today a single column); the fallen-character row should show items carried and a "Back {time}" status pill; a working character's row should show a restock status line (needs restock history). [src/ui/City.tsx](src/ui/City.tsx)
- [ ] **P3** — Shop: the selected totals sit in the bag section above the action bar in the sketch (today in the bottom bar); "{name} has N" is a separate bold span, not appended to the price line. [src/ui/Shop.tsx](src/ui/Shop.tsx)
- [ ] **P3** — Gear: a "Sort" button on the bag, and a fuller paper-doll layout matching the sketch. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P3** — Warehouse: split heading ("Warehouse" + muted "Tab 1 · shared"), transfer buttons with an icon and a count badge, and a bag subtitle / character picker. [src/ui/Warehouse.tsx](src/ui/Warehouse.tsx)

Automation off (#66, decisions A1):

- [ ] **P2** — Copy and controls that describe automation still show while `automation.enabled` is false: City "Restock on return" card and "Restocking." state, Settings return threshold, restock quantities ("Restocked in the city before heading out"), city healing choice, loot filter and auto-sell editors. Hide or mark them inactive. [src/ui/City.tsx](src/ui/City.tsx), [src/ui/Settings.tsx](src/ui/Settings.tsx)
- [ ] **P3** — Character-Fell: the heal card reads "Then it waits in the city" instead of the sketch's "Then it heals before farming", because a respawned character no longer heals and leaves on its own. Update the sketch. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P3** — Farm, in the city: health bar and one Drink row per health potion held (no sketch has them), so the player can heal by hand. The "no potions" alert (`CharacterView.noPotions`) is for the Farm screen rebuild (#64). [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)

Send to farm (#65, decisions A2):

- [ ] **P3** — World-Area: the send sheet no longer has the sketch's Target list; "Send" goes straight to the area and the target is set from the Farm screen's "Target enemy". The line under the button is the engine's refusal reason when a send is refused. Update the sketch. [src/ui/World.tsx](src/ui/World.tsx)
