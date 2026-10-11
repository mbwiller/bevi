import { Platform } from 'react-native';

import type { SessionStatus } from '@/state/session';

const STATUSES: readonly SessionStatus[] = ['signedOut', 'onboarding', 'ready'];

/**
 * Whether the dev session override is on: only while the app runs on the mock API (the default
 * until the real API passes its contract tests, DEVELOPMENT-MATT §3), in dev and production builds
 * alike. With `EXPO_PUBLIC_BEVI_API=supabase` it is off everywhere: the session comes only from
 * `getSession`, `?session=` and the gallery toggle do nothing, and the /dev routes are unreachable.
 * (Read `process.env.EXPO_PUBLIC_BEVI_API` literally so the bundler inlines it.)
 */
export function sessionOverrideEnabled(): boolean {
  return process.env.EXPO_PUBLIC_BEVI_API !== 'supabase';
}

function isStatus(v: string | null): v is SessionStatus {
  return v !== null && (STATUSES as readonly string[]).includes(v);
}

/**
 * Starting status for the session store: with the override on, `?session=signedOut|onboarding|ready`
 * in the URL on web, else `ready` so the tabs are reachable. With it off, `signedOut` until the API
 * reports a session.
 */
export function devSessionStatus(search: string | undefined = currentSearch()): SessionStatus {
  if (!sessionOverrideEnabled()) return 'signedOut';
  const param = search ? new URLSearchParams(search).get('session') : null;
  return isStatus(param) ? param : 'ready';
}

function currentSearch(): string | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  return window.location.search;
}
