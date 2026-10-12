/**
 * Before Bevi ran on Supabase, the deployed app kept a whole fake database in this browser's
 * localStorage: the old in-browser mock (`bevi.mock.db`, including the passwords people typed, in
 * plain text) and per-mock-user search recents (`bevi.add.recents:mock-user-…`). None of it is used
 * any more; remove it once on launch. Idempotent and never throws.
 */
export const LEGACY_KEYS = ['bevi.mock.db', 'bevi.mock.db.probe'] as const;
export const LEGACY_PREFIXES = ['bevi.mock.', 'bevi.add.recents:mock-user-'] as const;

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

export function clearLegacyStorage(storage: StorageLike | null | undefined = defaultStorage()): number {
  if (!storage) return 0;
  try {
    const doomed = new Set<string>(LEGACY_KEYS);
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && LEGACY_PREFIXES.some((p) => key.startsWith(p))) doomed.add(key);
    }
    for (const key of doomed) storage.removeItem(key);
    return doomed.size;
  } catch {
    return 0;
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}
