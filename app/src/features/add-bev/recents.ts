import type { BevSummary } from '@bevi/shared';
import { useCallback, useState } from 'react';

/** A Bev opened from search, as the Recents row shows it (name, brand) and links to it (id). */
export type RecentBev = Pick<BevSummary, 'id' | 'name' | 'brand'>;

/** One list per account, so people sharing a browser don't see each other's recents. */
const keyFor = (userId: string) => `bevi.add.recents:${userId}`;
/** Recents kept on this device. */
export const RECENTS_MAX = 8;

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

function isRecent(v: unknown): v is RecentBev {
  const r = v as RecentBev;
  return !!r && typeof r.id === 'string' && typeof r.name === 'string' && (r.brand === null || typeof r.brand === 'string');
}

/** A user's recents, newest first. Empty with no user, or when storage is missing, blocked or holds junk. */
export function readRecents(userId: string | undefined): RecentBev[] {
  if (!userId) return [];
  try {
    const raw = storage()?.getItem(keyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function write(userId: string | undefined, list: RecentBev[]): void {
  if (!userId) return;
  try {
    storage()?.setItem(keyFor(userId), JSON.stringify(list));
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
      const next = [{ id: bev.id, name: bev.name, brand: bev.brand }, ...readRecents(userId).filter((r) => r.id !== bev.id)].slice(0, RECENTS_MAX);
      write(userId, next);
      setState({ userId, list: userId ? next : [] });
    },
    [userId],
  );
  const forget = useCallback(
    (id: string) => {
      const next = readRecents(userId).filter((r) => r.id !== id);
      write(userId, next);
      setState({ userId, list: next });
    },
    [userId],
  );
  return { recents, remember, forget };
}
