import { isLeaderboardEligible } from '@bevi/ranking';
import type { BevSummary, LeaderboardRow } from '@bevi/shared';
import { useEffect, useMemo } from 'react';

import { flattenPages, useLeaderboardBevs } from '@/api/hooks';
import { categoryById } from '@/lib/categories';

/** How many Bevs "Popular on Bevi" lists. */
export const POPULAR_COUNT = 10;
/** Pages of the 50-row board to read looking for unranked Bevs before settling for fewer. */
const POPULAR_MAX_PAGES = 3;

/**
 * "Popular on Bevi" (Add Bev, idle): the first `POPULAR_COUNT` rows of the Bevs leaderboard the viewer
 * hasn't ranked, never an alcoholic Bev (nor one of an unknown category) for a viewer who can't see
 * alcohol (the server filters those already; this is the belt to its braces). Each summary carries the board's own Bayesian score and
 * rating count, so the row shows what the leaderboard shows.
 */
export function popularBevs(rows: readonly LeaderboardRow[], canSeeAlcohol: boolean): BevSummary[] {
  return rows
    .filter((r) => r.myScore == null && isLeaderboardEligible(r.ratingCount))
    // An unknown category can't be shown to be alcohol-free, so it is hidden from a viewer who can't see alcohol.
    .filter((r) => canSeeAlcohol || categoryById(r.bev.categoryId)?.isAlcoholic === false)
    .slice(0, POPULAR_COUNT)
    .map((r) => ({ ...r.bev, bayesScore: r.bayesScore, ratingCount: r.ratingCount }));
}

/**
 * The all-categories Bevs leaderboard (the cache Lists' Top tab shares), cut down by `popularBevs`.
 * Someone who has ranked most of the first page gets the next one or two read for them.
 */
export function usePopularBevs(canSeeAlcohol: boolean) {
  const query = useLeaderboardBevs();
  const bevs = useMemo(() => popularBevs(flattenPages(query.data), canSeeAlcohol), [query.data, canSeeAlcohol]);
  const pages = query.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  const short = bevs.length < POPULAR_COUNT;
  useEffect(() => {
    if (short && pages > 0 && pages < POPULAR_MAX_PAGES && hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [short, pages, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  return { query, bevs };
}
