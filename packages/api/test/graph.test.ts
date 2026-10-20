// S-14 part 2: `bevs.similarities`, `bevs.similar` and `rankings.listBucketBevs`
// over the bev_edges mirror (20261019000500). The RPC name, the arguments and
// the row mapping are the contract between this package and the SQL; the SQL
// itself is covered by supabase/tests/11_graph_tables.test.sql.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBevsApi } from '../src/bevs.ts';
import { createRankingsApi } from '../src/rankings.ts';
import type { SnapshotCache } from '../src/snapshot.ts';

const ANCHOR = '00000000-0000-4000-8000-0000000ed001';
const NEIGHBOUR = '00000000-0000-4000-8000-0000000ed002';

const snapshots: SnapshotCache = {
  get: async () => {
    throw new Error('the graph methods must not touch the prediction snapshot');
  },
  invalidate: () => undefined,
};

interface Calls {
  rpc?: [string, unknown];
  rpcCount: number;
}

function fakeClient(result: { data?: unknown; error?: unknown }, calls: Calls): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    rpc: (name: string, args: unknown) => {
      calls.rpc = [name, args];
      calls.rpcCount += 1;
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }) }) },
  } as unknown as SupabaseClient;
}

describe('bevs.similarities', () => {
  it('calls get_bev_similarities with the anchor and the id list, and maps the weights', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createBevsApi(
      fakeClient({ data: [{ bev_id: NEIGHBOUR, weight: 0.95 }] }, calls),
      snapshots,
    );

    const rows = await api.similarities(ANCHOR, [NEIGHBOUR, ANCHOR]);

    expect(calls.rpc).toEqual(['get_bev_similarities', { p_bev_id: ANCHOR, p_other_ids: [NEIGHBOUR, ANCHOR] }]);
    expect(rows).toEqual([{ bevId: NEIGHBOUR, weight: 0.95 }]);
  });

  it('turns a numeric arriving as a string into a number', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createBevsApi(fakeClient({ data: [{ bev_id: NEIGHBOUR, weight: '0.90' }] }, calls), snapshots);

    const [row] = await api.similarities(ANCHOR, [NEIGHBOUR]);

    expect(row).toEqual({ bevId: NEIGHBOUR, weight: 0.9 });
    expect(typeof row!.weight).toBe('number');
  });

  it('is empty, with no round trip, when there is nothing to compare against', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createBevsApi(fakeClient({ data: [] }, calls), snapshots);

    expect(await api.similarities(ANCHOR, [])).toEqual([]);
    expect(calls.rpcCount).toBe(0);
  });

  // The mirror is empty until the sync job lands, and sparse afterwards: the
  // contract says a shorter-than-asked result is normal, so this is the
  // everyday case rather than an edge case.
  it('is empty when the mirror holds no edge for any of the pairs', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createBevsApi(fakeClient({ data: null }, calls), snapshots);

    expect(await api.similarities(ANCHOR, [NEIGHBOUR])).toEqual([]);
    expect(calls.rpcCount).toBe(1);
  });

  it('maps the server-side id-count guard to a validation error', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createBevsApi(
      fakeClient({ error: { code: '22023', message: 'BEVI_VALIDATION', details: 'otherIds' } }, calls),
      snapshots,
    );

    await expect(api.similarities(ANCHOR, [NEIGHBOUR])).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'otherIds' },
    });
  });
});

describe('bevs.similar', () => {
  const row = {
    id: NEIGHBOUR,
    name: 'Pepsi',
    brand: 'Pepsi',
    flavor: 'Original',
    category_id: 'soda',
    photo_path: 'full.jpg',
    thumb_path: 'thumb.jpg',
    price_tier: 1,
    price_estimated: true,
    rating_count: 7,
    avg_score: 8.1,
    bayes_score: 7.4,
  };

  it("calls get_similar_bevs and maps search_bevs' columns to a BevSummary", async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createBevsApi(fakeClient({ data: [row] }, calls), snapshots);

    const items = await api.similar(ANCHOR, 3);

    expect(calls.rpc).toEqual(['get_similar_bevs', { p_bev_id: ANCHOR, p_limit: 3 }]);
    expect(items).toEqual([
      {
        id: NEIGHBOUR,
        name: 'Pepsi',
        brand: 'Pepsi',
        flavor: 'Original',
        categoryId: 'soda',
        // thumb wins over the full photo, as everywhere else a card is mapped
        photoUrl: 'https://x/thumb.jpg',
        photoStatus: 'ready',
        priceTier: 1,
        priceEstimated: true,
        ratingCount: 7,
        bayesScore: 7.4,
      },
    ]);
  });

  it('defaults n to 10 and leaves the upper bound to the server', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createBevsApi(fakeClient({ data: [] }, calls), snapshots);

    await api.similar(ANCHOR);
    expect(calls.rpc).toEqual(['get_similar_bevs', { p_bev_id: ANCHOR, p_limit: 10 }]);

    await api.similar(ANCHOR, 10_000);
    expect(calls.rpc).toEqual(['get_similar_bevs', { p_bev_id: ANCHOR, p_limit: 10_000 }]);
  });

  it('is empty, not an error, for a Bev with no edges', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createBevsApi(fakeClient({ data: null }, calls), snapshots);

    expect(await api.similar(ANCHOR)).toEqual([]);
  });
});

describe('rankings.listBucketBevs', () => {
  it('calls list_bucket_bevs with the bucket smallint and maps the rows', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createRankingsApi(
      fakeClient(
        {
          data: [
            { id: ANCHOR, category_id: 'soda', brand_key: 'dr pepper' },
            { id: NEIGHBOUR, category_id: 'coffee', brand_key: null },
          ],
        },
        calls,
      ),
      snapshots,
    );

    const rows = await api.listBucketBevs('LOVED');

    expect(calls.rpc).toEqual(['list_bucket_bevs', { p_bucket: 3 }]);
    expect(rows).toEqual([
      { id: ANCHOR, categoryId: 'soda', brandKey: 'dr pepper' },
      { id: NEIGHBOUR, categoryId: 'coffee', brandKey: null },
    ]);
  });

  it('sends each bucket as the smallint the schema uses', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createRankingsApi(fakeClient({ data: [] }, calls), snapshots);

    await api.listBucketBevs('FINE');
    expect(calls.rpc).toEqual(['list_bucket_bevs', { p_bucket: 2 }]);
    await api.listBucketBevs('DISLIKED');
    expect(calls.rpc).toEqual(['list_bucket_bevs', { p_bucket: 1 }]);
  });

  it('is empty for a bucket the caller has nothing in', async () => {
    const calls: Calls = { rpcCount: 0 };
    const api = createRankingsApi(fakeClient({ data: null }, calls), snapshots);

    expect(await api.listBucketBevs('LOVED')).toEqual([]);
  });
});
