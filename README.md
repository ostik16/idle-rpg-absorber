# Idle RPG Absorber

A browser-based idle RPG. Characters farm on their own. You decide where they fight, how they grow and what they become. They absorb the magical strengths of the enemies they kill, and the best farmer is often the weakest character in your roster.

Status: **early development.** The design is written, the UI is sketched, and the engine and app shell are in place. There is nothing to play yet. Work is tracked in the [First playable milestone](https://github.com/ostik16/idle-rpg-absorber/milestones).

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
| `design/ui/screens/` | Snapshot of the screen sketches artifact (19 phone screens, 2 desktop layouts, 6 component sheets) |
| `data/` | Game content as JSON tables (design 5.1). See [`data/README.md`](data/README.md) |
| `src/game/` | Pure game rules: the formulas the design has decided |
| `src/engine/`, `src/state/`, `src/data/` | Fixed-step simulation, state types and the data loader ([ADR 0002](docs/adr/0002-simulation-loop-and-offline.md)) |
| `src/ui/` | Preact app shell, hash router, icons ([ADR 0001](docs/adr/0001-ui-approach.md)) |
| `src/styles/tokens.css` | Generated from the design system's `tokens.json`. Run `npm run tokens` after changing it |
| `tests/` | Vitest tests. The formula tests check the tables printed in the design docs |
| `tools/` | `build-tokens.mjs`, `validate-data.mjs` and the [balance tools](tools/balance/README.md) |
| `docs/` | [Decisions](docs/decisions.md), [architecture](docs/architecture.md), ADRs and the pre-development checklist |

## Design artifacts

The two artifacts on claude.ai are the live, editable versions. The copies in `design/ui/` are snapshots (design system 2026-11-02, screens 2026-11-03) so development does not depend on them. If you change one, update the other.

- Design system: https://claude.ai/artifact/3n12SGkJ1VWxMXAQ8HMZrb
- Screen sketches: https://claude.ai/artifact/MM1u7hrsEdZww1XtTKEiE1

See [`design/ui/README.md`](design/ui/README.md) for how to read the snapshots.

## Stack

TypeScript, Vite, Vitest, Preact with signals. Pushes to `main` deploy to [GitHub Pages](https://ostik16.github.io/idle-rpg-absorber/).

Minimum browsers: Chrome and Edge 111, Firefox 114, Safari and iOS Safari 16.4. Phone first at 390 px.

## Licence

[MIT](LICENSE) for the code. Barlow, Barlow Semi Condensed and Cinzel keep the SIL Open Font Licence, and Lucide icons keep the ISC licence.
