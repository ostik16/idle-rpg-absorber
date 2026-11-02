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

Flags: `--level`, `--str`, `--dex`, `--vit`, `--int`, `--weapon` (weapon damage), `--armour` (armour defence), `--weapon-type`, `--prof-weapon`, `--prof-toughness`, `--prof-speed`, `--reference`, `--enemy` (id in `data/enemies.json`), `--enemy-level` (baseline from `constants.enemyScaling`), `--runs` (1000), `--seed` (1), `--max-seconds` (600).

- Without gear flags the build is the creation character: 5 in each attribute, no weapon, no armour.
- `--reference` starts from the character `docs/decisions.md` N6 tuned the enemy baseline against (attribute points split 45/20/25/10 over strength, dexterity, vitality, intelligence; weapon damage 3 + 1.8 x (L - 1); armour 1 + 0.9 x (L - 1)). Any other flag overrides its part.
- With neither `--enemy` nor `--enemy-level`, the enemy is the baseline enemy of `--level`.
- Output: win rate, time to kill (mean, median, 95th percentile), damage taken per fight, health lost per fight as a share of max health, and how many fights a full health bar lasts.

How a fight runs: flat damage minus defence, at least 1 (3.6); a crit multiplies the damage dealt by 1.5; attack intervals are rounded to whole 100 ms ticks (N2). The first attack of each side lands one full interval after the fight starts; when both attack on the same tick the player goes first. Each fight starts at full health. Not modelled: potions, spells, traits, the weapon attribute penalty, enemy crits.

## Drop calculator

```
npm run balance:drops -- --area mossfang-glade --level 3
npm run balance:drops -- --area mossfang-glade --level 3 --target mossfang-wolf --seconds-per-kill 10
```

Without `--area` it lists the areas. Per enemy it prints the share of kills, the drop level modifier, the final chance of each item (base chance x modifier, 3.8), the absorption rate (4.7) with kills and hours to reach the enemy's trait value, XP and gold. Totals per hour follow, including how much the drops would sell for when the item has a `sellPrice`.

`--seconds-per-kill` is the time from one kill to the next, fight and moving included. The default is `constants.farming.secondsPerKill` if that exists, else 12. `--target` farms one enemy and multiplies the seconds per kill by `constants.farming.targetingExtraTimeMultiplier` (3.3). XP and gold use the enemy's `xpReward` and `moneyRange`, or the formulas in `constants` when the enemy has none. Drop boosts, bosses, mini-bosses and offline efficiency are not applied.

## Progression curve

```
npm run balance:progression
npm run balance:progression -- --area mossfang-glade --seconds-per-kill 10 --to 12
npm run balance:progression -- --enemy-level 5
```

Time and kills to clear each level, from `data/xp-table.json` and the XP per kill. Without `--area` or `--enemy-level` the character always fights enemies of its own level, which is the curve the XP table was designed for (N4). With `--area` the character kills that area's spawn mix at every level, so the table shows when the area stops being worth it. XP is not reduced by level gap (3.5). Death and XP loss are not modelled.

## Layout

| File | Role |
|---|---|
| `combat-sim.ts`, `drop-calc.ts`, `progression.ts` | Thin command line wrappers |
| `combat.ts`, `drops.ts`, `curve.ts` | Pure logic, tested in `tests/balance.test.ts` |
| `load-data.ts` | Loads `data/*.json`, finds entries by id |
| `args.ts`, `format.ts`, `cli.ts` | Flag parsing, text tables, entry point |

Randomness comes from `src/game/rng.ts` (ADR 0002). The same `--seed` gives the same result.
