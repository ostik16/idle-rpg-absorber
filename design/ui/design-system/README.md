Idle RPG Absorber is a browser idle RPG. A roster of characters farms on its own while the player decides where each one fights, what it keeps and what it becomes. The interface is a quartermaster's ledger by lamplight: night-dark panels, gilded actions, and one luminous colour, essence, for the mechanic the game is named after. It is checked in glances on a phone and studied at length on a desktop, so every screen leads with state (who is doing what, how full, how long) and keeps the next decision one tap away.

## Voice and copy

- Lead with the number. "Bag 31/42", "Drops 80%", "+0.06% fire affinity". Never "Your bag is getting full".
- Name the actor. Characters are called by name; the player is "you" only in confirmations and settings. "Kaela returned to the city: bag full."
- Sentence case for every UI string. Cinzel adds the ceremony, so copy stays plain. No exclamation marks, no emoji.
- Fixed formats: level `Lv 14`, level range `Lv 5–10` (en dash), upgrade `+5`, chances to one decimal `59.0%`, absorbed traits to one decimal `4.2%`, per-kill gains to two `+0.06%`, durations `3m 12s` and `7h 42m`, gold with thousands separators `48,210` beside the coin icon, rates `1,240 / h`.
- Hidden numbers stay hidden. A proficiency shows its title (Novice, Apprentice, Adept, Expert, Master), never a value. A bestiary fact not yet revealed shows `??` and the kills still needed.
- Say the consequence before the tap, in plain words: "On failure: item is destroyed." "On failure: drops to +3." "Points are permanent."

## Colour

- One theme, dark. Build every screen on `ground`, put content in `surface-1` cards, raise rows, slots and inputs on `surface-2`, and mark the selected or pressed thing with `surface-3`.
- `line` hairlines are decoration. Anything tappable that relies on its edge (an input, a secondary button, a slot that accepts a drop) uses `line-strong`.
- `gold` is value and action: the one primary button per screen, the active tab, gold amounts, level badges. Two gold buttons on one screen means one of them is wrong. Text on a gold fill is `on-gold`.
- `essence` belongs to absorption and nothing else: absorbed traits, absorption progress, magical trait tags, the absorb line in the loot feed. Never use it for generic success or links.
- `arcane` marks the rare: rare items, cursed objects, the rare goods shop, upgrade marks +7 to +9.
- Resource bars fill `hp`, `mana`, `xp` or `essence` on `bar-track`. `hp` is a fill only; red text is `danger`. The XP bar carries ticks at 25%, 50% and 75%, where the level's three character points are awarded.
- Tints (`gold-soft`, `essence-soft`, `danger-soft`, `arcane-soft`) sit only behind their own colour's text or `ink`.
- Status and threat colours always travel with an icon and a word. `positive` and `danger` are close in lightness, so the word carries the meaning.

| Meaning | Colour | Icon and word |
|---|---|---|
| Farming | `positive` | swords · "Farming" |
| Travelling, returning | `info` | footprints · "Travelling 3m 12s" |
| In city | `gold` | house · "In city" |
| Dead | `danger` | skull · "Fell" |
| Normal enemy | `ink-muted` | "Normal" |
| Mini-boss | `warning` | "Mini-boss" |
| Boss | `danger` | "Boss" |
| Cursed object | `arcane` | "Cursed" |
| Drop rate 100% | `positive` | "Drops 100%" |
| Drop rate 10–90% | `warning` | "Drops 60%" |
| Drop rate 0% | `danger` | "Drops 0%" |
| Upgrade +1 to +3 / +4 to +6 / +7 to +9 | `ink-muted` / `gold` / `arcane` | "+5" in the slot's corner |

- Keyboard focus is `focus-ring`: a 2px solid gold outline with a 2px offset on every interactive element. It holds 7:1 or more on every ground.

## Type

- `display` (Cinzel) is for proper names and titles: screen titles, character, area, enemy, shop and item names. Use `display-lg`, `display-md` and `title`; never below 17px, never for numbers, buttons or body.
- `sans` (Barlow) carries reading text: `body`, `body-strong`, `small`. Button labels are `body` at 600.
- `condensed` (Barlow Semi Condensed) carries data: `number-lg`, `number` and `number-sm` with tabular figures, and `label` in uppercase for section labels, bar labels, chips and tags.
- On phones nothing is smaller than 12px, and anything the player must act on is 15px.
- All three families load from Google Fonts; `components/bundle.css` imports them.

