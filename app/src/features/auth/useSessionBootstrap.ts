import { useCallback, useRef, useState } from 'react';
import { isApiError, type Session } from '@bevi/shared';

import { api } from '@/api/client';
import { useAuthListener } from '@/api/hooks';
import { useSession } from '@/state/session';

export interface SessionBootstrap {
  /** The last `getMe` failed with something other than `unauthorized` (offline, server error). */
  error: unknown;
  /** Loads the profile for the current session again. */
  retry: () => void;
}

/**
 * Drives the session store from the API. Mount once, in the root layout, inside the
 * QueryClientProvider. On launch (`getSession`) and on every auth change: a session → `getMe` →
 * `setSession(profile, profile.onboarded)`; none → `signOut`, so signing out from anywhere lands on
 * sign in. When the dev override forced the launch status (`?session=`, mock only), the launch check
 * is skipped and later auth events still apply.
 */
export function useSessionBootstrap(): SessionBootstrap {
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const current = useRef<Session | null>(null);

  const load = useCallback((session: Session | null) => {
    const n = ++seq.current;
    setError(null);
    const store = useSession.getState();
    if (!session) {
      store.signOut();
      return;
    }
    api.profile.getMe().then(
      (profile) => {
        if (n === seq.current) useSession.getState().setSession(profile, profile.onboarded);
      },
      (e: unknown) => {
        if (n !== seq.current) return;
        if (isApiError(e) && e.code === 'unauthorized') useSession.getState().signOut();
        else setError(e);
      },
    );
  }, []);

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
