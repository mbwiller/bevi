import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createMediaApi } from '../src/media.ts';

// A minimal stand-in for SupabaseClient that records whether the
// rate-limit RPC or the storage upload were ever reached. Validation
// (mimeType / size) must reject before either -- these tests assert
// that without a live Supabase stack.
function fakeClient(calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {}): SupabaseClient {
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
        upload: (_path: string, body: unknown) => {
          calls.upload = true;
          calls.body = body;
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

  it.each([
    ['bev-photo', 'bev-photos'],
    ['label', 'nutrition-labels'],
    ['avatar', 'avatars'],
  ] as const)('uploads kind %s into the %s bucket and returns its public URL', async (kind, bucket) => {
    const buckets: string[] = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      rpc: () => Promise.resolve({ data: null, error: null }),
      storage: {
        from: (name: string) => {
          buckets.push(name);
          return {
            upload: () => Promise.resolve({ data: { path: 'user-1/x.jpg' }, error: null }),
            getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${name}/${path}` } }),
          };
        },
      },
    } as unknown as SupabaseClient;

    const result = await createMediaApi(client).upload({ kind, file: { size: 1 } as unknown as Blob, mimeType: 'image/jpeg' });
    expect(new Set(buckets)).toEqual(new Set([bucket]));
    expect(result.url).toBe(`https://example.supabase.co/storage/v1/object/public/${bucket}/${result.assetId}`);
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

// Contract 2.15.0 widened `UploadMediaInput.file` to `Blob | ArrayBuffer |
// Uint8Array`. React Native's Blob carries no bytes supabase-js can read and
// uploads a 0-byte object with no error, so native callers send raw bytes --
// these tests pin down that all three shapes are measured and that whatever
// reaches the Storage call actually has bytes in it.
describe('media.upload payload shapes', () => {
  const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
  const byteLengthOf = (body: unknown): number => {
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;
    if (body instanceof Blob) return body.size;
    throw new Error(`storage received an unmeasurable body: ${Object.prototype.toString.call(body)}`);
  };

  it('hands a Blob to storage untouched (the web path)', async () => {
    const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};
    const blob = new Blob([bytes(2048)], { type: 'image/jpeg' });

    const result = await createMediaApi(fakeClient(calls)).upload({ kind: 'bev-photo', file: blob, mimeType: 'image/jpeg' });

    expect(result.status).toBe('ready');
    expect(calls.body).toBe(blob);
    expect(byteLengthOf(calls.body)).toBe(2048);
  });

  it('uploads an ArrayBuffer with its bytes intact', async () => {
    const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};
    const buffer = bytes(1024).buffer;

    await createMediaApi(fakeClient(calls)).upload({ kind: 'bev-photo', file: buffer, mimeType: 'image/jpeg' });

    expect(calls.body).toBeInstanceOf(ArrayBuffer);
    expect(byteLengthOf(calls.body)).toBe(1024);
  });

  it('uploads a Uint8Array as an ArrayBuffer with its bytes intact', async () => {
    const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};
    const view = bytes(512, 42);

    await createMediaApi(fakeClient(calls)).upload({ kind: 'label', file: view, mimeType: 'image/png' });

    expect(calls.body).toBeInstanceOf(ArrayBuffer);
    expect(byteLengthOf(calls.body)).toBe(512);
    expect(new Uint8Array(calls.body as ArrayBuffer)).toEqual(view);
  });

  it('copies only a view\'s own bytes, not the whole buffer behind it', async () => {
    // `expo-file-system` and base64 decoders both hand back a window onto a
    // larger buffer; uploading `.buffer` would send the surrounding slack.
    const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};
    const backing = bytes(100, 1);
    backing.set([9, 9, 9], 10);
    const view = backing.subarray(10, 13);

    await createMediaApi(fakeClient(calls)).upload({ kind: 'avatar', file: view, mimeType: 'image/webp' });

    expect(calls.body).toBeInstanceOf(ArrayBuffer);
    expect(byteLengthOf(calls.body)).toBe(3);
    expect(Array.from(new Uint8Array(calls.body as ArrayBuffer))).toEqual([9, 9, 9]);
  });

  it('never reaches storage with a zero-byte body for a non-Blob payload', async () => {
    for (const file of [bytes(64).buffer, bytes(64)] as const) {
      const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};
      await createMediaApi(fakeClient(calls)).upload({ kind: 'bev-photo', file, mimeType: 'image/jpeg' });
      expect(calls.upload).toBe(true);
      expect(byteLengthOf(calls.body)).toBeGreaterThan(0);
      expect(byteLengthOf(calls.body)).toBe(64);
    }
  });

  const LIMIT = 10 * 1024 * 1024;
  const shapes = {
    Blob: (size: number) => ({ size }) as unknown as Blob,
    ArrayBuffer: (size: number) => new ArrayBuffer(size),
    Uint8Array: (size: number) => new Uint8Array(size),
  } as const;

  it.each(Object.keys(shapes) as (keyof typeof shapes)[])(
    'enforces the 10 MB limit on a %s before the rate-limit RPC or storage',
    async (shape) => {
      const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};
      const api = createMediaApi(fakeClient(calls));

      await expect(api.upload({ kind: 'bev-photo', file: shapes[shape](LIMIT + 1), mimeType: 'image/jpeg' })).rejects.toMatchObject({
        code: 'validation',
        detail: { field: 'file' },
      });
      expect(calls.rpc).toBeUndefined();
      expect(calls.upload).toBeUndefined();
    }
  );

  it.each(Object.keys(shapes) as (keyof typeof shapes)[])('accepts a %s exactly at the 10 MB limit', async (shape) => {
    const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};
    const api = createMediaApi(fakeClient(calls));

    const result = await api.upload({ kind: 'bev-photo', file: shapes[shape](LIMIT), mimeType: 'image/jpeg' });

    expect(result.status).toBe('ready');
    expect(calls.upload).toBe(true);
  });
});

