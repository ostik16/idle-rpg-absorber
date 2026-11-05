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
- [x] **In-session clock.** ADR 0002 asks for `performance.now()` as the in-session accumulator, and also says the loop calls `advanceTo(Date.now())`. Issue #31 built the second, the only one the engine's timeline supports today, so a small clock change while the tab is open adds or removes steps, or shows the rewind notice. The owner can keep this or ask for the accumulator. Decided (R1).
- [x] **Change notice.** The architecture says the engine "emits a throttled change notice". The engine has none, so `src/ui/frame-loop.ts` refreshes the signals after a frame that ran steps. That caps updates at once per frame, and at 10 Hz with `combat.tickMs` at 100. Issue #31 chose this over changing the engine; the owner can confirm it or reword the architecture. Decided (R2).
- [x] **Rounding on screen.** The engine's health, mana and XP are fractional (XP after a death loss), and the design does not say how to show them. `src/ui/store.ts` rounds all three up, so a living character never reads 0. XP rounded up can read a full level just before the level comes; the owner can confirm this or ask for XP rounded down. Decided (R3).
- [x] **When the game hits an error.** The design does not cover it. `src/start-game.tsx` stops the simulation and the autosave, because state may be partly stepped, and leaves the screen up with a lasting notice. Progress since the last save is lost on reload. The owner can confirm it. Decided (R4).
- [x] **How long save notices stay.** ADR 0003 says the player is told what a load found, not for how long. They stay on screen until the page reloads, with no dismiss button. The owner can confirm it or ask for a dismiss. Decided (R5: all notices dismiss, auto-dismiss after 5 s, kept in a notification center, details open in decisions.md).
- [x] **Unreadable save.** ADR 0003 asks for a recovery screen. Until #36 adds import, `unrecoverable` shows its message only, and the player has no way to start fresh from it. Decided (R6: export the corrupted records first, then start fresh).
- [ ] **Cost of copying lists to the UI.** `copyInto` in `src/ui/store.ts` runs `JSON.stringify` on every bag and warehouse tab at each refresh. #28 measures 4 characters on a phone and decides then whether it needs a dirty flag.

## 3. Design and content still to produce

