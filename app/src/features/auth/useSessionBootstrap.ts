import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError, type Session } from '@bevi/shared';

import { api } from '@/api/client';
import { useAuthListener } from '@/api/hooks';
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
 * the current screen and retries quietly instead of replacing the app with an error.
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

  const retry = useCallback(() => load(current.current), [load]);
  return { error, retry };
}
