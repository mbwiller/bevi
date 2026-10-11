import { Platform } from 'react-native';

import type { SessionStatus } from '@/state/session';

const STATUSES: readonly SessionStatus[] = ['signedOut', 'onboarding', 'ready'];

/**
 * The override is on in development and whenever the app runs on the mock API (the default until
 * the real API passes its contract tests, DEVELOPMENT-MATT §3). Against the real API the session
 * comes only from `getSession`, so this returns `signedOut` until it answers.
 */
export const DEV_TOOLS_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_BEVI_API !== 'supabase';

function isStatus(v: string | null): v is SessionStatus {
  return v !== null && (STATUSES as readonly string[]).includes(v);
}

/**
 * Dev-only starting status for the session store: `?session=signedOut|onboarding|ready` in the URL
 * on web, else `ready` so the tabs are reachable. The gallery's Session toggle changes it at runtime.
 */
export function devSessionStatus(search: string | undefined = currentSearch()): SessionStatus {
  if (!DEV_TOOLS_ENABLED) return 'signedOut';
  const param = search ? new URLSearchParams(search).get('session') : null;
  return isStatus(param) ? param : 'ready';
}

function currentSearch(): string | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  return window.location.search;
}