- [x] **First vertical slice content.** (Issue #8: see decisions S1 to S8 and T1 to T9. Area 1 has 11 normal enemies. The mini-boss and boss written for it are in no area for now (S2). The loop itself is issue #9.) Do not fill every table. Fill just enough to play one loop end to end: Area 1 (levels 1-5), about 5 normal enemies with traits, 1 mini-boss, a drop table each, around 15 items, 2 potions, 3 spells, the XP table to level 10, one upgrade table. Build the loop (travel, fight, loot, return, restock, offline summary) on that, then widen.
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
- [x] **Choices made building death (#24), for the owner to check.** None of these is in the design. (1) Healing after death runs in the `restocking` phase, the character's time in the city, so #27 can put selling and restocking ahead of it. (2) In the city a character drinks one potion at a time, and only when none is running, so regeneration can save the last one. (3) It picks the largest potion that fits what is missing up to its healing target, or the smallest when none fits: the L9 rule, measured to 65% for balanced and 100% for fast. (4) XP lost rounds down to a whole number, so a character always holds whole XP. (5) Character points can be spent in any phase, including in a fight and while dead. (6) Raising vitality raises maximum health and does not heal. Decided (R7).
- [x] **Confirm the farming assumptions from issue #22.** The design does not settle these, so the engine assumes them: Decided (R8).
  - Looting takes no time of its own.
  - A spawn chance applies per finished search, and the boss and mini-boss share one roll, so listed enemies take the rest of the spawns.
  - A target skips the spawn roll, so no boss or mini-boss turns up while targeting. The mini-boss and boss can be targeted, because their data sets a multiplier for it.
  - A target needs an area, so it cannot be set in the city. It is refused while fleeing or on the way back, and kept if set while dead. On a search under way it applies at once and keeps the time already spent, so a fight can start straight away.
  - A return clears the target.
  - The player's return command ends farming, and the character stays in the city. `stayInCity` keeps this through a death while fleeing, and a return also works while dead or healing.
  - Turning back on the way out takes as long as it has walked.
  - A character changes area only from the city.
  - A character needs full health to be sent out, following 3.2.
- [x] **Owner question from the #22 review.** Answered in S2: the first area has no mini-boss or boss, and a cursed object is the only special it can have.
- [ ] **Model bosses in `balance:drops`.** The tool leaves out the boss and mini-boss. Area 1 now has neither (S2), so this waits for the first area that does. The tool will need a rule for a boss the build cannot beat, and `--target` will need to accept the boss and mini-boss, as the engine does.
- [ ] **A source for rare items.** Every rare item that drops lists only Mossfang Matriarch as its source, and she is in no area now (S2). No rare item can drop until a cursed object or a later area exists. Cursed objects are outside the first playable batch (#9). Decide where Old Mossfang and Mossfang Matriarch go.
- [ ] **Update the UI sketches for S2.** Change any sketch that shows a boss in Area 1 in the claude.ai artifact, then re-snapshot it.

## 6. Choices made while building the save system (#30)

ADR 0003 left these open. They are recorded here so the owner can overrule them.

- [x] **A newer save stops the recovery.** A record from a newer version ends the load at once: no older record is opened and nothing is written, not even the copies of records that failed before it. That tab then refuses writes, so it cannot rotate the record out, and a stale writer stops itself (see below). The same holds for a newer record found only in an old `backup-v*` or `corrupt-*` entry: it is reached only when nothing before it loaded, and an update may open it, so the player is told to update. The ADR only says the record is not opened.
- [x] **A bad state is never written.** A write validates against the same schema as a load and is refused if it fails. Otherwise a `NaN`, which JSON turns into `null`, would get a valid checksum and three autosaves would push out every good record. The player sees a notice, and saving stays refused until the state is valid again.
- [x] **Failed records leave the rotation and can come back.** A failed record is copied to `corrupt-<time>-<position>` and taken out of the rotation, so a fresh start cannot push it out. Recovery tries those copies last, the latest failure first, so a fixed build can open a record that a build with a bug refused. Only a full `localStorage` removes a copy (see below).
- [x] **A store fault is not a verdict on the save.** If the store fails during a load, or a copy or backup cannot be written, the load ends in `storeFault`. No older record takes over, no fresh start is offered, and writes stay refused until a later load works.
- [x] **Evidence of a save.** `empty` means no records anywhere and no `ab.meta`. If `ab.meta` says IndexedDB holds a newer save and this boot only has the fallback, the load ends in `storeFault`. If the store works and the save named by `ab.meta` is gone, it ends in `unrecoverable`. To tell these apart, `ab.meta` also holds which storage has the save. That goes past the ADR's "only the active slot name and last-saved time".
- [x] **One writer: the lease.** `load` takes a Web Locks lease named `idle-rpg-absorber-writer`, before it reads or writes anything, and holds it until the page goes. A second tab gets `otherTab`: it must not start the game, and its writes are refused. It can load again once the first tab has gone. Where Web Locks is missing or refuses, the load goes on without a lease.
- [x] **Waiting for the lease.** A new page tries again after `save.leaseWaitSeconds` (1) before it says `otherTab`, in case a reload starts before the old page has let go. 13 reloads in Chromium with no wait never lost the lease, so this is a safeguard for other browsers, not a fix for something seen. A real second tab costs one second at boot. The number is mine.
- [x] **Where there is no lease: a stale writer stops itself.** A tab remembers the pointer's number from its last load or write. If the number has moved, the write is refused with `SaveBlockedError` reason `otherTab`, nothing is written, and `saveFailureNotice` tells the player. The pointer only moves by compare-and-swap, so of two writers that read the same pointer one wins and the other takes its record back and stops. Records are `record-<n>-<writer>`, so two writers cannot overwrite the same key, and tidying up leaves any record numbered above its own. That tab loses its progress since its last autosave, but it is told and no newer record goes. Loading again makes it the writer.
- [x] **Coming back from the fallback.** A fallback save becomes the current record only when it cannot hide anything: IndexedDB has no records, or its newest record came from the fallback, nothing was written since, and the fallback has moved on. The pointer keeps the fallback's number for this (`fallbackSeq`), and any write clears it. `savedAt` plays no part, so a new game started during an outage, a wrong clock or a cleared `ab.meta` cannot put a fallback save in front of the real one. The fallback keeps its copy.
- [x] **A full `localStorage`.** A browser that needs the fallback has about 5 MB and nowhere else. On a quota error the write frees space and tries again, in this order: records no pointer lists, the oldest `corrupt-*`, then the oldest of the rotation. It stops while one record that reads is left, and then the write fails. This goes against the ADR's "Nothing is deleted without confirm" for `corrupt-*`: the owner asked for it in the review of PR 44. IndexedDB frees nothing.
- [x] **Connections.** A tab closes its connection when another asks for a higher database version, so an old tab cannot block an upgrade. Requests that arrive together after a close share one new connection.
- [x] **Ids in settings.** Reconcile also removes unknown items from `restockList` and `potionThresholds`. They are the player's settings, not stacks, so nothing moves to Recovered items and no notice is shown.
- [x] **Backup timing.** Migrations are pure, so they run in memory first and `backup-v<N>` is written only for a record that passes. A record that cannot be migrated never replaces a good backup. If the backup cannot be written, the load ends in `storeFault` and the migrated save is not used.
- [x] **Saving after an action.** A command applies at the next step, so `saveNow` straight after `dispatch` saves the old state. `onEngineEvents` saves when a listed event arrives, because the event proves the command applied. `main` lists the events.
- [x] **Returning to the city** means phase `idle`, with the fight dropped and `stayInCity` cleared, because it has arrived. An area or target that still exists is kept, because it is the player's choice. A dead character stays dead with its `stayInCity`, so its respawn still runs.
- [x] **Recovered items tab.** It is a normal warehouse tab, added last, with a `name` field that `isRecoveredTab` checks. Each stack counts as one cell, because an unknown item's size is gone with its row. The tab is created only when something is recovered.
- [x] **Buyback stacks.** An unknown item in the buyback list moves to the Recovered items tab like any other stack. The player gets it back without paying, which the ADR's rule implies but does not state.
- [x] **Offline summary.** Unknown items are dropped from a summary not yet shown, so the Welcome back screen can look up the rest. The summary is only a report: the stacks themselves move to the Recovered items tab.
- [x] **Third storage fallback.** Where both IndexedDB and `localStorage` are blocked, the game runs on memory with a notice that progress is lost when the tab closes.

Still open:

- [x] **A game played only on the fallback.** If IndexedDB holds a save and the player starts a new game during an outage, that game stays in `localStorage` once IndexedDB works. It is not lost and is not in front of the real save, but nothing offers it to the player. #36 can. Decided (R9).
- [x] **`localStorage` and two tabs.** Its compare-and-swap is a read then a write, which is one step within a tab but not strictly across processes. This only matters where IndexedDB and Web Locks are both missing. The record keys and the number check still apply. Decided (R9).
- [x] **The `pagehide` save.** A review saw it not land on a reload in Chromium, and synchronous transactions did not help. It stays as an attempt, but it must not be counted on: up to one autosave interval can be lost when a tab closes. A `saveAfter` command still queued when the tab hides is not in that save either. Not decided. Decided (R9).
- [x] **The checksum does not cover `version`.** This matches the ADR, which says the checksum is of the payload. A damaged `version` that still parses is not caught by the checksum. Decided (R9).
- [x] **A store fault that never clears.** `storeFault` asks the player to reload. If one record stays unreadable for good, the game never starts, and there is no way out until the owner decides on one, such as an export or a choice to load an older save. Decided (R9).
- [x] **A fresh start on a build with a bug.** If a player starts fresh there and a later build fixes the bug, the new game is `current`, so the old save stays in `corrupt-*` and is not loaded. `corruptRecords()` marks it `readable`, but nothing tells the player yet. #36 can offer it. Decided (R9).
- [x] **Recovered tab field.** `RecoveredTab` lives in `src/save/reconcile.ts`, because #30 stayed inside `src/save/`. Move `name` to `WarehouseTab` in `src/state/types.ts` when the warehouse screen is built. Tab buying must not count this tab when it reads `constants.storage.tabCosts`. Decided (R9).
- [x] **Reveals check at load.** ADR 0003 asks for reveals to be recomputed from kills at load, keeping the higher. Nothing defines a tier number yet, so this belongs with #25, which writes `bestiary.revealed`. Decided (R9).

## 7. Choices made while building drops and the bag (#23)

- [x] **Cells per stack.** A stack takes its item's `size` in cells, whatever its quantity, so a sword is 3 and a stack of scraps is 1. L7 says "a stack uses 1"; every stackable item has `size` 1 today, so the two agree. A stackable item with a larger `size` would take that many cells per stack.
- [x] **Partial pickup.** A stack that only partly fits goes in as far as it fits (a new stack opens only if its `size` is free), and the rest is left behind with `bagFull`. The design does not say whether a drop is all or nothing.
- [x] **Merging.** A stackable drop tops up existing stacks of the same item with the same bonuses and upgrade level first, then opens new stacks of up to the max stack. A stack already above the max (a smaller backpack was fitted) takes nothing more and is not split.
- [x] **Loot filter.** Enabled: an item is picked up only if it matches at least one rule. No rules means nothing is picked up. A rule matches when every field it sets matches: category equal, the item's `requiredLevel` at or above `minRequiredLevel` (an item with no level counts as 1), and one rolled bonus on `bonusAttribute`. A rule with no fields matches everything. Disabled picks up everything. An item the filter refuses is left behind with no event.
- [x] **Order of kill rewards.** `enemyKilled`, XP, then gold, then drops. Gold is one `nextInt` on the drops stream from `moneyRange` (or `enemyMoneyRange` for the level), so a kill never changes the streams that other systems use. Gold arrives at the level cap and with a full bag.
- [x] **Draw alignment.** Every kill takes the same draws from the drops stream for a given table: per normal entry a chance, a quantity and two per bonus pool entry of its item; per pool a pick, a quantity and two per bonus pool entry of every item in the pool. A level modifier of 0, a boost, a full bag or the filter never move the stream. The cost is a few unused draws.
- [x] **Bonus attributes.** Each pool entry rolls its own chance, then a whole value in `min..max`. At most `items.maxBonusAttributes` (3) are kept, the first hits in the pool's listed order. The pool's order in `items.json` therefore matters when an item could roll more than 3.
- [x] **Events.** `goldGained`, `itemPickedUp` (what went in, with its bonuses) and `bagFull` (what was left, one per dropped item). #27 reads `bagFull` for the return trip and the L2 rule that a full bag does not send the character home again; neither is built.
- [x] **Drop boost.** `rollDrops` takes a `boost` that multiplies a normal entry's chance after the level modifier (Q5) and never touches a pool. The engine passes none until the boosts of 2.6 exist.
- [x] **`noDropEnemyLevelsAbove`.** The 3.8 level modifier is unchanged: 0 from 10 levels above (falloff 0.1 per level), and 0 for an enemy 20 or more levels above the character.
- [x] **Loot filter and guaranteed pools.** The engine applies an enabled loot filter to pool items too, so a filter can leave behind the one item T3 says every kill yields. L8 does not exempt pool items. The owner can keep this or exempt pools. Decided (R10).
- [x] **Level used for drops.** The drop roll uses the character's level when the kill landed, before that kill's XP can level it up.

## 8. Choices made while building proficiency, absorption and the bestiary (#25)

- [x] **Level of an area for speed training.** Design 4.6 says "the level of the area" and areas only have `levelRange`. The engine uses `levelRange.max`.
- [x] **What counts as moving.** Speed trains on `travelling`, `searching` and `returning` steps, by the seconds the step covers. Fleeing does not train it.
- [x] **Absorption level.** The character's level at the end of the fight, before the kill's XP.
- [x] **Regeneration trait.** Heals the absorbed percent of maximum health every `constants.traits.regenerationIntervalSeconds` (10), counted in `traitRegenMs` on the character. Life steal heals the percent of the damage each hit dealt, capped at maximum health.
- [x] **Bestiary kills.** Every kill counts, mini-bosses and bosses too. A deleted character's kill counts may go; `revealed` stays.
- [x] **Order inside a fight step.** The hits land, then proficiency training, then life steal (only if the character is still alive after the enemy's blow), then, on a kill, absorption, XP and loot.
- [x] **Offline proficiency.** #29 counts a kill's proficiency once, after the kill, with `killProficiencyGain` (hits times the gain at the points held before the kill), then applies `offline.proficiencyRate`. Not built until #29. The gain falls as the skill rises, so counting once is not lower than hit by hit; the slower offline pace comes from the rate.
- [x] **Trait and slot ids.** `constants.traits.lifeStealId` and `regenerationId` name the traits the engine acts on, and the weapon slot is the one whose row has `trainsProficiency`.
