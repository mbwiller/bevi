// Where the device is, for sorting the place picker's results by distance (BEV-22).
//
// This is the file every platform but the web runs: expo-location, asking for "while using the
// app" and nothing more. position.web.ts is the browser's Geolocation.
//
// THE POSITION IS USED TO ORDER ONE ANSWER. It goes to `venues.search` as the `near` of that
// request and is kept nowhere: not in a store, not in storage, not on the server.

import * as Location from 'expo-location';
import { Linking } from 'react-native';

import {
  POSITION_FALLBACK_AGE_MS,
  POSITION_MAX_AGE_MS,
  POSITION_QUICK_MS,
  POSITION_TIMEOUT_MS,
  type PositionPermission,
  type PositionResult,
} from './positionTypes';

export { POSITION_MAX_AGE_MS, POSITION_TIMEOUT_MS } from './positionTypes';
export type { PositionPermission, PositionResult } from './positionTypes';

/**
 * What iOS says without asking, so a caller can tell whether asking would interrupt. 'prompt' until
 * the person has answered once; after a refusal iOS never asks again, which is what 'denied' means.
 */
export async function positionPermission(): Promise<PositionPermission> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unknown';
  }
}

const fix = (at: Location.LocationObject): PositionResult => ({
  kind: 'ok',
  position: { lat: at.coords.latitude, lng: at.coords.longitude },
});

/**
 * One fix, or why not. Never rejects. Shows the system prompt the first time, and the wait for a
 * fix starts only once that prompt has been answered.
 *
 * A fix from the last minute is used as it is. Otherwise a new one is asked for, and if it is slow
 * an older one (up to `POSITION_FALLBACK_AGE_MS`) stands in rather than nothing: a phone indoors,
 * or one that has not moved, may not produce a new fix at all.
 */
export async function currentPosition(): Promise<PositionResult> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'undetermined') ({ status } = await Location.requestForegroundPermissionsAsync());
    if (status !== 'granted') return { kind: 'denied' };

    // Opening the picker twice in a shop asks the GPS once.
    const recent = await Location.getLastKnownPositionAsync({ maxAge: POSITION_MAX_AGE_MS });
    if (recent) return fix(recent);
    const older = await Location.getLastKnownPositionAsync({ maxAge: POSITION_FALLBACK_AGE_MS });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), older ? POSITION_QUICK_MS : POSITION_TIMEOUT_MS);
    });
    try {
      // A shop is a building, so the precise fix is worth the wait.
      const at = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), gaveUp]);
      return at ? fix(at) : older ? fix(older) : { kind: 'unavailable' };
    } catch {
      // No new fix to be had; the older one is still better than none.
      return older ? fix(older) : { kind: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Location Services off for the whole phone, or the permission could not be read.
    return { kind: 'unavailable' };
  }
}

/** Opens Bevi's page in iOS Settings, where a refused permission is turned back on. */
export const openPositionSettings: (() => void) | null = () => void Linking.openSettings();