## Space, shape and depth

- 4px grid, `space-1` to `space-10`. Phone gutters and card padding `space-4`, gaps between cards `space-3`; desktop gutters `space-6`.
- Radii: `radius-xs` badges, tags and upgrade marks; `radius-sm` buttons, slots, inputs and the segmented control; `radius-md` cards; `radius-lg` sheets and dialogs; `radius-pill` bars and chips.
- Borders, not shadows. Only floating layers cast one: `shadow-sheet` for bottom sheets and `shadow-pop` for desktop dialogs, both over `scrim`.
- Ornament is rationed to one mark: a 6px gold diamond (a square rotated 45°) before the section label of a hero card. Nothing else is decorative.
- Motion is functional: bars ease their width over 200ms, a new loot line fades in over 150ms, an absorbed trait pulses its essence bar once. Under `prefers-reduced-motion` everything changes instantly.

## Mobile and layout

- Design at 390px wide first (`bp-phone`). Everything works one-handed: navigation and the screen's main action sit in the bottom third.
- Below `bp-desktop` (900px): a `size-appbar` app bar with the selected character's name, their location and the character switcher, and a bottom tab bar (`size-tabbar`) with four destinations: Farm, City, Character, Bestiary. Tapping any tab closes whatever is pushed and shows that tab's root. Pad the tab bar with `env(safe-area-inset-bottom)`.
- At `bp-desktop` and wider, the tab bar becomes a left rail (`size-rail`); roster, character detail and the loot feed sit side by side; the warehouse and a character's bag sit side by side for transfers; bottom sheets become centred dialogs. Content stops at `size-content`.
- Character detail is a pushed screen with a back button and a segmented control: Farm, Stats, Gear, Spells.
- Touch targets are at least `size-tap` (44px). Item cells are `size-slot` (44px); weapons span 3 cells tall, body armour and leggings 2. A 7-column grid with 6px gaps fits a 390px phone.
- No hover-only information. Tapping an item or an area opens a bottom sheet on phones and a dialog on desktop. Drag and drop is a desktop shortcut for transfers, never the only way.
- Moving items between two inventories (a bag and the warehouse) always shows both grids at once. On phones the bag sits above and the warehouse below, with "To warehouse ↓" and "To bag ↑" between them. On desktop they sit side by side with → and ← buttons. Tapping items multi-selects them (2px `gold` edge and a gold check), and only the button for the selected side is live and gold. Stacks merge into existing stacks first. A status line under the buttons says what moved, or why something didn't fit ("No room for Rusty Dagger: it needs 2 free cells in one column").
- Shops use Buy, Sell and Buyback tabs. Buy has a quantity stepper per row and a bottom bar with the total, bag space after and gold after. Sell uses the bag grid with multi-select. Buyback lists the last hour's sales.
- Irreversible choices (spending character points, an unprotected upgrade) get a confirm step that states the consequence.
- Wide tables scroll sideways inside their card; the page itself never scrolls sideways.

## Iconography

- Lucide icons (ISC licence): 24px grid, stroke width 1.75, round caps and joins, coloured with `currentColor`. 20px in buttons and tabs, 16px in rows, 14px in chips. Never emoji.
- One icon per concept: Farm `map`, City `castle`, Character `user`, Bestiary `book-open`, Farming `swords`, Travelling `footprints`, In city `house`, Dead `skull`, Gold `coins`, Absorption `sparkle`, Rare item `gem`, Potion `flask-round`, Upgrade `hammer`, Warehouse `archive`, Teleporter `orbit`, Shop `store`, Loot filter `filter`, Return to city `undo-2`, Target enemy `crosshair`, Locked `lock`, Bag `backpack`.
- Items have no art yet. A slot shows its category's icon (sword, shield, flask, gem, ring, scroll) in `ink-muted`, or `arcane` for rare items. When item art arrives it replaces the icon and keeps the slot frame and corner marks.
- There is no logo yet: set the name in `display`.

## Components

Components are CSS classes in `components/bundle.css` (prefix `ab-`), written against the tokens; load `tokens.css` first. There is no script bundle: each component's guidelines give the markup it expects.
