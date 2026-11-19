import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError, type Session } from '@bevi/shared';

import { api } from '@/api/client';
import { useAuthListener } from '@/api/hooks';
import { useOnline } from '@/lib/useOnline';
import { useSession } from '@/state/session';

export interface SessionBootstrap {
  /**
   * The launch check's `getMe` failed with something other than `unauthorized` (offline, server
   * error). Only set before the first check settles; later failures retry quietly.
   */
  error: unknown;
  /** Loads the profile for the current session again. */
  retry: () => void;
}

/** Quiet retries after the first check: 1s, 2s, 4s … capped at 30s, until it works or the session changes. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * Drives the session store from the API. Mount once, in the root layout, inside the
 * QueryClientProvider. On launch (`getSession`) and on every auth change: a session → `getMe` →
 * `setSession(profile, profile.onboarded)`; none → `signOut`, so signing out from anywhere lands on
 * sign in. When a test set the status directly (`devForced`), the launch check is skipped and later
 * auth events still apply.
 *
 * A `getMe` result is dropped when a newer auth event arrived or the client changed the session
 * meanwhile (`epoch`: completeOnboarding, signOut). After the first check, a failing `getMe` keeps
 * the current screen and retries quietly instead of replacing the app with an error. When the
 * connection returns and the app is signed out while the auth client holds a session, it checks again.
 */
export function useSessionBootstrap(): SessionBootstrap {
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const current = useRef<Session | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((session: Session | null, attempt = 0) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const n = ++seq.current;
    setError(null);
    if (!session) {
      useSession.getState().signOut();
      return;
    }
    const epoch = useSession.getState().epoch;
    const stale = () => n !== seq.current || useSession.getState().epoch !== epoch;
    api.profile.getMe().then(
      (profile) => {
        if (!stale()) useSession.getState().setSession(profile, profile.onboarded);
      },
      (e: unknown) => {
        if (stale()) return;
        if (isApiError(e) && e.code === 'unauthorized') return useSession.getState().signOut();
        if (!useSession.getState().checked) return setError(e);
        const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
        timer.current = setTimeout(() => {
          if (n === seq.current) load(session, attempt + 1);
        }, delay);
      },
    );
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useAuthListener((session) => {
    current.current = session;
    if (useSession.getState().devForced) {
      useSession.setState({ devForced: false });
      return;
    }
    load(session);
  });

  // The connection came back. A check made while offline got no answer: it left the launch error
  // up, or the app signed out although the auth client still holds a session. Ask again, so the
  // app recovers by itself instead of waiting for Retry or a restart.
  const online = useOnline();
  const wasOnline = useRef(online);
  useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;
    if (cameBack && current.current && useSession.getState().status === 'signedOut') load(current.current);
  }, [online, load]);

  const retry = useCallback(() => load(current.current), [load]);
  return { error, retry };
}
