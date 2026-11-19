// Where the device is, for sorting the place picker's results by distance (BEV-22).
//
// This is the file every platform but the web runs, and for now it has no provider: the native app
// gets one when `expo-location` is added (a native dependency, so its own PR and a new build;
// DEVELOPMENT-MATT-IOS.md). Until then the picker works by name, which is what `unavailable` means
// to it. position.web.ts is the browser's Geolocation.
//
// THE POSITION IS USED TO ORDER ONE ANSWER. It goes to `venues.search` as the `near` of that
// request and is kept nowhere: not in a store, not in storage, not on the server.

import type { LatLng } from '@bevi/shared';

export type PositionResult =
  | { kind: 'ok'; position: LatLng }
  /** The user, or the browser's settings, said no. */
  | { kind: 'denied' }
  /** No provider on this platform, no fix, or no answer in time. */
  | { kind: 'unavailable' };

/** Whether asking would show a prompt: only a 'granted' answer is silent. */
export type PositionPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/** How long to wait for a fix before searching by name alone. */
export const POSITION_TIMEOUT_MS = 8_000;
/** A fix this recent is reused: opening the picker twice in a shop asks the GPS once. */
export const POSITION_MAX_AGE_MS = 60_000;

export async function positionPermission(): Promise<PositionPermission> {
  return 'unknown';
}

export async function currentPosition(): Promise<PositionResult> {
  return { kind: 'unavailable' };
}
