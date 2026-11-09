// "Show where I am" on the full-screen map (M-16, decision 38). The browser's position is asked for
// only when the locate button is tapped, never on load, and it stays on the device: it places the
// blue dot and pans the map, and is never stored or sent. Pure over an injected Geolocation, so jest
// drives every outcome.

import { NYC_BOUNDS } from '@bevi/shared';

export interface LatLng {
  lat: number;
  lng: number;
}

export type LocateResult =
  | { kind: 'inside'; position: LatLng }
  | { kind: 'outside' }
  | { kind: 'denied' }
  /** No geolocation in this browser, no fix, or no answer within the timeout. */
  | { kind: 'unavailable' };

/** How long to wait for a fix before giving up. */
export const LOCATE_TIMEOUT_MS = 10_000;
/** A fix this recent is good enough: a second tap shouldn't wait on the GPS again. */
const MAX_AGE_MS = 60_000;
/** Locating zooms in to at least street level. */
export const LOCATE_ZOOM = 15;

/** What the map says when it can't show you. */
export const LOCATE_COPY: Record<Exclude<LocateResult['kind'], 'inside'>, string> = {
  outside: "You're outside New York City",
  denied: 'Location is off for Bevi. Turn it on in your browser settings.',
  unavailable: "Couldn't find where you are",
};

/** Inside the five-borough box the map is restricted to (decision 36). */
export function insideNyc(p: LatLng): boolean {
  return p.lat >= NYC_BOUNDS.south && p.lat <= NYC_BOUNDS.north && p.lng >= NYC_BOUNDS.west && p.lng <= NYC_BOUNDS.east;
}

/** The browser's Geolocation, if it has one (web only; insecure origins have none). */
export function browserGeolocation(): Geolocation | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.geolocation;
}

/** One position, classified. Never rejects. */
export function locate(geo: Geolocation | undefined, timeoutMs = LOCATE_TIMEOUT_MS): Promise<LocateResult> {
  if (!geo) return Promise.resolve({ kind: 'unavailable' });
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: LocateResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    // Some browsers never call back while their permission prompt is ignored: stop waiting anyway.
    const timer = setTimeout(() => finish({ kind: 'unavailable' }), timeoutMs + 1_000);
    try {
      geo.getCurrentPosition(
        (pos) => {
          const position = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          finish(insideNyc(position) ? { kind: 'inside', position } : { kind: 'outside' });
        },
        // GeolocationPositionError.PERMISSION_DENIED is 1.
        (err) => finish(err.code === 1 ? { kind: 'denied' } : { kind: 'unavailable' }),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: MAX_AGE_MS },
      );
    } catch {
      finish({ kind: 'unavailable' });
    }
  });
}
