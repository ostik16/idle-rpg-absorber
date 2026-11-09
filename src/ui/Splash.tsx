// Shown while the game boots and catches up (ADR 0002, 0003). The art is the design system's Cover card (components/Cover/preview.html);
// the checklist records it as a splash-only exception to the one-ornament rule.

// Essence discs shrink as they near the gold slab; three are already gold-deep inside it.
const ESSENCE_ROWS = [192, 216, 240];
const ESSENCE_RADII = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8];
const ABSORBED_X = [48, 72, 96];

function Art() {
  return (
    <svg class="splash__art" viewBox="0 0 480 288" preserveAspectRatio="xMaxYMin meet" aria-hidden="true">
      <rect class="splash__gold splash__block" x="24" y="-12" width="96" height="276" rx="10" />
      <rect class="splash__field splash__block" x="136" y="48" width="232" height="216" rx="10" />
      <rect class="splash__essence splash__block" x="384" y="96" width="112" height="168" rx="10" />
      <rect class="splash__arcane splash__satellite" x="384" y="40" width="40" height="40" rx="6" />
      {ABSORBED_X.map((cx) => (
        <circle key={cx} class="splash__gold-deep" cx={cx} cy="240" r="3" />
      ))}
      {ESSENCE_ROWS.flatMap((cy) =>
        ESSENCE_RADII.map((r, i) => <circle key={`${cy}-${i}`} class="splash__essence" cx={160 + i * 24} cy={cy} r={r} />),
      )}
    </svg>
  );
}

/** `status` says what the wait is for: loading the save, or catching up after a long absence. */
export function Splash({ status }: { status: string }) {
  return (
    <div class="splash">
      <Art />
      <div class="splash__words">
        <h1 class="splash__name">
          Idle RPG
          <br />
          Absorber
        </h1>
        <p class="splash__status ab-label" role="status">
          {status}
        </p>
      </div>
    </div>
  );
}
