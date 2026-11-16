import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryId, CreateBevInput, FindDuplicatesInput, UploadMediaInput } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';

/** Bev detail. Pass `refetchInterval` to poll while `photoStatus === 'processing'`. */
export function useBev(id: string | undefined, opts: { refetchInterval?: number | false; staleTime?: number } = {}) {
  return useQuery({
    queryKey: keys.bevs.detail(id ?? ''),
    queryFn: () => api.bevs.get(id!),
    enabled: !!id,
    refetchInterval: opts.refetchInterval,
    // Only when asked: an explicit `undefined` would override the client's default.
    ...(opts.staleTime != null && { staleTime: opts.staleTime }),
  });
}

/** A custom Bev's generated illustration; poll only while the backend reports active work. */
export function useBevIcon(id: string | undefined) {
  return useQuery({
    queryKey: keys.bevs.icon(id ?? ''),
    queryFn: async () => (await api.bevs.icons([id!])).find((icon) => icon.bevId === id) ?? null,
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.iconStatus;
      return status === 'pending' || status === 'processing' ? 4_000 : false;
    },
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

/**
 * "Did you mean…" in the create wizard (up to 5).
 *
 * `keepPrevious` holds the last answer while the next lookup runs, as `useBevSearch` does. The wizard
 * sets it while the person is still typing: every keystroke is a new query key, and without it `data`
 * falls to `undefined` between lookups, so the hints that depend on it flicker and move the fields
 * under the keyboard (BEV-7). Leave it off where an answer must be the answer to what was asked --
 * the duplicates step, which would otherwise show the previous name's matches instead of "Checking
 * Bevi…" while it waits.
 */
export function useLikelyDuplicates(
  input: FindDuplicatesInput,
  opts: { enabled?: boolean; keepPrevious?: boolean } = {},
) {
  const enabled = (opts.enabled ?? true) && input.name.trim().length >= 3;
  return useQuery({
    queryKey: keys.bevs.duplicates(input),
    queryFn: () => api.bevs.findLikelyDuplicates(input),
    enabled,
    // Only while a lookup is coming. A name too short to look up has no next answer to wait for, and a
    // disabled query would hold the last one for good: "4 Bevs like this" under an emptied Name field.
    ...(opts.keepPrevious && enabled ? { placeholderData: keepPreviousData } : {}),
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
