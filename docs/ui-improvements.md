# UI improvements

Backlog of UI fixes to apply later. One checkbox per issue. Tick when done and leave it in place so the same thing is not re-implemented. New issues appended at the bottom.

Priority: **P1** blocks a screen or breaks the voice / design rules, **P2** noticeable rough edge, **P3** polish.

Every UI change here is checked against the screen sketches in `design/ui/screens/*.dc.html` before it ships.

## Roster

- [ ] **P2** — Empty unlocked slots are invisible. Show every unlocked slot (filled or empty); tapping an empty slot opens the create flow, same as the Create character button. Today only locked slots show; empty unlocked slots are hidden. [src/ui/Roster.tsx](src/ui/Roster.tsx)

## Character creation

- [ ] **P2** — "Starting character" details are low value and cause friction. Remove the block. On mobile the player has to dismiss the keyboard to see past it before they can tap Create. [src/ui/CharacterCreate.tsx:71](src/ui/CharacterCreate.tsx:71)

## Delete character

- [ ] **P1** — Delete confirmation is too easy to tap by accident. Require typing the character name to confirm (or, as a fallback, hold a 2–3 s delay before Delete arms). [src/ui/DeleteConfirm.tsx](src/ui/DeleteConfirm.tsx)
- [ ] **P1** — Delete button sits off-screen on narrow viewports and some of the text is clipped. Fix layout so the sheet fits at 390 px. [src/ui/DeleteConfirm.tsx](src/ui/DeleteConfirm.tsx)
- [ ] **P2** — Padding on the delete confirmation sheet is inconsistent (title, body, actions). Align to the design system spacing tokens. [src/ui/DeleteConfirm.tsx](src/ui/DeleteConfirm.tsx)

## World and character screens (#33, deferred)

- [ ] **P2** — Trip, search and flee progress bars and "arrives in {total}". Needs a pure duration helper in `src/game`; the engine's duration functions are off-limits to the UI, so only elapsed time and the respawn countdown show. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P3** — Loot feed relative timestamps ("now", "31s", "1m"). The time column is empty. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P2** — Absorption: the Farm "now absorbing" line and the Stats "absorbed traits" card. The engine exposes no absorption event or maximum yet. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P3** — Derived stats: damage range and health and mana regeneration rows. `DerivedStats` does not expose them. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
- [ ] **P2** — World character switcher. The screen uses the selected character. [src/ui/World.tsx](src/ui/World.tsx)
- [ ] **P3** — Send sheet: Walk / Teleporter control (teleporters are a later service) and a speed-adjusted arrival time. [src/ui/World.tsx](src/ui/World.tsx)
- [ ] **P2** — Character screen: Gear tab (#34) and Spells tab. Only Farm and Stats show. [src/ui/CharacterScreen.tsx](src/ui/CharacterScreen.tsx)
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
