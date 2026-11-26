// Cold start (§8.12): which Bevs a new user ranks during onboarding. Runs in the app only
// (seam interpretation 1, §12); the server never calls it.

import { compareCodePoints as cmp } from './bayesian.ts';
import { STARTER_CORE, STARTER_K, STARTER_MAX_PER_CATEGORY, STARTER_MIN_CATEGORIES, STARTER_PICK_QUOTAS } from './constants.ts';
import { createPrng, randomInt } from './prng.ts';
import type { BevId, CategoryId, StarterCandidate, StarterOptions } from './types.ts';

/**
 * Picks `k` (10) starter Bevs: a `core` (3) of the most-rated starters, the same for everyone;
 * then the user's go-to categories (`picks`, favourite first) topped up to STARTER_PICK_QUOTAS
 * (2, 2, 1) Bevs each with their most-rated starters; then wildcards drawn with a PRNG seeded by
 * `seed` (the userId, so the set is stable across visits). At most `maxPerCategory` (2) per
 * category over the whole set, aiming for at least STARTER_MIN_CATEGORIES (5) distinct
 * categories. `excludeCategoryIds` removes alcoholic categories for under-21s. Typically
 * 3 core + 5 from the picks + 2 wildcards; with no picks, 3 core + 7 wildcards.
 *
 * Choices where §8.12 is silent:
 * - Core order: ratingCount desc, name asc (code points), id asc. The core also respects
 *   maxPerCategory: a starter whose category already has 2 core members is skipped for the next
 *   most-rated one. The core depends on neither `picks` nor `seed`.
 * - Picks that count: the first STARTER_PICK_QUOTAS.length distinct entries not in
 *   `excludeCategoryIds`, so an excluded or repeated pick does not use up a pick rank and later
 *   ones are ignored. A pick with no starters still counts and takes nothing.
 * - A pick is topped up, not added to: core members in its category count toward its quota, so
 *   the slots they free become wildcards instead of stacking the favourite category. The top-up
 *   takes the category's most-rated remaining starters in core order (users with the same pick
 *   share them), never past maxPerCategory (a cap below a quota wins) or `k`. A category with too
 *   few starters gives what it has; the shortfall becomes wildcards.
 * - Wildcards shuffle the starters not yet taken (Fisher–Yates over id order) and take, in that
 *   order: (a) Bevs from categories neither in the set nor picked, until the set spans 5;
 *   (b) Bevs from non-picked categories under the cap; (c) any Bev under the cap; (d) anything.
 *   (d) relaxes the cap only when `k` is otherwise unreachable (onboarding needs k Bevs).
 * - Returns min(k, candidates after exclusion) unique ids, in the order the user sees them (they
 *   may stop after 3): each pick's first top-up Bev in pick order (a pick the core already filled
 *   has none), then the core in core order, then the picks' other top-up Bevs in pick order, then
 *   the wildcards in draw order. With no picks: the core, then the wildcards.
 */
export function selectStarterSet(candidates: readonly StarterCandidate[], opts: StarterOptions): BevId[] {
  const k = opts.k ?? STARTER_K;
  const core = Math.min(opts.core ?? STARTER_CORE, k);
  const maxPerCategory = opts.maxPerCategory ?? STARTER_MAX_PER_CATEGORY;
  const excluded = new Set<CategoryId>(opts.excludeCategoryIds ?? []);

  const byId = new Map<BevId, StarterCandidate>();
  for (const c of candidates) if (!excluded.has(c.categoryId) && !byId.has(c.id)) byId.set(c.id, c);
  const pool = [...byId.values()];

  const taken = new Set<BevId>();
  const perCat = new Map<CategoryId, number>();
  const count = (categoryId: CategoryId) => perCat.get(categoryId) ?? 0;
  const take = (c: StarterCandidate, into: StarterCandidate[]) => {
    into.push(c);
    taken.add(c.id);
    perCat.set(c.categoryId, count(c.categoryId) + 1);
  };
  const underCap = (c: StarterCandidate) => count(c.categoryId) < maxPerCategory;

  const mostRated = [...pool].sort((a, b) => b.ratingCount - a.ratingCount || cmp(a.name, b.name) || cmp(a.id, b.id));
  const coreSet: StarterCandidate[] = [];
  for (const c of mostRated) {
    if (coreSet.length >= core) break;
    if (underCap(c)) take(c, coreSet);
  }

  const picks: CategoryId[] = [];
  for (const p of opts.picks ?? []) {
    if (picks.length >= STARTER_PICK_QUOTAS.length) break;
    if (!excluded.has(p) && !picks.includes(p)) picks.push(p);
  }
  const picked = new Set(picks);
  const fromPicks = picks.map((categoryId, i) => {
    const target = Math.min(STARTER_PICK_QUOTAS[i] as number, maxPerCategory);
    const got: StarterCandidate[] = [];
    for (const c of mostRated) {
      if (taken.size >= k || count(categoryId) >= target) break;
      if (c.categoryId === categoryId && !taken.has(c.id)) take(c, got);
    }
    return got;
  });

  const rest = pool.filter((c) => !taken.has(c.id)).sort((a, b) => cmp(a.id, b.id));
  const rand = createPrng(opts.seed);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = randomInt(rand, i + 1);
    [rest[i], rest[j]] = [rest[j] as StarterCandidate, rest[i] as StarterCandidate];
  }

  const wildcards: StarterCandidate[] = [];
  const passes: Array<(c: StarterCandidate) => boolean> = [
    (c) => perCat.size < STARTER_MIN_CATEGORIES && !perCat.has(c.categoryId) && !picked.has(c.categoryId),
    (c) => underCap(c) && !picked.has(c.categoryId),
    underCap,
    () => true,
  ];
  for (const ok of passes) {
    for (const c of rest) {
      if (taken.size >= k) break;
      if (!taken.has(c.id) && ok(c)) take(c, wildcards);
    }
  }

  return [
    ...fromPicks.flatMap((got) => got.slice(0, 1)),
    ...coreSet,
    ...fromPicks.flatMap((got) => got.slice(1)),
    ...wildcards,
  ].map((c) => c.id);
}
