import type { TasteProfileRow } from '@bevi/shared';

import { categoryById } from '@/lib/categories';

// The preference read-out of the Taste Profile tab. Thresholds are from the ranking paper,
// Definition (Taste Profile), \S\ref{sec:taste} (docs/bevi-ranking-math.tex): a statement
// "prefers c over c'" is shown when n_c, n_c' >= 3 and mean_c - mean_c' >= 1.

/** Each category in the statement needs at least this many rankings (paper, Definition (Taste Profile), sec:taste). */
export const TASTE_MIN_RANKINGS = 3;
/** The preferred category's mean must beat the other's by at least this many points out of 10 (same definition). */
export const TASTE_MIN_GAP = 1;
/** "coffee and boba over soda": at most this many preferred categories are named. */
const MAX_PREFERRED = 2;

type Row = Pick<TasteProfileRow, 'categoryId' | 'mean' | 'rankingCount'>;

const name = (r: Row) => (categoryById(r.categoryId)?.label ?? r.categoryId).toLowerCase();

/**
 * "You prefer coffee and boba over soda" (or "Sam prefers coffee over soda" when `name` is given).
 * L is the eligible category (3 or more rankings) with the lowest mean; the preferred ones are the eligible
 * categories at least 1 point above it, highest first, at most two. Null when there are none: no line.
 */
export function tasteReadout(rows: readonly Row[], who?: string): string | null {
  const eligible = rows.filter((r) => r.rankingCount >= TASTE_MIN_RANKINGS);
  if (eligible.length < 2) return null;
  const lowest = eligible.reduce((l, r) => (r.mean < l.mean ? r : l));
  // Means are stored to 3 places; round the gap the same way so 8.1 - 7.1 is exactly the 1.0 it is.
  const preferred = eligible
    .filter((r) => Math.round((r.mean - lowest.mean) * 1000) / 1000 >= TASTE_MIN_GAP)
    .sort((a, z) => z.mean - a.mean)
    .slice(0, MAX_PREFERRED);
  if (preferred.length === 0) return null;
  const list = preferred.map(name).join(' and ');
  return `${who ? `${who} prefers` : 'You prefer'} ${list} over ${name(lowest)}`;
}
