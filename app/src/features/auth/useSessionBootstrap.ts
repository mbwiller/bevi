import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError, type Session } from '@bevi/shared';

import { api } from '@/api/client';
import { useAuthListener } from '@/api/hooks';
import { useOnline } from '@/lib/useOnline';
import { useSession } from '@/state/session';

export interface SessionBootstrap {
  /**
   * The launch check got no answer: `getSession` could not tell whether anyone is signed in
   * (offline, with a stored session whose access token has expired), or `getMe` failed with
   * something other than `unauthorized` (offline, server error). Only set before the first check
   * settles; later failures retry quietly.
   */
  error: unknown;
  /** Makes the check that failed again: the session when it is not known, else its profile. */
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
 *
 * A `getSession` that got no answer (`network`) is not a sign-out: the session is still stored and
 * could not be checked. It is the launch error, like a `getMe` that failed, and it is asked again on
 * Retry and when the connection returns. A session or a sign-out heard meanwhile settles it.
 */
export function useSessionBootstrap(): SessionBootstrap {
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const current = useRef<Session | null>(null);
  /** The last `getSession` got no answer, and nothing has been heard about the session since. */
  const unknown = useRef(false);
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

  const askSession = useAuthListener(
    (session) => {
      unknown.current = false;
      current.current = session;
      if (useSession.getState().devForced) {
        useSession.setState({ devForced: false });
        return;
      }
      load(session);
    },
    (e) => {
      if (useSession.getState().devForced) {
        useSession.setState({ devForced: false });
        return;
      }
      unknown.current = true;
      setError(e);
    },
  );

  const checkSession = useCallback(() => {
    setError(null);
    askSession();
  }, [askSession]);

  // The connection came back. A check made while offline got no answer: it left the launch error
  // up, or the app signed out although the auth client still holds a session. Ask again, so the
  // app recovers by itself instead of waiting for Retry or a restart.
  const online = useOnline();
  const wasOnline = useRef(online);
  useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;
    if (!cameBack) return;
    if (unknown.current) checkSession();
    else if (current.current && useSession.getState().status === 'signedOut') load(current.current);
  }, [online, load, checkSession]);

  const retry = useCallback(() => (unknown.current ? checkSession() : load(current.current)), [load, checkSession]);
  return { error, retry };
}
