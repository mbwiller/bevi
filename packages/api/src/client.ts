import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { withDeadline } from './net';

// --------------------------------------------------------------------------
// Runtime globals this package assumes (DEVELOPMENT-ARJUN-IOS.md, IA-5)
//
// The package runs in three runtimes now: a browser (the Vercel web build),
// Node (vitest, scripts/) and Hermes on iOS. What each global's story is,
// checked against the versions in this repo's lockfile -- React Native 0.86.3
// and Expo 57 -- and NOT against a running device, which IA-5's device check
// still owes:
//
//   * `fetch`, `AbortController`, `setTimeout` -- present in all three. On
//     native, Expo's runtime (`expo/src/winter/runtime.native.ts`) replaces
//     React Native's `fetch` with `expo/fetch` and patches `AbortSignal`. The
//     wrapper below resolves `globalThis.fetch` per call rather than capturing
//     it at import time, so whichever implementation wins at startup is the
//     one used.
//   * `URL` / `URLSearchParams` -- not used by this package's own code
//     (checked), but supabase-js uses both: auth-js builds query strings with
//     `URLSearchParams` and storage-js parses with `new URL`. React Native's
//     own versions are partial, which is the historical reason RN apps needed
//     `react-native-url-polyfill`; Expo 57's runtime installs spec-compliant
//     `URL` and `URLSearchParams` globals over them, so no shim here.
//   * `TextEncoder` / `TextDecoder` -- `paging.ts`. Expo 57 installs
//     `TextDecoder`, and `TextEncoder` is already there (Expo's own fetch
//     implementation calls `new TextEncoder()` unguarded).
//   * `atob` / `btoa` -- `paging.ts`; see the fallback and comment there.
//   * `crypto.randomUUID` -- `media.ts:44` and `bugs.ts:61` already fall back.
//   * `Intl.DateTimeFormat` with a `timeZone` -- `profile.ts`; see the note
//     there.
//   * `navigator.onLine` / `window` listeners -- deliberately absent from this
//     package. `net.ts`'s deadline is what tells a native caller it is
//     offline.
// --------------------------------------------------------------------------

/** Minimal storage adapter shape supabase-js's `auth.storage` option needs. */
export interface AuthStorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface BeviApiConfig {
  /** Supabase project URL. */
  url: string;
  /** `sb_publishable_…` (or legacy `anon`) key -- safe in the app. */
  publishableKey: string;
  /** Session persistence, e.g. a `localStorage` wrapper (the app is web-only). */
  authStorage: AuthStorageAdapter;
}

/** The username is the handle; `handle_new_user` derives it from this local part. */
export const SYNTHETIC_EMAIL_DOMAIN = 'users.bevi.app';

export function usernameToEmail(username: string): string {
  return `${username}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function emailToUsername(email: string | null | undefined): string {
  return (email ?? '').split('@')[0] ?? '';
}

export function createSupabaseClientFor(config: BeviApiConfig): SupabaseClient {
  return createSupabaseClient(config.url, config.publishableKey, {
    auth: {
      storage: config.authStorage,
      // Proactive refresh. On native this ticker only runs while the app has
      // told us it is foregrounded -- see `session.ts` and the
      // `startAutoRefresh`/`stopAutoRefresh` pair exported from `index.ts`.
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    // One wrapper covers postgrest, storage, auth and functions: supabase-js
    // passes `global.fetch` to all four. `globalThis.fetch` is read per call
    // on purpose (see the globals note above).
    global: { fetch: withDeadline((input, init) => globalThis.fetch(input, init)) },
  });
}
