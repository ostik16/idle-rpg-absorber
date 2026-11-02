# StatusChip

What a character is doing right now: farming, travelling, in city or fallen.

- Markup: `<span class="ab-status ab-status--farming">` with an `svg.ab-icon` and the word; a running timer goes in `.ab-status__time`.
- Four states only: `--farming` (swords, `positive`), `--travel` (footprints, `info`, with the time left; also used for "Returning"), `--city` (house, `gold`), `--dead` (skull, `danger`).
- Always icon plus word. The colours of farming and fallen are close in lightness, so the word carries the meaning.
- One chip per character, top right of its card or header. Why a character is returning (bag full, out of potions, low health) goes in the line below, not in the chip.
