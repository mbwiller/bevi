import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Profile, Session, UpdateMeInput } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { cursorPaging } from './util';

interface QueryOpts {
  enabled?: boolean;
}

/** The signed-in user's profile; the root gate reads this one query. */
export function useMe(opts: QueryOpts = {}) {
  return useQuery({ queryKey: keys.me(), queryFn: () => api.profile.getMe(), enabled: opts.enabled });
}

/** Another user's profile row (with `isFollowing`). */
export function useUser(id: string | undefined) {
  return useQuery({ queryKey: keys.users.detail(id ?? ''), queryFn: () => api.profile.getUser(id!), enabled: !!id });
}

/** People search (Add tab, People). Debounce `q` in the screen. */
export function useUserSearch(q: string, opts: QueryOpts & { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: keys.users.search(q),
    queryFn: ({ pageParam }) => api.profile.searchUsers({ q, cursor: pageParam, limit: opts.limit ?? 25 }),
    ...cursorPaging,
    enabled: opts.enabled ?? q.trim().length > 0,
  });
}

/** Handle availability for the sign-up / edit-profile field. Callable signed out; debounce in the screen. */
export function useCheckHandle(handle: string, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.checkHandle(handle),
    queryFn: () => api.profile.checkHandle(handle),
    enabled: (opts.enabled ?? true) && handle.length > 0,
    staleTime: 10_000,
  });
}

/** `useStats()` = mine; `useStats(id)` = that user's. */
export function useStats(userId?: string) {
  return useQuery({
    queryKey: userId ? keys.stats.user(userId) : keys.stats.mine(),
    queryFn: () => (userId ? api.stats.getUser(userId) : api.stats.getMine()),
  });
}

function onProfileSaved(qc: ReturnType<typeof useQueryClient>, profile: Profile) {
  qc.setQueryData(keys.me(), profile);
  qc.setQueryData<Session | null>(keys.session(), (s) => (s ? { ...s, handle: profile.handle } : s));
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateMeInput) => api.profile.updateMe(patch),
    onSuccess: (profile) => {
      onProfileSaved(qc, profile);
      void qc.invalidateQueries({ queryKey: keys.users.all });
      void qc.invalidateQueries({ queryKey: keys.feed() });
      void qc.invalidateQueries({ queryKey: keys.leaderboard.users() });
    },
  });
}

/** Sets the birthdate once; `canSeeAlcohol` may flip, so every age-filtered read refetches. */
export function useSetBirthDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api.profile.setBirthDate(date),
    onSuccess: (profile) => {
      onProfileSaved(qc, profile);
      void qc.invalidateQueries({ queryKey: keys.categories() });
      void qc.invalidateQueries({ queryKey: keys.bevs.all });
      void qc.invalidateQueries({ queryKey: keys.featured() });
      void qc.invalidateQueries({ queryKey: keys.leaderboard.all });
      void qc.invalidateQueries({ queryKey: keys.recommendationsAll });
    },
  });
}
