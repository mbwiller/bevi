import { useCallback, useEffect, useMemo, useState } from 'react';

/** The slice of an infinite query `useAllPages` drives. */
interface PagedQuery {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isError: boolean;
  fetchNextPage: () => unknown;
}

/**
 * Keeps fetching until every page is loaded. For the lookups the leaderboard derives row state from
 * (whom I follow, what I saved): a first page alone would get rows past it wrong.
 */
export function useAllPages(query: PagedQuery): void {
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
}

/**
 * A set of ids from the server (whom I follow, what I saved) with local optimistic overrides on top.
 * Leaderboard rows don't carry `isFollowing` / `inMyWantToTry` (contract gap), so the screen derives
 * them from the caller's own lists and flips them here the moment a button is pressed. An override
 * lasts only until `base` agrees with it, so later changes made elsewhere (unsaving in Your Lists,
 * unfollowing on a profile) show through. `set` returns an undo for the mutation's onError.
 */
export function useToggleSet(base: readonly string[]) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const baseSet = useMemo(() => new Set(base), [base]);

  useEffect(() => {
    setOverrides((m) => {
      const settled = [...m].filter(([id, value]) => baseSet.has(id) === value);
      if (settled.length === 0) return m;
      const next = new Map(m);
      for (const [id] of settled) next.delete(id);
      return next;
    });
  }, [baseSet]);

  const has = useCallback((id: string) => overrides.get(id) ?? baseSet.has(id), [overrides, baseSet]);

  const set = useCallback((id: string, value: boolean) => {
    setOverrides((m) => new Map(m).set(id, value));
    return () =>
      setOverrides((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      });
  }, []);

  return { has, set };
}
