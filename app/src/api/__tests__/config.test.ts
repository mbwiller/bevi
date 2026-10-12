import { isApiError } from '@bevi/shared';

import { webAuthStorage } from '../authStorage';
import { readApiConfig, unconfiguredApi } from '../config';

const URL_OK = 'https://abcdefghijklmnop.supabase.co';
const KEY_OK = 'sb_publishable_abc123';

/** A JWT-shaped legacy key with the given role claim (unsigned; only the payload is read). */
const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;

describe('readApiConfig', () => {
  it('accepts an https project URL and a publishable key', () => {
    expect(readApiConfig(`${URL_OK}/`, ` ${KEY_OK} `)).toEqual({ ok: true, url: URL_OK, publishableKey: KEY_OK });
  });

  it('accepts a legacy anon JWT and a local stack over http', () => {
    expect(readApiConfig('http://127.0.0.1:54321', jwt('anon')).ok).toBe(true);
    expect(readApiConfig('http://localhost:54321', KEY_OK).ok).toBe(true);
  });

  it.each([
    [undefined, KEY_OK, 'EXPO_PUBLIC_SUPABASE_URL is not set.'],
    ['', KEY_OK, 'EXPO_PUBLIC_SUPABASE_URL is not set.'],
    ['not a url', KEY_OK, 'EXPO_PUBLIC_SUPABASE_URL is not a valid URL.'],
    ['http://abcdefghijklmnop.supabase.co', KEY_OK, 'EXPO_PUBLIC_SUPABASE_URL must use https.'],
    [URL_OK, undefined, 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.'],
  ])('rejects url=%s key=%s', (url, key, problem) => {
    expect(readApiConfig(url, key)).toEqual({ ok: false, problem });
  });

  it('refuses a secret key, which would ship to every browser', () => {
    for (const key of ['sb_secret_abc', jwt('service_role')]) {
      expect(readApiConfig(URL_OK, key)).toEqual({ ok: false, problem: expect.stringContaining('secret key') });
    }
  });
});

describe('unconfiguredApi', () => {
  it('rejects every call with the problem and never throws synchronously', async () => {
    const api = unconfiguredApi('EXPO_PUBLIC_SUPABASE_URL is not set.');
    const e = await api.profile.getMe().catch((x: unknown) => x);
    expect(isApiError(e) && e.message).toContain('EXPO_PUBLIC_SUPABASE_URL is not set.');
    await expect(api.signIn({ username: 'a', password: 'b' })).rejects.toBeTruthy();
    const unsubscribe = api.onAuthChange(() => {});
    expect(typeof unsubscribe).toBe('function');
  });
});

describe('webAuthStorage', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('keeps the session in memory when localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    const s = webAuthStorage();
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });

  it('writes through to localStorage when it works', () => {
    const data = new Map<string, string>();
    const ls = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: ls });
    webAuthStorage().setItem('sb-auth', 'token');
    expect(data.get('sb-auth')).toBe('token');
  });
});
