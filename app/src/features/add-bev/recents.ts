import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { parseRecents, recentsKey, withoutRecent, withRecent, type RecentBev } from './recentsList';

// The native file: Recents in AsyncStorage, which only answers asynchronously. The web one,
// recents.web.ts, keeps the same list in localStorage and reads it synchronously.

export { RECENTS_MAX, type RecentBev } from './recentsList';

/** A user's stored recents, newest first. Empty when nothing is stored, storage fails, or it holds junk. */
export async function loadRecents(userId: string): Promise<RecentBev[]> {
  try {
    return parseRecents(await AsyncStorage.getItem(recentsKey(userId)));
  } catch {
    return [];
  }
}

async function save(userId: string, list: RecentBev[]): Promise<void> {
  try {
    await AsyncStorage.setItem(recentsKey(userId), JSON.stringify(list));
  } catch {
    // Full or failing storage: recents are a convenience, so drop the write.
  }
}

/**
 * Every read and read-modify-write of Recents runs one after another, across all the hooks that are
 * mounted (the Search panel and the map's venue panel both keep Recents): each edit starts from what
 * is stored, so one panel never overwrites what another just added.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const NONE: RecentBev[] = [];

/**
 * Recent Bevs for the Search panel's idle state, per account on this device: remember on open, forget with
 * the row's ✕. Nothing is kept until the signed-in user is known. The list starts empty and fills when the
 * stored one has been read; writes are fire-and-forget and never throw. The list in state is tagged with
 * its account, and any other account's list reads as empty, so switching accounts never shows the
 * previous one's Recents, not even for a frame.
 */
export function useRecents(userId: string | undefined) {
  const [state, setState] = useState<{ userId: string | undefined; list: RecentBev[] }>(() => ({ userId, list: NONE }));
  const recents = state.userId === userId ? state.list : NONE;
  if (state.userId !== userId) setState({ userId, list: NONE });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Shows `list` as `uid`'s Recents, unless the hook has moved on to another account (or unmounted). */
  const show = useCallback((uid: string, list: RecentBev[]) => {
    if (mounted.current) setState((s) => (s.userId === uid ? { userId: uid, list } : s));
  }, []);

  useEffect(() => {
    if (!userId) return;
    void serial(() => loadRecents(userId)).then((list) => show(userId, list));
  }, [userId, show]);

  const edit = useCallback(
    (change: (list: RecentBev[]) => RecentBev[]) => {
      if (!userId) return;
      // At once on screen, then from what is stored once the write has been made.
      setState((s) => (s.userId === userId ? { userId, list: change(s.list) } : s));
      void serial(async () => {
        const next = change(await loadRecents(userId));
        await save(userId, next);
        return next;
      }).then((next) => show(userId, next));
    },
    [userId, show],
  );
  const remember = useCallback((bev: RecentBev) => edit((list) => withRecent(list, bev)), [edit]);
  const forget = useCallback((id: string) => edit((list) => withoutRecent(list, id)), [edit]);
  return { recents, remember, forget };
}
