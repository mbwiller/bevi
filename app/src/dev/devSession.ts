import { Platform } from 'react-native';

import { apiBackend } from '@/api/backend';

import type { SessionStatus } from '@/state/session';

const STATUSES: readonly SessionStatus[] = ['signedOut', 'onboarding', 'ready'];

/**
 * Whether the dev session override is on: only while the app runs on the mock API (the default
 * until the real API passes its contract tests, DEVELOPMENT-MATT §3), in dev and production builds
 * alike. With `EXPO_PUBLIC_BEVI_API=supabase` it is off everywhere: the session comes only from
 * `getSession`, `?session=` and the gallery toggle do nothing, and the /dev routes are unreachable.
 * Reads the backend from `@/api/backend` (the same source as `API_BACKEND` in `@/api/client`),
 * at call time and without constructing the API.
 */
export function sessionOverrideEnabled(): boolean {
  return apiBackend() === 'mock';
}

function isStatus(v: string | null): v is SessionStatus {
  return v !== null && (STATUSES as readonly string[]).includes(v);
}

/**
 * The status the dev override forces at launch: with the override on, `?session=signedOut|onboarding|ready`
 * in the URL on web; otherwise (no or unknown `?session=`, or the override off) null, and the session
 * comes from the API like in production. A fresh visitor on the mock with no session lands on sign in.
 */
export function devSessionOverride(search: string | undefined = currentSearch()): SessionStatus | null {
  if (!sessionOverrideEnabled()) return null;
  const param = search ? new URLSearchParams(search).get('session') : null;
  return isStatus(param) ? param : null;
}

/** Starting status for the session store: the dev override's, else `signedOut` until the API reports a session. */
export function devSessionStatus(search: string | undefined = currentSearch()): SessionStatus {
  return devSessionOverride(search) ?? 'signedOut';
}

function currentSearch(): string | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  return window.location.search;
}
