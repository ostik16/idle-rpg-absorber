# Pre-development checklist

Written when the repo was set up (2026-11-02), from a read of the design docs and the UI sketches. It lists what is still missing before feature work can start, in the order it is likely to bite.

Items are phrased as decisions or tasks. This list is now tracked in GitHub issues: development work is in the milestone "First playable".

## 1. Decisions the design does not make

### Architecture and tech

All decided in `docs/adr/`, approved by the owner on 2026-11-03. The offline estimator itself is still to build.

- [x] **UI approach.** The sketches are plain HTML and CSS classes. Pick a rendering approach (vanilla, Preact, Svelte, Solid, React) before building screens. The repo currently has none.
- [x] **Simulation model.** Browsers throttle background tabs, so a `setInterval` game loop will stall. Decide now: a fixed-step simulation advanced from timestamps (catch up on return) is the usual answer, and it is the same mechanism offline progress (3.4) needs. Decide whether online play and offline progress share one code path.
- [x] **Offline estimate.** 3.4 says to estimate kills per hour from stats and area, then roll in bulk. That estimator needs a definition: expected time to kill, travel and search time (3.3), potion use, return triggers (3.2). It is the hardest single piece of logic in the game.
- [x] **Random numbers.** Use a seedable RNG so fights, drops and the balance simulators (5.3) are reproducible and testable.
- [x] **Save storage.** `localStorage` holds about 5 MB. A roster, warehouse tabs and bags may outgrow it, so decide between `localStorage` and IndexedDB before writing the save code. Include the save version number and migrations from 5.5 from the start.
- [x] **Clock manipulation.** Offline progress trusts the system clock. Local-only saves make cheating harmless, but decide that explicitly, and decide what happens if the clock goes backwards.

### Numbers nobody has written yet

A fight cannot run without these. 5.3's combat and progression simulators are the way to tune them. All are now set in [decisions.md](decisions.md) (N1 to N12, C1, C2). The owner reviewed them: N1 to N7 approved, N3, N8 to N12, C1 and C2 decided or changed. Nothing is open; the XP table and pacing are approved as they are.

- [x] Derived stat formulas: how Strength, Dexterity, Vitality and Intelligence become damage, attack speed, crit, health, defence, mana (4.2 lists the Data line, the formulas do not exist).
- [x] XP required per level (4.3), and XP reward per enemy level.
- [x] Enemy stat scaling by level, and money drop scaling.
- [x] Weapon attribute penalty curve (2.2).
- [x] Proficiency gain per action, diminishing-return curve, effect per point, title thresholds (4.6).
- [x] Attack speed to attack interval, and heal-over-time rates for potions.
- [x] Character creation: starting attributes, starting gear, anything the player chooses. Decided (C1, C2): name only, attributes start at 5, no gear and no items. The sketches still have no creation screen.

### The 15 open questions already written in the docs

All 15 are answered by the owner in [decisions.md](decisions.md) (Q1 to Q15). Q4, Q5, Q7, Q11 to Q14 approved as proposed; Q1 to Q3, Q6, Q8 to Q10 and Q15 decided differently or in more detail. The 5,000 gold forced shop rotation (Q3) is approved and can be adjusted later.

| # | Section | Question |
|---|---|---|
| 1 | 2.1 | How many bonus attributes can one item roll? |
| 2 | 2.2 | Weapon penalty: gradual or a hard cut? |
| 3 | 2.5 | How often does the rare goods shop rotate? |
| 4 | 2.5 | Does its stock depend on the level of the player's characters? |
| 5 | 2.6 | Is a drop-rate boost applied before or after the level-gap penalty? |
| 6 | 2.7 | At which upgrade level do materials start? |
| 7 | 3.1 | How many areas between level 1 and 30? |
| 8 | 3.3 | Exact targeting penalty (for example double the time between fights)? |
| 9 | 4.1 | How many character slots unlock at level 30? |
| 10 | 4.5 | Max spell rank above 10? |
| 11 | 4.5 | Spell respec gold formula |
| 12 | 4.7 | Does absorption change when the enemy is above the character? |
| 13 | 4.7 | Do cursed-object defenders count as normal enemies? |
| 14 | 06 | Is a Warding Seal used up when an upgrade succeeds, or only when it fails? |
| 15 | 06 | Can low-level characters buy potions they cannot use yet, to pass on through the warehouse? |

Question 12 is now a rule: `src/game/formulas.ts` reads `constants.absorption.enemyAboveCharacterModifier` (1).

## 2. Inconsistencies and gaps in the docs

Small things that will cause arguments during implementation. All eight are settled by the owner in [decisions.md](decisions.md) (I1 to I8).

