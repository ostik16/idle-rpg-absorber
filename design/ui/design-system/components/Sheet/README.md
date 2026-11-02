# Sheet

Details and decisions that sit on top of a screen: an item, an area to send a character to, a confirmation.

- Markup: `.ab-scrim` (fills the viewport, `scrim`) holding `<section class="ab-sheet" role="dialog" aria-modal="true" aria-labelledby="…">` with `.ab-sheet__grip`, a `title`-style heading, the content (often an `.ab-dl` of facts) and `.ab-sheet__actions`.
- On phones the sheet rises from the bottom and can be dragged down or closed with the scrim; at 900px and wider the same content is a centred dialog (`radius-lg` all round, `shadow-pop`), 480px wide.
- Actions: the primary spans the full width at the bottom, within thumb reach; secondary actions sit in two columns above it.
- State consequences inside the sheet before its primary action: "Points are permanent.", "On failure: item is destroyed."
- One sheet at a time. A sheet never opens another; it replaces its content and shows a back button.
