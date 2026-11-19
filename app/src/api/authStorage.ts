import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import type { AuthStorageAdapter } from '@bevi/api';

/**
 * Where supabase-js keeps the session on native: the iOS Keychain, through expo-secure-store. The
 * web build uses `authStorage.web.ts` (localStorage) instead; Metro picks the file by platform.
 *
 * Never throws and never rejects. Every value also lives in an in-memory copy, so a failing Keychain
 * call keeps this launch signed in (it just may not survive a relaunch).
 *
 * Layout, for a supabase-js key K (mapped by `secureKeyFor` to M, see below):
 *
 *   bevi-session.M        the value, as one Keychain item
 *   bevi-session-index    JSON list of every M ever written, so the reinstall wipe can find them
 *
 * A session is a few KB, and this version of expo-secure-store imposes no size limit on a value, so
 * one item per key is deliberate: a single `setItemAsync` is a single Keychain write, and there is
 * no half-written state to guard against.
 *
 * Reinstalls: Keychain items outlive the app, AsyncStorage does not. Before the first read or
 * write of a launch, the adapter looks for INSTALL_MARKER in AsyncStorage. Absent (a fresh install,
 * or a reinstall) → delete every stored session, then set the marker. If the marker cannot be read,
 * nothing is deleted. Every call waits for that check, so supabase-js never sees an old account.
 */

/** AsyncStorage key that says "this install has already cleared any Keychain session left over". */
export const INSTALL_MARKER = 'bevi.session.install-marker';
/** Keychain prefix for every value this adapter writes. */
export const KEY_PREFIX = 'bevi-session.';
/** Keychain item listing the mapped keys written so far (see the layout above). */
export const INDEX_KEY = 'bevi-session-index';

/**
 * `AFTER_FIRST_UNLOCK`: a token refresh while the phone is locked (after its first unlock since
 * boot) can still read and write the session.
 */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

/**
 * SecureStore keys may only hold alphanumerics, `.`, `-` and `_`. supabase-js's key
 * (`sb-<project-ref>-auth-token`) passes through unchanged; any other character, `_` and `.`
 * included, becomes `_` and four hex digits, which keeps the mapping one-to-one.
 */
export function secureKeyFor(key: string): string {
  let out = '';
  for (let i = 0; i < key.length; i++) {
    const ch = key[i]!;
    out += /[A-Za-z0-9-]/.test(ch) ? ch : `_${key.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  return out;
}

const itemKey = (m: string) => `${KEY_PREFIX}${m}`;

export function createAuthStorage(): AuthStorageAdapter {
  /** This launch's truth: a string, or null for "removed this launch" (so the Keychain is not consulted). */
  const memory = new Map<string, string | null>();
  /** False when the reinstall wipe failed: whatever the Keychain holds may be an old account. */
  let trustKeychain = true;
  let index: string[] | null = null;
  let ready: Promise<void> | null = null;
  /** Keychain work runs one call at a time, so a write and the index update cannot interleave. */
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function readIndex(): Promise<string[]> {
    if (index) return index;
    const raw = await SecureStore.getItemAsync(INDEX_KEY, OPTIONS);
    let parsed: unknown = [];
    if (raw !== null) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = [];
      }
    }
    index = Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    return index;
  }

  /** Records `m` in the index before its value is written, so a later wipe always finds it. */
  async function addToIndex(m: string): Promise<void> {
    const current = await readIndex();
    if (current.includes(m)) return;
    const next = [...current, m];
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(next), OPTIONS);
    index = next;
  }

  async function wipeAll(): Promise<void> {
    const keys = await readIndex();
    for (const m of keys) await SecureStore.deleteItemAsync(itemKey(m), OPTIONS);
    await SecureStore.deleteItemAsync(INDEX_KEY, OPTIONS);
    index = [];
  }

  async function installCheck(): Promise<void> {
    let marker: string | null;
    try {
      marker = await AsyncStorage.getItem(INSTALL_MARKER);
    } catch {
      return; // Cannot tell a reinstall from a relaunch: delete nothing.
    }
    if (marker !== null) return;
    try {
      await wipeAll();
    } catch {
      // The old session may still be there. Ignore the Keychain for this launch and leave the marker
      // unset, so the next launch tries the wipe again.
      trustKeychain = false;
      return;
    }
    try {
      await AsyncStorage.setItem(INSTALL_MARKER, '1');
    } catch {
      // The next launch wipes again: at worst one extra sign-out.
    }
  }

  function whenReady(): Promise<void> {
    ready ??= serial(installCheck).catch(() => {});
    return ready;
  }

  return {
    async getItem(key) {
      await whenReady();
      if (memory.has(key)) return memory.get(key) ?? null;
      if (!trustKeychain) return null;
      try {
        const stored = await serial(() => SecureStore.getItemAsync(itemKey(secureKeyFor(key)), OPTIONS));
        // A setItem/removeItem that ran meanwhile wins over what was read.
        if (!memory.has(key)) memory.set(key, stored);
        return memory.get(key) ?? null;
      } catch {
        return null; // Not cached: the next call asks the Keychain again.
      }
    },
    async setItem(key, value) {
      memory.set(key, value);
      await whenReady();
      try {
        await serial(async () => {
          const m = secureKeyFor(key);
          await addToIndex(m);
          await SecureStore.setItemAsync(itemKey(m), value, OPTIONS);
        });
      } catch {
        // The in-memory copy keeps this launch signed in.
      }
    },
    async removeItem(key) {
      memory.set(key, null);
      await whenReady();
      try {
        await serial(() => SecureStore.deleteItemAsync(itemKey(secureKeyFor(key)), OPTIONS));
      } catch {
        // Removed for this launch; the Keychain copy may come back next launch.
      }
    },
  };
}
