// BEV-22 (contract 3.5.0): what `rankings` and `venues` send for a place, and
// how the answers are shaped. The SQL is covered by
// supabase/tests/43_bev_locations.test.sql; this pins which function a call
// reaches, because the choice between `submit_ranking` and its wrapper is made
// here and nowhere else.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@bevi/shared';
import { createRankingsApi } from '../src/rankings.ts';
import { createVenuesApi } from '../src/venues.ts';
import type { SnapshotCache } from '../src/snapshot.ts';

const VENUE_ID = '00000000-0000-4000-8000-00000000d001';
const ME = '00000000-0000-4000-8000-0000000000a1';
const ANA = '00000000-0000-4000-8000-0000000000a2';

const venueJson = {
  id: VENUE_ID,
  name: 'The Café at Cornell Tech',
  kind: 'craft',
  place_type: 'cafe',
  lat: '40.7557',
  lng: '-73.9560',
  address: '2 West Loop Road',
  neighborhood: 'Roosevelt Island',
  borough: 'Manhattan',
  hours_osm: null,
  hours_known: false,
  website: null,
};

const rankingRow = {
  id: 'r1',
  user_id: ME,
  bev_id: 'bev-1',
  bucket: 3,
  position: 0,
  score: '8.20',
  note: null,
  photo_path: null,
  ranked_at: '2026-11-19T12:00:00Z',
  updated_at: '2026-11-19T12:00:00Z',
};

const bevRow = {
  id: 'bev-1',
  name: 'Cold Brew',
  brand: null,
  flavor: null,
  category_id: 'coffee',
  photo_path: null,
  price_tier: 2,
  price_estimated: false,
  bev_stats: { rating_count: 1, avg_score: 8.2, score_stddev: null, bayes_score: 6.9 },
  bev_icons: null,
};

const profile = (id: string, handle: string) => ({
  id,
  handle,
  display_name: handle,
  avatar_path: null,
  birth_date: null,
  can_see_alcohol: false,
  timezone: 'America/New_York',
  onboarded: true,
  created_at: '2026-10-01T00:00:00Z',
});

interface Fixture {
  rpc?: Record<string, { data?: unknown; error?: unknown }>;
  tables?: Record<string, unknown[]>;
  invoke?: { data?: unknown; error?: unknown };
}

interface Calls {
  rpc: Array<[string, Record<string, unknown>]>;
  invoke: Array<[string, unknown]>;
  from: string[];
}

function fakeClient(fixture: Fixture, calls: Calls = { rpc: [], invoke: [], from: [] }): SupabaseClient {
  // A PostgREST builder is awaitable and chainable; `.single()` unwraps one row.
  const answer = (result: { data?: unknown; error?: unknown }) => {
    const settled = { data: result.data ?? null, error: result.error ?? null };
    const builder = {
      single: () => Promise.resolve({ ...settled, data: Array.isArray(settled.data) ? (settled.data[0] ?? null) : settled.data }),
      eq: () => builder,
      in: () => builder,
      then: (ok: (v: typeof settled) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(settled).then(ok, bad),
    };
    return builder;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }) }) },
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc.push([name, args]);
      return answer(fixture.rpc?.[name] ?? { data: [] });
    },
    from: (table: string) => {
      calls.from.push(table);
      return { select: () => answer({ data: fixture.tables?.[table] ?? [] }) };
    },
    functions: {
      invoke: (name: string, options: { body?: unknown }) => {
        calls.invoke.push([name, options.body]);
        return Promise.resolve({ data: fixture.invoke?.data ?? null, error: fixture.invoke?.error ?? null });
      },
    },
  } as unknown as SupabaseClient;
}

const snapshots = { invalidate: () => undefined } as unknown as SnapshotCache;
const placement = { bevId: 'bev-1', bucket: 'LOVED' as const, insertIndex: 0, expectedBucketSize: 0, comparisons: [] };
const saved = { data: [{ ranking: rankingRow, bucket_size: 1 }] };