// The 0-byte trap IA-4 exists to close, and the one thing the type system
// cannot catch: a React Native Blob IS a Blob and carries a plausible `.size`,
// so it satisfies the widened union, passes `uploadByteLength()` and the size
// limit, and then uploads nothing behind a 200. `toUploadBody()` refuses it,
// detecting RN by `navigator.product`/`HermesInternal` -- NOT by a missing
// `document`, which is also missing here in Node and would reject the real,
// byte-backed Blobs the tests above (and the web build) rely on.
describe('media.upload React Native Blob guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads a real Blob in a runtime that is not React Native', async () => {
    // Node has no `document` either, which is exactly why `document` is not
    // the test: this upload must succeed.
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
    const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};
    const blob = new Blob([new Uint8Array(32).fill(3)], { type: 'image/jpeg' });

    const result = await createMediaApi(fakeClient(calls)).upload({ kind: 'bev-photo', file: blob, mimeType: 'image/jpeg' });

    expect(result.status).toBe('ready');
    expect(calls.body).toBe(blob);
  });

  it('rejects a Blob under React Native instead of uploading 0 bytes', async () => {
    vi.stubGlobal('navigator', { product: 'ReactNative' });
    const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};
    // What `await fetch(uri).then((r) => r.blob())` hands back for a picked
    // photo on a device: a Blob with a believable size and no readable bytes.
    const rnBlob = new Blob([new Uint8Array(4096)], { type: 'image/jpeg' });

    await expect(
      createMediaApi(fakeClient(calls)).upload({ kind: 'bev-photo', file: rnBlob, mimeType: 'image/jpeg' })
    ).rejects.toMatchObject({ code: 'validation', detail: { field: 'file' } });
    expect(calls.upload).toBeUndefined();
    // An unusable payload should cost the caller no upload quota either.
    expect(calls.rpc).toBeUndefined();
  });

  it('rejects a Blob under Hermes with no navigator marker', async () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('HermesInternal', {});
    const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};

    await expect(
      createMediaApi(fakeClient(calls)).upload({
        kind: 'avatar',
        file: new Blob([new Uint8Array(16)], { type: 'image/png' }),
        mimeType: 'image/png',
      })
    ).rejects.toMatchObject({ code: 'validation', detail: { field: 'file' } });
    expect(calls.upload).toBeUndefined();
  });

  it('names the payload at fault in the error message', async () => {
    vi.stubGlobal('navigator', { product: 'ReactNative' });

    await expect(
      createMediaApi(fakeClient({})).upload({
        kind: 'bev-photo',
        file: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
        mimeType: 'image/jpeg',
      })
    ).rejects.toThrow(/Blob/);
  });

  it('still uploads bytes under React Native -- the native path', async () => {
    vi.stubGlobal('navigator', { product: 'ReactNative' });
    for (const file of [new Uint8Array(64).fill(5), new Uint8Array(64).fill(5).buffer] as const) {
      const calls: { rpc?: boolean; upload?: boolean; body?: unknown } = {};

      const result = await createMediaApi(fakeClient(calls)).upload({ kind: 'bev-photo', file, mimeType: 'image/jpeg' });

      expect(result.status).toBe('ready');
      expect(calls.body).toBeInstanceOf(ArrayBuffer);
      expect((calls.body as ArrayBuffer).byteLength).toBe(64);
    }
  });
});
