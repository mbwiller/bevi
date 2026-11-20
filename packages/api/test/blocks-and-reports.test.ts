import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type ReportContentInput } from '@bevi/shared';
import { createBlocksApi } from '../src/blocks.ts';
import { createReportsApi } from '../src/reports.ts';
import { decodeCursor } from '../src/paging.ts';

// IS-7: blocks and content reports over the RPCs in
// 20261118220000_user_blocks_and_reports.sql. A stand-in SupabaseClient
// records every RPC and answers from a script, so these pin the argument
// shapes and the error mapping without a live stack.

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

type Answer = { data: unknown; error: unknown };

function fakeClient(log: RpcCall[], answer: (call: RpcCall) => Answer = () => ({ data: null, error: null }), signedIn = true) {
  return {
    auth: {
      getUser: async () =>
        signedIn
          ? { data: { user: { id: 'me-0000' } }, error: null }
          : { data: { user: null }, error: null },
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      const call = { fn, args };
      log.push(call);
      return Promise.resolve(answer(call));
    },
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    },
  } as unknown as SupabaseClient;
}

/** A profile id as the database has it. `block_user`, `unblock_user` and `report_content` type it `uuid`. */
const USER_1 = '00000000-0000-4000-8000-000000000001';

/** A PostgrestError as a security-definer RPC raises it. */
const pgError = (message: string, code: string, details: string | null = null) => ({ message, code, details, hint: null });

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected a rejection');
}

function blockedRow(i: number) {
  return {
    user_id: `user-${i}`,
    handle: `person${i}`,
    display_name: `Person ${i}`,
    avatar_path: i === 0 ? `user-${i}/a.jpg` : null,
    timezone: 'America/New_York',
    onboarded: true,
    created_at: '2026-01-01T00:00:00.000Z',
    blocked_at: `2026-11-1${i}T00:00:00.000Z`,
  };
}

describe('blocks', () => {
  it('block and unblock call their RPCs with the user id', async () => {
    const log: RpcCall[] = [];
    const api = createBlocksApi(fakeClient(log));
    await api.block(USER_1);
    await api.unblock(USER_1);
    expect(log).toEqual([
      { fn: 'block_user', args: { p_user_id: USER_1 } },
      { fn: 'unblock_user', args: { p_user_id: USER_1 } },
    ]);
  });

  // Postgres would answer either with 22P02, which `mapError` reads as `unknown`.
  it.each(['user-1', '', '00000000-0000-4000-8000-00000000000', "' or 1=1 --"])(
    'an id that cannot be a profile (%j): block is not_found and unblock resolves, without calling an RPC',
    async (id) => {
      const log: RpcCall[] = [];
      const api = createBlocksApi(fakeClient(log));
      expect((await rejection(api.block(id))).code).toBe('not_found');
      await expect(api.unblock(id)).resolves.toBeUndefined();
      expect(log).toEqual([]);
    },
  );

  it.each([
    ['BEVI_VALIDATION', '22023', 'cannot block self', 'validation'],
    ['BEVI_NOT_FOUND', 'P0002', null, 'not_found'],
    ['BEVI_RATE_LIMITED', 'P0001', 'block_user', 'rate_limited'],
    ['BEVI_UNAUTHORIZED', '42501', null, 'unauthorized'],
  ] as const)('block maps %s to %s', async (name, sqlstate, details, code) => {
    const api = createBlocksApi(fakeClient([], () => ({ data: null, error: pgError(name, sqlstate, details) })));
    expect((await rejection(api.block(USER_1))).code).toBe(code);
  });

  it('is unauthorized signed out, without calling the RPC', async () => {
    const log: RpcCall[] = [];
    const api = createBlocksApi(fakeClient(log, undefined, false));
    expect((await rejection(api.block('user-1'))).code).toBe('unauthorized');
    expect((await rejection(api.unblock('user-1'))).code).toBe('unauthorized');
    expect((await rejection(api.list())).code).toBe('unauthorized');
    expect(log).toEqual([]);
  });

  it('list maps rows to BlockedUser and pages by offset', async () => {
    const log: RpcCall[] = [];
    const api = createBlocksApi(
      fakeClient(log, ({ args }) => {
        const limit = args.p_limit as number;
        const offset = args.p_offset as number;
        // Three blocked people in all.
        const rows = [0, 1, 2].map(blockedRow).slice(offset, offset + limit);
        return { data: rows, error: null };
      }),
    );

    const first = await api.list({ limit: 2 });
    expect(log[0]).toEqual({ fn: 'list_blocked_users', args: { p_limit: 2, p_offset: 0 } });
    expect(first.items.map((u) => u.id)).toEqual(['user-0', 'user-1']);
    expect(first.items[0]).toEqual({
      id: 'user-0',
      handle: 'person0',
      displayName: 'Person 0',
      avatarUrl: 'https://example.supabase.co/storage/v1/object/public/avatars/user-0/a.jpg',
      timezone: 'America/New_York',
      createdAt: '2026-01-01T00:00:00.000Z',
      birthdate: null,
      canSeeAlcohol: false,
      onboarded: true,
      blockedAt: '2026-11-10T00:00:00.000Z',
    });
    expect(decodeCursor(first.nextCursor)).toEqual({ offset: 2 });

    const second = await api.list({ limit: 2, cursor: first.nextCursor! });
    expect(log[1]).toEqual({ fn: 'list_blocked_users', args: { p_limit: 2, p_offset: 2 } });
    expect(second.items.map((u) => u.id)).toEqual(['user-2']);
    expect(second.nextCursor).toBeNull();
  });

  it('list clamps the page size to the package maximum', async () => {
    const log: RpcCall[] = [];
    const api = createBlocksApi(fakeClient(log, () => ({ data: [], error: null })));
    expect(await api.list({ limit: 1000 })).toEqual({ items: [], nextCursor: null });
    expect(log[0]!.args).toEqual({ p_limit: 50, p_offset: 0 });
  });
});

