// Which Supabase project the app talks to, from the two public env vars Expo inlines at build time
// (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY; see app/.env.example). Pure, so
// it is unit-tested; client.ts reads the env vars and passes them in.

import { ApiError, type BeviApi } from '@bevi/shared';

export type ApiConfig = { ok: true; url: string; publishableKey: string } | { ok: false; problem: string };

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1';
}

/** The `role` claim of a legacy JWT key, or null when the key isn't a decodable JWT. */
function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3 || typeof atob !== 'function') return null;
  try {
    const json = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

export function readApiConfig(url: string | undefined, publishableKey: string | undefined): ApiConfig {
  const u = (url ?? '').trim();
  const key = (publishableKey ?? '').trim();
  if (!u) return { ok: false, problem: 'EXPO_PUBLIC_SUPABASE_URL is not set.' };
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return { ok: false, problem: 'EXPO_PUBLIC_SUPABASE_URL is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost(parsed.hostname))) {
    return { ok: false, problem: 'EXPO_PUBLIC_SUPABASE_URL must use https.' };
  }
  if (!key) return { ok: false, problem: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.' };
  // A secret key in a web bundle is readable by anyone who opens the app.
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    return { ok: false, problem: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is a secret key. Use the publishable key.' };
  }
  return { ok: true, url: u.replace(/\/+$/, ''), publishableKey: key };
}

/**
 * A BeviApi for a build with no usable config: every call rejects with the problem. The root layout
 * shows the problem instead of the app, so nothing should call it; this only keeps a stray call from
 * crashing at import time.
 */
export function unconfiguredApi(problem: string): BeviApi {
  const fail = () => Promise.reject(new ApiError('unknown', `Bevi isn't configured: ${problem}`));
  const node: object = new Proxy(fail, {
    get: (_target, prop) => (prop === 'onAuthChange' ? () => () => {} : prop === 'then' ? undefined : node),
    apply: fail,
  });
  return node as BeviApi;
}
