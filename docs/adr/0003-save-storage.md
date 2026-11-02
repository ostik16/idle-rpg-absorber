# ADR 0003: Save storage

Status: proposed default, awaiting owner review.

## Context

- Local only for now; export and import and a save version number are wanted (5.5).
- The save holds a roster (4.1), the shared warehouse with tabs (2.4, tabs are bought with gold), bags and equipment, spell and proficiency state, per-character bestiary kills and shared reveals (4.8), absorption progress (4.7), and timestamps for offline progress (3.4).
- `localStorage` is about 5 MB, synchronous, and strings only. Item instances with rolled bonuses, many warehouse tabs and 10 or more characters could approach it over time.
- Data tables change during development (5.1), so old saves must be migrated.

## Decision

### Storage

**IndexedDB**, one database `idle-rpg-absorber`, object store `saves`, written through a small own wrapper (about 50 lines, no dependency). Reasons: asynchronous (autosave does not block the frame), far larger quota, transactional writes. A tiny `localStorage` key `ab.meta` holds only the active slot name and last-saved time, for fast boot decisions. If IndexedDB is unavailable (some private modes), fall back to `localStorage` for the save, and show a notice recommending export. Call `navigator.storage.persist()` after the first save.

### Save envelope

```
{ format: "idle-rpg-absorber", version: <int>, savedAt, appBuild, checksum, payload }
```

`checksum` is CRC-32 of the serialised payload. JSON is the only format (readable, diffable, easy to migrate).

### Contents of `payload`

- `clock`: `lastSimulatedAt`, `savedAt`, `masterSeed`, diagnostics (`clockRewind` count).
- `account`: gold, warehouse tabs (grid size, bought tabs, cell contents), unlocked character slots, settings.
- `roster[]`: id, name, level, XP in level, points spent and unspent (4.4), attributes, proficiency values (hidden numbers are stored, shown as titles), spells (ranks, auto-cast order, conditions), equipment, bag, current hp and mana, activity state (area, target, phase, time in phase), return trigger settings (3.2), loot filter rules (2.3), absorption progress per trait (4.7), RNG stream states (ADR 0002).
- `bestiary`: kills per character per enemy id, and `revealed` per enemy id as the highest threshold tier reached by any character. Reveals are stored, not derived, so deleting a character cannot hide knowledge that was shared (4.8 Rules).
- `shops`: rare goods rotation state and buyback lists (2.5).
- `pendingSummary`: offline summary not yet shown, so closing the tab on the Welcome back screen loses nothing.

Items are stored as `{ itemId, rolled bonuses, upgradeLevel, qty }`, never copies of table data. Data is referenced by id (5.1), so a rebalance applies to existing saves.

### Writing

Autosave every 30 s of real time, on `visibilitychange` to hidden, on `pagehide`, and after irreversible actions (spending points, upgrades, selling, 4.4 and 2.7). Writes go to a rotating set: `current`, `previous`, `previous2`. A write is a new record, then the pointer moves, so a crash mid-write leaves the older record intact. Debounce so only one write is in flight.

### Versioning and migrations

`version` is an integer, bumped on any payload shape change. `src/save/migrations.ts` holds an ordered list of pure functions `v -> v+1`. Load runs every missing step in order, then validates against the current schema. Each migration ships with a fixture of the older shape and a test. Before migrating, the unmigrated record is copied to `backup-v<N>`. A save with a newer version than the game is not opened; the player is told to update, and the record is left untouched.

Data table changes that keep the shape (an item removed from `data/items.json`) are handled by a reconcile pass after load: unknown item ids move to a "Recovered items" warehouse tab with a notice; unknown enemy or area ids are dropped from active state and the character returns to the city.

### Export and import (5.5)

- Export: downloads `idle-rpg-absorber-<date>.json` (the envelope) and offers copy to clipboard. Same code as the autosave serialiser.
- Import: read file, check `format`, checksum and version, migrate, validate, then show a summary (characters, levels, gold, saved time) and require a confirm step that states the consequence: "This replaces the current save." The current save is backed up first.
- Not encrypted or signed. Editing is not a threat (ADR 0002).

### Corruption and backup handling

On load, try `current`, then `previous`, then `previous2`, then `backup-v<N>`. The first record passing parse, checksum and schema wins; the player is told which was used and its age. If none loads, show a recovery screen: import a file, or start fresh. Nothing is deleted without confirm. Failed records are kept under `corrupt-<time>` for export.

## Consequences

- Good: no 5 MB ceiling, non-blocking writes, safe against a crash during save.
- Good: migrations are tested the same way as formulas.
- Cost: IndexedDB is async, so boot has an await before the first render (a splash state). The wrapper and fallback path add code that needs tests with a fake IndexedDB (`fake-indexeddb`).
- Cost: reveals are duplicated state to keep consistent; a load-time check recomputes them from kill counts and keeps the higher.

## Alternatives considered

- `localStorage` only: simplest, but synchronous writes jank, 5 MB cap risk, and no transactions.
- A storage library such as Dexie or localForage: more features than needed for one record set; a wrapper is small.
- Compressed or binary saves: smaller, but harder to debug and migrate; size is not the constraint with IndexedDB.
- Save per character as separate records: easier partial writes, but the warehouse is shared and cross-record consistency is harder.
- Cloud sync: out of scope; design says local only for now (5.5).
