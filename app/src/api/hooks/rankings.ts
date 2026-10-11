import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Bucket, SubmitRankingInput } from '@bevi/shared';

import { api } from '../client';
import { keys, type MyRankingsParams } from '../keys';
import { cursorPaging, invalidateAfterRankingChange } from './util';

/** The caller's rankings (Bev'd list), cursor-paginated. Default sort 'score'. */
export function useMyRankings(params: MyRankingsParams = {}) {
  const { limit, ...filters } = params;
  return useInfiniteQuery({
    queryKey: keys.rankings.mine(params),
    queryFn: ({ pageParam }) => api.rankings.listMine({ ...filters, page: { cursor: pageParam, limit } }),
    ...cursorPaging,
  });
}

/** A user's rankings, newest first (profile Activity). */
export function useUserRankings(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: keys.rankings.user(userId ?? ''),
    queryFn: ({ pageParam }) => api.rankings.listUser(userId!, { cursor: pageParam }),
    ...cursorPaging,
    enabled: !!userId,
  });
}

/**
 * The caller's whole bucket as ordered Bev ids: what the placement flow searches. Always fetched
 * fresh (`staleTime: 0`) since its length is `expectedBucketSize`.
 */
export function useBucket(bucket: Bucket | undefined) {
  return useQuery({
    queryKey: keys.rankings.bucket(bucket),
    queryFn: () => api.rankings.listBucket(bucket!),
    enabled: !!bucket,
    staleTime: 0,
  });
}

/**
 * On `conflict` (the bucket changed elsewhere) the screen refetches `useBucket` and restarts
 * placement; the bucket query is invalidated here either way.
 */
export function useSubmitRanking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitRankingInput) => api.rankings.submitRanking(input),
    onSettled: () => invalidateAfterRankingChange(qc),
  });
}

export function useRerankBev() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitRankingInput) => api.rankings.rerankBev(input),
    onSettled: () => invalidateAfterRankingChange(qc),
  });
}

export function useRemoveRanking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bevId: string) => api.rankings.removeRanking(bevId),
    onSettled: () => invalidateAfterRankingChange(qc),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bevId, note }: { bevId: string; note: string }) => api.rankings.updateNote(bevId, note),
    onSuccess: (_d, { bevId }) => {
      void qc.invalidateQueries({ queryKey: keys.rankings.all });
      void qc.invalidateQueries({ queryKey: keys.bevs.detail(bevId) });
      void qc.invalidateQueries({ queryKey: keys.feed() });
    },
  });
}
