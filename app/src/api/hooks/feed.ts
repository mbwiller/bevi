import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { CategoryId } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { cursorPaging } from './util';

/** The caller's and followed users' posts, newest first, 20 per page. */
export function useFeed() {
  return useInfiniteQuery({
    queryKey: keys.feed(),
    queryFn: ({ pageParam }) => api.feed.getFeed({ cursor: pageParam, limit: 20 }),
    ...cursorPaging,
  });
}

export function useFeatured() {
  return useQuery({ queryKey: keys.featured(), queryFn: () => api.feed.getFeatured() });
}

/**
 * Bev leaderboard, 50 per page. Display `row.bayesScore` (the score on this board: per-category
 * boards use the category's prior); `row.bev.bayesScore` carries the same value.
 */
export function useLeaderboardBevs(categoryId?: CategoryId) {
  return useInfiniteQuery({
    queryKey: keys.leaderboard.bevs(categoryId),
    queryFn: ({ pageParam }) => api.leaderboard.bevs({ categoryId, page: { cursor: pageParam, limit: 50 } }),
    ...cursorPaging,
  });
}

export function useLeaderboardUsers() {
  return useInfiniteQuery({
    queryKey: keys.leaderboard.users(),
    queryFn: ({ pageParam }) => api.leaderboard.users({ cursor: pageParam, limit: 50 }),
    ...cursorPaging,
  });
}

/** Minimum version and maintenance flag (callable signed out). */
export function useAppConfig() {
  return useQuery({ queryKey: keys.appConfig(), queryFn: () => api.meta.getAppConfig(), staleTime: 5 * 60_000 });
}
