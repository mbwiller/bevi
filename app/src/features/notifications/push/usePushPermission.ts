import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { pushAvailable } from './availability';
import { getPushPermission } from './push';
import type { PushPermission } from './pushTypes';

/**
 * What the phone says about notifications for Bevi, read again whenever the screen using it comes
 * back into focus and whenever the app comes to the front (the person may have just changed it in
 * the phone's Settings). `null` until the first read; 'unavailable' at once where there is no push,
 * without asking the phone anything.
 */
export function usePushPermission(): { permission: PushPermission | null; refresh: () => Promise<PushPermission> } {
  const available = pushAvailable();
  const [permission, setPermission] = useState<PushPermission | null>(available ? null : 'unavailable');
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<PushPermission> => {
    if (!available) return 'unavailable';
    const next = await getPushPermission();
    if (live.current) setPermission(next);
    return next;
  }, [available]);

  useFocusEffect(
    useCallback(() => {
      if (!available) return;
      void refresh();
      const sub = AppState.addEventListener('change', (status) => {
        if (status === 'active') void refresh();
      });
      return () => sub.remove();
    }, [available, refresh]),
  );

  return { permission, refresh };
}