describe('reports', () => {
  it.each([
    [{ kind: 'post', id: '42', reason: 'spam' }, { p_reason: 'spam', p_feed_event_id: 42, p_note: null }],
    [{ kind: 'comment', id: '7', reason: 'harassment', note: 'rude' }, { p_reason: 'harassment', p_comment_id: 7, p_note: 'rude' }],
    [{ kind: 'profile', id: USER_1, reason: 'other' }, { p_reason: 'other', p_user_id: USER_1, p_note: null }],
  ] as [ReportContentInput, Record<string, unknown>][])('sends exactly one target for %o', async (input, args) => {
    const log: RpcCall[] = [];
    const api = createReportsApi(fakeClient(log, () => ({ data: 31, error: null })));
    expect(await api.report(input)).toEqual({ reportId: '31' });
    expect(log).toEqual([{ fn: 'report_content', args }]);
  });

  it('a post or comment id that cannot be a row is not_found, without calling the RPC', async () => {
    const log: RpcCall[] = [];
    const api = createReportsApi(fakeClient(log));
    expect((await rejection(api.report({ kind: 'post', id: 'abc', reason: 'spam' }))).code).toBe('not_found');
    expect((await rejection(api.report({ kind: 'comment', id: '', reason: 'spam' }))).code).toBe('not_found');
    expect(log).toEqual([]);
  });

  it('a profile id that cannot be a row is not_found, without calling the RPC', async () => {
    const log: RpcCall[] = [];
    const api = createReportsApi(fakeClient(log));
    // Postgres would answer each with 22P02, which `mapError` reads as `unknown`.
    for (const id of ['user-1', '', '42', '00000000-0000-4000-8000-00000000000']) {
      expect((await rejection(api.report({ kind: 'profile', id, reason: 'spam' }))).code).toBe('not_found');
    }
    expect(log).toEqual([]);
  });

  it.each([null, undefined])('an RPC that answers %s is unknown, never a report id', async (data) => {
    const api = createReportsApi(fakeClient([], () => ({ data, error: null })));
    const e = await rejection(api.report({ kind: 'post', id: '1', reason: 'spam' }));
    expect(e.code).toBe('unknown');
    expect(e.message).toBe('report_content returned no id');
  });

  it.each([
    ['BEVI_NOT_FOUND', 'P0002', null, 'not_found', undefined],
    ['BEVI_VALIDATION', '22023', 'reason', 'validation', { field: 'reason' }],
    ['BEVI_VALIDATION', '22023', 'note', 'validation', { field: 'note' }],
    ['BEVI_VALIDATION', '22023', 'cannot report own content', 'validation', { field: 'cannot report own content' }],
    ['BEVI_RATE_LIMITED', 'P0001', 'report_content', 'rate_limited', 'report_content'],
  ] as const)('maps %s (%s) to %s', async (name, sqlstate, details, code, detail) => {
    const api = createReportsApi(fakeClient([], () => ({ data: null, error: pgError(name, sqlstate, details) })));
    const e = await rejection(api.report({ kind: 'post', id: '1', reason: 'spam' }));
    expect(e.code).toBe(code);
    expect(e.detail).toEqual(detail);
  });

  it('is unauthorized signed out, without calling the RPC', async () => {
    const log: RpcCall[] = [];
    const api = createReportsApi(fakeClient(log, undefined, false));
    expect((await rejection(api.report({ kind: 'profile', id: 'user-1', reason: 'spam' }))).code).toBe('unauthorized');
    expect(log).toEqual([]);
  });
});
