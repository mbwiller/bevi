import { useQueryClient } from '@tanstack/react-query';
import { useRootNavigationState, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useUnreadNotificationCount } from '@/api/hooks';
import { keys } from '@/api/keys';
import { useSession } from '@/state/session';

import { pushAvailable } from './availability';
import { registerThisDevice } from './device';
import { configureForegroundPresentation, onPushOpened, onPushReceived, setAppBadge } from './push';
import { pushRoute, type PushRoute } from './pushRoute';

/**
 * Push while someone is signed in (T-31 Release 2), mounted once by the root layout beside the
 * Stack. Renders nothing. Off unless `ready` (the session is) and `pushAvailable()`: with the gate
 * off nothing below runs at all, so the app behaves as it did before push existed.
 */
export function PushHost({ ready }: { ready: boolean }) {
  if (!ready || !pushAvailable()) return null;
  return <PushLifecycle />;
}

/**
 * - A push shows while the app is open (`configureForegroundPresentation`).
 * - The device is registered when notifications are allowed: now, and each time the app comes to
 *   the front (device.ts keeps it to once per token per account).
 * - A push that arrives while open refreshes the bell's count; the inbox is only marked stale, so
 *   rows are never swapped under someone reading them (the Notifications screen reads it again
 *   when it is next opened).
 * - A push that is opened goes where its `data.url` says, if that is one of the allowed routes
 *   (pushRoute.ts), else to Notifications; the tap that launched the app waits for the navigator.
 * - The icon's badge is the bell's count, 0 included, and 0 once nobody is signed in.
 */
function PushLifecycle() {
  const qc = useQueryClient();
  const router = useRouter();
  const account = useSession((s) => s.profile?.handle);
  const navigatorReady = !!useRootNavigationState()?.key;
  const { data: unread } = useUnreadNotificationCount();
  const [opened, setOpened] = useState<PushRoute | null>(null);

  useEffect(() => configureForegroundPresentation(), []);

  useEffect(() => {
    if (!account) return;
    void registerThisDevice(account);
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') void registerThisDevice(account);
    });
    return () => sub.remove();
  }, [account]);

  useEffect(
    () =>
      onPushReceived(() => {
        void qc.invalidateQueries({ queryKey: keys.notifications.unreadCount() });
        void qc.invalidateQueries({ queryKey: keys.notifications.list(), refetchType: 'none' });
      }),
    [qc],
  );

  useEffect(() => onPushOpened((message) => setOpened(pushRoute(message.url))), []);

  useEffect(() => {
    if (!opened || !navigatorReady) return;
    setOpened(null);
    router.push(opened as Href);
  }, [opened, navigatorReady, router]);

  useEffect(() => {
    if (typeof unread === 'number') void setAppBadge(unread);
  }, [unread]);
  // Signed out by any path (Sign out, an expired session, a deleted account): no count is left on the icon.
  useEffect(() => () => void setAppBadge(0), []);

  return null;
}
