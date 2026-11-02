# ResourceBar

A labelled bar for health, mana, experience or absorption progress.

- Markup: `.ab-bar.ab-bar--{hp|mana|xp|essence}` holding `.ab-bar__head` (label, then `.ab-bar__value`) and `.ab-bar__track` with `role="progressbar"`, `aria-label` and `aria-valuenow/min/max`, wrapping `.ab-bar__fill` whose width is the percentage.
- The consumer provides the label, the current and maximum values, and the width.
- XP bars carry three `.ab-bar__tick` marks at 25%, 50% and 75%, where the level's character points are awarded.
- Essence bars show an absorbed trait against its cap: "Life steal 4.2% of 6.0%". The cap is the strongest enemy absorbed from.
- `--thin` (4px track) is for roster cards and compact rows; drop the head and put the label beside it.
- Never colour a bar by threshold (a red HP bar at 20%); the number says it. Return triggers are shown separately.
