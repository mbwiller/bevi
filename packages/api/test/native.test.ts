import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiError } from '@bevi/shared';
import { requireUserId } from '../src/currentUser.ts';
import { createProfileApi } from '../src/profile.ts';
import { mapError } from '../src/errors.ts';
import { REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, deadlineMsFor, withDeadline } from '../src/net.ts';
import { isAutoRefreshRunning, registerAutoRefreshTarget } from '../src/session.ts';
import * as api from '../src/index.ts';

// IA-5 (DEVELOPMENT-ARJUN-IOS.md): the two things this package gained for a
// phone. Neither needs a live stack -- what matters is that a hang ends as
// `ApiError('network')` instead of a spinner, and that the app can drive the
// session refresh without being handed the supabase client.

const RPC_URL = 'https://project.supabase.co/rest/v1/rpc/get_feed';
const UPLOAD_URL = 'https://project.supabase.co/storage/v1/object/bev-photos/u/1.jpg';

/**
 * A fetch that never answers; it only settles when its signal aborts -- which
 * is how a real `fetch` behaves on a phone that has lost the radio.
 */
function hangingFetch(): typeof fetch {
  return ((_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort, { once: true });
    })) as unknown as typeof fetch;
}

describe('request deadlines', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('picks the upload deadline only for storage objects', () => {
    expect(deadlineMsFor(RPC_URL)).toBe(REQUEST_TIMEOUT_MS);
    expect(deadlineMsFor(UPLOAD_URL)).toBe(UPLOAD_TIMEOUT_MS);
    // A `Request`-like input, which is what supabase-js may pass.
    expect(deadlineMsFor({ url: UPLOAD_URL })).toBe(UPLOAD_TIMEOUT_MS);
  });

  it('leaves a request alone until its deadline', async () => {
    const result = withDeadline(hangingFetch())(RPC_URL).then(
      () => 'resolved',
      () => 'rejected',
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(await Promise.race([result, Promise.resolve('pending')])).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('rejected');
  });

  it('turns a hung request into ApiError("network") through every supabase-js error shape', async () => {
    const failure = withDeadline(hangingFetch())(RPC_URL).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const error = (await failure) as Error;

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain(String(REQUEST_TIMEOUT_MS));
    // Thrown straight at a caller (storage-js rethrows it much like this).
    expect(mapError(error).code).toBe('network');
    // postgrest-js swallows the rejection and returns a plain object instead.
    expect(mapError({ message: `${error.name}: ${error.message}`, details: '', hint: '', code: '' }).code).toBe('network');
    // storage-js wraps it in a StorageUnknownError.
    expect(mapError({ name: 'StorageUnknownError', message: error.message }).code).toBe('network');
  });

  it('gives an upload the longer deadline', async () => {
    const failure = withDeadline(hangingFetch())(UPLOAD_URL).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    expect(await Promise.race([failure, Promise.resolve('pending')])).toBe('pending');

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    expect((await failure) as Error).toBeInstanceOf(TypeError);
  });

  it('passes a response through and clears its timer', async () => {
    const ok = { status: 200 } as Response;
    const base = vi.fn().mockResolvedValue(ok) as unknown as typeof fetch;
    expect(await withDeadline(base)(RPC_URL)).toBe(ok);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the caller's own abort as the caller's, not a timeout", async () => {
    const controller = new AbortController();
    const failure = withDeadline(hangingFetch())(RPC_URL, { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    const error = (await failure) as Error;

    expect(error.name).toBe('AbortError');
    expect(error.message).not.toContain('timed out');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not call out at all when the caller aborted first', async () => {
    const controller = new AbortController();
    controller.abort();
    const base = vi.fn(hangingFetch());
    const failure = withDeadline(base as unknown as typeof fetch)(RPC_URL, { signal: controller.signal }).catch((e: unknown) => e);
    expect(((await failure) as Error).name).toBe('AbortError');
  });
});

// Reported from an iOS simulator run with Wi-Fi off: every screen but the
// cached Feed said "You're signed out", and because the app reads
// `'unauthorized'` from `profile.getMe()` as a real sign-out, an offline launch
// landed on the sign-in screen. `requireUserId` calls `auth.getUser()`, which
// is a network call, and turned every failure into `'unauthorized'`.
describe('requireUserId when the radio is off', () => {
  function clientWhoseGetUserFails(error: unknown): SupabaseClient {
    return { auth: { getUser: async () => ({ data: { user: null }, error }) } } as unknown as SupabaseClient;
  }

  async function codeFrom(error: unknown): Promise<string> {
    try {
      await requireUserId(clientWhoseGetUserFails(error));
    } catch (e) {
      return (e as ApiError).code;
    }
    throw new Error('requireUserId resolved; it was meant to throw');
  }

  it('returns the id when there is a session', async () => {
    const client = { auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) } } as unknown as SupabaseClient;
    await expect(requireUserId(client)).resolves.toBe('user-1');
  });

  it('is network, not unauthorized, when the call never completed', async () => {
    // A blown `REQUEST_TIMEOUT_MS` deadline, straight from `net.ts`.
    expect(await codeFrom(new TypeError(`Network request timed out after ${REQUEST_TIMEOUT_MS} ms`))).toBe('network');
    // auth-js's own retryable shape for an unreachable host: status 0.
    expect(await codeFrom({ name: 'AuthRetryableFetchError', message: 'Request aborted', status: 0 })).toBe('network');
    expect(await codeFrom(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('keeps unauthorized for a real sign-out', async () => {
    // No error and no user: a genuinely missing session.
    const empty = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as unknown as SupabaseClient;
    await expect(requireUserId(empty)).rejects.toMatchObject({ code: 'unauthorized' });

    // A real 401/403, and an auth error this package does not recognise: the
    // gate stays closed rather than reporting a network problem.
    expect(await codeFrom({ name: 'AuthApiError', message: 'invalid claim: missing sub claim', status: 401, code: 'bad_jwt' })).toBe(
      'unauthorized',
    );
    expect(await codeFrom({ name: 'AuthApiError', message: 'User not allowed', status: 403 })).toBe('unauthorized');
    expect(await codeFrom({ name: 'AuthError', message: 'something new', status: 500 })).toBe('unauthorized');
  });

  it('reaches the app as network through profile.getMe(), which is what decides a sign-out', async () => {
    const offline = clientWhoseGetUserFails(new TypeError('Network request timed out after 15000 ms'));
    await expect(createProfileApi(offline).getMe()).rejects.toMatchObject({ code: 'network' });
  });
});

describe('auto-refresh control', () => {
  const target = { startAutoRefresh: vi.fn().mockResolvedValue(undefined), stopAutoRefresh: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    target.startAutoRefresh.mockClear().mockResolvedValue(undefined);
    target.stopAutoRefresh.mockClear().mockResolvedValue(undefined);
    registerAutoRefreshTarget(target);
  });
  afterEach(() => registerAutoRefreshTarget(undefined));

  it('is exported from the package entry point, without the supabase client', () => {
    expect(typeof api.startAutoRefresh).toBe('function');
    expect(typeof api.stopAutoRefresh).toBe('function');
    expect(Object.keys(api)).not.toContain('createSupabaseClientFor');
  });

  it('starts and stops the refresh ticker', async () => {
    await api.startAutoRefresh();
    expect(target.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(isAutoRefreshRunning()).toBe(true);

    await api.stopAutoRefresh();
    expect(target.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(isAutoRefreshRunning()).toBe(false);
  });

  it('ignores a repeated start or stop (AppState fires more than once)', async () => {
    await api.startAutoRefresh();
    await api.startAutoRefresh();
    expect(target.startAutoRefresh).toHaveBeenCalledTimes(1);

    await api.stopAutoRefresh();
    await api.stopAutoRefresh();
    expect(target.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing, and does not throw, with no api created yet', async () => {
    registerAutoRefreshTarget(undefined);
    await expect(api.startAutoRefresh()).resolves.toBeUndefined();
    await expect(api.stopAutoRefresh()).resolves.toBeUndefined();
    expect(isAutoRefreshRunning()).toBe(false);
  });

  it('never rejects into the app\'s AppState listener, and can retry after a failed start', async () => {
    target.startAutoRefresh.mockRejectedValueOnce(new Error('no session'));
    await expect(api.startAutoRefresh()).resolves.toBeUndefined();
    expect(isAutoRefreshRunning()).toBe(false);

    await api.startAutoRefresh();
    expect(target.startAutoRefresh).toHaveBeenCalledTimes(2);
    expect(isAutoRefreshRunning()).toBe(true);
  });

  it('is wired to the client createBeviApi builds', async () => {
    const store = new Map<string, string>();
    api.createBeviApi({
      url: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test',
      authStorage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      },
    });

    // The real `client.auth` is now the target -- the stand-in above is not.
    await api.startAutoRefresh();
    expect(target.startAutoRefresh).not.toHaveBeenCalled();
    expect(isAutoRefreshRunning()).toBe(true);
    await api.stopAutoRefresh();
    expect(isAutoRefreshRunning()).toBe(false);
  });
});
