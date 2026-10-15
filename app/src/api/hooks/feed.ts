import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isApiError, type CategoryId, type FeedItem } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { cursorPaging, mapCachedItems } from './util';

/** The caller's and followed users' posts, newest first, 20 per page. */
export function useFeed() {
  return useInfiniteQuery({
    queryKey: keys.feed(),
    queryFn: ({ pageParam }) => api.feed.getFeed({ cursor: pageParam, limit: 20 }),
    ...cursorPaging,
  });
}

/**
 * Every cache that holds FeedItems, by key prefix. Profile › Activity shows `RankedBev`s, which carry
 * no likes, so today that is the feed alone; a later FeedItem list (Explore, M-04) joins here.
 */
const FEED_ITEM_PREFIXES = [keys.feed()];

export interface LikeVars {
  /** The FeedItem's id. */
  id: string;
  /** true likes, false unlikes. */
  like: boolean;
}

/**
 * Per post, while taps are in flight: the sequence number of the latest tap, and the like state the
 * server last confirmed (or the cached one before the first tap). Per QueryClient, so each test's
 * client starts clean.
 */
interface LikeChain {
  latest: number;
  confirmed: boolean;
}
const chainsByClient = new WeakMap<QueryClient, Map<string, LikeChain>>();

function chainsFor(qc: QueryClient): Map<string, LikeChain> {
  let chains = chainsByClient.get(qc);
  if (!chains) chainsByClient.set(qc, (chains = new Map()));
  return chains;
}

/** The post's like state as the caches show it, if any cache holds it. */
function cachedLiked(qc: QueryClient, id: string): boolean | undefined {
  let liked: boolean | undefined;
  for (const queryKey of FEED_ITEM_PREFIXES) {
    for (const [, data] of qc.getQueriesData({ queryKey })) {
      mapCachedItems<FeedItem>(data, (item) => {
        if (item.id === id) liked = item.likedByMe;
        return item;
      });
    }
  }
  return liked;
}

/** Sets `likedByMe` on the post in every FeedItem cache, moving `likeCount` by one when it changes. */
function setLiked(qc: QueryClient, id: string, liked: boolean): void {
  for (const queryKey of FEED_ITEM_PREFIXES) {
    qc.setQueriesData({ queryKey }, (data: unknown) =>
      mapCachedItems<FeedItem>(data, (item) =>
        item.id === id && item.likedByMe !== liked
          ? { ...item, likedByMe: liked, likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)) }
          : item,
      ),
    );
  }
}

/**
 * Like or unlike a post, optimistically: the heart and count change in every FeedItem cache the
 * moment it's tapped. `like` / `unlike` are idempotent and run one at a time in tap order (the
 * mutation `scope`), so rapid taps leave the server in the state of the last tap. Offline, the query
 * client pauses them (networkMode 'online') with the optimistic state on screen, and they run in
 * order on reconnect.
 *
 * Only the latest tap on a post settles it, by writing back the state the server last confirmed:
 * on success that is the tap's own state (re-applied over any refetch that landed meanwhile); when
 * it fails ('network', 'rate_limited', 'not_found', …) the post goes back to the last confirmed one. A per-item restore
 * rather than `snapshot` / `rollback`, so a rollback never undoes another post's like, or a later
 * tap on this one. 'not_found' means the post is gone: the feed refetches. The screen tells the user
 * from the mutation's `error` and `variables` (see `likeErrorMessage`).
 */
export function useToggleLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, like }: LikeVars) => (like ? api.feed.like(id) : api.feed.unlike(id)),
    scope: { id: 'feed.like' },
    onMutate: async ({ id, like }) => {
      await Promise.all(FEED_ITEM_PREFIXES.map((queryKey) => qc.cancelQueries({ queryKey })));
      const chains = chainsFor(qc);
      const chain = chains.get(id) ?? { latest: 0, confirmed: cachedLiked(qc, id) ?? !like };
      chain.latest += 1;
      chains.set(id, chain);
      setLiked(qc, id, like);
      return { seq: chain.latest };
    },
    onSuccess: (_data, { id, like }) => {
      const chain = chainsFor(qc).get(id);
      if (chain) chain.confirmed = like;
    },
    onSettled: (_data, error, { id }, ctx) => {
      const chains = chainsFor(qc);
      const chain = chains.get(id);
      // A newer tap on this post is queued behind this one: it decides.
      if (!chain || ctx?.seq !== chain.latest) return;
      chains.delete(id);
      // On success too: a feed refetch that started after onMutate's cancel (pull-to-refresh, focus,
      // a Want to Try toggle) can land with the pre-tap state; the confirmed state wins.
      setLiked(qc, id, chain.confirmed);
      if (isApiError(error) && error.code === 'not_found') {
        void Promise.all(FEED_ITEM_PREFIXES.map((queryKey) => qc.invalidateQueries({ queryKey })));
      }
    },
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
