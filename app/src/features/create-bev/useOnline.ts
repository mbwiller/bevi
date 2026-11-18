import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

import { isOnline } from '@/lib/connection';

/**
 * The connection, live, from `@react-native-community/netinfo` (the native file; the web one,
 * useOnline.web.ts, reads `navigator.onLine`). Starts online and follows NetInfo's listener, which
 * reports the current state soon after subscribing and then every change.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((state) => setOnline(isOnline(state))), []);
  return online;
}
