# ItemSlot

One cell of a bag, the warehouse or an equipment slot, sized by the item it holds.

- Markup: `<button class="ab-slot" aria-label="Iron Longsword +6, two-handed, Lv 10">` with the category icon, an optional `.ab-slot__plus` upgrade mark (top right) and an optional `.ab-slot__count` stack count (bottom right). Grids are `.ab-grid` (7 columns of `size-slot`, 6px gaps).
- Size follows the item: weapons span three cells (`--h3`), body armour, leggings and shields two (`--h2`), everything else one. Materials stack to 100 in one cell.
- Upgrade marks: +1 to +3 plain `.ab-slot__plus`, +4 to +6 `--gold`, +7 to +9 `--arcane`. +0 shows no mark.
- States: `--empty` (dashed `line`), `--drop` (accepts the dragged item, `line-strong`), `--locked` (bag rows not yet unlocked, or an off hand blocked by a two-handed weapon), `--rare` (rare items: `arcane-soft` ground, `arcane` icon), `--selected` (2px `gold` edge; its details show in a sheet or side panel).
- Every filled slot is a button with an `aria-label` that names the item, its upgrade level and stack count; tapping opens the item sheet. Never rely on hover for details.
