// S-13 + A-12: `bevs.report` with `duplicateOfId`, and `bevs.get` after a merge.
// The RPC names, the arguments and the error mapping are the contract between
// this package and the SQL; the SQL itself is covered by
// supabase/tests/22_duplicates.test.sql.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isApiError } from '@bevi/shared';
import { createBevsApi } from '../src/bevs.ts';
import type { SnapshotCache } from '../src/snapshot.ts';

const BEV = '00000000-0000-4000-8000-0000000d1201';
const ORIGINAL = '00000000-0000-4000-8000-0000000d1202';

const snapshots: SnapshotCache = {
  // predictionFor catches this and returns null, which is all `get` needs here.
  get: async () => {
    throw new Error('no snapshot in this test');
  },
  invalidate: () => undefined,
};

type Result = { data: unknown; error: unknown };

interface Query extends PromiseLike<Result> {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  maybeSingle(): Promise<Result>;
}

interface Log {
  rpc: Array<{ fn: string; args: unknown }>;
  eqs: Array<{ table: string; column: string; value: unknown }>;
}

function fakeClient(log: Log, rpcResult: Result, tables: Record<string, Result> = {}): SupabaseClient {
  const query = (table: string): Query => {
    const result = tables[table] ?? { data: null, error: null };
    const q: Query = {
      select: () => q,
      eq: (column, value) => {
        log.eqs.push({ table, column, value });
        return q;
      },
      in: () => q,
      maybeSingle: async () => result,
      then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return q;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) },
    rpc: (fn: string, args: unknown) => {
      log.rpc.push({ fn, args });
      const p = Promise.resolve(rpcResult);
      return Object.assign(p, { maybeSingle: () => p });
    },
    from: query,
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }) }) },
  } as unknown as SupabaseClient;
}

describe('bevs.report', () => {
  it('sends p_duplicate_of: null when no original is named (today\'s app)', async () => {
    const log: Log = { rpc: [], eqs: [] };
    const api = createBevsApi(fakeClient(log, { data: null, error: null }), snapshots);

    await api.report(BEV, 'duplicate');

    expect(log.rpc).toEqual([
      { fn: 'report_bev', args: { p_bev_id: BEV, p_reason: 'duplicate', p_duplicate_of: null } },
    ]);
  });

  it('sends duplicateOfId as p_duplicate_of', async () => {
    const log: Log = { rpc: [], eqs: [] };
    const api = createBevsApi(fakeClient(log, { data: null, error: null }), snapshots);

    await api.report(BEV, 'duplicate', { duplicateOfId: ORIGINAL });

    expect(log.rpc).toEqual([
      { fn: 'report_bev', args: { p_bev_id: BEV, p_reason: 'duplicate', p_duplicate_of: ORIGINAL } },
    ]);
  });

  it("turns report_bev's BEVI_VALIDATION / 'duplicateOfId' into validation with detail.field", async () => {
    const log: Log = { rpc: [], eqs: [] };
    const error = { code: '22023', message: 'BEVI_VALIDATION', details: 'duplicateOfId', hint: null };
    const api = createBevsApi(fakeClient(log, { data: null, error }), snapshots);

    const e = await api.report(BEV, 'duplicate', { duplicateOfId: BEV }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(isApiError(e) && e.code).toBe('validation');
    expect(isApiError(e) && e.detail).toEqual({ field: 'duplicateOfId' });
  });
});

describe('bevs.get after a merge', () => {
  it('keys every follow-up read off the Bev get_bev returned, not the id asked for', async () => {
    const log: Log = { rpc: [], eqs: [] };
    // Asked for BEV, which was merged into ORIGINAL: get_bev returns ORIGINAL's row.
    const row = {
      id: ORIGINAL,
      name: 'Original',
      brand: null,
      flavor: null,
      category_id: 'water',
      photo_path: null,
      nutrition_label_path: null,
      price_tier: 1,
      price_estimated: true,
      status: 'active',
      is_starter: false,
      created_at: '2026-11-01T00:00:00.000Z',
      created_by_id: null,
      created_by_handle: null,
      rating_count: 0,
      avg_score: null,
      score_stddev: null,
      bayes_score: null,
    };
    const api = createBevsApi(
      fakeClient(log, { data: row, error: null }, { follows: { data: [], error: null } }),
      snapshots,
    );

    const bev = await api.get(BEV);

    expect(log.rpc).toEqual([{ fn: 'get_bev', args: { p_bev_id: BEV } }]);
    expect(bev.id).toBe(ORIGINAL);
    const bevIdReads = log.eqs.filter((e) => e.column === 'bev_id');
    expect(bevIdReads.map((e) => e.table).sort()).toEqual(['bev_flavor_profiles', 'rankings', 'want_to_try']);
    expect(bevIdReads.every((e) => e.value === ORIGINAL)).toBe(true);
  });
});
