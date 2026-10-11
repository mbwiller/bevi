import { Redirect } from 'expo-router';

import { useSession, type SessionStatus } from '@/state/session';

const HOME = {
  signedOut: '/sign-in',
  onboarding: '/onboarding/profile',
  ready: '/feed',
} as const satisfies Record<SessionStatus, string>;

/** `/` and the fallback for any route the session doesn't allow: on to the status's home. */
export default function Index() {
  const status = useSession((s) => s.status);
  return <Redirect href={HOME[status]} />;
}
