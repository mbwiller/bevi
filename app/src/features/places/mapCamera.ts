// Where the Map tab's camera sits for a set of pins (BEV-22), as pure functions so jest checks them
// without a map.

import type { BevdPin } from '@bevi/shared';

/** react-native-maps' Region: a centre and how many degrees the view spans. */
export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** One place, or several on one block, is shown at about street level, never as a rooftop. */
export const MIN_SPAN_DEG = 0.012;
/** Room around the outermost pins, so none sits under the edge of the screen. */
export const SPAN_PADDING = 1.5;
const MAX_LAT_SPAN = 150;
const MAX_LNG_SPAN = 340;

/**
 * The region that shows every pin, or null when there are none. Pins in New York and in Dublin
 * give a view of the Atlantic, which is the honest picture. A set that straddles the antimeridian
 * is fitted the long way round; nobody's map does that yet.
 */
export function regionFor(pins: readonly Pick<BevdPin, 'venue'>[]): MapRegion | null {
  if (pins.length === 0) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const { venue } of pins) {
    south = Math.min(south, venue.lat);
    north = Math.max(north, venue.lat);
    west = Math.min(west, venue.lng);
    east = Math.max(east, venue.lng);
  }
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    latitudeDelta: Math.min(Math.max((north - south) * SPAN_PADDING, MIN_SPAN_DEG), MAX_LAT_SPAN),
    longitudeDelta: Math.min(Math.max((east - west) * SPAN_PADDING, MIN_SPAN_DEG), MAX_LNG_SPAN),
  };
}

/** Changes exactly when the set of places does, so the camera refits then and not on a refetch. */
export function pinsKey(pins: readonly Pick<BevdPin, 'venue'>[]): string {
  return pins
    .map((p) => p.venue.id)
    .sort()
    .join('|');
}

/** What a pin's disc shows: the count, capped so three digits never overflow it. */
export function pinText(pin: Pick<BevdPin, 'bevCount'>): string {
  return pin.bevCount > 99 ? '99+' : String(pin.bevCount);
}
