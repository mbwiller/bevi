import { MAX_CATEGORY_PICKS, type BevSummary, type CategoryId } from '@bevi/shared';

import { visibleCategories, type CategoryInfo } from '@/lib/categories';

/** A pick's place: 1 for the favorite. */
export type PickRank = 1 | 2 | 3;

/** The tiles: every category the user can see, in catalog order, without Other. */
export function pickableCategories(canSeeAlcohol: boolean): readonly CategoryInfo[] {
  return visibleCategories(canSeeAlcohol).filter((c) => c.id !== 'other');
}

/**
 * A tap on a tile. An unpicked one joins at the end (it gets the next number) while there is room;
 * a picked one leaves and the later picks move up one. At the cap, a tap on an unpicked tile
 * changes nothing and returns the same list.
 */
export function togglePick(picks: readonly CategoryId[], id: CategoryId): readonly CategoryId[] {
  if (picks.includes(id)) return picks.filter((p) => p !== id);
  if (picks.length >= MAX_CATEGORY_PICKS) return picks;
  return [...picks, id];
}

/** The tile's number, or undefined when it isn't picked. */
export function rankOf(picks: readonly CategoryId[], id: CategoryId): PickRank | undefined {
  const i = picks.indexOf(id);
  return i < 0 ? undefined : ((i + 1) as PickRank);
}

/**
 * What a returning user starts with: their saved picks, favorite first, keeping only the
 * categories offered now (a category they can no longer see drops out), each once, at most
 * MAX_CATEGORY_PICKS.
 */
export function prefillPicks(saved: readonly CategoryId[], offered: readonly CategoryId[]): readonly CategoryId[] {
  const out: CategoryId[] = [];
  for (const id of saved) {
    if (out.length >= MAX_CATEGORY_PICKS) break;
    if (offered.includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Most-rated first, then name, then id: negative when `a` comes before `b`. */
function mostRatedFirst(a: BevSummary, b: BevSummary): number {
  return b.ratingCount - a.ratingCount || byCodeUnit(a.name, b.name) || byCodeUnit(a.id, b.id);
}

/**
 * Each category's art: its most-rated starter Bev (ratingCount high to low, then name, then id, so
 * it holds still across visits). A category with no starter is left out and its tile shows the
 * category's own art.
 */
export function artBevsByCategory(candidates: readonly BevSummary[]): ReadonlyMap<CategoryId, BevSummary> {
  const best = new Map<CategoryId, BevSummary>();
  for (const c of candidates) {
    const cur = best.get(c.categoryId);
    if (!cur || mostRatedFirst(c, cur) < 0) best.set(c.categoryId, c);
  }
  return best;
}
