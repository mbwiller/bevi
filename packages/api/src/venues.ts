import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type VenueDetail, type VenuePin, type VenuesApi } from '@bevi/shared';
import { mapError } from './errors';
import { mapVenueDetail, mapVenuePin, type VenueDetailRow, type VenuePinRow } from './mappers';

/**
 * S-10 + A-08 half 2. Every method goes through a `security definer` RPC
 * because the three venue tables have RLS on with NO policy: there is no
 * direct read of a venue from a client, by design, so these RPCs are the whole
 * surface and the age gate lives in them.
 */
export function createVenuesApi(client: SupabaseClient): VenuesApi {
  return {
    async inView({ bounds, zoom, filters }): Promise<VenuePin[]> {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw new ApiError('unauthorized', 'Not signed in');

      // The bounds go as jsonb and are CLAMPED to NYC_BOUNDS server-side, so a
      // viewport dragged past the coast returns what is inside rather than an
      // error. Nothing is validated here that the RPC does not also enforce.
      const { data, error } = await client.rpc('venues_in_view', {
        p_bounds: bounds,
        p_zoom: zoom,
        p_category_ids: filters?.categoryIds ?? null,
        p_kinds: filters?.kinds ?? null,
        p_price_tiers: filters?.priceTiers ?? null,
        p_neighborhoods: filters?.neighborhoods ?? null,
        p_open_now: filters?.openNow ?? false,
      });
      if (error) throw mapError(error);
      return (data as VenuePinRow[]).map(mapVenuePin);
    },

    async get(venueId: string): Promise<VenueDetail> {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw new ApiError('unauthorized', 'Not signed in');

      const { data, error } = await client.rpc('venue_detail', { p_venue_id: venueId });
      if (error) throw mapError(error);
      // The RPC raises BEVI_NOT_FOUND for a hidden venue, an unknown id, or one
      // whose whole assortment this caller may not see, so an empty array here
      // would be a contract break rather than an empty sheet.
      return mapVenueDetail(client, data as VenueDetailRow[]);
    },

    async neighborhoods(): Promise<string[]> {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw new ApiError('unauthorized', 'Not signed in');

      const { data, error } = await client.rpc('venue_neighborhoods');
      if (error) throw mapError(error);
      // Empty today, and that is the designed state: OSM has no neighbourhood
      // for any venue in the starting area. The contract tells the app to hide
      // the filter on an empty list rather than show it with no options.
      return (data as Array<{ neighborhood: string }>).map((r) => r.neighborhood);
    },
  };
}
