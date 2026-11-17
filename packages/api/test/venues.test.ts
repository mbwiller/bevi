// S-10 + A-08 half 2: what `venues` sends to the RPCs (20261102000400). The
// SQL itself is covered by supabase/tests/27_venues_read.test.sql; this pins
// the arguments that would otherwise reach Postgres as a type error.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@bevi/shared';
import { createVenuesApi } from '../src/venues.ts';

const BOUNDS = { south: 40.76, north: 40.79, west: -73.98, east: -73.94 };

interface Calls {
  rpc?: [string, Record<string, unknown>];
  rpcCount: number;
}

function fakeClient(calls: Calls, data: unknown = []): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.rpc = [name, args];
      calls.rpcCount += 1;
      return Promise.resolve({ data, error: null });
    },
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }) }) },
  } as unknown as SupabaseClient;
}

describe('venues.inView', () => {
  it('floors a fractional zoom, because p_zoom is an integer and 12.5 would be a 22P02', async () => {
    const calls: Calls = { rpcCount: 0 };
    await createVenuesApi(fakeClient(calls)).inView({ bounds: BOUNDS, zoom: 12.5 });

    expect(calls.rpc?.[0]).toBe('venues_in_view');
    const zoom = calls.rpc?.[1].p_zoom;
    expect(zoom).toBe(12);
    expect(Number.isInteger(zoom)).toBe(true);
  });

  it('sends a non-finite zoom as null, which the RPC reads as 11', async () => {
    const calls: Calls = { rpcCount: 0 };
    await createVenuesApi(fakeClient(calls)).inView({ bounds: BOUNDS, zoom: Number.NaN });
    expect(calls.rpc?.[1].p_zoom).toBeNull();
  });

  it('sends an empty filter array as null: an empty array is no filter', async () => {
    const calls: Calls = { rpcCount: 0 };
    await createVenuesApi(fakeClient(calls)).inView({
      bounds: BOUNDS,
      zoom: 14,
      filters: { categoryIds: [], kinds: [], priceTiers: [], neighborhoods: [] },
    });

    expect(calls.rpc?.[1]).toMatchObject({
      p_category_ids: null,
      p_kinds: null,
      p_price_tiers: null,
      p_neighborhoods: null,
      p_open_now: false,
    });
  });

  it('passes a non-empty filter through unchanged', async () => {
    const calls: Calls = { rpcCount: 0 };
    await createVenuesApi(fakeClient(calls)).inView({ bounds: BOUNDS, zoom: 14, filters: { kinds: ['craft'] } });
    expect(calls.rpc?.[1].p_kinds).toEqual(['craft']);
  });
});

describe('venues.get', () => {
  it('is not_found for an id that is not a uuid, without the round trip that would be a raw 22P02', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createVenuesApi(fakeClient(calls));

    const err = await api.get('venue-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('not_found');
    expect(calls.rpcCount).toBe(0);
  });

  it('calls venue_detail for a uuid', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createVenuesApi(fakeClient(calls, []));

    // An empty result is the mapper's not_found; what matters here is the call.
    await api.get('00000000-0000-4000-8000-00000000dead').catch(() => undefined);
    expect(calls.rpc).toEqual(['venue_detail', { p_venue_id: '00000000-0000-4000-8000-00000000dead' }]);
  });
});
