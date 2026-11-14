import type { BevSummary, CategoryId } from '@bevi/shared';

import type { CategoryInfo } from '@/lib/categories';

/**
 * The category the wizard's likely-duplicate matches agree on, when it differs from the one chosen.
 *
 * Count `categoryId` over `matches` (relevance order), ignoring categories the user can't see. X is the
 * most frequent; a tie goes to the category that appears first in `matches`. X is suggested only if at
 * least two matches are in it, it isn't already chosen, and it has more matches than the chosen
 * category (which counts 0 when nothing is chosen). Otherwise null: no hint.
 */
export function suggestCategory(
  matches: readonly BevSummary[],
  chosen: CategoryId | null,
  visible: readonly CategoryInfo[],
): CategoryId | null {
  const shown = new Set<CategoryId>(visible.map((c) => c.id));
  // A Map keeps insertion order, so iterating it visits categories in order of first appearance.
  const counts = new Map<CategoryId, number>();
  for (const m of matches) {
    if (shown.has(m.categoryId)) counts.set(m.categoryId, (counts.get(m.categoryId) ?? 0) + 1);
  }
  let best: CategoryId | null = null;
  let bestCount = 0;
  for (const [id, n] of counts) {
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  if (best === null || bestCount < 2 || best === chosen) return null;
  const chosenCount = chosen ? (counts.get(chosen) ?? 0) : 0;
  return bestCount > chosenCount ? best : null;
}
