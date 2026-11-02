# 6. UI and Design System

**Purpose.** One visual language for the game on phones and desktops, so every screen reads the same and new screens are built from the same parts.

**Where it lives.**
- Design system (tokens, brand book, component guidelines, CSS classes in `components/bundle.css`): https://claude.ai/artifact/3n12SGkJ1VWxMXAQ8HMZrb
- Screen sketches (13 phone screens linked as a clickable prototype, 2 desktop layouts): https://claude.ai/artifact/MM1u7hrsEdZww1XtTKEiE1

Template: **Proposed** (not yet decided), **Assumed by the sketches**, **Open questions**.

---

**Proposed.**
- Dark theme only. Grounds `ground`, `surface-1/2/3`.
- `gold` means value and action, with one primary button per screen. `essence` (teal) is used only for absorption. `arcane` (violet) marks rare items, cursed objects and upgrade marks from +7 to +9.
- Type: Cinzel for names and titles (17px and up), Barlow for reading text, Barlow Semi Condensed with tabular figures for numbers, labels and chips.
- Phone first, at 390px wide. Phone screens have an app bar and a bottom tab bar with Roster, World, City and Bestiary. From 900px wide the tab bar becomes a left rail. Roster, character detail and loot then sit side by side, and so do the warehouse and a character's bag.
- Touch targets and item cells are 44px. Grids have 7 columns. Weapons take 3 cells in a column; body armour, leggings and shields take 2.
- Every status shows an icon and a word, never colour alone. Drop chips show the rate after the level-gap modifier (3.8) for a chosen character. The World screen draws each area's level range against that character's level.
- The XP bar has ticks at 25%, 50% and 75%, where character points are awarded (4.4).
- Choices that can't be undone get a confirm step that states the consequence: spending character points (4.4) and unprotected upgrades (2.7).
- Moving items between a bag and the warehouse (2.4) always shows both grids. On phones the bag is above and the warehouse below, with "To warehouse ↓" and "To bag ↑" between them. Items are multi-selected by tapping, stacks merge first, and a status line says what moved or why it didn't fit.
- Shops (2.5) have Buy, Sell and Buyback tabs. Buy shows the total, bag space after and gold after before you confirm.
- Spells (4.5): the character's spell screen shows skill points, an auto-cast priority list that can be reordered, and the shared spell book filtered by kind. Spells boosted by an absorbed trait show it in essence colour ("Fire affinity adds 2.8%").

**Screens sketched.** Roster · Character: Farm, Stats, Gear, Spells · Welcome back (offline summary, 3.4) · World · Area sheet (target and travel) · City · Shop (Alchemist) · Upgrade smith · Warehouse · Bestiary · Desktop roster · Desktop warehouse transfer.

**Assumed by the sketches** (placeholders, not yet in sections 2–4).
- Proficiency titles: Novice, Apprentice, Adept, Expert, Master.
- Item names: "Warding Seal" for upgrade protection, "Waystone" for travel skip, "Tome of Insight" for the XP boost, "Arcane Shard" for spell upgrade material, "Scroll of Unlearning" for spell respec, "Sigil of Embers" as an example rare-slot item.
- Spell list: Ember Strike, Cleave, Frost Lance, Thunderclap, Iron Skin, Parry, Second Wind and Haste, with made-up numbers per rank. Spell respec costs 4,200 gold at Lv 14.
- Auto-cast entries can carry a condition, such as "When health is below 40%".
- Any shop buys any item. Buyback lasts one hour.
- Nine areas from Mossfang Glade (Lv 1–5) to Blightspire (Lv 25–30), with walking times and teleporter fees.
- Bag sizes of 36 and 42 cells, and restock targets per potion type.

**Open questions.**
- The loot filter rule editor (2.3) is not sketched yet.
- Items have no art yet. Slots show category icons until art exists.
- Is a Warding Seal used up when an upgrade succeeds, or only when it fails?
- Can low-level characters buy potions they can't use yet, so they can pass them on through the warehouse? The shop sketch allows it.