describe('rankings.submitRanking and a place', () => {
  it('with no venue calls submit_ranking, the function every older client calls', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    await createRankingsApi(fakeClient({ rpc: { submit_ranking: saved } }, calls), snapshots).submitRanking(placement);
    expect(calls.rpc.map(([name]) => name)).toEqual(['submit_ranking']);
    expect(calls.rpc[0]?.[1]).not.toHaveProperty('p_venue_id');
  });

  it('a null venue is the same as none', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    await createRankingsApi(fakeClient({ rpc: { submit_ranking: saved } }, calls), snapshots).submitRanking({
      ...placement,
      venueId: null,
    });
    expect(calls.rpc.map(([name]) => name)).toEqual(['submit_ranking']);
  });

  it('with a venue calls the wrapper, so the ranking and its place are one write', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const result = await createRankingsApi(
      fakeClient({ rpc: { submit_ranking_with_location: saved } }, calls),
      snapshots,
    ).submitRanking({ ...placement, note: 'on tap', venueId: VENUE_ID });

    expect(calls.rpc).toEqual([
      [
        'submit_ranking_with_location',
        { p_bev_id: 'bev-1', p_bucket: 3, p_insert_index: 0, p_expected_bucket_size: 0, p_comparisons: [], p_note: 'on tap', p_venue_id: VENUE_ID },
      ],
    ]);
    expect(result).toMatchObject({ bucketSize: 1, ranking: { id: 'r1', score: 8.2 } });
  });
});

describe('rankings.rerankBev and a place', () => {
  it('venueId left out keeps the place: plain rerank_bev', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    await createRankingsApi(fakeClient({ rpc: { rerank_bev: saved } }, calls), snapshots).rerankBev(placement);
    expect(calls.rpc.map(([name]) => name)).toEqual(['rerank_bev']);
  });

  it('a venue replaces it, and null removes it: both through the wrapper', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createRankingsApi(fakeClient({ rpc: { rerank_bev_with_location: saved } }, calls), snapshots);
    await api.rerankBev({ ...placement, venueId: VENUE_ID });
    await api.rerankBev({ ...placement, venueId: null });
    expect(calls.rpc.map(([name, args]) => [name, args.p_venue_id])).toEqual([
      ['rerank_bev_with_location', VENUE_ID],
      ['rerank_bev_with_location', null],
    ]);
  });
});

