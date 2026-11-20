import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  type BevdAtVenue,
  type BevdHere,
  type BevdPin,
  type BevdScope,
  type ExternalPlace,
  type LatLng,
  type Profile,
  type Venue,
  type VenueDetail,
  type VenueMatch,
  type VenuePin,
  type VenuesApi,
} from '@bevi/shared';
import { mapError } from './errors';
import { requireUserId } from './currentUser';
import {
  mapProfile,
  mapVenue,
  mapVenueDetail,
  mapVenuePin,
  type ProfileViewRow,
  type VenueDetailRow,
  type VenueJsonRow,
  type VenuePinRow,
} from './mappers';
import { mapRankedBev, RANKED_BEV_SELECT, type RankingWithBevRow } from './rankings';

// `venue_detail` takes a `uuid`, so anything else would come back as a raw
// 22P02 (invalid_text_representation) that `mapError` has no reason to call
// not_found. The FakeApi answers not_found for an id like 'venue-1', and so
// does this, without the round trip.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An empty filter array is no filter (contract 2.10.0), the same as leaving it out. */
const nonEmpty = <T>(values: readonly T[] | undefined): readonly T[] | null =>
  values !== undefined && values.length > 0 ? values : null;

/** The Edge Function behind `searchMore` and `addPlace` (supabase/functions/places). */
const PLACES_FUNCTION = 'places';

/** `near` as the two RPC arguments; a position that is not two finite numbers is no position. */
function nearArgs(near: LatLng | null | undefined): { p_lat: number | null; p_lng: number | null } {
  const ok = !!near && Number.isFinite(near.lat) && Number.isFinite(near.lng);
  return { p_lat: ok ? near.lat : null, p_lng: ok ? near.lng : null };
}

interface PlacesErrorBody {
  error?: string;
  message?: string;
}

/**
 * The places function's error, as the contract's. supabase-js rejects a
 * non-2xx with a `FunctionsHttpError` whose body is on the attached
 * `Response`, as in bugs.ts. Anything unreadable falls through to `mapError`.
 */
async function mapPlacesError(error: unknown): Promise<ApiError> {
  const response = (error as { context?: Response } | null)?.context;
  if (response && typeof response.json === 'function') {
    let body: PlacesErrorBody | null = null;
    try {
      body = (await response.json()) as PlacesErrorBody;
    } catch {
      body = null;
    }
    const message = body?.message;
    if (body?.error === 'validation' || response.status === 400) {
      return new ApiError('validation', message ?? 'Check the search and try again');
    }
    if (response.status === 401 || response.status === 403) return new ApiError('unauthorized', message ?? 'Sign in to search places');
    if (body?.error === 'not_found' || response.status === 404) return new ApiError('not_found', message ?? 'No such place');
    if (body?.error === 'rate_limited' || response.status === 429) {
      return new ApiError('rate_limited', message ?? 'Too many place searches, try again in a minute');
    }
    return new ApiError('unknown', message ?? 'Place search is unavailable right now', body?.error);
  }
  return mapError(error);
}

const numOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Accepts only the shape the contract promises; a result without an id, a name or a position is dropped. */
function toExternalPlace(raw: unknown): ExternalPlace | null {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const lat = numOrNull(r.lat);
  const lng = numOrNull(r.lng);
  if (typeof r.placeId !== 'string' || !r.placeId || typeof r.name !== 'string' || !r.name || lat === null || lng === null) {
    return null;
  }
  return {
    placeId: r.placeId,
    name: r.name,
    address: typeof r.address === 'string' && r.address ? r.address : null,
    lat,
    lng,
    distanceMeters: numOrNull(r.distanceMeters),
  };
}

interface BevdAtVenueRow {
  venue: VenueJsonRow;
  ranking_id: string;
  user_id: string;
  bev_id: string;
  ranked_at: string;
}

/**
 * S-10 + A-08 half 2. Every method goes through a `security definer` RPC
 * because the three venue tables have RLS on with NO policy: there is no
 * direct read of a venue from a client, by design, so these RPCs are the whole
 * surface and the age gate lives in them.
 */
