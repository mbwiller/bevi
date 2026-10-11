import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { Session, SignInInput, SignUpInput } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { clearUserQueries, resetUserQueries } from './util';

/** The persisted session (null when signed out). Kept current by the auth mutations and `useAuthListener`. */
export function useSession() {
  return useQuery({ queryKey: keys.session(), queryFn: () => api.getSession(), staleTime: Infinity });
}

/**
 * Bridges `api.onAuthChange` to a session store without this module knowing the store: calls
 * `onChange` once with the persisted session on mount (`getSession`), then on every sign-in,
 * sign-out, token expiry and account deletion. Also keeps the session query in sync and drops the
 * previous user's cached data on sign-out. Mount it once, in the root layout:
 *
 *   useAuthListener((session) => useSessionStore.getState().setSession(session));
 */
export function useAuthListener(onChange: (session: Session | null) => void): void {
  const qc = useQueryClient();
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  useEffect(() => {
    let active = true;
    let heardEvent = false;
    const unsubscribe = api.onAuthChange((session) => {
      heardEvent = true;
      qc.setQueryData(keys.session(), session);
      if (!session) clearUserQueries(qc);
      cb.current(session);
    });
    api.getSession().then(
      (session) => {
        if (!active || heardEvent) return;
        qc.setQueryData(keys.session(), session);
        cb.current(session);
      },
      () => {
        if (active && !heardEvent) cb.current(null);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [qc]);
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

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.signOut(),
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
