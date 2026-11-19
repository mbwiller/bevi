import type { NetInfoState } from '@react-native-community/netinfo';

/**
 * Whether a NetInfo state counts as online. Only "no connection at all" is offline. `null` (not
 * known yet) counts as online, so a slow first answer never shows a false offline banner.
 *
 * `isInternetReachable` is deliberately not read: it is NetInfo's own probe of a Google URL, which a
 * network or VPN that blocks that URL answers "no" while Supabase is reachable. The offline state
 * blocks creating a Bev and holds every read back (src/api/queryLifecycle.ts), so a false "offline"
 * costs more than a late one; a request that fails on a connected network already surfaces as its
 * own error.
 */
export function isOnline(state: Pick<NetInfoState, 'isConnected'>): boolean {
  return state.isConnected !== false;
}
