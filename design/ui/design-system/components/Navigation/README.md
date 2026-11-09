# Navigation

The app bar, the phone tab bar and the desktop rail: four destinations: Farm, City, Character and Bestiary.

- App bar: `<header class="ab-appbar">` with the character switcher: the selected character's avatar, name and location, with a chevron. Nothing else lives in the app bar.
- Tab bar (below 900px): `<nav class="ab-tabbar" aria-label="Main">` with four `<a class="ab-tab">`, each an icon over a word; the current one has `aria-current="page"` and a gold bar along its top edge. It pads itself for the home indicator.
- Rail (900px and wider): the same four links in `<nav class="ab-rail">`; the current one sits on `gold-soft`.
- The consumer provides the hrefs and which one is current. Don't add a fifth tab: settings, the save export and dev tools live behind the gold balance's menu.
- The tab bar stays visible on pushed screens. Tapping any tab, the active one too, closes what is pushed and shows that tab's root.
