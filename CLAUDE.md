# Idle RPG Absorber

Browser idle RPG. TypeScript, Vite, Vitest. Pre-development: the design exists, the game does not.

## Commands

- `npm run dev` runs the dev server.
- `npm run check` runs typecheck, tests, data validation and the token sync check. Run it before committing.
- `npm run tokens` regenerates `src/styles/tokens.css` from `design/ui/design-system/tokens.json`.
- `npm run validate:data` validates `data/*.json`.

## Rules for working here

- **The design docs in `design/` are the source of truth.** Each system lists **Rules** (decided), **Proposed** (not decided) and **Open questions**. Implement Rules. Do not silently turn Proposed or Open items into decisions: ask, or record the choice in `docs/pre-development-checklist.md`.
- **Content is data, not code.** Numbers, items, enemies and constants go in `data/*.json` (design 5.1). Do not hard-code them in `src/`. A `null` in `data/constants.json` means undecided.
- **Formulas live in `src/game/formulas.ts` and are pure.** Add a test for every formula, checked against the numbers printed in the design docs.
- **UI follows the design system** in `design/ui/design-system/` (read its `README.md`). Use the `ab-` classes from `components/bundle.css` and the tokens in `tokens.css`. Do not introduce colours, fonts or spacing outside the tokens. Do not edit `src/styles/tokens.css` by hand.
- Screen sketches in `design/ui/screens/*.dc.html` are references to look at, not code to ship. They need the claude.ai Design runtime (`support.js`) to render, so open the artifact link instead.
- Copy follows the voice rules in the design system README: lead with the number, sentence case, no exclamation marks, no emoji.
