import { selectStarterSet } from '@bevi/ranking';
import type { BevSummary, CategoryId, Profile } from '@bevi/shared';

import { CATEGORIES } from '@/lib/categories';

/** The categories hidden from anyone who can't see alcohol (§6.17). */
export const ALCOHOLIC_CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.filter((c) => c.isAlcoholic).map((c) => c.id);

/**
 * The seed for a round of starters. Round 0 is the user id itself (§8.12: the set is stable, so
 * leaving onboarding and coming back shows the same 10); "Show me more" asks for round 1, 2…
 */
export function starterSeed(userId: string, round: number): string {
  return round === 0 ? userId : `${userId}:more:${round}`;
}

/**
 * One round of the starter set: `selectStarterSet` from @bevi/ranking over the candidates not shown
 * in an earlier round, seeded by the user id, alcoholic categories excluded when the user can't
 * see alcohol. The server already filters by age; the exclusion is the client-side mirror.
 */
export function selectStarterRound(
  candidates: readonly BevSummary[],
  me: Pick<Profile, 'id' | 'canSeeAlcohol'>,
  round: number,
  seen: ReadonlySet<string> = new Set(),
): string[] {
  const pool = candidates.filter((c) => !seen.has(c.id));
  return selectStarterSet(pool, {
    seed: starterSeed(me.id, round),
    excludeCategoryIds: me.canSeeAlcohol ? undefined : [...ALCOHOLIC_CATEGORY_IDS],
  });
}

/** Whether another round could show anything new. */
export function hasMoreStarters(
  candidates: readonly BevSummary[],
  me: Pick<Profile, 'canSeeAlcohol'>,
  seen: ReadonlySet<string>,
): boolean {
  return candidates.some(
    (c) => !seen.has(c.id) && (me.canSeeAlcohol || !ALCOHOLIC_CATEGORY_IDS.includes(c.categoryId)),
  );
}
