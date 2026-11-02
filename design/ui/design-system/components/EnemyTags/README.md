# EnemyTags

Small labels that describe an enemy or area: its type, its traits, and what the level gap does to drops.

- Type tags: `.ab-tag` (Normal), `.ab-tag--miniboss`, `.ab-tag--boss`, `.ab-tag--cursed`. Enemy level is `.ab-level.ab-level--enemy`, so a character's gold badge is never confused with an enemy's.
- Trait tags: magical traits are `.ab-tag--magic` with the sparkle icon ("Life steal 6%"); they are what a character can absorb. Physical traits stay plain `.ab-tag` and are never essence-coloured.
- Drop chip: `.ab-drop` shows the drop rate after the level-gap modifier for the chosen character: `--full` at 100%, `--partial` from 10% to 90%, `--none` at 0%. For an area, show the range across its enemies: "Drops 40–90%".
- The consumer provides the character the rate is for; say so nearby ("For Kaela · Lv 14").
- Bosses, mini-bosses and cursed objects cannot be absorbed: never put a magic tag's absorb progress beside them.
