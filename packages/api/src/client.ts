import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

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
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}
