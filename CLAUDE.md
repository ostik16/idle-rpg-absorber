# Idle RPG Absorber

Browser idle RPG. TypeScript, Vite, Vitest, Preact. Early development: the design, engine skeleton and app shell exist, the game does not yet.

## Commands

- `npm run dev` runs the dev server.
- `npm run check` runs typecheck, tests, data validation and the token sync check. Run it before committing.
- `npm run tokens` regenerates `src/styles/tokens.css` from `design/ui/design-system/tokens.json`.
- `npm run validate:data` validates `data/*.json`.

## Rules for working here

- **The design docs in `design/` are the source of truth.** Each system lists **Rules** (decided), **Proposed** (not decided) and **Open questions**. Implement Rules. Do not silently turn Proposed or Open items into decisions: ask, or record the choice in `docs/pre-development-checklist.md`.
- **Content is data, not code.** Numbers, items, enemies and constants go in `data/*.json` (design 5.1). Do not hard-code them in `src/`. A `null` in `data/constants.json` means undecided.
- **The layers are in `docs/architecture.md` and `docs/adr/`.** The engine takes time as an argument and never touches the DOM, storage or `Math.random`. The UI never mutates state; it dispatches commands.
- **Formulas live in `src/game/formulas.ts` and are pure.** Add a test for every formula, checked against the numbers printed in the design docs.
- **UI follows the design system** in `design/ui/design-system/` (read its `README.md`). Use the `ab-` classes from `components/bundle.css` and the tokens in `tokens.css`. Do not introduce colours, fonts or spacing outside the tokens. Do not edit `src/styles/tokens.css` by hand.
- Screen sketches in `design/ui/screens/*.dc.html` are references to look at, not code to ship. They need the claude.ai Design runtime (`support.js`) to render, so open the artifact link instead. **Every UI change is compared against the matching screen sketch before it ships** — layout, spacing, copy and components. Mismatches that cannot be fixed go to `docs/ui-improvements.md`.
- Copy follows the voice rules in the design system README: lead with the number, sentence case, no exclamation marks, no emoji.

## Working principles

- **Smallest change that fully solves the task.** No features, options or abstractions nobody asked for. Reuse what exists before adding anything. Work with `/ponytail:ponytail` active.
- **Read before writing.** Check the design doc for the system, the callers and the tests your change touches.
- **Low confidence: ask me for the decision. Missing information: interview me for the missing points** before building. Do not guess. Record the answer in `docs/decisions.md` or `docs/pre-development-checklist.md`.
- **Every behaviour change gets a test**, and `npm run check` passes before you commit.
- **Review every change before it is committed.** Run `/ponytail:ponytail-review` (or `/code-review`) on the diff and fix or answer each finding. Run `/ponytail:ponytail-audit` before a milestone and `/ponytail:ponytail-debt` to list the `shortcut:` comments still open.
- **One concern per commit and PR.** Do not mix refactors with features.
- **Say what you skipped or did not verify** at the end of your reply.
