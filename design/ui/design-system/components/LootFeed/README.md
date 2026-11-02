# LootFeed

The running log of what a character, or the whole roster, just gained or lost.

- Markup: `<ol class="ab-feed">` of `.ab-feed__row`: `.ab-feed__time` ("now", "31s", "4m"), a 16px icon, the text, and `.ab-feed__amt`.
- Colour follows the kind of gain, on the icon and the amount: XP `xp`, gold `gold`, items `ink`, absorption `essence`, rare drops `arcane`, deaths and destroyed items `danger`.
- One event per line; a kill that yields XP, gold and an item is three lines with the same time.
- Newest on top. On a character screen show the last 8; the desktop roster shows every character's feed with the character's initial before the icon.
- Don't animate more than the newest line (150ms fade in).
