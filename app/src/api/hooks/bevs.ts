import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryId, CreateBevInput, FindDuplicatesInput, UploadMediaInput } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';

/** Bev detail. Pass `refetchInterval` to poll while `photoStatus === 'processing'`. */
export function useBev(id: string | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: keys.bevs.detail(id ?? ''),
    queryFn: () => api.bevs.get(id!),
    enabled: !!id,
    refetchInterval: opts.refetchInterval,
  });
}

/**
 * First page of Bev search (25 results, age-filtered by the server). Debounce `q` in the screen;
 * keeps the previous results on screen while the next query loads.
 */
export function useBevSearch(q: string, categoryId?: CategoryId, opts: { enabled?: boolean; limit?: number } = {}) {
  return useQuery({
    queryKey: keys.bevs.search(q, categoryId),
    queryFn: () => api.bevs.search({ q, categoryId, limit: opts.limit ?? 25 }),
    enabled: opts.enabled,
    placeholderData: keepPreviousData,
  });
}

/** "Did you mean…" in the create wizard (up to 5). */
export function useLikelyDuplicates(input: FindDuplicatesInput, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.bevs.duplicates(input),
    queryFn: () => api.bevs.findLikelyDuplicates(input),
    enabled: (opts.enabled ?? true) && input.name.trim().length >= 3,
  });
}

/** ≥ 30 age-filtered starter Bevs; the screen picks 10 with a seeded selection. */
export function useStarterCandidates() {
  return useQuery({ queryKey: keys.bevs.starterCandidates(), queryFn: () => api.bevs.getStarterCandidates(), staleTime: Infinity });
}

/** How many neighbours "Bevs like this" shows on Bev detail. */
export const SIMILAR_BEVS_COUNT = 5;

/**
 * "Bevs like this": the heaviest `bev_edges` neighbours of a Bev, most similar first, age-filtered and active
 * only. Empty (not an error) when the Bev has no edges, so the caller renders the row only when non-empty.
 */
export function useSimilarBevs(bevId: string | undefined, n: number = SIMILAR_BEVS_COUNT) {
  return useQuery({
    queryKey: keys.bevs.similar(bevId ?? '', n),
    queryFn: () => api.bevs.similar(bevId!, n),
    enabled: !!bevId,
  });
}

/** Age-filtered categories. */
export function useCategories() {
  return useQuery({ queryKey: keys.categories(), queryFn: () => api.categories.list(), staleTime: Infinity });
}

export function useCreateBev() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBevInput) => api.bevs.create(input),
    onSuccess: (bev) => {
      qc.setQueryData(keys.bevs.detail(bev.id), bev);
      void qc.invalidateQueries({ queryKey: keys.bevs.all, predicate: (q) => q.queryKey[2] !== 'detail' });
    },
  });
}

export function useUploadMedia() {
  return useMutation({ mutationFn: (input: UploadMediaInput) => api.media.upload(input) });
}

export function useReportBev() {
  return useMutation({
    mutationFn: ({ bevId, reason, duplicateOfId }: { bevId: string; reason: string; duplicateOfId?: string }) =>
      api.bevs.report(bevId, reason, duplicateOfId ? { duplicateOfId } : undefined),
  });
}
