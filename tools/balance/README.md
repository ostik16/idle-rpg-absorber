# Balance tools

Scripts over `data/` for checking a balance change before players find it (design [5.3](../../design/05-dev-tools.md)). They reuse the formulas in `src/game`, so they cannot drift from the game. Run them with `npm run`; flags go after `--`. Every script takes `--help`.

Run `npm install` once first. The scripts run under `vite-node`, which comes with vitest.

| Script | Answers |
|---|---|
| `balance:combat` | How long does this build take to kill that enemy, and what does it cost in health? |
| `balance:drops` | What does a character of this level get per hour in this area? |
| `balance:progression` | How long does each level take? |

## Combat simulator

```
npm run balance:combat -- --reference --level 10 --enemy mossfang-wolf --runs 2000 --seed 7
npm run balance:combat -- --level 5 --str 12 --dex 8 --vit 10 --weapon 9 --armour 4 --prof-weapon 20 --enemy-level 5
```

Flags: `--level`, `--str`, `--dex`, `--vit`, `--int`, `--weapon` (weapon damage), `--weapon-requires` (e.g. `strength=12,dexterity=7`), `--armour` (armour defence), `--weapon-type`, `--prof-weapon`, `--prof-toughness`, `--prof-combat`, `--reference`, `--enemy` (id in `data/enemies.json`), `--enemy-level` (baseline from `constants.enemyScaling`), `--runs` (1000), `--seed` (1), `--max-seconds` (600).

- Without gear flags the build is the creation character: 5 in each attribute, unarmed (`constants.stats.unarmedDamage` as weapon damage), no armour. Giving `--weapon` makes the weapon type one-handed unless `--weapon-type` says otherwise.
- `--prof-weapon` is the points of the weapon style skill (unarmed, one-handed or two-handed): +0.3% damage and +0.1% attack speed per point. `--prof-combat` adds +0.1% attack speed per point. The speed skill trains by moving and only affects the drop and progression scripts (`--prof-speed` there).
- `--weapon-requires` applies the weapon penalty (2.2): each attribute point below a required value costs 1% of the weapon's damage, added up over all attributes, at most 50%. Unarmed damage has no penalty.
- `--reference` starts from the character `docs/decisions.md` N6 tuned the enemy baseline against (attribute points split 45/20/25/10 over strength, dexterity, vitality, intelligence, 20 points at level 1 plus 3 per level; weapon damage 3 + 1.8 x (L - 1); armour 1 + 0.9 x (L - 1)). Any other flag overrides its part.
- With neither `--enemy` nor `--enemy-level`, the enemy is the baseline enemy of `--level`.
- Output: win rate, time to kill (mean, median, 95th percentile), damage taken per fight, health lost per fight as a share of max health, and how many fights a full health bar lasts.

How a fight runs: flat damage minus defence, at least 1 (3.6); a crit multiplies the damage dealt after defence and the minimum by 2; attack intervals are rounded to whole 100 ms ticks (N2). The first attack of each side lands one full interval after the fight starts; when both attack on the same tick the player goes first. Each fight starts at full health. Not modelled: potions, spells, traits, enemy crits. The visible endurance stat is not modelled (owner question I1 is pending).

## Drop calculator

```
npm run balance:drops -- --area mossfang-glade --level 3
npm run balance:drops -- --area mossfang-glade --level 3 --target mossfang-wolf --fight-seconds 4
```

Without `--area` it lists the areas. Per enemy it prints the share of kills, the drop level modifier, the final chance of each item (base chance x modifier, 3.8), the absorption rate (4.7) with kills and hours to reach the enemy's trait value, XP and gold. Totals per hour follow, including how much the drops would sell for when the item has a `sellPrice`.

Time per kill is fight seconds plus movement seconds (3.3):

- `--fight-seconds` fixes the fight time for every enemy. Without it, each enemy's fight time is simulated: the reference build for `--level` against that enemy (enemies without full stats use the baseline enemy of their level), mean time to kill over 200 seeded fights.
- Movement seconds are the area's `movementSecondsBetweenEnemies` if it has one, else `constants.farming.movementSecondsBetweenEnemies` (6). `--movement-seconds` overrides it, and `--prof-speed` (speed skill points) divides it by 1 + 0.005 x points.
- `--target <enemy>` farms only that enemy and multiplies the movement seconds by that enemy's own `targetingMultiplier` (common 2, up to `constants.farming.targeting.maxMultiplier` = 10). The fight time is not multiplied.

Guaranteed pools (`guaranteedPools` in a drop table) give exactly one entry per kill, chosen by weight, with a quantity between min and max and no level modifier. They are listed as `[every kill, pool <id>]`; their per-hour rate is kills per hour x weight / total weight x average quantity. XP and gold use the enemy's `xpReward` and `moneyRange`, or the formulas in `constants` when the enemy has none. Drop boosts, bosses, mini-bosses and offline efficiency are not applied. Items come from `data/items.json` only.

## Progression curve

```
npm run balance:progression
npm run balance:progression -- --area mossfang-glade --fight-seconds 4 --to 12
npm run balance:progression -- --area mossfang-glade --target mossfang-wolf
npm run balance:progression -- --enemy-level 5
```

Time and kills to clear each level, from `data/xp-table.json` and the XP per kill. Seconds per kill is fight plus movement, as in the drop calculator: the fight time is simulated for the reference build of each level unless `--fight-seconds` is given, and `--seconds-per-kill` fixes the total. Without `--area` or `--enemy-level` the character always fights enemies of its own level, which is the curve the XP table was designed for (N4); movement is `--movement-seconds` or the constant. With `--area` the character kills that area's spawn mix at every level, so the table shows when the area stops being worth it; `--target` (with `--area`) kills one enemy with its own targeting multiplier on the movement. XP is not reduced by level gap (3.5). Death and XP loss are not modelled (`xpAfterDeath` in `src/game/progression.ts` has the rule).

## Layout

| File | Role |
|---|---|
| `combat-sim.ts`, `drop-calc.ts`, `progression.ts` | Thin command line wrappers |
| `combat.ts`, `drops.ts`, `curve.ts` | Pure logic, tested in `tests/balance.test.ts` |
| `load-data.ts` | Loads `data/*.json` (items from `items.json` only), finds entries by id, movement and targeting lookups |
| `args.ts`, `format.ts`, `cli.ts` | Flag parsing, text tables, entry point |

Randomness comes from `src/game/rng.ts` (ADR 0002). The same `--seed` gives the same result.
