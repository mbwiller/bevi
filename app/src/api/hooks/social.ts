import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ProfileRow, ProfileStats } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { cursorPaging, mapCachedItems, rollback, snapshot } from './util';

export function useFollowers(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: keys.follows.followers(userId ?? ''),
    queryFn: ({ pageParam }) => api.follows.listFollowers(userId!, { cursor: pageParam }),
    ...cursorPaging,
    enabled: !!userId,
  });
}

export function useFollowing(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: keys.follows.following(userId ?? ''),
    queryFn: ({ pageParam }) => api.follows.listFollowing(userId!, { cursor: pageParam }),
    ...cursorPaging,
    enabled: !!userId,
  });
}

/** Users with the most rankings the caller doesn't follow. */
export function useSuggested() {
  return useQuery({ queryKey: keys.follows.suggested(), queryFn: () => api.follows.suggested() });
}

const ROW_PREFIXES = [keys.users.all, keys.follows.all, keys.stats.mine()];

function applyFollow(qc: QueryClient, userId: string, isFollowing: boolean) {
  const patch = (row: ProfileRow) => (row.id === userId ? { ...row, isFollowing } : row);
  qc.setQueryData<ProfileRow>(keys.users.detail(userId), (row) => row && patch(row));
  for (const prefix of [keys.users.all, keys.follows.all]) {
    qc.setQueriesData({ queryKey: prefix }, (data: unknown) => mapCachedItems<ProfileRow>(data, patch));
  }
  qc.setQueryData<ProfileStats>(keys.stats.mine(), (s) => s && { ...s, following: Math.max(0, s.following + (isFollowing ? 1 : -1)) });
  qc.setQueryData<ProfileStats>(keys.stats.user(userId), (s) => s && { ...s, followers: Math.max(0, s.followers + (isFollowing ? 1 : -1)) });
}

function settleFollow(qc: QueryClient, userId: string) {
  void qc.invalidateQueries({ queryKey: keys.users.detail(userId) });
  // Suggested keeps the row (now "Following") until the screen refetches on its own.
  void qc.invalidateQueries({ queryKey: keys.follows.all, predicate: (q) => q.queryKey[2] !== 'suggested' });
  void qc.invalidateQueries({ queryKey: keys.stats.all });
  void qc.invalidateQueries({ queryKey: keys.feed() });
  void qc.invalidateQueries({ queryKey: keys.bevs.all }); // Bev detail "friends who've had it"
}

/** Both follow and unfollow share this key; the variable is the user id. */
export const FOLLOW_MUTATION = ['bevi', 'follow'] as const;

function useFollowMutation(isFollowing: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: FOLLOW_MUTATION,
    mutationFn: (userId: string) => (isFollowing ? api.follows.follow(userId) : api.follows.unfollow(userId)),
    onMutate: async (userId) => {
      const snap = await snapshot(qc, [...ROW_PREFIXES, keys.stats.user(userId)]);
      applyFollow(qc, userId, isFollowing);
      return { snap };
    },
    onError: (_e, _userId, ctx) => rollback(qc, ctx?.snap),
    onSettled: (_d, _e, userId) => settleFollow(qc, userId),
  });
}

/** Optimistic: `isFollowing` and the counts flip immediately and roll back on error. */
export function useFollow() {
  return useFollowMutation(true);
}

/** Optimistic, like `useFollow`. */
export function useUnfollow() {
  return useFollowMutation(false);
}
