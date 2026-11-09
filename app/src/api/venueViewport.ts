// What the Search tab map asks `venues.inView` for (M-16), as pure functions so the query key and
// the request are unit-tested without a map. The map reports its viewport on every `idle`; small
// jitters (a 1px pan, a fractional zoom) must not make a new request, so bounds are rounded and
// the zoom floored here, and the request is built from the same rounded values as the key.

import { NYC_BOUNDS, type LatLngBounds, type VenueFilters } from '@bevi/shared';

/** The map's viewport as Google reports it: bounds plus a possibly fractional zoom. */
export interface MapViewport {
  bounds: LatLngBounds;
  zoom: number;
}

/** 4 dp is about 11 m at New York's latitude: finer than a pin, coarser than a nudge. */
export const BOUNDS_DP = 4;
const SCALE = 10 ** BOUNDS_DP;

/** Removes binary noise (40.7762 * 1e4 = 407761.99…) before flooring or ceiling. */
const tidy = (v: number) => Math.round(v * SCALE * 1e6) / 1e6;
const down = (v: number) => Math.floor(tidy(v)) / SCALE;
const up = (v: number) => Math.ceil(tidy(v)) / SCALE;

/**
 * Bounds clamped to `NYC_BOUNDS` (the server clamps the same way, so the answer is unchanged) and
 * rounded OUTWARD to `BOUNDS_DP`, so the request never covers less than what is on screen.
 */
export function roundBounds(b: LatLngBounds): LatLngBounds {
  return {
    south: down(Math.max(b.south, NYC_BOUNDS.south)),
    west: down(Math.max(b.west, NYC_BOUNDS.west)),
    north: up(Math.min(b.north, NYC_BOUNDS.north)),
    east: up(Math.min(b.east, NYC_BOUNDS.east)),
  };
}

/**
 * Filters in one canonical form: an empty array is the same as no filter (contract 2.10.0), so it
 * is dropped, and multi-selects are sorted so ticking A then B and B then A share a cache entry.
 */
export function normaliseVenueFilters(f: VenueFilters | undefined): VenueFilters {
  const out: VenueFilters = {};
  if (!f) return out;
  const sorted = <T extends string | number>(xs: readonly T[] | undefined): T[] | undefined =>
    xs && xs.length ? [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : undefined;
  const categoryIds = sorted(f.categoryIds);
  const kinds = sorted(f.kinds);
  const priceTiers = sorted(f.priceTiers);
  const neighborhoods = sorted(f.neighborhoods);
  if (categoryIds) out.categoryIds = categoryIds;
  if (kinds) out.kinds = kinds;
  if (priceTiers) out.priceTiers = priceTiers;
  if (neighborhoods) out.neighborhoods = neighborhoods;
  if (f.openNow === true) out.openNow = true;
  return out;
}

/** The exact `venues.inView` argument for a viewport: rounded bounds, floored zoom, canonical filters. */
export function inViewParams(viewport: MapViewport, filters?: VenueFilters): { bounds: LatLngBounds; zoom: number; filters: VenueFilters } {
  return { bounds: roundBounds(viewport.bounds), zoom: Math.floor(viewport.zoom), filters: normaliseVenueFilters(filters) };
}
