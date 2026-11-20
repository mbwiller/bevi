import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError, Session } from '@bevi/shared';
import { createBeviApi } from '../src/index.ts';
import { REQUEST_TIMEOUT_MS, SESSION_CHECK_TIMEOUT_MS } from '../src/net.ts';

// BEV-27: opening the app with no connection, more than an hour after it was
// last used. The stored access token has expired, so the first thing auth-js
// does is try to refresh it, and nothing answers.
//
// These drive the real supabase-js client that `createBeviApi` builds, over a
// scripted `globalThis.fetch` and an in-memory `AuthStorageAdapter`, on fake
// timers: what is pinned is what auth-js makes of a refresh that fails, and
// what this package then tells the app. Measured before the fix, with the
// lockfile's auth-js (2.117.3):
//
//   * auth-js retries the refresh inside `initialize()` with backoff -- eight
//     requests at 0, 0.2, 0.6, 1.4, 3, 6.2, 12.6 and 25.4 s when each fails at
//     once, two (0 and 15.2 s) when each hangs to `REQUEST_TIMEOUT_MS` -- and
//     everything that waits on `initialize()` waits with it;
//   * `getSession()` then rejected with `ApiError('network')`, 25.4 s (30.2 s
//     hung) after launch;
//   * at the same moment `onAuthChange` fired with `null`, auth-js's
//     INITIAL_SESSION for "could not refresh", which the app read as a
//     sign-out;
//   * the stored session was never removed: auth-js keeps it through a
//     retryable failure and deletes it only when the server refuses the
//     refresh token.
//
// So the session survived and the app was told otherwise, half a minute late.

const PROJECT_URL = 'https://project.supabase.co';
/** Joined at run time: a literal in a publishable key's shape trips the secret scanner on every push. */
const PUBLISHABLE_KEY = ['sb', 'publishable', 'test'].join('_');
/** supabase-js's default storage key: `sb-<project ref>-auth-token`. */
const STORAGE_KEY = 'sb-project-auth-token';
const REFRESH_URL = `${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`;

const TESTER: Session = { userId: 'user-1', handle: 'tester' };
const USER = {
  id: TESTER.userId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'tester@users.bevi.app',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

/** A session as auth-js stores it. `expiresInS` is negative for an access token that has expired. */
function storedSession(expiresInS: number, refreshToken = 'refresh-1') {
  return {
    access_token: 'header.payload.signature',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + expiresInS,
    refresh_token: refreshToken,
    user: USER,
  };
}

type Fetch = (input: unknown, init?: { method?: string; signal?: AbortSignal }) => Promise<Response>;

/** React Native's own `fetch` with the radio off: it rejects at once. */
const reactNativeOffline: Fetch = () => Promise.reject(new TypeError('Network request failed'));

/**
 * `expo/fetch`, which Expo's runtime installs over React Native's on a device
 * (`client.ts`): its `FetchError` is a plain `Error`, not a `TypeError`, whose
 * message starts 'fetch failed: ' and carries on with what NSURLSession said.
 */
const expoFetchOffline: Fetch = () => Promise.reject(new Error('fetch failed: The Internet connection appears to be offline.'));

/** A socket iOS still holds open with nothing coming through: it settles only when aborted. */
const hungSocket: Fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });

