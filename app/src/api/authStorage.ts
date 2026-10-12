import type { AuthStorageAdapter } from '@bevi/api';

/**
 * Where supabase-js keeps the session: `localStorage` (the app is web only), or memory when storage
 * is unavailable (Safari private mode, blocked site data). Never throws: a failing write just keeps
 * the session for this page load.
 */
export function webAuthStorage(): AuthStorageAdapter {
  const memory = new Map<string, string>();
  let ls: Storage | null = null;
  try {
    ls = typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
    const probe = 'bevi.storage-probe';
    ls?.setItem(probe, '1');
    ls?.removeItem(probe);
  } catch {
    ls = null;
  }
  return {
    getItem(key) {
      try {
        return ls ? ls.getItem(key) : (memory.get(key) ?? null);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        ls?.setItem(key, value);
      } catch {
        // Quota or blocked storage: the in-memory copy keeps this page load signed in.
      }
    },
    removeItem(key) {
      memory.delete(key);
      try {
        ls?.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}
