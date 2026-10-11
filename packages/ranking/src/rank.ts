// "Rank on Bevi" (§8.13): an effort-based user leaderboard. Followers are deliberately excluded.
// SQL twin: Arjun's `user_leaderboard` view, `rank() over (order by points desc)`.

import { RANK_POINTS_WEIGHTS } from './constants.ts';
import type { RankedUser, RankPointsInput, RankUsersRow } from './types.ts';

function checkCount(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0) throw new RangeError(`${name} must be a non-negative integer, got ${v}`);
}

/**
 * points = bevsRanked + 3·currentStreak + 2·bevsCreated, where bevsCreated counts only Bevs the
 * user added that at least one OTHER user has ranked (the caller/SQL computes that count).
 */
export function rankPoints(a: RankPointsInput): number {
  checkCount('bevsRanked', a.bevsRanked);
  checkCount('currentStreak', a.currentStreak);
  checkCount('bevsCreated', a.bevsCreated);
  return (
    RANK_POINTS_WEIGHTS.bevsRanked * a.bevsRanked +
    RANK_POINTS_WEIGHTS.currentStreak * a.currentStreak +
    RANK_POINTS_WEIGHTS.bevsCreated * a.bevsCreated
  );
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The user leaderboard in display order: points desc, bevsRanked desc, createdAt asc, then userId
 * asc so the order is total. rank = 1 + |{ v : points_v > points_u }| (competition ranking: ties
 * share a rank, the next rank skips).
 *
 * Users with bevsRanked = 0 are "Unranked" (§8.13): they are left out of the result and do not
 * count toward anyone's rank (SQL: `where bevs_ranked > 0` before the window). createdAt is
 * compared as a string, so pass a uniform ISO format (e.g. UTC "…Z").
 */
export function rankUsers(rows: readonly RankUsersRow[]): RankedUser[] {
  const scored = rows
    .filter((r) => r.bevsRanked > 0)
    .map((r) => ({ row: r, points: rankPoints(r) }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.row.bevsRanked - a.row.bevsRanked ||
        cmp(a.row.createdAt, b.row.createdAt) ||
        cmp(a.row.userId, b.row.userId),
    );
  const out: RankedUser[] = [];
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i] as (typeof scored)[number];
    const prev = out[i - 1];
    // Sorted by points desc, so the number of users with more points is the first index with these points.
    const rank = prev && prev.points === s.points ? prev.rank : i + 1;
    out.push({ userId: s.row.userId, points: s.points, rank });
  }
  return out;
}
