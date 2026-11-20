// Where the device is, for sorting the place picker's results by distance (BEV-22).
//
// This is the file every platform but the web runs: expo-location, asking for "while using the
// app" and nothing more. position.web.ts is the browser's Geolocation.
//
// THE POSITION IS USED TO ORDER ONE ANSWER. It goes to `venues.search` as the `near` of that
// request and is kept nowhere: not in a store, not in storage, not on the server.

import * as Location from 'expo-location';
import { Linking } from 'react-native';

import { POSITION_MAX_AGE_MS, POSITION_TIMEOUT_MS, type PositionPermission, type PositionResult } from './positionTypes';

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
 * fix (`POSITION_TIMEOUT_MS`) starts only once that prompt has been answered.
 */
export async function currentPosition(): Promise<PositionResult> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'undetermined') ({ status } = await Location.requestForegroundPermissionsAsync());
    if (status !== 'granted') return { kind: 'denied' };

    // Opening the picker twice in a shop asks the GPS once.
    const last = await Location.getLastKnownPositionAsync({ maxAge: POSITION_MAX_AGE_MS });
    if (last) return fix(last);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), POSITION_TIMEOUT_MS);
    });
    try {
      // A shop is a building, so the precise fix is worth the wait.
      const at = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), gaveUp]);
      return at ? fix(at) : { kind: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Location Services off for the whole phone, or no fix to be had.
    return { kind: 'unavailable' };
  }
}

/** Opens Bevi's page in iOS Settings, where a refused permission is turned back on. */
export const openPositionSettings: (() => void) | null = () => void Linking.openSettings();
