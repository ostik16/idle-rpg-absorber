/** Text output helpers for the balance scripts. */

export function num(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : String(x);
  return x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(fraction: number, digits = 1): string {
  return `${num(fraction * 100, digits)}%`;
}

/** 90 -> "1m 30s", 5400 -> "1h 30m", 200000 -> "2d 7h". */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'never';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Plain-text table. Columns after the first are right-aligned. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]): string =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join('  ');
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}
