import type { BevSummary } from '@bevi/shared';

// The parts of Recents both platforms share: the stored format and the list edits. The storage
// itself is per platform: recents.web.ts (localStorage, synchronous) and recents.ts (AsyncStorage).

/** A Bev opened from search, as the Recents row shows it (name, brand) and links to it (id). */
export type RecentBev = Pick<BevSummary, 'id' | 'name' | 'brand'>;

/** One list per account, so people sharing a device don't see each other's recents. */
export const recentsKey = (userId: string) => `bevi.add.recents:${userId}`;
/** Recents kept on this device. */
export const RECENTS_MAX = 8;

function isRecent(v: unknown): v is RecentBev {
  const r = v as RecentBev;
  return !!r && typeof r.id === 'string' && typeof r.name === 'string' && (r.brand === null || typeof r.brand === 'string');
}

/** The stored text as a list, newest first. Empty for nothing stored; throws on text that is not JSON. */
export function parseRecents(raw: string | null | undefined): RecentBev[] {
  const parsed: unknown = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, RECENTS_MAX) : [];
}

/** `list` with `bev` moved (or added) to the front, capped at RECENTS_MAX. */
export function withRecent(list: RecentBev[], bev: RecentBev): RecentBev[] {
  return [{ id: bev.id, name: bev.name, brand: bev.brand }, ...list.filter((r) => r.id !== bev.id)].slice(0, RECENTS_MAX);
}

/** `list` without the Bev `id`. */
export function withoutRecent(list: RecentBev[], id: string): RecentBev[] {
  return list.filter((r) => r.id !== id);
}
