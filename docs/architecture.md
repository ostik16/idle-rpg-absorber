# Architecture overview

Approved by the owner on 2026-11-03. Decisions are in `docs/adr/`.

## Principle

The game is a pure TypeScript engine over JSON data. The UI is a thin view on top. Saves are a serialised copy of engine state. Anything in `src/engine`, `src/game`, `src/data` and `src/save` runs in Node, so tests and balance tools (design 5.3) need no DOM.

## Module layout under `src/`

| Folder | Holds | Notes |
|---|---|---|
| `data/` | Loader and types for `data/*.json` and `data/constants.json`; builds the frozen `GameData`; `requireConstant()` | Same rules as `tools/validate-data.mjs`. No game logic. |
| `game/` | Pure rules: `formulas.ts`, RNG (sfc32, `rng.ts`), drop rolls, absorption, upgrade chance, level modifier | Pure functions, numbers in as arguments. Every formula tested against the design docs. |
| `engine/` | Fixed-step simulation, character state machines, per-character RNG streams, command dispatch, event list, offline estimator | `advanceTo(nowMs)` is the only way time moves. No DOM, no storage, no `Math.random`. |
| `state/` | State types (account, roster, warehouse, bestiary), selectors, command handlers for UI actions | Plain serialisable objects. The single source of truth. |
| `save/` | IndexedDB wrapper, envelope, migrations, export and import, backup rotation | Depends on `state/` types only. |
| `ui/` | Preact components, signals adapter, hash router, screens, icon set | Uses `ab-` classes from `design/ui/design-system/components/bundle.css`. |
| `styles/` | `tokens.css` (generated), imports of `bundle.css` | Do not edit `tokens.css` by hand. |
| `main.tsx` | Composition root: load data, load save, start engine, mount UI, wire autosave | Only place that knows every module. |

## Dependency direction

```
main
 |- ui --------> state, engine (types and dispatch only)
 |- save ------> state
 |- engine ----> game, state, data
 |- game ------> data (types only)
 |- state -----> game, data
 '- data -----> (nothing in src)
```

Rules: lower layers never import upper ones. `engine` never imports `ui` or `save`. `ui` never mutates `state`; it dispatches commands. Browser APIs (`Date`, IndexedDB, DOM, `visibilitychange`) are touched only in `main.tsx`, `save/` and `ui/`; the engine receives time as an argument.

## Data flow

1. `main` loads and validates data, then loads the save (`save/`, migrates if needed).
2. `main` builds the engine from `GameData` and saved state, and calls `advanceTo(now)` to catch up (ADR 0002).
3. A frame loop calls `advanceTo(now)` while visible; `visibilitychange` triggers a catch-up.
4. The engine mutates `state`, emits a throttled change notice; the `ui` adapter updates signals.
5. UI actions become commands; the engine applies them between steps.
6. `save/` serialises `state` on a timer, on page hide and after irreversible actions.

## Which ADR governs what

| ADR | Governs |
|---|---|
| 0001 UI approach | `ui/`, `styles/`, the signals adapter, component and CSS rules |
| 0002 Simulation loop and offline | `engine/`, RNG, `data/` constant access, offline estimator and its validation, clock handling |
| 0003 Save storage | `save/`, the shape of persisted `state`, migrations, export and import |

## Testing split

- `tests/` for `game/` and `engine/`: Vitest, node environment, fixtures for `GameData`.
- Estimator drift test (ADR 0002) and migration fixtures (ADR 0003) are required checks in `npm run check`.
- UI: a few component tests only; screens are checked against the sketches by eye.
