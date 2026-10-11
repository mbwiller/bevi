import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { Page } from '@bevi/shared';

import { keys } from '../keys';

/** Shared options for every cursor-paginated `useInfiniteQuery`. */
export const cursorPaging = {
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: Page<unknown>) => last.nextCursor ?? undefined,
};

/** Flattens an infinite query's pages for a list component. */
export function flattenPages<T>(data: InfiniteData<Page<T>> | undefined): T[] {
  return data ? data.pages.flatMap((p) => p.items) : [];
}

type Snapshot = [QueryKey, unknown][];

/** Cancels in-flight reads under each prefix and snapshots them, for optimistic rollback. */
export async function snapshot(qc: QueryClient, prefixes: QueryKey[]): Promise<Snapshot> {
  await Promise.all(prefixes.map((queryKey) => qc.cancelQueries({ queryKey })));
  return prefixes.flatMap((queryKey) => qc.getQueriesData({ queryKey }));
}

export function rollback(qc: QueryClient, snap: Snapshot | undefined): void {
  for (const [key, data] of snap ?? []) qc.setQueryData(key, data);
}

/**
 * Applies `fn` to every item of a cached value that is a list, a `Page`, or an infinite query's
 * `InfiniteData<Page>`; other shapes are returned untouched.
 */
export function mapCachedItems<T>(data: unknown, fn: (item: T) => T): unknown {
  if (Array.isArray(data)) return data.map(fn);
  if (data && typeof data === 'object') {
    const d = data as { items?: T[]; pages?: Page<T>[] };
    if (Array.isArray(d.pages)) return { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map(fn) })) };
    if (Array.isArray(d.items)) return { ...d, items: d.items.map(fn) };
  }
  return data;
}

export function filterCachedItems<T>(data: unknown, keep: (item: T) => boolean): unknown {
  if (data && typeof data === 'object') {
    const d = data as { items?: T[]; pages?: Page<T>[] };
    if (Array.isArray(d.pages)) return { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter(keep) })) };
    if (Array.isArray(d.items)) return { ...d, items: d.items.filter(keep) };
  }
  return data;
}

const ANONYMOUS = new Set(['session', 'appConfig', 'checkHandle']);
const isUserQuery = (q: { queryKey: QueryKey }) => !ANONYMOUS.has(String(q.queryKey[1]));

/** Signed out: drop everything that belonged to the previous user. */
export function clearUserQueries(qc: QueryClient): void {
  qc.removeQueries({ predicate: isUserQuery });
}

/** Signed in (maybe as someone else): reset user data and refetch whatever is on screen. */
export function resetUserQueries(qc: QueryClient): Promise<void> {
  return qc.resetQueries({ predicate: isUserQuery });
}

/** §3: after submitRanking (and rerank/remove) refresh my rankings, the Bev, stats, feed,
 * leaderboard, recommendations, and Want to Try (ranking a Bev removes it from there). */
export function invalidateAfterRankingChange(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: keys.rankings.all }),
    qc.invalidateQueries({ queryKey: keys.bevs.all }),
    qc.invalidateQueries({ queryKey: keys.stats.all }),
    qc.invalidateQueries({ queryKey: keys.feed() }),
    qc.invalidateQueries({ queryKey: keys.leaderboard.all }),
    qc.invalidateQueries({ queryKey: keys.recommendationsAll }),
    qc.invalidateQueries({ queryKey: keys.wantToTry() }),
  ]);
}
