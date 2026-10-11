import type { ProfileStats } from '@bevi/shared';

import { formatCount } from '@/lib/format';

/** "Member since Oct 2026". */
export function memberSince(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return `Member since ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}

/** The counts row's third column: "#12", or a dash before the first ranking. */
export function rankShort(stats: ProfileStats): string {
  return stats.rankOnBevi != null ? `#${stats.rankOnBevi}` : '–';
}

/** The "Rank on Bevi" card: "#12 · 42 pts", or "Unranked" until there is at least one ranking. */
export function rankCardValue(stats: ProfileStats): string {
  if (stats.rankOnBevi == null || stats.bevdCount === 0) return 'Unranked';
  return `#${stats.rankOnBevi} · ${formatCount(stats.rankPoints)} pts`;
}

/** The "Current streak" card: "4 days"; at 0, a nudge on your own profile and a plain line on someone else's. */
export function streakCardValue(stats: ProfileStats, self: boolean): string {
  const n = stats.currentStreak;
  if (n > 0) return `${n} ${n === 1 ? 'day' : 'days'}`;
  return self ? 'Rank today to start' : 'No streak yet';
}
