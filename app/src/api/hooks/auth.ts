import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { isApiError, type Session, type SignInInput, type SignUpInput } from '@bevi/shared';

import { forgetThisDevice } from '@/features/notifications/push/device';

import { api } from '../client';
import { keys } from '../keys';
import { clearUserQueries, resetUserQueries } from './util';

/**
 * The persisted session as a query (null when signed out). Named to avoid the shell's Zustand
 * `useSession` store (state/session.ts). Kept current by the auth mutations and `useAuthListener`.
 */
export function useSessionQuery() {
  return useQuery({ queryKey: keys.session(), queryFn: () => api.getSession(), staleTime: Infinity });
}

/**
 * Bridges `api.onAuthChange` to a session store without this module knowing the store: calls
 * `onChange` once with the persisted session on mount (`getSession`), then on every sign-in,
 * sign-out, token expiry and account deletion. Also keeps the session query in sync and drops the
 * previous user's cached data on sign-out. Mount it once, in the root layout, e.g. with the
 * shell's store (state/session.ts):
 *
 *   useAuthListener((session) => {
 *     if (!session) return useSession.getState().signOut();
 *     api.profile.getMe().then((p) => useSession.getState().setSession(p, p.onboarded));
 *   });
 *
 * `getSession` can also get no answer. Opened offline with a stored session whose access token has
 * expired, it rejects with `network` (packages/api/src/auth.ts): the session is still there, it
 * just could not be checked. That is not a sign-out, so `onChange` is not called with null for it;
 * `onUnknown` is called with the error instead. The function this returns asks `getSession` again
 * (Retry, the connection returning) and reports the answer the same way. An auth event heard while
 * an answer is on its way is the newer of the two, and the answer is dropped.
 */
export function useAuthListener(onChange: (session: Session | null) => void, onUnknown?: (error: unknown) => void): () => void {
  const qc = useQueryClient();
  const cb = useRef(onChange);
  const unknown = useRef(onUnknown);
  const ask = useRef<() => void>(() => {});
  useEffect(() => {
    cb.current = onChange;
    unknown.current = onUnknown;
  });
  useEffect(() => {
    let active = true;
    let heard = 0;
    let asked = 0;
    const unsubscribe = api.onAuthChange((session) => {
      heard += 1;
      qc.setQueryData(keys.session(), session);
      if (!session) clearUserQueries(qc);
      cb.current(session);
    });
    ask.current = () => {
      const mine = ++asked;
      const heardBefore = heard;
      const stale = () => !active || heard !== heardBefore || mine !== asked;
      api.getSession().then(
        (session) => {
          if (stale()) return;
          qc.setQueryData(keys.session(), session);
          cb.current(session);
        },
        (e: unknown) => {
          if (stale()) return;
          if (isApiError(e) && e.code === 'network') unknown.current?.(e);
          else cb.current(null);
        },
      );
    };
    ask.current();
    return () => {
      active = false;
      ask.current = () => {};
      unsubscribe();
    };
  }, [qc]);
  return useCallback(() => ask.current(), []);
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SignInInput) => api.signIn(input),
    onSuccess: async (session) => {
      qc.setQueryData(keys.session(), session);
      await resetUserQueries(qc);
    },
  });
}

export function useSignUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SignUpInput) => api.signUp(input),
    onSuccess: async (session) => {
      qc.setQueryData(keys.session(), session);
      await resetUserQueries(qc);
    },
  });
}

/**
 * Signs out. First, while the session still works, this device's push token is forgotten by the
 * server and the icon's badge cleared (T-31 Release 2): best effort and bounded, it never fails or
 * holds up the sign-out (features/notifications/push/device.ts), and does nothing on a build
 * without push.
 */
export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await forgetThisDevice();
      await api.signOut();
    },
    onSuccess: () => {
      qc.setQueryData(keys.session(), null);
      clearUserQueries(qc);
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: () => {
      qc.setQueryData(keys.session(), null);
      clearUserQueries(qc);
    },
  });
}
