# Proficiency

A hidden skill shown by its title, never its number, plus the notice when a title rises.

- Markup: `.ab-prof` rows with `.ab-prof__skill` (Two-handed, One-handed, Unarmed, Toughness, Speed, Combat), `.ab-prof__title` and `.ab-prof__pips`: five rotated squares, one per title (Novice, Apprentice, Adept, Expert, Master), `--on` up to the current one.
- The consumer provides the skill name and its title index. Never show progress inside a title; the game keeps it hidden.
- When a title rises, show `.ab-notice` for four seconds above the tab bar: trend icon, "Two-handed: Adept". Several at once stack, newest on top. Offline gains are listed in the return summary instead.
