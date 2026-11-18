import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { isOnline } from '@/lib/connection';

/**
 * Tells React Query when the phone is online and when the app is in front. The native file: in a
 * browser React Query hears both from `window` by itself (queryLifecycle.web.ts does nothing), but
 * React Native has no such events, so without this it believes it is always online and in focus.
 *
 * - Online, from NetInfo: with no connection a read waits instead of failing, and the moment the
 *   connection is back the waiting reads run and the ones that failed are fetched again. Without it
 *   a screen that failed offline kept its error for good.
 * - Focus, from AppState: a stale read is refreshed when the app comes back to the foreground, as a
 *   browser tab does when it is shown again.
 *
 * Safe to call again: each call replaces the listeners of the one before.
 */
export function connectQueryLifecycle(): void {
  onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(isOnline(state))));
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (status) => setFocused(status === 'active'));
    return () => subscription.remove();
  });
}
