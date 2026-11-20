// Where a Bev was had (BEV-22, contract 3.4.0): the place picker's searches, the write that tags a
// ranked Bev, and the Map tab's reads.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BevdScope, LatLng } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { invalidateAfterVenueChange } from './util';

/** A search answer is good for this long: venues change when we import or someone adds one. */
export const PLACE_SEARCH_STALE_MS = 60_000;
/** The map's pins: a friend's new Bev shows up on the next visit, not while you look. */
export const BEVD_STALE_MS = 30_000;

/**
 * A position as the search key and the request both use it: four decimals, about 11 m. A phone's
 * fix moves by more than that while it sits on a table, and each new value would otherwise be a new
 * query; anything finer changes no result, since the nearest shop is not 11 m from the next one.
 */
export function searchPosition(near: LatLng | null | undefined): LatLng | null {
  if (!near || !Number.isFinite(near.lat) || !Number.isFinite(near.lng)) return null;
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return { lat: round(near.lat), lng: round(near.lng) };
}

/**
 * The place picker's results (`venues.search`): the venues nearest `near` for an empty query, name
 * matches otherwise. Debounce the query in the caller. Disabled with neither a query nor a
 * position, where the answer is always empty; the previous results stay up while the next load.
 */
export function useVenueSearch(query: string, near: LatLng | null | undefined, enabled = true) {
  const q = query.trim();
  const pos = searchPosition(near);
  return useQuery({
    queryKey: keys.venues.search(q, pos),
    queryFn: () => api.venues.search({ query: q, near: pos }),
    enabled: enabled && (q.length > 0 || pos !== null),
    placeholderData: keepPreviousData,
    staleTime: PLACE_SEARCH_STALE_MS,
  });
}

/**
 * Places Bevi does not have (`venues.searchMore`). Every call is a billed request on the server and
 * is rate limited per user, so this never runs on its own: it is fetched when `armed` is set, which
 * the picker does on a tap, and it does not retry.
 */
export function useSearchMorePlaces(query: string, near: LatLng | null | undefined, armed: boolean) {
  const q = query.trim();
  const pos = searchPosition(near);
  return useQuery({
    queryKey: keys.venues.searchMore(q, pos),
    queryFn: () => api.venues.searchMore({ query: q, near: pos }),
    enabled: armed && q.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Turns a `searchMore` result into a venue (`venues.addPlace`), which our own search finds from then on. */
export function useAddPlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (placeId: string) => api.venues.addPlace(placeId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...keys.venues.all, 'search'] }),
  });
}

/** Sets, replaces or (null) removes where the caller had a Bev they have ranked. */
export function useSetVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bevId, venueId }: { bevId: string; venueId: string | null }) => api.rankings.setVenue(bevId, venueId),
    onSuccess: () => invalidateAfterVenueChange(qc),
  });
}

/** Where the caller had one Bev, for the re-rank flow. Off until there is a Bev to ask about. */
export function useMyVenue(bevId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.rankings.venue(bevId ?? ''),
    queryFn: () => api.rankings.getVenue(bevId!),
    enabled: enabled && !!bevId,
  });
}

/** How much of the caller's Bev'd list has a place: the Map tab's "add where you had them" line. */
export function useLocationSummary() {
  return useQuery({ queryKey: keys.rankings.locationSummary(), queryFn: () => api.rankings.locationSummary() });
}

/** How many recently used places the picker shows above what is nearby. */
export const RECENT_PLACES = 3;

/**
 * The places the caller set on a Bev most recently (`venues.recent`), for the top of the picker:
 * tagging a second Bev at the same shop is then two taps. Fetched while the picker is open.
 */
export function useRecentVenues(enabled = true) {
  return useQuery({
    queryKey: keys.venues.recent(RECENT_PLACES),
    queryFn: () => api.venues.recent({ limit: RECENT_PLACES }),
    enabled,
    staleTime: BEVD_STALE_MS,
  });
}

/** The Map tab's pins (`venues.bevdMap`). The pins of the previous scope stay while the next load. */
export function useBevdMap(scope: BevdScope) {
  return useQuery({
    queryKey: keys.venues.bevdMap(scope),
    queryFn: () => api.venues.bevdMap({ scope }),
    placeholderData: keepPreviousData,
    staleTime: BEVD_STALE_MS,
  });
}

/** What was had at one venue (`venues.bevdAt`), for the sheet a pin opens. */
export function useBevdAt(venueId: string | null, scope: BevdScope) {
  return useQuery({
    queryKey: keys.venues.bevdAt(venueId ?? '', scope),
    queryFn: () => api.venues.bevdAt(venueId!, { scope }),
    enabled: !!venueId,
    staleTime: BEVD_STALE_MS,
    // 'not_found' is an answer (nothing in scope there any more), not a blip.
    retry: false,
  });
}