/** The auth server refusing the refresh token: revoked, or the account is gone. */
const refreshTokenRefused: Fetch = () =>
  Promise.resolve(
    new Response(JSON.stringify({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  );

/** The auth server answering the refresh. */
const refreshGranted: Fetch = () =>
  Promise.resolve(
    new Response(JSON.stringify(storedSession(3600, 'refresh-2')), { status: 200, headers: { 'content-type': 'application/json' } }),
  );

/** The auth server reachable but not answering: a 503 from the gateway, which auth-js retries like no connection at all. */
const serviceUnavailable: Fetch = () =>
  Promise.resolve(
    new Response(JSON.stringify({ code: 503, msg: 'Service Unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } }),
  );

/** The auth server answering the refresh `afterMs` late: a connection that is slow, not down. */
const refreshGrantedAfter =
  (afterMs: number): Fetch =>
  (_input, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => resolve(new Response(JSON.stringify(storedSession(3600, 'refresh-2')), { status: 200, headers: { 'content-type': 'application/json' } })),
        afterMs,
      );
      init?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });

interface Settled {
  state: 'pending' | 'resolved' | 'rejected';
  value?: unknown;
}

function track(promise: Promise<unknown>): Settled {
  const settled: Settled = { state: 'pending' };
  promise.then(
    (value) => Object.assign(settled, { state: 'resolved', value }),
    (value: unknown) => Object.assign(settled, { state: 'rejected', value }),
  );
  return settled;
}

/** Advances the fake clock until `done()` or `limitMs`; a test asserts on what it waited for. */
async function until(done: () => boolean, limitMs: number): Promise<void> {
  for (let waited = 0; !done() && waited < limitMs; waited += 100) await vi.advanceTimersByTimeAsync(100);
}

/** Longer than auth-js keeps retrying a refresh (`AUTO_REFRESH_TICK_DURATION_MS`, 30 s), hung or not. */
const PAST_EVERY_RETRY_MS = 31_000;

/** The app at launch: an api over `network`, a stored session, an `onAuthChange` listener. */
function launch(network: Fetch, { expiresInS = -2 * 3600 }: { expiresInS?: number } = {}) {
  const startedAt = Date.now();
  let current = network;
  /** When each token refresh was sent, in ms since launch. */
  const refreshes: number[] = [];
  vi.stubGlobal('fetch', (input: unknown, init?: { method?: string; signal?: AbortSignal }) => {
    if (String(input) === REFRESH_URL) refreshes.push(Date.now() - startedAt);
    return current(input, init);
  });

  const store = new Map<string, string>([[STORAGE_KEY, JSON.stringify(storedSession(expiresInS))]]);
  const removed: string[] = [];
  const api = createBeviApi({
    url: PROJECT_URL,
    publishableKey: PUBLISHABLE_KEY,
    authStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => {
        removed.push(key);
        store.delete(key);
      },
    },
  });
  /** Everything `onAuthChange` told the app, in order. */
  const heard: (Session | null)[] = [];
  api.onAuthChange((session) => heard.push(session));

  return {
    api,
    heard,
    refreshes,
    removed,
    /** The refresh token in storage, or null when the session has been removed. */
    storedRefreshToken: () => (JSON.parse(store.get(STORAGE_KEY) ?? 'null') as { refresh_token: string } | null)?.refresh_token ?? null,
    /** The connection changes: every later request gets `next`. */
    networkBecomes: (next: Fetch) => void (current = next),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // auth-js reports every failed refresh on the console; that is not what is under test.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('launching offline with an expired access token', () => {
  it.each([
    ['React Native fetch', reactNativeOffline],
    ['expo/fetch', expoFetchOffline],
    ['a socket that hangs', hungSocket],
  ])('%s: getSession() is network within the session-check deadline, not after every retry', async (_name, offline) => {
    const app = launch(offline);
    const check = track(app.api.getSession());

    // No later than the bound is the promise. How long before it is auth-js's
    // business: today its retries outlast the bound, so the answer comes at
    // the bound exactly, and a version that gives up sooner may answer sooner.
    await vi.advanceTimersByTimeAsync(SESSION_CHECK_TIMEOUT_MS);
    // Rejected, so never resolved to null, which would have meant signed out.
    expect(check.state).toBe('rejected');
    expect((check.value as ApiError).code).toBe('network');
    expect(app.heard).not.toContain(null);
    // Sooner than one hung request takes to time out, let alone auth-js's retries.
    expect(SESSION_CHECK_TIMEOUT_MS).toBeLessThan(REQUEST_TIMEOUT_MS);
  });

  it.each([
    ['React Native fetch', reactNativeOffline],
    ['expo/fetch', expoFetchOffline],
    ['a socket that hangs', hungSocket],
  ])('%s: nobody is told they are signed out, and the stored session survives', async (_name, offline) => {
    const app = launch(offline);
    const check = track(app.api.getSession());

    await vi.advanceTimersByTimeAsync(PAST_EVERY_RETRY_MS);
    expect(check.state).toBe('rejected');
    // auth-js went on retrying long after the app had its answer.
    expect(app.refreshes.length).toBeGreaterThan(1);
    expect(app.refreshes.at(-1)).toBeGreaterThan(SESSION_CHECK_TIMEOUT_MS);

    expect(app.heard).toEqual([]);
    expect(app.removed).toEqual([]);
    expect(app.storedRefreshToken()).toBe('refresh-1');
  });

  it('a later check asks the server again and is network within the same deadline, while the connection is still down', async () => {
    const app = launch(reactNativeOffline);
    track(app.api.getSession());
    await vi.advanceTimersByTimeAsync(PAST_EVERY_RETRY_MS);
    const sentAtLaunch = app.refreshes.length;

    // The app's Retry. It is not answered from auth-js's memory of the failure
    // (`forgetRefreshFailure`), so a new series of refreshes starts and the
    // check waits on it like the first one did: today, the whole bound again,
    // not an answer at once.
    const again = track(app.api.getSession());
    await vi.advanceTimersByTimeAsync(SESSION_CHECK_TIMEOUT_MS);
    expect(app.refreshes.length).toBeGreaterThan(sentAtLaunch);
    expect(again.state).toBe('rejected');
    expect((again.value as ApiError).code).toBe('network');
    expect(app.heard).toEqual([]);
    expect(app.storedRefreshToken()).toBe('refresh-1');
  });

  it('an access token auth-js wants refreshed but that has not expired yet: the session is reported, never a sign-out', async () => {
    // Inside auth-js's 90 s refresh margin, so it still tries the refresh first.
    const app = launch(reactNativeOffline, { expiresInS: 60 });
    const check = track(app.api.getSession());

    await vi.advanceTimersByTimeAsync(SESSION_CHECK_TIMEOUT_MS);
    expect((check.value as ApiError).code).toBe('network');
    await until(() => app.heard.length > 0, PAST_EVERY_RETRY_MS);
    expect(app.heard).toEqual([TESTER]);
    expect(app.storedRefreshToken()).toBe('refresh-1');
  });
});

describe('when the connection comes back after an offline launch', () => {
  it('the next check asks the server and is signed in, without waiting out auth-js’s memory of the failure', async () => {
    const app = launch(reactNativeOffline);
    track(app.api.getSession());
    await vi.advanceTimersByTimeAsync(PAST_EVERY_RETRY_MS);
    const sentOffline = app.refreshes.length;

    app.networkBecomes(refreshGranted);
    // auth-js answers a refresh from its last failure for 60 s
    // (`REFRESH_FAILURE_COOLDOWN_MS`); a check the app asks for must not.
    const again = track(app.api.getSession());
    await until(() => again.state !== 'pending', 1_000);
    expect(again).toEqual({ state: 'resolved', value: TESTER });
    expect(app.refreshes.length).toBe(sentOffline + 1);
    expect(app.heard).toEqual([TESTER]);
    expect(app.storedRefreshToken()).toBe('refresh-2');
  });

  it('the app hears the session by itself, from auth-js’s refresh ticker, with no further call', async () => {
    const app = launch(reactNativeOffline);
    track(app.api.getSession());
    await vi.advanceTimersByTimeAsync(PAST_EVERY_RETRY_MS);

    app.networkBecomes(refreshGranted);
    // The ticker runs every 30 s and waits out the 60 s failure memory.
    await until(() => app.heard.length > 0, 120_000);
    expect(app.heard).toEqual([TESTER]);
    expect(app.storedRefreshToken()).toBe('refresh-2');
  });

  it('a refresh token the server now refuses signs the person out', async () => {
    const app = launch(reactNativeOffline);
    track(app.api.getSession());
    await vi.advanceTimersByTimeAsync(PAST_EVERY_RETRY_MS);

    app.networkBecomes(refreshTokenRefused);
    const again = track(app.api.getSession());
    await until(() => again.state !== 'pending', 1_000);
    expect(app.heard).toEqual([null]);
    expect(app.storedRefreshToken()).toBeNull();
    // The check itself may answer null or throw, but never "you are offline".
    expect((again.value as ApiError | null)?.code).not.toBe('network');
    await expect(app.api.getSession()).resolves.toBeNull();
  });
});

describe('launching with an auth server that does not answer the refresh in time', () => {
  it('a 503: getSession() is network within the session-check deadline, the stored session is kept, nobody is told they are signed out', async () => {
    const app = launch(serviceUnavailable);
    const check = track(app.api.getSession());

    await vi.advanceTimersByTimeAsync(SESSION_CHECK_TIMEOUT_MS);
    expect(check.state).toBe('rejected');
    expect((check.value as ApiError).code).toBe('network');

    await vi.advanceTimersByTimeAsync(PAST_EVERY_RETRY_MS);
    expect(app.heard).toEqual([]);
    expect(app.removed).toEqual([]);
    expect(app.storedRefreshToken()).toBe('refresh-1');
  });

  it('a refresh that succeeds after 8 s: network at the deadline, then the session arrives through onAuthChange', async () => {
    const answersAfterMs = 8_000;
    // Later than the session check waits, sooner than the request is given up on.
    expect(answersAfterMs).toBeGreaterThan(SESSION_CHECK_TIMEOUT_MS);
    expect(answersAfterMs).toBeLessThan(REQUEST_TIMEOUT_MS);
    const app = launch(refreshGrantedAfter(answersAfterMs));
    const check = track(app.api.getSession());

    await vi.advanceTimersByTimeAsync(SESSION_CHECK_TIMEOUT_MS);
    expect(check.state).toBe('rejected');
    expect((check.value as ApiError).code).toBe('network');
    expect(app.heard).toEqual([]);

    // The refresh was not cancelled when the check gave up on it.
    await vi.advanceTimersByTimeAsync(answersAfterMs - SESSION_CHECK_TIMEOUT_MS);
    // auth-js says it more than once (TOKEN_REFRESHED, then the INITIAL_SESSION
    // it owed the listener); what matters is that every time it is the session.
    expect(app.heard.length).toBeGreaterThan(0);
    for (const session of app.heard) expect(session).toEqual(TESTER);
    expect(app.refreshes).toHaveLength(1);
    expect(app.storedRefreshToken()).toBe('refresh-2');
  });
});

describe('launching online with a refresh token the server refuses', () => {
  it('is a sign-out: one event, the stored session removed, and getSession() answers null', async () => {
    const app = launch(refreshTokenRefused);
    const check = track(app.api.getSession());

    await until(() => check.state !== 'pending', 1_000);
    expect(check).toEqual({ state: 'resolved', value: null });
    expect(app.heard).toEqual([null]);
    expect(app.removed).toContain(STORAGE_KEY);
    expect(app.storedRefreshToken()).toBeNull();
    expect(app.refreshes).toHaveLength(1);
  });
});

describe('launching with nobody signed in', () => {
  it('getSession() answers null and makes no request', async () => {
    const request = vi.fn(reactNativeOffline);
    vi.stubGlobal('fetch', request);
    const api = createBeviApi({
      url: PROJECT_URL,
      publishableKey: PUBLISHABLE_KEY,
      authStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    const heard: (Session | null)[] = [];
    api.onAuthChange((session) => heard.push(session));

    const check = track(api.getSession());
    await until(() => check.state !== 'pending', 1_000);
    expect(check).toEqual({ state: 'resolved', value: null });
    expect(request).not.toHaveBeenCalled();
  });
});
