import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Bev, FeedItem, ProfileStats, WantToTryItem } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { cursorPaging, filterCachedItems, mapCachedItems, rollback, snapshot } from './util';

/** The caller's Want to Try, newest first. */
export function useWantToTry() {
  return useInfiniteQuery({
    queryKey: keys.wantToTry(),
    queryFn: ({ pageParam }) => api.wantToTry.list({ cursor: pageParam }),
    ...cursorPaging,
  });
}

/** Empty `items` below 3 rankings. */
export function useRecommendations(limit = 20) {
  return useQuery({ queryKey: keys.recommendations(limit), queryFn: () => api.recs.getRecommendations({ limit }) });
}

export function useRefreshRecommendations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.recs.refresh(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.recommendationsAll }),
  });
}

function applySaved(qc: QueryClient, bevId: string, saved: boolean) {
  const bev = qc.getQueryData<Bev>(keys.bevs.detail(bevId));
  const wasSaved = bev?.inWantToTry;
  qc.setQueryData<Bev>(keys.bevs.detail(bevId), (b) => b && { ...b, inWantToTry: saved });
  // The feed and every person's Activity (keys.feedUser sits under keys.feed()).
  qc.setQueriesData({ queryKey: keys.feed() }, (data: unknown) =>
    mapCachedItems<FeedItem>(data, (item) => (item.bev.id === bevId ? { ...item, inMyWantToTry: saved } : item)),
  );
  if (!saved) qc.setQueryData(keys.wantToTry(), (data: unknown) => filterCachedItems<WantToTryItem>(data, (w) => w.bev.id !== bevId));
  if (wasSaved !== saved) {
    qc.setQueryData<ProfileStats>(keys.stats.mine(), (s) => s && { ...s, wantToTryCount: Math.max(0, s.wantToTryCount + (saved ? 1 : -1)) });
  }
}

function settleSaved(qc: QueryClient, bevId: string) {
  void qc.invalidateQueries({ queryKey: keys.wantToTry() });
  void qc.invalidateQueries({ queryKey: keys.stats.mine() });
  void qc.invalidateQueries({ queryKey: keys.feed() });
  void qc.invalidateQueries({ queryKey: keys.bevs.detail(bevId) });
}

const SAVED_PREFIXES = [keys.wantToTry(), keys.feed(), keys.stats.mine()];

/** Optimistic: the bookmark fills immediately and rolls back on error. Idempotent server-side. */
export function useAddWantToTry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bevId, viaUserId }: { bevId: string; viaUserId?: string }) => api.wantToTry.add(bevId, viaUserId),
    onMutate: async ({ bevId }) => {
      const snap = await snapshot(qc, [...SAVED_PREFIXES, keys.bevs.detail(bevId)]);
      applySaved(qc, bevId, true);
      return { snap };
    },
    onError: (_e, _v, ctx) => rollback(qc, ctx?.snap),
    onSettled: (_d, _e, { bevId }) => settleSaved(qc, bevId),
  });
}

/** Optimistic, like `useAddWantToTry`; the row leaves the Want to Try list immediately. */
export function useRemoveWantToTry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bevId: string) => api.wantToTry.remove(bevId),
    onMutate: async (bevId) => {
      const snap = await snapshot(qc, [...SAVED_PREFIXES, keys.bevs.detail(bevId)]);
      applySaved(qc, bevId, false);
      return { snap };
    },
    onError: (_e, _v, ctx) => rollback(qc, ctx?.snap),
    onSettled: (_d, _e, bevId) => settleSaved(qc, bevId),
  });
}
