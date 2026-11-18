import { useSyncExternalStore } from 'react';

import { connectionOnline, subscribeConnection } from './connectionStore';

/**
 * The connection, live (the native file; the web one, useOnline.web.ts, reads `navigator.onLine`
 * and follows the online and offline events). It reads the app's one connection store
 * (connectionStore.ts): NetInfo, corrected by asking the backend while NetInfo says offline. Starts
 * online.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeConnection, connectionOnline, connectionOnline);
}
