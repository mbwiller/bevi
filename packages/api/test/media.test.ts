import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createMediaApi } from '../src/media.ts';

// A minimal stand-in for SupabaseClient that records whether the
// rate-limit RPC or the storage upload were ever reached. Validation
// (mimeType / size) must reject before either -- these tests assert
// that without a live Supabase stack.
function fakeClient(calls: { rpc?: boolean; upload?: boolean } = {}): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
    rpc: () => {
      calls.rpc = true;
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from: () => ({
        upload: () => {
          calls.upload = true;
          return Promise.resolve({ data: { path: 'user-1/x.jpg' }, error: null });
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/bev-photos/${path}` } }),
      }),
    },
  } as unknown as SupabaseClient;
}

describe('media.upload validation', () => {
  it('rejects an unsupported mimeType before calling the rate-limit RPC or storage', async () => {
    const calls: { rpc?: boolean; upload?: boolean } = {};
    const api = createMediaApi(fakeClient(calls));

    await expect(
      api.upload({ kind: 'bev-photo', file: { size: 100 } as unknown as Blob, mimeType: 'image/gif' })
    ).rejects.toMatchObject({ code: 'validation', detail: { field: 'mimeType' } });
    expect(calls.rpc).toBeUndefined();
    expect(calls.upload).toBeUndefined();
  });

  it('rejects a file over the 10 MB limit before calling the rate-limit RPC or storage', async () => {
    const calls: { rpc?: boolean; upload?: boolean } = {};
    const api = createMediaApi(fakeClient(calls));
    const oversized = { size: 10 * 1024 * 1024 + 1 } as unknown as Blob;

    await expect(api.upload({ kind: 'label', file: oversized, mimeType: 'image/png' })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'file' },
    });
    expect(calls.rpc).toBeUndefined();
    expect(calls.upload).toBeUndefined();
  });

  it('accepts a file exactly at the 10 MB limit with a supported mimeType', async () => {
    const calls: { rpc?: boolean; upload?: boolean } = {};
    const api = createMediaApi(fakeClient(calls));
    const atLimit = { size: 10 * 1024 * 1024 } as unknown as Blob;

    const result = await api.upload({ kind: 'bev-photo', file: atLimit, mimeType: 'image/jpeg' });
    expect(result.status).toBe('ready');
    expect(result.assetId).toMatch(/^user-1\/.+\.jpg$/);
    expect(result.url).toContain(result.assetId);
    expect(calls.rpc).toBe(true);
    expect(calls.upload).toBe(true);
  });

  it('derives the extension from mimeType for every supported type', async () => {
    const cases: Array<[string, string]> = [
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
      ['image/heic', 'heic'],
    ];
    for (const [mimeType, ext] of cases) {
      const api = createMediaApi(fakeClient());
      const result = await api.upload({ kind: 'label', file: { size: 1 } as unknown as Blob, mimeType });
      expect(result.assetId.endsWith(`.${ext}`)).toBe(true);
    }
  });
});
