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
