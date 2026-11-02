# ADR 0001: UI approach

Status: proposed default, awaiting owner review.

## Context

- Phone first at 390px, desktop layouts from 900px (design 6).
- Many small numbers update live: HP, mana, XP, loot feed, timers, for 5 or more characters at once (4.1). Most are off screen at any moment.
- The design system is plain CSS with `ab-` classes in `design/ui/design-system/components/bundle.css`. Markup must use these classes unchanged. A framework that scopes or rewrites CSS would fight this.
- Small bundle, since the game is a static page on a phone (checklist section 4, hosting).
- Game state must live outside the UI so the engine runs in Vitest without a DOM (5.3 simulators run as CLI scripts over `data/`).
- The repo has no UI dependency yet. Icons are Lucide (design system README).

## Decision

Use **Preact with @preact/signals**, with all game state in a plain TypeScript engine that knows nothing about Preact.

- The engine owns state (see ADR 0002 and `docs/architecture.md`). The UI never mutates it. It sends commands (`engine.dispatch({type: ...})`) and reads view data.
- A thin `ui/store` adapter publishes engine state into signals. The engine emits change notifications at most once per UI frame (about 4 to 10 Hz for live numbers, not per simulation step). The adapter exposes one signal per character view (hp, mana, xp, activity, loot feed) and one per list (roster, warehouse tab, bag).
- Components bind signals directly in JSX text positions (`{hp}`), so a number change updates one text node without re-rendering the component tree. This suits many small live numbers.
- Components are function components that render the existing `ab-` markup, for example `<div class="ab-resource-bar ...">`. Use `class`, not `className`, which Preact supports. Component CSS is not re-written. Tokens come from `src/styles/tokens.css`.
- No CSS-in-JS, no CSS modules, no utility framework.
- Routing: a small hash router (about 30 lines, own code) for the four tabs and sheets. No router dependency.
- Icons: `lucide-static` SVG sprites or per-icon imports, inlined at build time. Do not ship the whole icon set.
- Tests: engine tests are pure Vitest (node environment). UI tests, if any, use `@testing-library/preact` with `happy-dom`, kept few.

Expected cost: about 4 kB gzip for Preact plus about 2 kB for signals.

## Consequences

- Good: tiny runtime, `class` and plain CSS work as is, signals give fine-grained updates without hand-written DOM code, JSX gives typed components.
- Good: the engine/UI split is enforced by dependency direction (UI imports engine types, engine imports nothing from UI), which lets 5.3 tools reuse the engine.
- Cost: signals add a second reactivity concept next to the engine state. The adapter must stay thin and be the only place that creates signals.
- Cost: Preact is not React-compatible in every library. Avoid React-only component libraries (none are planned).
- Risk: the adapter throttle must not hide state from the player when the tab returns. On `visibilitychange` the adapter forces one full refresh.

## Alternatives considered

- Vanilla TypeScript: smallest, but hand-written DOM diffing for lists (bags, warehouse grids, loot feed) is repetitive and error prone.
- Solid: best fine-grained updates and similar size, but a smaller ecosystem and a JSX compile quirk set, and signals in Preact give most of the benefit.
- Svelte: compiled and small, but its component-scoped CSS model and `.svelte` build step add friction with the shared `bundle.css`, and engine-outside-UI needs stores anyway.
- React: largest runtime, re-render model needs memoisation discipline for live numbers; no benefit over Preact here.
