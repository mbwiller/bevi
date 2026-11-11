// Parked 2026-11-11 (TASKS.md D-16, M-32): unmounted, kept for the Bev Maps integration.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { VenueDetail, VenueFilters, VenuePin } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { inViewParams, type MapViewport } from '../venueViewport';

/** Pins stay fresh this long: an assortment changes when we curate it, not while you pan. */
export const VENUES_STALE_MS = 60_000;

/** The Neighborhood filter's vocabulary changes when we curate venues, so it is read about once a visit. */
export const NEIGHBORHOODS_STALE_MS = 60 * 60_000;

/**
 * The Search tab map's pins (M-16): `venues.inView` for a viewport the map has settled on (debounce
 * its `idle` events in the caller). Bounds are rounded and the zoom floored into the key and the
 * request alike, and the previous pins stay on screen while the next viewport loads. Disabled until
 * the map reports a viewport.
 */
export function useVenuesInView(viewport: MapViewport | null, filters?: VenueFilters) {
  const params = viewport ? inViewParams(viewport, filters) : null;
  return useQuery({
    queryKey: params ? keys.venues.inView(params) : [...keys.venues.all, 'inView', null],
    queryFn: () => api.venues.inView(params!),
    enabled: !!params,
    placeholderData: keepPreviousData,
    staleTime: VENUES_STALE_MS,
  });
}

/**
 * One venue and the Bevs it carries (the VenueSheet), keyed by id. While it loads, the tapped pin
 * stands in (`isPlaceholderData`, with no Bevs yet), so the sheet's header shows at once.
 */
export function useVenue(venueId: string | null, seed?: VenuePin | null) {
  return useQuery({
    queryKey: keys.venues.detail(venueId ?? ''),
    queryFn: () => api.venues.get(venueId!),
    enabled: !!venueId,
    staleTime: VENUES_STALE_MS,
    placeholderData:
      seed && seed.venue.id === venueId ? (): VenueDetail => ({ venue: seed.venue, openNow: seed.openNow, bevs: [] }) : undefined,
  });
}

/**
 * The neighbourhoods with a pinned venue, for the Neighborhood filter. Empty in prod today (OSM has
 * none for New York), and then the filter is left out; a failed read is treated the same way.
 */
export function useVenueNeighborhoods() {
  return useQuery({
    queryKey: keys.venues.neighborhoods(),
    queryFn: () => api.venues.neighborhoods(),
    staleTime: NEIGHBORHOODS_STALE_MS,
  });
}