- [x] **Endurance is two things.** Settled (I1): endurance is dropped. Speed covers travel, toughness covers health, dexterity covers attack speed. Visible stats are health and mana.
- [x] **Speed has no trainer.** Settled (I2): speed is trained by moving and shortens travel and between-enemy time. A new hidden combat skill, trained by attacking, adds to attack speed.
- [x] **Starting character slots.** Settled (I3, Q9): at most 4 slots, 1 unlocked at the start, 3 locked and each unlocked by a ticket a character earns at level 20. The roster sketch still shows 5 of 5.
- [x] **Death details.** Settled (I4): respawn after 4 seconds per level with 10% health, healing to full before farming (T11), inventory and equipment kept. XP loss has a floor at the point marks (T6). Health regeneration is T10.
- [x] **Boost items.** Settled (I5): boost consumables grant a buff like a potion grants health, and boost equipment gives permanent bonuses. Both are in 2.8.
- [x] **"Percentage points" wording.** The intro says drop rates fall by 10 percentage points per level. The formula in 3.8 multiplies the base chance by `1 - 0.1 x diff`. That is 10 points of the modifier, not of the chance (a 5% drop does not go to 4.9%, it goes to 4.5%). Reword the intro so nobody implements it as a subtraction.
- [x] **Proficiency titles.** 4.6 gives four example titles (Novice, Adept, Expert, Master). The sketches use five (adding Apprentice). Fix the list and the thresholds.
- [x] **Document map.** `design/01-introduction.md` lists sections 2 to 5 and leaves out section 6 (UI and Design System).
- [ ] **In-session clock.** ADR 0002 asks for `performance.now()` as the in-session accumulator, and also says the loop calls `advanceTo(Date.now())`. Issue #31 built the second, the only one the engine's timeline supports today, so a small clock change while the tab is open adds or removes steps, or shows the rewind notice. The owner can keep this or ask for the accumulator.
- [ ] **Change notice.** The architecture says the engine "emits a throttled change notice". The engine has none, so `src/ui/frame-loop.ts` refreshes the signals after a frame that ran steps. That caps updates at once per frame, and at 10 Hz with `combat.tickMs` at 100. Issue #31 chose this over changing the engine; the owner can confirm it or reword the architecture.
- [ ] **Rounding on screen.** The engine's health, mana and XP are fractional (XP after a death loss), and the design does not say how to show them. `src/ui/store.ts` rounds all three up, so a living character never reads 0. XP rounded up can read a full level just before the level comes; the owner can confirm this or ask for XP rounded down.
- [ ] **When the game hits an error.** The design does not cover it. `src/start-game.tsx` stops the simulation and the autosave, because state may be partly stepped, and leaves the screen up with a lasting notice. Progress since the last save is lost on reload. The owner can confirm it.
- [ ] **How long save notices stay.** ADR 0003 says the player is told what a load found, not for how long. They stay on screen until the page reloads, with no dismiss button. The owner can confirm it or ask for a dismiss.
- [ ] **Unreadable save.** ADR 0003 asks for a recovery screen. Until #36 adds import, `unrecoverable` shows its message only, and the player has no way to start fresh from it.

## 3. Design and content still to produce

- [x] **First vertical slice content.** (Issue #8: see decisions S1 to S8 and T1 to T9. Area 1 has 11 normal enemies, a mini-boss and a boss. The loop itself is issue #9.) Do not fill every table. Fill just enough to play one loop end to end: Area 1 (levels 1-5), about 5 normal enemies with traits, 1 mini-boss, a drop table each, around 15 items, 2 potions, 3 spells, the XP table to level 10, one upgrade table. Build the loop (travel, fight, loot, return, restock, offline summary) on that, then widen.
- [x] **Screens not sketched.** Character creation, backpack, loot filter rule editor, save export and import, settings, travelling state and death state detail are sketched. The content editor and debug tools (5.2, 5.4) are not, and wait for their issues.
- [ ] **Item art.** None exists. Slots show category icons until it does, and the design system is set up for that.
- [x] **Dev tools plan.** Data validation, the combat simulator, drop calculator and progression curve are built. A proper editor (5.2) comes later.

## 4. Repo housekeeping

- [x] **Licence.** MIT (decisions H1).
- [x] **Visibility.** Public since 2026-11-03 (decisions H1).
- [x] **Hosting.** GitHub Pages on every push to `main` (decisions H2): https://ostik16.github.io/idle-rpg-absorber/
- [x] **Fonts.** Self-hosted through `@fontsource`. A Vite plugin strips the Google Fonts import from `bundle.css`, and CI checks the build has none.
- [x] **Icons.** `lucide-static`, per-icon imports in `src/ui/icons.ts`.
- [x] **Issue tracking.** All in GitHub issues and milestones.
- [x] **Browser and device targets.** Phone first at 390px. Chrome and Edge 111, Firefox 114, Safari and iOS Safari 16.4 (decisions H3).
- [x] **Keep the artifacts in sync.** The artifact is canonical: change it, then re-snapshot into `design/ui/`.

## 5. Follow-ups from the owner review

- [x] **Answer I1.** Endurance dropped (I1).
- [x] **Confirm assumptions.** Answered or approved by the owner: respawn 4 s per level, 10 starting minor health potions, 5,000 gold shop refresh, cursed objects dropping rare items, weapon penalty on weapon damage only, slot ticket applied automatically, targeting multiplier on movement time. Still the lead's defaults, to tune: health regeneration of 0.5% per second (T10) and backpack numbers.
- [x] **Update the UI sketches.** Done in the claude.ai artifact and re-snapshotted (issue #17).
- [x] **Items table.** One table for equipment, consumables, materials and rare items (T2), including the Rotation token and both attribute stones.
- [x] **Pacing.** The owner approved the XP table as it is. Gold per hour can still be checked with the balance tools (5.3).
- [x] **Rewrite the upgrade table** for per-type materials and gold-only up to +5 (S6). The validator enforces a low-level source for every material (T12).
- [x] **Check the drop tables** against the balance principle (S8). The validator enforces the pools and rolls for bosses, cursed objects and mini-bosses.