describe('rankings.setVenue, locationSummary and RankedBev.venue', () => {
  it('setVenue returns the venue, numbers as numbers', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createRankingsApi(fakeClient({ rpc: { set_bev_location: { data: venueJson } } }, calls), snapshots);
    const venue = await api.setVenue('bev-1', VENUE_ID);
    expect(calls.rpc).toEqual([['set_bev_location', { p_bev_id: 'bev-1', p_venue_id: VENUE_ID }]]);
    expect(venue).toMatchObject({ id: VENUE_ID, name: 'The Café at Cornell Tech', lat: 40.7557, lng: -73.956 });
  });

  it('setVenue(null) clears and returns null', async () => {
    const api = createRankingsApi(fakeClient({ rpc: { set_bev_location: { data: null } } }), snapshots);
    await expect(api.setVenue('bev-1', null)).resolves.toBeNull();
  });

  it('a Bev that is not ranked is not_found', async () => {
    const api = createRankingsApi(
      fakeClient({ rpc: { set_bev_location: { error: { code: 'P0002', message: 'BEVI_NOT_FOUND', details: 'ranking', hint: null } } } }),
      snapshots,
    );
    await expect(api.setVenue('bev-1', VENUE_ID)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('getVenue asks for the one pair, the caller and the Bev', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createRankingsApi(
      fakeClient({ rpc: { get_bev_locations: { data: [{ user_id: ME, bev_id: 'bev-1', venue: venueJson }] } } }, calls),
      snapshots,
    );
    await expect(api.getVenue('bev-1')).resolves.toMatchObject({ id: VENUE_ID });
    expect(calls.rpc).toEqual([['get_bev_locations', { p_user_ids: [ME], p_bev_ids: ['bev-1'] }]]);
    await expect(createRankingsApi(fakeClient({}), snapshots).getVenue('bev-2')).resolves.toBeNull();
  });

  it('locationSummary maps the one row', async () => {
    const api = createRankingsApi(
      fakeClient({ rpc: { bev_location_summary: { data: [{ ranked_count: 40, located_count: 28 }] } } }),
      snapshots,
    );
    await expect(api.locationSummary()).resolves.toEqual({ rankedCount: 40, locatedCount: 28 });
  });

  it('listMine puts each ranking\'s place on it, and null where there is none', async () => {
    const api = createRankingsApi(
      fakeClient({
        rpc: { get_user_bev_locations: { data: [{ bev_id: 'bev-1', venue: venueJson }] } },
        tables: {
          rankings: [
            { ...rankingRow, bevs: bevRow },
            { ...rankingRow, id: 'r2', bev_id: 'bev-2', position: 1, bevs: { ...bevRow, id: 'bev-2', name: 'Seltzer' } },
          ],
        },
      }),
      snapshots,
    );
    const page = await api.listMine();
    expect(page.items.map((r) => [r.bev.id, r.venue?.name ?? null])).toEqual([
      ['bev-1', 'The Café at Cornell Tech'],
      ['bev-2', null],
    ]);
  });
});

describe('venues.search', () => {
  it('sends the position as two numbers and maps the distance', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createVenuesApi(fakeClient({ rpc: { venues_search: { data: [{ venue: venueJson, distance_m: 84 }] } } }, calls));
    const results = await api.search({ query: 'cafe', near: { lat: 40.7557, lng: -73.956 } });
    expect(calls.rpc).toEqual([['venues_search', { p_query: 'cafe', p_lat: 40.7557, p_lng: -73.956, p_limit: 20 }]]);
    expect(results).toEqual([expect.objectContaining({ distanceMeters: 84, venue: expect.objectContaining({ id: VENUE_ID }) })]);
  });

  it('no position, or one that is not two finite numbers, goes as nulls', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createVenuesApi(fakeClient({}, calls));
    await api.search({ query: 'duane' });
    await api.search({ query: 'duane', near: { lat: Number.NaN, lng: -73.95 }, limit: 5 });
    expect(calls.rpc.map(([, args]) => [args.p_lat, args.p_lng, args.p_limit])).toEqual([
      [null, null, 20],
      [null, null, 5],
    ]);
  });
});

describe('venues.searchMore and addPlace', () => {
  it('searchMore posts the search to the places function and keeps only well-formed results', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createVenuesApi(
      fakeClient(
        {
          invoke: {
            data: {
              places: [
                { placeId: 'ChIJ1', name: 'Bread & Butter', placeType: 'store', address: '579 Main St', lat: 40.76, lng: -73.95, distanceMeters: 120 },
                { placeId: 'ChIJ3', name: 'Somewhere New', placeType: 'spaceport', address: null, lat: 40.77, lng: -73.96, distanceMeters: null },
                { placeId: 'ChIJ2', name: 'No position' },
                { name: 'No id', lat: 1, lng: 1 },
              ],
            },
          },
        },
        calls,
      ),
    );
    const places = await api.searchMore({ query: 'bread', near: { lat: 40.76, lng: -73.95 } });
    expect(calls.invoke).toEqual([['places', { action: 'search', query: 'bread', lat: 40.76, lng: -73.95 }]]);
    expect(places).toEqual([
      { placeId: 'ChIJ1', name: 'Bread & Butter', placeType: 'store', address: '579 Main St', lat: 40.76, lng: -73.95, distanceMeters: 120 },
      // A type this client does not know reads as 'other', not as a failure.
      { placeId: 'ChIJ3', name: 'Somewhere New', placeType: 'other', address: null, lat: 40.77, lng: -73.96, distanceMeters: null },
    ]);
  });

  it('addPlace returns the venue the function made, with what kind of place it is', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createVenuesApi(fakeClient({ invoke: { data: { venue: venueJson } } }, calls));
    await expect(api.addPlace('ChIJ1')).resolves.toMatchObject({ id: VENUE_ID, placeType: 'cafe' });
    expect(calls.invoke).toEqual([['places', { action: 'add', placeId: 'ChIJ1' }]]);
  });

  const httpError = (status: number, body: unknown) => ({
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  });

  it.each([
    [429, { error: 'rate_limited' }, 'rate_limited'],
    [404, { error: 'not_found' }, 'not_found'],
    // The gateway's answer when the function is not deployed: no `error` field, so not "no such place".
    [404, { code: 'NOT_FOUND', message: 'Requested function was not found' }, 'unknown'],
    [502, { error: 'upstream' }, 'unknown'],
    [400, { error: 'validation', message: 'query' }, 'validation'],
    [503, { error: 'not_configured' }, 'unknown'],
  ] as const)('a %i from the function is %s', async (status, body, code) => {
    const api = createVenuesApi(fakeClient({ invoke: { error: httpError(status, body) } }));
    const err = await api.searchMore({ query: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(code);
  });
});

