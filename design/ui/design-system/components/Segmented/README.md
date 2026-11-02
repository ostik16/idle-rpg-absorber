# Segmented

Switches between views of the same thing: a character's Farm, Stats, Gear and Spells, or warehouse tabs.

- Markup: `<div class="ab-seg" role="tablist">` with `.ab-seg__item` buttons (`role="tab"`, `aria-selected`). When each segment is its own page, use links with `aria-current="page"` instead.
- Two to five segments, one or two words each. The track's 3px padding brings each segment to a 44px target.
- The selected segment sits on `surface-3` with gold text; it is the only gold on the control.
- Don't use it for actions or filters that combine; those are buttons or tags.
