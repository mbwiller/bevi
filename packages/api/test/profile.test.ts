import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@bevi/shared';
import { createProfileApi } from '../src/profile.ts';

// A stand-in for SupabaseClient that records every RPC and every direct
// `profiles` update, so these tests can assert which path `updateMe` takes
// for each field without a live stack (the live suite covers the rest).
interface Log {
  rpc: Array<{ fn: string; args: unknown }>;
  updates: unknown[];
}

function fakeClient(log: Log, avatarPath: string | null = null): SupabaseClient {
  const row = {
    id: 'user-1',
    handle: 'pat',
    display_name: 'Pat',
    avatar_path: avatarPath,
    birth_date: null,
    can_see_alcohol: false,
    timezone: 'America/Chicago',
    onboarded: true,
    created_at: '2026-01-01T00:00:00.000Z',
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    rpc: (fn: string, args: unknown) => {
      log.rpc.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      update: (patch: unknown) => {
        log.updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
    }),
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    },
  } as unknown as SupabaseClient;
}

describe('profile.updateMe and the avatar', () => {
  it('sends avatarAssetId to set_avatar, never as a direct column update', async () => {
    const log: Log = { rpc: [], updates: [] };
    const api = createProfileApi(fakeClient(log, 'user-1/new.jpg'));

    const me = await api.updateMe({ avatarAssetId: 'user-1/new.jpg' });

    expect(log.rpc).toEqual([{ fn: 'set_avatar', args: { p_path: 'user-1/new.jpg' } }]);
    expect(log.updates).toEqual([]);
    expect(me.avatarUrl).toBe('https://example.supabase.co/storage/v1/object/public/avatars/user-1/new.jpg');
  });

  it('null clears the photo through set_avatar', async () => {
    const log: Log = { rpc: [], updates: [] };
    const api = createProfileApi(fakeClient(log, null));

    const me = await api.updateMe({ avatarAssetId: null });

    expect(log.rpc).toEqual([{ fn: 'set_avatar', args: { p_path: null } }]);
    expect(me.avatarUrl).toBeNull();
  });

  it('leaves the photo alone when avatarAssetId is omitted, and still writes the other columns directly', async () => {
    const log: Log = { rpc: [], updates: [] };
    const api = createProfileApi(fakeClient(log, 'user-1/old.jpg'));

    const me = await api.updateMe({ displayName: 'Pat Doe', onboarded: true });

    expect(log.rpc).toEqual([]);
    expect(log.updates).toEqual([{ display_name: 'Pat Doe', onboarded: true }]);
    expect(me.avatarUrl).toContain('/avatars/user-1/old.jpg');
  });
});

