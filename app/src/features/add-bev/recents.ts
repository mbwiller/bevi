import type { BevSummary } from '@bevi/shared';
import { useCallback, useState } from 'react';

/** A Bev opened from search, as the Recents row shows it (name, brand) and links to it (id). */
export type RecentBev = Pick<BevSummary, 'id' | 'name' | 'brand'>;

const KEY = 'bevi.add.recents';
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

/** The recents list, newest first. Empty when storage is missing, blocked or holds junk. */
export function readRecents(): RecentBev[] {
  try {
    const raw = storage()?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function write(list: RecentBev[]): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode or full storage: recents are a convenience, so drop the write.
  }
}

/** Per-device recent Bevs for the Add Bev idle state: remember on open, forget with the row's ✕. */
export function useRecents() {
  const [recents, setRecents] = useState<RecentBev[]>(readRecents);
  const remember = useCallback((bev: RecentBev) => {
    const next = [{ id: bev.id, name: bev.name, brand: bev.brand }, ...readRecents().filter((r) => r.id !== bev.id)].slice(0, RECENTS_MAX);
    write(next);
    setRecents(next);
  }, []);
  const forget = useCallback((id: string) => {
    const next = readRecents().filter((r) => r.id !== id);
    write(next);
    setRecents(next);
  }, []);
  return { recents, remember, forget };
}
