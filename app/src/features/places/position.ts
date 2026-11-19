// Where the device is, for sorting the place picker's results by distance (BEV-22).
//
// This is the file every platform but the web runs, and for now it has no provider: the native app
// gets one when `expo-location` is added (a native dependency, so its own PR and a new build;
// DEVELOPMENT-MATT-IOS.md). Until then the picker works by name, which is what `unavailable` means
// to it. position.web.ts is the browser's Geolocation.
//
// THE POSITION IS USED TO ORDER ONE ANSWER. It goes to `venues.search` as the `near` of that
// request and is kept nowhere: not in a store, not in storage, not on the server.

import type { PositionPermission, PositionResult } from './positionTypes';

export { POSITION_MAX_AGE_MS, POSITION_TIMEOUT_MS } from './positionTypes';
export type { PositionPermission, PositionResult } from './positionTypes';

export async function positionPermission(): Promise<PositionPermission> {
  return 'unknown';
}

export async function currentPosition(): Promise<PositionResult> {
  return { kind: 'unavailable' };
}