export function createVenuesApi(client: SupabaseClient): VenuesApi {
  return {
    async inView({ bounds, zoom, filters }): Promise<VenuePin[]> {
      await requireUserId(client);

      // The bounds go as jsonb and are CLAMPED to NYC_BOUNDS server-side, so a
      // viewport dragged past the coast returns what is inside rather than an
      // error. Nothing is validated here that the RPC does not also enforce.
      const { data, error } = await client.rpc('venues_in_view', {
        p_bounds: bounds,
        // `p_zoom` is an integer, and Google's vector maps report fractional
        // zooms (12.5), which Postgres would reject with 22P02. Floored, as
        // the FakeApi floors it; a non-finite zoom goes as null, which the
        // RPC reads as 11.
        p_zoom: Number.isFinite(zoom) ? Math.floor(zoom) : null,
        p_category_ids: nonEmpty(filters?.categoryIds),
        p_kinds: nonEmpty(filters?.kinds),
        p_price_tiers: nonEmpty(filters?.priceTiers),
        p_neighborhoods: nonEmpty(filters?.neighborhoods),
        p_open_now: filters?.openNow ?? false,
      });
      if (error) throw mapError(error);
      return (data as VenuePinRow[]).map(mapVenuePin);
    },

    async get(venueId: string): Promise<VenueDetail> {
      await requireUserId(client);

      // The same error `mapError` makes of the RPC's BEVI_NOT_FOUND.
      if (!UUID_RE.test(venueId)) throw new ApiError('not_found', 'BEVI_NOT_FOUND');

      const { data, error } = await client.rpc('venue_detail', { p_venue_id: venueId });
      if (error) throw mapError(error);
      // The RPC raises BEVI_NOT_FOUND for a hidden venue, an unknown id, or one
      // whose whole assortment this caller may not see, so an empty array here
      // would be a contract break rather than an empty sheet.
      return mapVenueDetail(client, data as VenueDetailRow[]);
    },

    async neighborhoods(): Promise<string[]> {
      await requireUserId(client);

      const { data, error } = await client.rpc('venue_neighborhoods');
      if (error) throw mapError(error);
      // Empty today, and that is the designed state: OSM has no neighbourhood
      // for any venue in the starting area. The contract tells the app to hide
      // the filter on an empty list rather than show it with no options.
      return (data as Array<{ neighborhood: string }>).map((r) => r.neighborhood);
    },

    // ----------------------------------------------------------------------
    // BEV-22: the place picker and the map of where Bevs were had
    // ----------------------------------------------------------------------

    async search({ query, near, limit }): Promise<VenueMatch[]> {
      await requireUserId(client);
      const { data, error } = await client.rpc('venues_search', {
        p_query: query,
        ...nearArgs(near),
        p_limit: limit ?? 20,
      });
      if (error) throw mapError(error);
      return ((data ?? []) as Array<{ venue: VenueJsonRow; distance_m: number | null }>).map((row) => ({
        venue: mapVenue(row.venue),
        distanceMeters: row.distance_m,
      }));
    },

    async searchMore({ query, near }): Promise<ExternalPlace[]> {
      await requireUserId(client);
      const { p_lat, p_lng } = nearArgs(near);
      const { data, error } = await client.functions.invoke<{ places?: unknown[] }>(PLACES_FUNCTION, {
        body: { action: 'search', query, lat: p_lat, lng: p_lng },
      });
      if (error) throw await mapPlacesError(error);
      return (data?.places ?? []).flatMap((raw) => {
        const place = toExternalPlace(raw);
        return place ? [place] : [];
      });
    },

    async addPlace(placeId: string): Promise<Venue> {
      await requireUserId(client);
      const { data, error } = await client.functions.invoke<{ venue?: VenueJsonRow }>(PLACES_FUNCTION, {
        body: { action: 'add', placeId },
      });
      if (error) throw await mapPlacesError(error);
      if (!data?.venue?.id) throw new ApiError('unknown', 'The places function returned no venue');
      return mapVenue(data.venue);
    },

    async bevdMap(params): Promise<BevdPin[]> {
      await requireUserId(client);
      const { data, error } = await client.rpc('bevd_map', { p_scope: params?.scope ?? ('all' satisfies BevdScope) });
      if (error) throw mapError(error);
      return (
        (data ?? []) as Array<{ venue: VenueJsonRow; bev_count: number; mine_count: number; latest_at: string }>
      ).map((row) => ({
        venue: mapVenue(row.venue),
        bevCount: row.bev_count,
        mineCount: row.mine_count,
        latestAt: row.latest_at,
      }));
    },

    async bevdAt(venueId, params): Promise<BevdAtVenue> {
      await requireUserId(client);
      if (!UUID_RE.test(venueId)) throw new ApiError('not_found', 'BEVI_NOT_FOUND');

      const { data, error } = await client.rpc('bevd_at_venue', {
        p_venue_id: venueId,
        p_scope: params?.scope ?? ('all' satisfies BevdScope),
      });
      if (error) throw mapError(error);
      const rows = (data ?? []) as BevdAtVenueRow[];
      const first = rows[0];
      // Nothing in scope the caller may see: there was no pin to have tapped.
      if (!first) throw new ApiError('not_found', 'Nothing was had at this venue');
      const venue = mapVenue(first.venue);

      // The RPC names the rankings; they and their authors are read through
      // the paths a profile screen uses, so RLS (the block, the age gate)
      // applies a second time and a Bev is shaped by the one mapper.
      const [rankings, profiles] = await Promise.all([
        client.from('rankings').select(RANKED_BEV_SELECT).in('id', rows.map((r) => r.ranking_id)),
        client.from('profiles_view').select('*').in('id', [...new Set(rows.map((r) => r.user_id))]),
      ]);
      if (rankings.error) throw mapError(rankings.error);
      if (profiles.error) throw mapError(profiles.error);

      const rankingById = new Map((rankings.data as RankingWithBevRow[]).map((r) => [r.id, r]));
      const profileById = new Map<string, Profile>(
        (profiles.data as ProfileViewRow[]).map((p) => [p.id, mapProfile(client, p)]),
      );

      // In the RPC's order (most recent first). A row whose ranking or author
      // did not come back was removed between the two reads; it is left out.
      const items = rows.flatMap((row): BevdHere[] => {
        const ranking = rankingById.get(row.ranking_id);
        const user = profileById.get(row.user_id);
        return ranking && user ? [{ user, ranking: mapRankedBev(client, ranking, venue) }] : [];
      });
      if (items.length === 0) throw new ApiError('not_found', 'Nothing was had at this venue');
      return { venue, items };
    },
  };
}
