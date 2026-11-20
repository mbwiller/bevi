// Where a Bev was had (BEV-22, contract 3.5.0): the reads that put a venue on
// a post or a Bev'd row.
//
// The feed RPCs do not return a venue. They are called by app binaries that
// cannot be redeployed, so their columns stay as they are, and the place comes
// from a second round trip per page, the way `loadActors` fetches the people
// (feed.ts). `bev_locations` has RLS on with no policy, so both reads below
// are definer RPCs, and the block and the age gate live in them.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Venue } from '@bevi/shared';
import { mapError } from './errors';
import { mapVenue, type VenueJsonRow } from './mappers';

/** PostgREST's "no function matches": the database is older than 20261119193100. */
const NO_SUCH_FUNCTION = 'PGRST202';

/**
 * A database without the BEV-22 migrations has neither RPC. That is the state
 * between this client shipping and the migration being pushed, if they happen
 * in that order, and the feed has to keep loading through it: no function
 * reads as "nobody said where", which is all the older server could tell us.
 */
const missing = (error: { code?: string | null }): boolean => error.code === NO_SUCH_FUNCTION;

export const venueKey = (userId: string, bevId: string): string => `${userId}:${bevId}`;

/** The places of these (user, Bev) pairs, keyed by `venueKey`. A pair with no visible place is absent. */
export async function loadVenuesForPairs(
  client: SupabaseClient,
  pairs: ReadonlyArray<{ userId: string; bevId: string }>,
): Promise<Map<string, Venue>> {
  const byKey = new Map<string, Venue>();
  const unique = [...new Map(pairs.map((p) => [venueKey(p.userId, p.bevId), p])).values()];
  if (unique.length === 0) return byKey;

  const { data, error } = await client.rpc('get_bev_locations', {
    p_user_ids: unique.map((p) => p.userId),
    p_bev_ids: unique.map((p) => p.bevId),
  });
  if (error) {
    if (missing(error)) return byKey;
    throw mapError(error);
  }
  for (const row of (data ?? []) as Array<{ user_id: string; bev_id: string; venue: VenueJsonRow }>) {
    byKey.set(venueKey(row.user_id, row.bev_id), mapVenue(row.venue));
  }
  return byKey;
}

/** Every place on one user's rankings, keyed by Bev id. */
export async function loadUserVenues(client: SupabaseClient, userId: string): Promise<Map<string, Venue>> {
  const byBev = new Map<string, Venue>();
  const { data, error } = await client.rpc('get_user_bev_locations', { p_user_id: userId });
  if (error) {
    if (missing(error)) return byBev;
    throw mapError(error);
  }
  for (const row of (data ?? []) as Array<{ bev_id: string; venue: VenueJsonRow }>) {
    byBev.set(row.bev_id, mapVenue(row.venue));
  }
  return byBev;
}
