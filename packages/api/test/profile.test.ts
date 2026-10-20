import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
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
