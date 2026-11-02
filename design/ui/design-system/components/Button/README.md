# Button

Buttons start an action: `ab-btn--primary` (gold) for the one action a screen exists for, plain `ab-btn` for everything else.

- Markup: `<button class="ab-btn ab-btn--primary">Upgrade to +5</button>`. A link styled as a button is `<a class="ab-btn">`. An optional leading icon is an `svg.ab-icon` before the label.
- Labels are verb first, sentence case: "Send Kaela", "Return to city", "Withdraw to Tamsin".
- Variants: `--primary` (gold fill, `on-gold` label, once per screen); default (`surface-2`, `line-strong` edge); `--ghost` (tertiary, inside cards); `--danger` (destructive or risky: an unprotected upgrade, deleting a character).
- Sizes: the default is 44px tall and the only size on touch screens. `--sm` (36px) is for dense desktop tables. `--block` fills its container, for the bottom action of a phone screen or sheet.
- Icon-only buttons use `--icon` (44×44) and always carry an `aria-label`.
- Don't place two primaries side by side; pair a primary with a default or ghost button.
