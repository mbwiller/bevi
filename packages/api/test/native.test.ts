import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiError } from '@bevi/shared';
import { requireUserId } from '../src/currentUser.ts';
import { createProfileApi } from '../src/profile.ts';
import { mapError } from '../src/errors.ts';
import { FUNCTION_TIMEOUT_MS, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, deadlineMsFor, withDeadline } from '../src/net.ts';
import { isAutoRefreshRunning, registerAutoRefreshTarget } from '../src/session.ts';
import * as api from '../src/index.ts';

// IA-5 (DEVELOPMENT-ARJUN-IOS.md): the two things this package gained for a
// phone. Neither needs a live stack -- what matters is that a hang ends as
// `ApiError('network')` instead of a spinner, and that the app can drive the
// session refresh without being handed the supabase client.

const RPC_URL = 'https://project.supabase.co/rest/v1/rpc/get_feed';
const UPLOAD_URL = 'https://project.supabase.co/storage/v1/object/bev-photos/u/1.jpg';
const LIST_URL = 'https://project.supabase.co/storage/v1/object/list/bev-photos';
const FUNCTION_URL = 'https://project.supabase.co/functions/v1/bug-report';

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

  it('picks the upload deadline only for an object upload, not every storage call', () => {
    expect(deadlineMsFor(RPC_URL)).toBe(REQUEST_TIMEOUT_MS);
    expect(deadlineMsFor(UPLOAD_URL, { method: 'POST' })).toBe(UPLOAD_TIMEOUT_MS);
    // `update()`, and an upload to a signed URL, both PUT.
    expect(deadlineMsFor(UPLOAD_URL, { method: 'PUT' })).toBe(UPLOAD_TIMEOUT_MS);
    // A `Request`-like input, which is what supabase-js may pass.
    expect(deadlineMsFor({ url: UPLOAD_URL, method: 'POST' })).toBe(UPLOAD_TIMEOUT_MS);

    // A read, a delete and a list are round trips: two minutes of spinning on
    // a hung storage *list* was the bug.
    expect(deadlineMsFor(UPLOAD_URL)).toBe(REQUEST_TIMEOUT_MS);
    expect(deadlineMsFor(UPLOAD_URL, { method: 'DELETE' })).toBe(REQUEST_TIMEOUT_MS);
    expect(deadlineMsFor(LIST_URL, { method: 'POST' })).toBe(REQUEST_TIMEOUT_MS);
    expect(deadlineMsFor(`${UPLOAD_URL.replace('/object/', '/object/info/')}`, { method: 'GET' })).toBe(REQUEST_TIMEOUT_MS);
    expect(deadlineMsFor('https://project.supabase.co/storage/v1/object/move', { method: 'POST' })).toBe(REQUEST_TIMEOUT_MS);
    expect(deadlineMsFor('https://project.supabase.co/storage/v1/object/copy', { method: 'POST' })).toBe(REQUEST_TIMEOUT_MS);
    // Signed URLs: the POST mints one (a round trip), the PUT carries bytes.
    expect(deadlineMsFor('https://project.supabase.co/storage/v1/object/sign/bev-photos/u/1.jpg', { method: 'POST' })).toBe(
      REQUEST_TIMEOUT_MS,
    );
    expect(deadlineMsFor('https://project.supabase.co/storage/v1/object/upload/sign/bev-photos/u/1.jpg', { method: 'POST' })).toBe(
      REQUEST_TIMEOUT_MS,
    );
    expect(deadlineMsFor('https://project.supabase.co/storage/v1/object/upload/sign/bev-photos/u/1.jpg?token=x', { method: 'PUT' })).toBe(
      UPLOAD_TIMEOUT_MS,
    );
  });

  // An Edge Function is not a round trip. `bug-report` downloads up to three
  // 10 MB evidence objects and re-uploads them to the founders' board before it
  // answers, and that call has been live on the web since #234 -- a 15 s
  // deadline would report `ApiError('network')` for a ticket that was filed.
  it('gives an Edge Function call its own, long budget', () => {
    expect(deadlineMsFor(FUNCTION_URL)).toBe(FUNCTION_TIMEOUT_MS);
    expect(deadlineMsFor(FUNCTION_URL, { method: 'POST' })).toBe(FUNCTION_TIMEOUT_MS);
    // The reporter's other routes are sub-paths of the same function.
    expect(deadlineMsFor(`${FUNCTION_URL}/status`, { method: 'GET' })).toBe(FUNCTION_TIMEOUT_MS);
    expect(FUNCTION_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });

  it('does not cut an Edge Function off at the ordinary deadline', async () => {
    const failure = withDeadline(hangingFetch())(FUNCTION_URL, { method: 'POST' }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    expect(await Promise.race([failure, Promise.resolve('pending')])).toBe('pending');

    await vi.advanceTimersByTimeAsync(FUNCTION_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    expect((await failure) as Error).toBeInstanceOf(TypeError);
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
    const failure = withDeadline(hangingFetch())(UPLOAD_URL, { method: 'POST' }).catch((e: unknown) => e);
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
    // The point of the case: no request is made, and no timer is left behind.
    expect(base).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
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

  // A second `createBeviApi()` (a test, Fast Refresh, a sign-out/sign-in that
  // rebuilds the api) used to abandon the previous client's auth-js interval,
  // which then ticked for the life of the process with nothing able to reach
  // it.
  it('stops the previous target when a new api replaces it', async () => {
    await api.startAutoRefresh();
    expect(target.startAutoRefresh).toHaveBeenCalledTimes(1);

    const next = { startAutoRefresh: vi.fn().mockResolvedValue(undefined), stopAutoRefresh: vi.fn().mockResolvedValue(undefined) };
    registerAutoRefreshTarget(next);
    await Promise.resolve();
    await Promise.resolve();

    expect(target.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(isAutoRefreshRunning()).toBe(false);

    // The new target is the one a foreground nudge now drives.
    await api.startAutoRefresh();
    expect(next.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(target.startAutoRefresh).toHaveBeenCalledTimes(1);
    registerAutoRefreshTarget(undefined);
  });

  it('does not stop a target that was never started, or re-register the same one', async () => {
    registerAutoRefreshTarget(target);
    expect(target.stopAutoRefresh).not.toHaveBeenCalled();

    await api.startAutoRefresh();
    registerAutoRefreshTarget(target);
    await Promise.resolve();
    // Same target: nothing was abandoned, so nothing is stopped behind the
    // app's back.
    expect(target.stopAutoRefresh).not.toHaveBeenCalled();
  });

  // auth-js installs its interval and then does async work that can reject. A
  // single `running` flag read that rejection as "never started" and every
  // later stop returned early, stranding the very ticker `stopAutoRefresh()`
  // exists to stop.
  it('still stops the ticker after a start that rejected', async () => {
    target.startAutoRefresh.mockRejectedValueOnce(new Error('no session'));
    await api.startAutoRefresh();
    expect(isAutoRefreshRunning()).toBe(false);

    await api.stopAutoRefresh();
    expect(target.stopAutoRefresh).toHaveBeenCalledTimes(1);

    // And the stop is not repeated once it has been made.
    await api.stopAutoRefresh();
    expect(target.stopAutoRefresh).toHaveBeenCalledTimes(1);
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
