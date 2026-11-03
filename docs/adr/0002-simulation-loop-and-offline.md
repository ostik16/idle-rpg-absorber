# ADR 0002: Simulation loop and offline progress

Status: accepted, approved by the owner on 2026-11-03. Constants named below as `null` or proposed are now set in `data/constants.json`, and the frame budget is `engine.maxStepsPerFrame`. Amended on 2026-11-03: gold is per character (decisions L16).

## Context

- All characters farm at once, online and offline (3.4, 4.1). Combat is real time with attack speed deciding attack frequency (3.6).
- Browsers throttle timers in background tabs, so a `setInterval` loop stalls and cannot be the clock.
- Offline progress is estimated in bulk from stats and area (3.4 Proposed). The estimator must agree with real play, or players are punished or rewarded for closing the tab.
- Content and numbers live in `data/*.json` and `data/constants.json`, never in `src/` (5.1, CLAUDE.md). A `null` constant means undecided.
- Balance tools (5.3) and tests need reproducible runs.

## Decision

### One engine, driven by timestamps

`engine.advanceTo(nowMs)` advances the simulation to a wall-clock time by running whole fixed steps. Nothing else moves game state. The browser runs `requestAnimationFrame` while visible and a `visibilitychange` handler on return. Neither is the clock; they only call `advanceTo(Date.now())`. Tests and tools call it with synthetic times.

- **Step length:** `combat.tickMs` from `data/constants.json`, **100 ms**. Attack intervals, travel and search times are quantised to whole steps by one function in `formulas.ts`. The engine refuses to start while `tickMs` is `null`.
- **Time source:** `Date.now()` for the saved timeline; `performance.now()` for the in-session accumulator, so small clock changes do not add or remove steps while the tab is open.
- **Online budget:** at most 600 steps (60 s of game time) per frame. A larger backlog is handed to the catch-up path below.

### Multiple characters

Each character is an independent state machine (travel, search, fight, loot, return, restock, dead) with no shared mutable state except the warehouse. Each step iterates characters in stable id order and advances each one step. Shared effects (warehouse deposits, bestiary reveals) are applied through an ordered event list at the end of the step, so results do not depend on iteration order beyond id order. Characters never interact in combat, so a character can also be advanced alone for a time range (used by catch-up and tests).

### RNG

**sfc32** (four 32-bit words of state), seeded from a 128-bit seed through splitmix32. Pure TypeScript, about 15 lines, fast, passes PractRand. A master seed is stored in the save. Each character has its own stream, derived as `splitmix(masterSeed, characterId, streamIndex)`. Separate streams per purpose (combat, drops, search) keep a change in one system from reshuffling the others, which makes balance diffs readable. Stream state (4 words) is part of the save (ADR 0003). No `Math.random` anywhere in `src/game` or `src/engine`; `tests/purity.test.ts` enforces it.

### Catch-up on return and offline

On load or tab return, `gap = now - lastSimulatedAt`.

1. `gap < 0`: see clock handling below.
2. `0 <= gap <= stepSimMaxSeconds`: run the real step simulation for the whole gap (loot appears as normal).
3. `gap > stepSimMaxSeconds`: capped gap goes through the **offline estimator**; the result becomes a per-character summary for the Welcome back screen (3.4, design 6).

`stepSimMaxSeconds` is a constant under `offline` in `data/constants.json`: 300 (5 minutes). Short gaps use exact simulation so brief tab switches never feel different.

### Offline estimator

For each character, from state at `lastSimulatedAt`: build one **farming cycle** from the same formulas the step sim uses (`formulas.ts`): time to kill each enemy type weighted by area spawn weights (3.1), movement between enemies, the targeting extra-time multiplier (3.3), expected damage taken and potion use, and the return triggers (bag full, health threshold, 3.2). A cycle is search + fights + travel back + sell, restock and heal + travel out. From cycle length and expected yields, compute the number of kills in the capped time. Then **roll in bulk** with the character's RNG: drops via binomial draws (normal approximation above a size threshold), money by sum of ranges, absorption and bestiary kills added in aggregate, proficiency at `offline.proficiencyRate`. XP and levels are applied by walking the XP table, since level changes alter the cycle; the estimator is re-run per level band. Death risk: if expected damage per fight exceeds what potions cover, the estimator ends the character's farming at the expected death time and applies the 3.7 penalty, never silently.

Yields are multiplied by `offline.efficiency`. Time beyond `offline.capHours` is discarded, and the summary says so.

### Validating the estimator against the step sim

- Test suite `tests/offline-vs-step.test.ts`: for a fixed set of builds and areas from the first vertical slice, run the step sim for the cap length over 200 seeds and the estimator over the same, with efficiency set to 1. Assert that mean kills, XP, gold and per-item drop counts are within 3 percent, and that their standard deviations are within 20 percent.
- The 5.3 "offline report" tool runs the same comparison on any build and prints the drift. The tolerance values live in the test, not in game data.
- Any change to `formulas.ts` or cycle logic must pass this suite. Edge cases (bag fills early, potions run out, boss spawn chance) each get their own fixture.

### Clock going backwards

If `now < lastSimulatedAt` (manual change, NTP step, DST bug): grant no progress, set `lastSimulatedAt = now`, record `clockRewind` in the save diagnostics and show a one-line notice. Do not punish and do not try to detect cheating: saves are local only (5.5), so cheating harms nobody else. Large forward jumps are treated as real absence and bounded by the cap.

### Reading data

`src/data` loads and type-checks all `data/*.json` once (same validation rules as `tools/validate-data.mjs`) into a frozen `GameData` object passed into the engine constructor. The engine and `formulas.ts` take numbers from `GameData.constants`; a `requireConstant(path)` helper throws a clear error when a value is `null`. Tests construct `GameData` from small fixtures.

## Consequences

- One code path for play; offline is the only place with an approximation, and it is tested against ground truth.
- Reproducibility: seed plus data plus commands gives the same run, which the simulators need.
- Cost: the estimator duplicates cycle logic in aggregate form. The shared `formulas.ts` and the drift test contain that risk.
- New constants: `combat.tickMs`, `offline.efficiency`, `offline.capHours`, `offline.proficiencyRate`, `offline.stepSimMaxSeconds`, `engine.maxStepsPerFrame`.

## Alternatives considered

- `setInterval` loop: stalls in background tabs.
- Web Worker simulation: useful later for long catch-ups, but workers are throttled less, not never, and it complicates tests. Revisit if catch-up blocks the UI.
- Pure estimator for everything, no step sim: cannot show live fights, drops or the loot feed.
- Always simulate offline time step by step: too slow for hours of 5+ characters on a phone.
- `Math.random` or `mulberry32`: not seedable per stream, or too weak a state for many independent streams.
