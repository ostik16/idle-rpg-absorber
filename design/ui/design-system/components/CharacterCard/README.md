# CharacterCard

One character in the roster: who, where, doing what, and whether something needs attention.

- Markup: `<a class="ab-char" href="…">` (the whole card opens the character) holding `.ab-char__avatar` (initial in `display`) and a body with `.ab-char__top` (name, `.ab-level`, status chip), `.ab-char__where` (area and level range, or what it is doing), `.ab-char__bars` (thin HP and XP bars) and `.ab-char__stats` (gold per hour, bag, potions).
- The consumer provides name, level, status, area or activity, HP and XP percentages, gold per hour, bag used/size and potion count.
- A stat about to fire a return trigger (bag 90% full, 3 potions or fewer) takes `.ab-char__stat--warn` so the player can act before the character walks home.
- The selected card on desktop gets `aria-current="true"`.
- Locked slots use `.ab-char--locked` with a lock icon and the unlock rule: "Unlocks when a character reaches Lv 30".
- Keep it to four lines; details live on the character screen.
