// Cold start (§8.12): which Bevs a new user ranks during onboarding. Runs in the app only
// (seam interpretation 1, §12); the server never calls it.

import { STARTER_CORE, STARTER_K, STARTER_MAX_PER_CATEGORY, STARTER_MIN_CATEGORIES } from './constants.ts';
import { createPrng, randomInt } from './prng.ts';
import type { BevId, CategoryId, StarterCandidate, StarterOptions } from './types.ts';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Picks `k` (10) starter Bevs: a `core` (6) of the most-rated starters, the same for everyone,
 * then `k − core` drawn with a PRNG seeded by `seed` (the userId, so the set is stable across
 * visits), keeping at most `maxPerCategory` (2) per category over the whole set and aiming for
 * at least STARTER_MIN_CATEGORIES (5) distinct categories. `excludeCategoryIds` removes
 * alcoholic categories for under-21s.
 *
 * Choices where §8.12 is silent:
 * - Core order: ratingCount desc, name asc (code points), id asc. The core also respects
 *   maxPerCategory: a starter whose category already has 2 core picks is skipped for the next
 *   most-rated one.
 * - The draw shuffles the remaining starters (Fisher–Yates over id order) and takes, in that
 *   order, first Bevs from new categories until the set spans 5, then any Bev under the cap.
 * - If the cap makes `k` unreachable, the cap is relaxed to fill the set (onboarding needs k Bevs).
 * - Returns min(k, candidates after exclusion) ids: the core in core order, then draws in draw order.
 */
export function selectStarterSet(candidates: readonly StarterCandidate[], opts: StarterOptions): BevId[] {
  const k = opts.k ?? STARTER_K;
  const core = Math.min(opts.core ?? STARTER_CORE, k);
  const maxPerCategory = opts.maxPerCategory ?? STARTER_MAX_PER_CATEGORY;
  const excluded = new Set<CategoryId>(opts.excludeCategoryIds ?? []);

  const byId = new Map<BevId, StarterCandidate>();
  for (const c of candidates) if (!excluded.has(c.categoryId) && !byId.has(c.id)) byId.set(c.id, c);
  const pool = [...byId.values()];

  const chosen: StarterCandidate[] = [];
  const perCat = new Map<CategoryId, number>();
  const take = (c: StarterCandidate) => {
    chosen.push(c);
    perCat.set(c.categoryId, (perCat.get(c.categoryId) ?? 0) + 1);
  };
  const underCap = (c: StarterCandidate) => (perCat.get(c.categoryId) ?? 0) < maxPerCategory;

  const mostRated = [...pool].sort((a, b) => b.ratingCount - a.ratingCount || cmp(a.name, b.name) || cmp(a.id, b.id));
  for (const c of mostRated) {
    if (chosen.length >= core) break;
    if (underCap(c)) take(c);
  }

  const taken = new Set(chosen.map((c) => c.id));
  const rest = pool.filter((c) => !taken.has(c.id)).sort((a, b) => cmp(a.id, b.id));
  const rand = createPrng(opts.seed);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = randomInt(rand, i + 1);
    [rest[i], rest[j]] = [rest[j] as StarterCandidate, rest[i] as StarterCandidate];
  }

  const passes: Array<(c: StarterCandidate) => boolean> = [
    (c) => perCat.size < STARTER_MIN_CATEGORIES && !perCat.has(c.categoryId),
    underCap,
    () => true,
  ];
  for (const ok of passes) {
    for (const c of rest) {
      if (chosen.length >= k) break;
      if (!chosen.includes(c) && ok(c)) take(c);
    }
  }
  return chosen.map((c) => c.id);
}
