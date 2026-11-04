import { lastingNotices, notice } from './store';

/** One-line messages, on every screen: lasting ones first, then the engine's latest (ADR 0002, ADR 0003). */
export function Notice() {
  const lines = notice.value === null ? lastingNotices.value : [...lastingNotices.value, notice.value];
  if (lines.length === 0) return null;
  return (
    <div class="app__notices" role="status">
      {lines.map((line) => (
        <span key={line} class="ab-notice">
          {line}
        </span>
      ))}
    </div>
  );
}
