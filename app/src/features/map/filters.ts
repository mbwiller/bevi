// The map's filters (M-16, §1c): what the pills say, how many are on, and the filters a viewer can
// actually use. Pure, so they are tested without rendering. The state itself lives in the Search
// feature (features/search/mapFilters.ts); `venues.inView` gets these after `normaliseVenueFilters`.

import type { CategoryId, PriceTier, VenueFilters, VenueKind } from '@bevi/shared';

import { normaliseVenueFilters } from '@/api/venueViewport';
import { CATEGORIES, categoryById, visibleCategories } from '@/lib/categories';
import { KIND_PLURAL, VENUE_KINDS } from '@/lib/venue';

export const PRICE_TIERS: readonly PriceTier[] = [1, 2, 3, 4];

export const priceLabel = (t: PriceTier) => '$'.repeat(t);

/** "Filters N": each facet that is on counts once, and Open now counts once. */
export function activeFilterCount(f: VenueFilters): number {
  const on = (xs?: readonly unknown[]) => (xs && xs.length ? 1 : 0);
  return on(f.neighborhoods) + on(f.categoryIds) + on(f.priceTiers) + on(f.kinds) + (f.openNow ? 1 : 0);
}

/** "Coffee", or "Coffee +2" past one. */
function firstPlus(labels: string[]): string {
  if (labels.length === 0) return '';
  return labels.length === 1 ? labels[0]! : `${labels[0]} +${labels.length - 1}`;
}

/** The pills' picked labels, in catalog order whatever order they were ticked in. */
export function pickedLabels(f: VenueFilters): { neighborhood: string; category: string; price: string; retailer: string } {
  const cats = CATEGORIES.filter((c) => f.categoryIds?.includes(c.id)).map((c) => c.label);
  const tiers = PRICE_TIERS.filter((t) => f.priceTiers?.includes(t)).map(priceLabel);
  const kinds = VENUE_KINDS.filter((k) => f.kinds?.includes(k)).map((k) => KIND_PLURAL[k]);
  const hoods = [...(f.neighborhoods ?? [])].sort((a, b) => a.localeCompare(b));
  return { neighborhood: firstPlus(hoods), category: firstPlus(cats), price: tiers.join(', '), retailer: kinds.join(', ') };
}

/** Adds `x` to the list or takes it out. */
export function toggled<T>(xs: readonly T[] | undefined, x: T): T[] {
  const list = xs ?? [];
  return list.includes(x) ? list.filter((y) => y !== x) : [...list, x];
}

/**
 * The filters this viewer can use: never an alcoholic category under 21 (one may linger from an
 * earlier session in the same tab), and no neighbourhood the vocabulary doesn't have (prod's is
 * empty today, so the hidden pill can't leave a filter on). `vocabulary` undefined = not loaded yet,
 * so neighbourhoods are kept until it is.
 */
export function usableFilters(f: VenueFilters, canSeeAlcohol: boolean, vocabulary: readonly string[] | undefined): VenueFilters {
  const allowed = new Set(visibleCategories(canSeeAlcohol).map((c) => c.id));
  return normaliseVenueFilters({
    ...f,
    categoryIds: f.categoryIds?.filter((id) => allowed.has(id)),
    neighborhoods: vocabulary ? f.neighborhoods?.filter((n) => vocabulary.includes(n)) : f.neighborhoods,
  });
}

/**
 * A change from the pills, to store. The pills show `usableFilters`, so a category this viewer can't
 * use yet (an alcoholic one before `me` has loaded, or under 21) isn't in what they hand back; it is
 * kept from the stored selection, and `usableFilters` keeps it out of the request. Reset filters
 * (`{}`) and an explicitly empty category list clear it too.
 */
export function keepHiddenCategories(next: VenueFilters, stored: VenueFilters, canSeeAlcohol: boolean): VenueFilters {
  const allowed = new Set(visibleCategories(canSeeAlcohol).map((c) => c.id));
  const hidden = (stored.categoryIds ?? []).filter((id) => !allowed.has(id));
  if (hidden.length === 0 || Object.keys(next).length === 0 || next.categoryIds?.length === 0) return next;
  return { ...next, categoryIds: [...(next.categoryIds ?? []), ...hidden.filter((id) => !next.categoryIds?.includes(id))] };
}

/**
 * Filters read back from storage, keeping only well-formed values: a stale or hand-edited
 * sessionStorage entry must never reach `venues.inView` as junk.
 */
export function sanitiseFilters(raw: unknown): VenueFilters {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const list = <T>(v: unknown, ok: (x: unknown) => x is T): T[] | undefined => (Array.isArray(v) ? v.filter(ok) : undefined);
  return normaliseVenueFilters({
    categoryIds: list(r.categoryIds, (x): x is CategoryId => typeof x === 'string' && !!categoryById(x as CategoryId)),
    kinds: list(r.kinds, (x): x is VenueKind => VENUE_KINDS.includes(x as VenueKind)),
    priceTiers: list(r.priceTiers, (x): x is PriceTier => PRICE_TIERS.includes(x as PriceTier)),
    neighborhoods: list(r.neighborhoods, (x): x is string => typeof x === 'string' && x.trim().length > 0),
    openNow: r.openNow === true,
  });
}
