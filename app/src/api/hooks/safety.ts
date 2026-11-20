import { useInfiniteQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BlockedUser, Comment, ExplorePost, FeedItem, ProfileRow, ReportContentInput, ReportContentResult } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { cursorPaging, filterCachedItems, mapCachedItems, rollback, snapshot } from './util';

/**
 * The people the caller has blocked, most recently blocked first (Settings > Blocked accounts).
 * 50 a page; the screen loads the next on scroll.
 */
export function useBlockedUsers() {
  return useInfiniteQuery({
    queryKey: keys.blocks.list(),
    queryFn: ({ pageParam }) => api.blocks.list({ cursor: pageParam }),
    ...cursorPaging,
  });
}

/** Caches that hold something about one person alone; none of it may outlive a block. */
const personKeys = (userId: string) => [
  keys.users.detail(userId),
  keys.stats.user(userId),
  keys.stats.tasteProfile(userId),
  keys.rankings.user(userId),
  keys.feedUser(userId),
  keys.follows.followers(userId),
  keys.follows.following(userId),
];

/**
 * A block took effect: take the person out of every cache that can show them, now, then refetch what
 * is on screen. The one place that knows where a person can appear, so a new surface that lists
 * people is added here and nowhere else.
 *
 * - Posts (Your feed, every Activity) and Explore lose the person's posts, and every post loses
 *   their comments, straight away; the feed refetches to refill. Explore is only marked stale: its
 *   cursor belongs to one sequence, so it isn't refetched under the reader.
 * - Threads lose their comments; People lists (search, followers, following, suggestions) lose the
 *   row.
 * - Their profile, stats, rankings, Activity and follower lists go (the server now answers
 *   'not_found'); the rest of stats, the Friends board and the leaderboards, Bev detail ("friends
 *   who've had it") and recommendations refetch, since the follows between you are gone.
 */
export function applyBlock(qc: QueryClient, userId: string): void {
  const withoutTheirComments = (post: FeedItem): FeedItem =>
    post.comments?.some((c) => c.author.id === userId) ? { ...post, comments: post.comments.filter((c) => c.author.id !== userId) } : post;
  qc.setQueriesData({ queryKey: keys.feed() }, (data: unknown) =>
    mapCachedItems<FeedItem>(filterCachedItems<FeedItem>(data, (p) => p.actor.id !== userId), withoutTheirComments),
  );
  qc.setQueriesData({ queryKey: keys.explore() }, (data: unknown) => filterCachedItems<ExplorePost>(data, (p) => p.actor.id !== userId));
  qc.setQueriesData({ queryKey: keys.commentsAll }, (data: unknown) => filterCachedItems<Comment>(data, (c) => c.author.id !== userId));
  for (const prefix of [keys.users.all, keys.follows.all]) {
    qc.setQueriesData({ queryKey: prefix }, (data: unknown) => filterCachedItems<ProfileRow>(data, (r) => r.id !== userId));
  }

  for (const queryKey of personKeys(userId)) {
    qc.removeQueries({ queryKey, type: 'inactive' });
    void qc.invalidateQueries({ queryKey });
  }
  void qc.invalidateQueries({ queryKey: keys.feed() });
  void qc.invalidateQueries({ queryKey: keys.explore(), refetchType: 'none' });
  void qc.invalidateQueries({ queryKey: keys.commentsAll });
  void qc.invalidateQueries({ queryKey: keys.users.all });
  void qc.invalidateQueries({ queryKey: keys.follows.all });
  void qc.invalidateQueries({ queryKey: keys.stats.all });
  void qc.invalidateQueries({ queryKey: keys.leaderboard.all });
  void qc.invalidateQueries({ queryKey: keys.bevs.all });
  void qc.invalidateQueries({ queryKey: keys.bevOfPeriod() });
  void qc.invalidateQueries({ queryKey: keys.recommendationsAll });
  void qc.invalidateQueries({ queryKey: keys.blocks.all });
}

/**
 * Blocks someone. Not optimistic: the confirm says what it does, and the person asked for it, so
 * the sheet waits for the server and shows a failure in place. networkMode 'always' makes an offline
 * tap fail at once with 'network' instead of waiting, paused, for a connection. Idempotent.
 */
export function useBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.blocks.block(userId),
    networkMode: 'always',
    onSuccess: (_d, userId) => applyBlock(qc, userId),
    onError: (_e, userId) => {
      // 'not_found' (they left, or blocked you first): whatever we hold of them is stale.
      void qc.invalidateQueries({ queryKey: keys.users.detail(userId) });
    },
  });
}

/**
 * Lifts a block. Optimistic: the row leaves Blocked accounts at once and comes back if the call
 * fails. Unblocking doesn't restore follows, but the person can show again everywhere, so what was
 * hidden is refetched.
 */
export function useUnblock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.blocks.unblock(userId),
    networkMode: 'always',
    onMutate: async (userId) => {
      const snap = await snapshot(qc, [keys.blocks.all]);
      qc.setQueriesData({ queryKey: keys.blocks.all }, (data: unknown) => filterCachedItems<BlockedUser>(data, (b) => b.id !== userId));
      return { snap };
    },
    onError: (_e, _userId, ctx) => rollback(qc, ctx?.snap),
    onSettled: (_d, _e, userId) => {
      void qc.invalidateQueries({ queryKey: keys.blocks.all });
      for (const queryKey of personKeys(userId)) void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: keys.feed() });
      void qc.invalidateQueries({ queryKey: keys.explore(), refetchType: 'none' });
      void qc.invalidateQueries({ queryKey: keys.commentsAll });
      void qc.invalidateQueries({ queryKey: keys.users.all });
      void qc.invalidateQueries({ queryKey: keys.follows.all });
      void qc.invalidateQueries({ queryKey: keys.leaderboard.all });
      void qc.invalidateQueries({ queryKey: keys.stats.all });
      void qc.invalidateQueries({ queryKey: keys.bevs.all });
    },
  });
}

/**
 * Files a report. Nothing hides or changes from it, so there is nothing to invalidate: the sheet
 * keeps the draft on failure. Idempotent per content on the server, so a second tap is harmless.
 */
export function useReport() {
  return useMutation<ReportContentResult, Error, ReportContentInput>({
    mutationFn: (input) => api.reports.report(input),
    networkMode: 'always',
  });
}
