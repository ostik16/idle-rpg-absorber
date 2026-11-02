# Pre-development checklist

Written when the repo was set up (2026-11-02), from a read of the design docs and the UI sketches. It lists what is still missing before feature work can start, in the order it is likely to bite.

Items are phrased as decisions or tasks. Tick them off here, or turn them into GitHub issues.

## 1. Decisions the design does not make

### Architecture and tech

- [ ] **UI approach.** The sketches are plain HTML and CSS classes. Pick a rendering approach (vanilla, Preact, Svelte, Solid, React) before building screens. The repo currently has none.
- [ ] **Simulation model.** Browsers throttle background tabs, so a `setInterval` game loop will stall. Decide now: a fixed-step simulation advanced from timestamps (catch up on return) is the usual answer, and it is the same mechanism offline progress (3.4) needs. Decide whether online play and offline progress share one code path.
- [ ] **Offline estimate.** 3.4 says to estimate kills per hour from stats and area, then roll in bulk. That estimator needs a definition: expected time to kill, travel and search time (3.3), potion use, return triggers (3.2). It is the hardest single piece of logic in the game.
- [ ] **Random numbers.** Use a seedable RNG so fights, drops and the balance simulators (5.3) are reproducible and testable.
- [ ] **Save storage.** `localStorage` holds about 5 MB. A roster, warehouse tabs and bags may outgrow it, so decide between `localStorage` and IndexedDB before writing the save code. Include the save version number and migrations from 5.5 from the start.
- [ ] **Clock manipulation.** Offline progress trusts the system clock. Local-only saves make cheating harmless, but decide that explicitly, and decide what happens if the clock goes backwards.

### Numbers nobody has written yet

A fight cannot run without these. 5.3's combat and progression simulators are the way to tune them. All are now set as defaults in [decisions.md](decisions.md) (N1 to N12, C1, C2), pending owner review.

- [x] Derived stat formulas: how Strength, Dexterity, Vitality and Intelligence become damage, attack speed, crit, health, defence, mana (4.2 lists the Data line, the formulas do not exist).
- [x] XP required per level (4.3), and XP reward per enemy level.
- [x] Enemy stat scaling by level, and money drop scaling.
- [x] Weapon attribute penalty curve (2.2).
- [x] Proficiency gain per action, diminishing-return curve, effect per point, title thresholds (4.6).
- [x] Attack speed to attack interval, and heal-over-time rates for potions.
- [x] Character creation: starting attributes, starting gear, anything the player chooses. The design has no character creation rules and the sketches have no creation screen.

### The 15 open questions already written in the docs

All 15 are resolved with defaults in [decisions.md](decisions.md) (Q1 to Q15), pending owner review.

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

`src/game/formulas.ts` has one marked placeholder for question 12. The default is now modifier 1 for an enemy above the character, so the placeholder can become a rule.

## 2. Inconsistencies and gaps in the docs

Small things that will cause arguments during implementation. All eight are settled with defaults in [decisions.md](decisions.md) (I1 to I8), pending owner review.

- [x] **Endurance is two things.** 4.2 lists endurance as a visible stat that sets travel speed. 4.6 lists endurance as a hidden skill raised by moving. Are they the same number, or does the visible stat combine proficiency with something else?
- [x] **Speed has no trainer.** 4.6 names a hidden `speed` skill but gives it no training action (weapon skills train by hitting, toughness by being hit, endurance by moving).
- [x] **Starting character slots.** 4.1 says extra slots unlock at level 30 and does not say how many exist at the start. The roster sketch shows 5 of 5 slots in use with the highest character at Lv 22, so it assumes 5 starting slots. Settle the number, since it sets how fast the roster pillar can be played.
- [x] **Death details.** 3.7 says the character returns to the city. The sketches also assume a respawn delay ("back in 1m 40s") and that the character keeps its inventory ("carrying 22 items"). Neither is in the rules.
- [x] **Boost items.** 2.6 says move speed, attack speed, crit and defence boosts are rare drops, but the single list of rare items (2.8) holds only the XP and drop-rate boosts. Add them to 2.8 or make them ordinary consumables.
- [x] **"Percentage points" wording.** The intro says drop rates fall by 10 percentage points per level. The formula in 3.8 multiplies the base chance by `1 - 0.1 x diff`. That is 10 points of the modifier, not of the chance (a 5% drop does not go to 4.9%, it goes to 4.5%). Reword the intro so nobody implements it as a subtraction.
- [x] **Proficiency titles.** 4.6 gives four example titles (Novice, Adept, Expert, Master). The sketches use five (adding Apprentice). Fix the list and the thresholds.
- [x] **Document map.** `design/01-introduction.md` lists sections 2 to 5 and leaves out section 6 (UI and Design System).

## 3. Design and content still to produce

- [ ] **First vertical slice.** (Data done, issue #8: see decisions S1 to S8; the loop is still to build.) Do not fill every table. Fill just enough to play one loop end to end: Area 1 (levels 1-5), about 5 normal enemies with traits, 1 mini-boss, a drop table each, around 15 items, 2 potions, 3 spells, the XP table to level 10, one upgrade table. Build the loop (travel, fight, loot, return, restock, offline summary) on that, then widen.
- [ ] **Screens not sketched.** Character creation, loot filter rule editor (2.3), save export and import (5.5), settings, a travelling or in-transit state, death state detail, the content editor and debug tools (5.2, 5.4).
- [ ] **Item art.** None exists. Slots show category icons until it does, and the design system is set up for that.
- [ ] **Dev tools plan.** 5.2 to 5.4 are large. Suggest order: data validation (done, basic), then the combat simulator and drop calculator as CLI scripts over `data/`, then a proper editor later.

## 4. Repo housekeeping

- [ ] **Licence.** None chosen. Add one before the repo goes public, or keep it private.
- [ ] **Visibility.** Decide private or public when creating the GitHub repo.
- [ ] **Hosting.** A static build suits GitHub Pages (the Vite `base` is already relative). Add a deploy workflow when there is something to show.
- [ ] **Fonts.** `bundle.css` imports Cinzel, Barlow and Barlow Semi Condensed from Google Fonts. That is a network dependency and a privacy question. Self-host the font files if the game should work offline or without third-party requests.
- [ ] **Icons.** The design specifies Lucide at 1.75 stroke. The sketches inline the SVG paths. Add `lucide-static` or `lucide` as a dependency when building the UI.
- [ ] **Issue tracking.** Turn sections 1 to 3 into GitHub issues, grouped into milestones: "Decide", "Vertical slice", "Dev tools".
- [ ] **Browser and device targets.** Phone first at 390px. State the minimum browsers.
- [ ] **Keep the artifacts in sync.** The artifacts on claude.ai and the snapshots in `design/ui/` can drift. Decide which is canonical for changes (suggested: the artifact, then re-snapshot).
