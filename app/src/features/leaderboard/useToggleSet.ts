import { useCallback, useMemo, useState } from 'react';

/**
 * A set of ids from the server (whom I follow, what I saved) with local optimistic overrides on top.
 * Leaderboard rows don't carry `isFollowing` / `inMyWantToTry` (see the PR's contract gaps), so the
 * screen derives them from the caller's own lists and flips them here the moment a button is pressed.
 * `set` returns an undo for the mutation's onError.
 */
export function useToggleSet(base: readonly string[]) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const baseSet = useMemo(() => new Set(base), [base]);

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
