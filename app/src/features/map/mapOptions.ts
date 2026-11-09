// The Search tab map's Google options (M-16, decisions 34 and 36). Pure and type-only on
// `google.maps`, so jest tests them without loading the Maps JS API.

import { NYC_BOUNDS, type LatLngBounds } from '@bevi/shared';

/**
 * The opening view (D-13): the Upper East Side with Roosevelt Island in frame on a phone-width map
 * under the search bar. Vector maps take fractional zooms; 13.75 fits roughly 59th to 86th Street
 * and the whole island at 390pt wide.
 */
export const DEFAULT_CENTER = { lat: 40.7695, lng: -73.953 } as const;
export const DEFAULT_ZOOM = 13.75;
/** About the five boroughs on a phone (decision 36); `strictBounds` does the rest. */
export const MIN_ZOOM = 10;
export const MAX_ZOOM = 19;
/** Pins are asked for once the viewport has stopped changing for this long after an `idle`. */
export const VIEWPORT_DEBOUNCE_MS = 250;

/**
 * Options for the one `google.maps.Map` of the session. No default UI (part 2 draws Beli's chrome),
 * no clickable Google POIs, and one-finger panning: the map fills the screen under the bar, so
 * "use two fingers to move the map" would only get in the way.
 */
export function mapOptions(mapId: string): google.maps.MapOptions {
  return {
    mapId,
    center: { ...DEFAULT_CENTER },
    zoom: DEFAULT_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    // NYC_BOUNDS is already Google's LatLngBoundsLiteral shape ({ north, south, east, west }).
    restriction: { latLngBounds: { ...NYC_BOUNDS }, strictBounds: true },
    disableDefaultUI: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
    keyboardShortcuts: true,
    // The map is created once per session, so it follows the system appearance rather than a
    // scheme read at creation time.
    colorScheme: 'FOLLOW_SYSTEM',
  };
}

/**
 * While the search results panel covers the map it takes no gestures and no keys (TASKS.md M-15):
 * the host is `pointer-events: none` as well, this stops the map's own handlers too.
 */
export function interactionOptions(passive: boolean): Pick<google.maps.MapOptions, 'gestureHandling' | 'keyboardShortcuts'> {
  return { gestureHandling: passive ? 'none' : 'greedy', keyboardShortcuts: !passive };
}

/** Google's `LatLngBounds.toJSON()` literal in the contract's shape. */
export function toLatLngBounds(b: google.maps.LatLngBoundsLiteral): LatLngBounds {
  return { south: b.south, west: b.west, north: b.north, east: b.east };
}
