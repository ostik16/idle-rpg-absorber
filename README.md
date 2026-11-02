# Idle RPG Absorber

A browser-based idle RPG. Characters farm on their own. You decide where they fight, how they grow and what they become. They absorb the magical strengths of the enemies they kill, and the best farmer is often the weakest character in your roster.

Status: **pre-development.** The design is written, the UI is sketched, and this repo is scaffolded. There is no game yet. Start with [`docs/pre-development-checklist.md`](docs/pre-development-checklist.md).

## Quick start

```bash
nvm use            # Node 22 (see .nvmrc)
npm install
npm run dev        # placeholder shell on http://localhost:5173
npm run check      # typecheck, tests, data validation, token sync
```

## What is in the repo

| Path | What |
|---|---|
| `design/01…05-*.md` | The game design document, one file per section. Source of truth for rules |
| `design/06-ui-design-system.md` | UI and design system rules, with links to the claude.ai artifacts |
| `design/ui/design-system/` | Snapshot of the design system artifact: tokens, brand book, component guidelines, `components/bundle.css` |
| `design/ui/screens/` | Snapshot of the screen sketches artifact (13 phone screens, 2 desktop layouts, 6 component sheets) |
| `data/` | Game content as JSON tables (design 5.1). See [`data/README.md`](data/README.md) |
| `src/game/` | Game logic. So far only the formulas the design has already decided |
| `src/styles/tokens.css` | Generated from the design system's `tokens.json`. Run `npm run tokens` after changing it |
| `tests/` | Vitest tests. The formula tests check the tables printed in the design docs |
| `tools/` | `build-tokens.mjs` and `validate-data.mjs` |
| `docs/` | Working notes: the pre-development checklist |

## Design artifacts

The two artifacts on claude.ai are the live, editable versions. The copies in `design/ui/` are snapshots taken on 2026-11-02 so development does not depend on them. If you change one, update the other.

- Design system: https://claude.ai/artifact/3n12SGkJ1VWxMXAQ8HMZrb
- Screen sketches: https://claude.ai/artifact/MM1u7hrsEdZww1XtTKEiE1

See [`design/ui/README.md`](design/ui/README.md) for how to read the snapshots.

## Stack (provisional)

TypeScript, Vite, Vitest. No UI framework yet. See the checklist for what is still to be decided.