// DELIVERABLE-44: go-to categories over `user_category_picks` and
// `set_category_picks` (20261128000200). A stand-in client records the select
// chain and the RPC, and answers from a script, so these pin the column names,
// the filter, the argument shape and the error mapping without a live stack.
describe('profile.getCategoryPicks and setCategoryPicks', () => {
  interface PicksLog {
    from: string[];
    select: string[];
    eq: Array<[string, unknown]>;
    order: Array<[string, unknown]>;
    rpc: Array<{ fn: string; args: unknown }>;
  }
  type Answer = { data: unknown; error: unknown };

  /** A PostgrestError as a security-definer RPC raises it. */
  const pgError = (message: string, code: string, details: string | null = null) => ({ message, code, details, hint: null });

  function picksClient(log: PicksLog, answers: { select?: Answer; rpc?: Answer } = {}, signedIn = true): SupabaseClient {
    return {
      auth: {
        getUser: async () =>
          signedIn ? { data: { user: { id: 'user-1' } }, error: null } : { data: { user: null }, error: null },
      },
      from: (table: string) => {
        log.from.push(table);
        return {
          select: (columns: string) => {
            log.select.push(columns);
            return {
              eq: (column: string, value: unknown) => {
                log.eq.push([column, value]);
                return {
                  order: async (orderColumn: string, opts: unknown) => {
                    log.order.push([orderColumn, opts]);
                    return answers.select ?? { data: [], error: null };
                  },
                };
              },
            };
          },
        };
      },
      rpc: (fn: string, args: unknown) => {
        log.rpc.push({ fn, args });
        return Promise.resolve(answers.rpc ?? { data: [], error: null });
      },
    } as unknown as SupabaseClient;
  }

  const emptyLog = (): PicksLog => ({ from: [], select: [], eq: [], order: [], rpc: [] });

  async function rejection(p: Promise<unknown>): Promise<ApiError> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      return e as ApiError;
    }
    throw new Error('expected a rejection');
  }

  it("reads the caller's own rows by name, ordered by rank, favourite first", async () => {
    const log = emptyLog();
    const api = createProfileApi(
      picksClient(log, {
        // Out of order on purpose: the mapper sorts by rank whatever the transport did.
        select: { data: [{ category_id: 'soda', rank: 2 }, { category_id: 'coffee', rank: 1 }], error: null },
      }),
    );

    expect(await api.getCategoryPicks()).toEqual(['coffee', 'soda']);
    expect(log.from).toEqual(['user_category_picks']);
    expect(log.select).toEqual(['category_id, rank']);
    expect(log.eq).toEqual([['user_id', 'user-1']]);
    expect(log.order).toEqual([['rank', { ascending: true }]]);
  });

  it('is [] until set', async () => {
    const api = createProfileApi(picksClient(emptyLog(), { select: { data: [], error: null } }));
    expect(await api.getCategoryPicks()).toEqual([]);
  });

  it('sends the ids to set_category_picks in order and returns what was saved', async () => {
    const log = emptyLog();
    const api = createProfileApi(
      picksClient(log, {
        rpc: {
          data: [
            { category_id: 'tea', rank: 1 },
            { category_id: 'beer', rank: 2 },
          ],
          error: null,
        },
      }),
    );

    expect(await api.setCategoryPicks(['tea', 'beer'])).toEqual(['tea', 'beer']);
    expect(log.rpc).toEqual([{ fn: 'set_category_picks', args: { p_category_ids: ['tea', 'beer'] } }]);
    expect(log.from).toEqual([]);
  });

  it('an empty list clears, through the same RPC', async () => {
    const log = emptyLog();
    const api = createProfileApi(picksClient(log, { rpc: { data: [], error: null } }));
    expect(await api.setCategoryPicks([])).toEqual([]);
    expect(log.rpc).toEqual([{ fn: 'set_category_picks', args: { p_category_ids: [] } }]);
  });

  it("maps BEVI_VALIDATION to 'validation' on the categoryIds field", async () => {
    const api = createProfileApi(
      picksClient(emptyLog(), { rpc: { data: null, error: pgError('BEVI_VALIDATION', '22023', 'categoryIds') } }),
    );
    const e = await rejection(api.setCategoryPicks(['soda', 'soda']));
    expect(e.code).toBe('validation');
    expect(e.detail).toEqual({ field: 'categoryIds' });
  });

  it("maps BEVI_AGE_RESTRICTED to 'age_restricted', not 'unauthorized' (both are 42501)", async () => {
    const api = createProfileApi(
      picksClient(emptyLog(), { rpc: { data: null, error: pgError('BEVI_AGE_RESTRICTED', '42501') } }),
    );
    expect((await rejection(api.setCategoryPicks(['beer']))).code).toBe('age_restricted');
  });

  it('maps a failed read through mapError', async () => {
    const api = createProfileApi(
      picksClient(emptyLog(), { select: { data: null, error: pgError('permission denied for table user_category_picks', '42501') } }),
    );
    expect((await rejection(api.getCategoryPicks())).code).toBe('unauthorized');
  });

  it("signed out, both are 'unauthorized' and nothing reaches the database", async () => {
    const log = emptyLog();
    const api = createProfileApi(picksClient(log, {}, false));
    expect((await rejection(api.getCategoryPicks())).code).toBe('unauthorized');
    expect((await rejection(api.setCategoryPicks(['soda']))).code).toBe('unauthorized');
    expect(log.from).toEqual([]);
    expect(log.rpc).toEqual([]);
  });
});
