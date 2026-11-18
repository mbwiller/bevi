import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Whether a NetInfo state counts as online. Only "no connection at all" is offline. `null` (not
 * known yet) counts as online, so a slow first answer never shows a false offline banner.
 *
 * `isInternetReachable` is deliberately not read: it is NetInfo's own probe of a Google URL, which a
 * network or VPN that blocks that URL answers "no" while Supabase is reachable. The offline state
 * blocks creating a Bev, so a false "offline" costs more than a late one; a request that fails on a
 * connected network already surfaces as its own error.
 */
export function isOnline(state: Pick<NetInfoState, 'isConnected'>): boolean {
  return state.isConnected !== false;
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
