import { useCallback, useState } from 'react';

import { parseRecents, recentsKey, withoutRecent, withRecent, type RecentBev } from './recentsList';

// The web file: Recents in localStorage, read and written synchronously. The native one, recents.ts,
// keeps the same list in AsyncStorage.

export { RECENTS_MAX, type RecentBev } from './recentsList';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage` when it exists and works (web), else null. Never throws. */
function storage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** A user's recents, newest first. Empty with no user, or when storage is missing, blocked or holds junk. */
export function readRecents(userId: string | undefined): RecentBev[] {
  if (!userId) return [];
  try {
    return parseRecents(storage()?.getItem(recentsKey(userId)));
  } catch {
    return [];
  }
}

function write(userId: string | undefined, list: RecentBev[]): void {
  if (!userId) return;
  try {
    storage()?.setItem(recentsKey(userId), JSON.stringify(list));
  } catch {
    // Private mode or full storage: recents are a convenience, so drop the write.
  }
}

/**
 * Recent Bevs for the Search panel's idle state, per account on this device: remember on open, forget with
 * the row's ✕. Nothing is kept until the signed-in user is known.
 */
export function useRecents(userId: string | undefined) {
  const [state, setState] = useState(() => ({ userId, list: readRecents(userId) }));
  // Re-read when the account changes (or becomes known).
  const recents = state.userId === userId ? state.list : readRecents(userId);
  if (state.userId !== userId) setState({ userId, list: recents });
  const remember = useCallback(
    (bev: RecentBev) => {
      const next = withRecent(readRecents(userId), bev);
      write(userId, next);
      setState({ userId, list: userId ? next : [] });
    },
    [userId],
  );
  const forget = useCallback(
    (id: string) => {
      const next = withoutRecent(readRecents(userId), id);
      write(userId, next);
      setState({ userId, list: next });
    },
    [userId],
  );
  return { recents, remember, forget };
}
