import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { DRAFT_KEY, UNPLACED_KEY, type StorageLike } from './draft';

/**
 * Where the reporter keeps its note and its tickets to place, on iOS: AsyncStorage, which only
 * answers asynchronously (draftStorage.web.ts is `localStorage`, which answers at once). Same split
 * as Recents (features/add-bev/recents.ts, recents.web.ts).
 *
 * The store (store.ts) reads and writes through the synchronous `StorageLike` of draft.ts, so this
 * keeps the two keys in memory: `loadStorage()` reads them from AsyncStorage once, the host waits
 * for it (`useStorageReady`) before it restores anything (`hydrate`), and every write after that
 * lands in memory at once and in AsyncStorage in order, in the background. A write that fails is
 * dropped: the note lives in memory either way.
 *
 * What is kept is what draft.ts keeps and nothing more: the text, the type, what was pointed at and
 * the recorded steps, never a picture. A screenshot of the tester's screen is in memory, and the
 * temporary file behind its thumbnail, until the note is sent or discarded; neither is written to
 * AsyncStorage, which would hold a picture of whatever was on screen with nothing ever pruning it.
 * A restored note says so ("Screenshots weren't kept").
 */

const KEYS = [DRAFT_KEY, UNPLACED_KEY];

const memory = new Map<string, string>();
/** Keys written or removed since start, so a slow first read never brings back what was just forgotten. */
const touched = new Set<string>();
let loading: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function later(task: () => Promise<unknown>): void {
  queue = queue.then(task, task).catch(() => undefined);
}

/** The reporter's storage, as the store reads it. */
export const nativeStorage: StorageLike = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
    touched.add(key);
    later(() => AsyncStorage.setItem(key, value));
  },
  removeItem: (key) => {
    memory.delete(key);
    touched.add(key);
    later(() => AsyncStorage.removeItem(key));
  },
};

/** What `store.ts` uses unless a test injects its own. */
export function defaultStorage(): StorageLike | null {
  return nativeStorage;
}

/** Reads the stored note and tickets into memory, once. Never rejects: storage that fails reads as empty. */
export function loadStorage(): Promise<void> {
  loading ??= (async () => {
    try {
      const pairs = await AsyncStorage.multiGet(KEYS);
      for (const [key, value] of pairs) {
        if (value !== null && !touched.has(key)) memory.set(key, value);
      }
    } catch {
      // Unreadable storage: start with no note.
    }
  })();
  return loading;
}

/** Whether the stored note has been read, so the host can restore it. True at once where storage is synchronous. */
export function useStorageReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadStorage().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

/** Test seam: forget what was read, as a fresh launch. */
export function resetNativeStorage(): void {
  memory.clear();
  touched.clear();
  loading = null;
  queue = Promise.resolve();
}
