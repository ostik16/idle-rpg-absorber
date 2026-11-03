# UI design artifacts

Snapshots of two claude.ai artifacts: the design system taken 2026-11-02, the screens updated 2026-11-03. The artifacts are the live versions. These copies exist so development can proceed without them and so changes show up in git history.

## design-system/

Snapshot of https://claude.ai/artifact/3n12SGkJ1VWxMXAQ8HMZrb

| File | What |
|---|---|
| `README.md` | The brand book: voice and copy, colour, type, space, mobile layout, iconography. **Read this first** |
| `tokens.json` | Colours, type, spacing, radius, shadow, sizes, breakpoints, each with a usage note |
| `components/bundle.css` | Component classes, prefix `ab-`, written against the tokens |
| `components/<Name>/README.md` | Guidelines and the markup each component expects |
| `components/<Name>/preview.html` | A small page showing the component. Needs `tokens.css` and `bundle.css` loaded to look right |
| `design-system.json` | Artifact metadata |

There is no script bundle. Components are CSS classes, so each one has to be implemented in whatever UI approach the project chooses.

`components/bundle.css` starts with an `@import` from fonts.googleapis.com, because the artifact's runtime needs it. The game self-hosts its fonts (`src/styles/fonts.css`), so a small Vite plugin in `vite.config.ts` removes that one `@import` from that one file, in dev and in build. The snapshot itself stays byte-for-byte as copied.

`tokens.css` is not in the snapshot because the artifact generates it. The repo generates its own at `src/styles/tokens.css`: run `npm run tokens`.

## screens/

Snapshot of https://claude.ai/artifact/MM1u7hrsEdZww1XtTKEiE1

`canvas.json` lists every board with its title and size. Each `*.dc.html` is one board. Phone screens are 390 x 844, desktop layouts 1440 wide, and the `Comp-*.dc.html` boards are component sheets.

These files are written for the Design canvas runtime. They load `./support.js`, which is not part of the snapshot, so they do not render when opened directly. Use the artifact link to view and click through them. They remain useful as a readable source for exact markup, colours and copy.

## Keeping them in sync

When the artifact changes, copy the changed files over the snapshot here and run `npm run tokens`. When a screen changes in a way that affects the rules, update `design/06-ui-design-system.md` too.
