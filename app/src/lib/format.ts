// Number formats from the design system's "Voice and copy" rules.

/** Scores always show one decimal: 9.3, never 9.30 or 93. */
export function formatScore(score: number): string {
  return (Math.round(score * 10) / 10).toFixed(1);
}

/** Counts as Beli prints them: 362, 5k. */
export function formatCount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
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
