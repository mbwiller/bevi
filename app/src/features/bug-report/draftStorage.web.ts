import { webStorage, type StorageLike } from './draft';

/**
 * Where the reporter keeps its note and its tickets to place, on the web: `localStorage`, which
 * answers at once. draftStorage.ts is the iOS file (AsyncStorage, read into memory first).
 */

/** What `store.ts` uses unless a test injects its own: `localStorage` where there is one. */
export function defaultStorage(): StorageLike | null {
  return webStorage();
}

/** Nothing to wait for: the note can be restored on the first render. */
export function useStorageReady(): boolean {
  return true;
}
