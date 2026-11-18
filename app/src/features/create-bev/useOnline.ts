import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Whether a NetInfo state counts as online. Only a definite "no" is offline: `null` (not known yet,
 * or the reachability probe has not answered) counts as online, so a slow first probe never shows a
 * false offline banner.
 */
export function isOnline(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

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
