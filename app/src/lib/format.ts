// Number formats from the design system's "Voice and copy" rules.

/** Scores always show one decimal: 9.3, never 9.30 or 93. */
export function formatScore(score: number): string {
  return (Math.round(score * 10) / 10).toFixed(1);
}

/** Counts as Beli prints them: 362, 5k. */
export function formatCount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** A rating count in words, for a meta line: 1 rating, 362 ratings, 5k ratings. */
export function formatRatings(n: number): string {
  return formatCount(n) + (n === 1 ? ' rating' : ' ratings');
}

/**
 * The share of a category you've tried, rounded down: "6%". "<1%" once anything is tried, so a
 * first Bev never reads as 0%; null when the category is empty.
 */
export function formatTriedPercent(ranked: number, total: number): string | null {
  if (!(total > 0)) return null;
  const pct = Math.floor((Math.min(ranked, total) * 100) / total);
  return ranked > 0 && pct === 0 ? '<1%' : `${pct}%`;
}

/** "4 of 61 tried · 6%"; no percentage for an empty category. */
export function formatTried(ranked: number, total: number): string {
  const pct = formatTriedPercent(ranked, total);
  return `${ranked} of ${total} tried${pct ? ` · ${pct}` : ''}`;
}

/** The same line for a screen reader: "4 of 61 tried, 6 percent", "…, less than 1 percent". */
export function spokenTried(ranked: number, total: number): string {
  const pct = formatTriedPercent(ranked, total);
  const said = pct == null ? '' : pct === '<1%' ? ', less than 1 percent' : `, ${pct.slice(0, -1)} percent`;
  return `${ranked} of ${total} tried${said}`;
}

/** Up to two initials for an Avatar. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}
