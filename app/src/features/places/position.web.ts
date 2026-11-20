// The browser's Geolocation behind the place picker (BEV-22). See position.ts for what the position
// is used for and where it does not go.

// From positionTypes, never from './position': on the web that path is this file.
import { POSITION_MAX_AGE_MS, POSITION_TIMEOUT_MS, type PositionPermission, type PositionResult } from './positionTypes';

export { POSITION_MAX_AGE_MS, POSITION_TIMEOUT_MS } from './positionTypes';
export type { PositionPermission, PositionResult } from './positionTypes';

/** The browser's Geolocation, if it has one (an insecure origin has none). */
function geolocation(): Geolocation | undefined {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : undefined;
}

/**
 * What the Permissions API says, so a caller can tell whether asking would interrupt. 'unknown' on
 * a browser without the API or without 'geolocation' in it (older Safari), which callers treat as
 * "would prompt".
 */
export async function positionPermission(): Promise<PositionPermission> {
  if (!geolocation()) return 'denied';
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return status ? (status.state as PositionPermission) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** One fix, or why not. Never rejects, and answers within `POSITION_TIMEOUT_MS` or a little over. */
export function currentPosition(geo: Geolocation | undefined = geolocation()): Promise<PositionResult> {
  if (!geo) return Promise.resolve({ kind: 'unavailable' });
  return new Promise<PositionResult>((resolve) => {
    let settled = false;
    const settle = (result: PositionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // Some browsers ignore the `timeout` option while a permission prompt is open.
    const timer = setTimeout(() => settle({ kind: 'unavailable' }), POSITION_TIMEOUT_MS + 500);
    geo.getCurrentPosition(
      (p) => settle({ kind: 'ok', position: { lat: p.coords.latitude, lng: p.coords.longitude } }),
      (e) => settle({ kind: e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      // A shop is a building, so the precise fix is worth the wait.
      { enableHighAccuracy: true, timeout: POSITION_TIMEOUT_MS, maximumAge: POSITION_MAX_AGE_MS },
    );
  });
}