describe('venues.recent', () => {
  it('asks for five by default, passes a limit through, and maps each venue', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createVenuesApi(
      fakeClient({ rpc: { recent_bev_venues: { data: [{ venue: venueJson, used_at: '2026-11-19T12:00:00Z' }] } } }, calls),
    );
    expect(await api.recent()).toEqual([expect.objectContaining({ id: VENUE_ID })]);
    await api.recent({ limit: 2 });
    expect(calls.rpc).toEqual([
      ['recent_bev_venues', { p_limit: 5 }],
      ['recent_bev_venues', { p_limit: 2 }],
    ]);
  });
});

describe('venues.bevdMap and bevdAt', () => {
  it('bevdMap defaults to everyone in scope and maps the counts', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createVenuesApi(
      fakeClient(
        { rpc: { bevd_map: { data: [{ venue: venueJson, bev_count: 3, mine_count: 1, latest_at: '2026-11-19T12:00:00Z' }] } } },
        calls,
      ),
    );
    const pins = await api.bevdMap();
    expect(calls.rpc).toEqual([['bevd_map', { p_scope: 'all' }]]);
    expect(pins).toEqual([
      expect.objectContaining({ bevCount: 3, mineCount: 1, latestAt: '2026-11-19T12:00:00Z', venue: expect.objectContaining({ id: VENUE_ID }) }),
    ]);
  });

  it('bevdAt is not_found for an id that is not a uuid, without a round trip', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    await expect(createVenuesApi(fakeClient({}, calls)).bevdAt('venue-1')).rejects.toMatchObject({ code: 'not_found' });
    expect(calls.rpc).toEqual([]);
  });

  it('bevdAt with nothing in scope is not_found: there was no pin', async () => {
    const api = createVenuesApi(fakeClient({ rpc: { bevd_at_venue: { data: [] } } }));
    await expect(api.bevdAt(VENUE_ID, { scope: 'friends' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('bevdAt joins each row to its ranking and its author, in the RPC\'s order, and drops one that vanished', async () => {
    const calls: Calls = { rpc: [], invoke: [], from: [] };
    const api = createVenuesApi(
      fakeClient(
        {
          rpc: {
            bevd_at_venue: {
              data: [
                { venue: venueJson, ranking_id: 'r2', user_id: ANA, bev_id: 'bev-1', ranked_at: '2026-11-19T13:00:00Z' },
                { venue: venueJson, ranking_id: 'r1', user_id: ME, bev_id: 'bev-1', ranked_at: '2026-11-19T12:00:00Z' },
                { venue: venueJson, ranking_id: 'gone', user_id: ME, bev_id: 'bev-9', ranked_at: '2026-11-19T11:00:00Z' },
              ],
            },
          },
          tables: {
            rankings: [
              { ...rankingRow, bevs: bevRow },
              { ...rankingRow, id: 'r2', user_id: ANA, bevs: bevRow },
            ],
            profiles_view: [profile(ME, 'me'), profile(ANA, 'ana')],
          },
        },
        calls,
      ),
    );

    const here = await api.bevdAt(VENUE_ID);

    expect(calls.rpc).toEqual([['bevd_at_venue', { p_venue_id: VENUE_ID, p_scope: 'all' }]]);
    expect(here.venue.id).toBe(VENUE_ID);
    expect(here.items.map((i) => [i.user.handle, i.ranking.id, i.ranking.venue?.id])).toEqual([
      ['ana', 'r2', VENUE_ID],
      ['me', 'r1', VENUE_ID],
    ]);
  });
});
