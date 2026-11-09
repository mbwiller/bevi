// The map's filters (M-16 part 2): the pills' labels and count, what a viewer can use, what comes
// back from storage, and the Search feature's session store.

import type { VenueFilters } from '@bevi/shared';

import { MAP_FILTERS_KEY, reloadMapFiltersForTests, useMapFilters } from '@/features/search/mapFilters';

import { activeFilterCount, keepHiddenCategories, pickedLabels, sanitiseFilters, toggled, usableFilters } from '../filters';

describe('the pills', () => {
  it('count each facet that is on once, and Open now once', () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ categoryIds: [], kinds: [] })).toBe(0);
    expect(activeFilterCount({ categoryIds: ['coffee', 'tea'], priceTiers: [1], openNow: true })).toBe(3);
    expect(activeFilterCount({ neighborhoods: ['Yorkville'], kinds: ['chain'], openNow: false })).toBe(2);
  });

  it('say what is picked, in catalog order', () => {
    expect(pickedLabels({})).toEqual({ neighborhood: '', category: '', price: '', retailer: '' });
    const f: VenueFilters = {
      categoryIds: ['tea', 'coffee', 'soda'],
      priceTiers: [2, 1],
      kinds: ['craft', 'chain'],
      neighborhoods: ['Yorkville', 'Carnegie Hill'],
    };
    expect(pickedLabels(f)).toEqual({ category: 'Soda +2', price: '$, $$', retailer: 'Chains, Craft', neighborhood: 'Carnegie Hill +1' });
    expect(pickedLabels({ categoryIds: ['coffee'], kinds: ['chain'] })).toMatchObject({ category: 'Coffee', retailer: 'Chains' });
  });

  it('toggle an option in or out', () => {
    expect(toggled(undefined, 'a')).toEqual(['a']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('usableFilters', () => {
  it('drops alcoholic categories for an under-21 viewer, and normalises', () => {
    expect(usableFilters({ categoryIds: ['beer', 'coffee'], kinds: [] }, false, undefined)).toEqual({ categoryIds: ['coffee'] });
    expect(usableFilters({ categoryIds: ['beer', 'coffee'] }, true, undefined)).toEqual({ categoryIds: ['beer', 'coffee'] });
  });

  it('keeps neighbourhoods until the vocabulary loads, then only the ones it has', () => {
    const f = { neighborhoods: ['Yorkville', 'Atlantis'] };
    expect(usableFilters(f, true, undefined)).toEqual({ neighborhoods: ['Atlantis', 'Yorkville'] });
    expect(usableFilters(f, true, ['Yorkville'])).toEqual({ neighborhoods: ['Yorkville'] });
    // Prod today: no vocabulary, so no neighbourhood filter can stay on behind a hidden pill.
    expect(usableFilters(f, true, [])).toEqual({});
  });
});

describe('keepHiddenCategories', () => {
  const stored = { categoryIds: ['beer', 'coffee'] } as const;
  it('keeps a stored category the pills hide (before me loads, or under 21) through other changes', () => {
    expect(
      keepHiddenCategories({ categoryIds: ['coffee'], openNow: true }, { ...stored, categoryIds: [...stored.categoryIds] }, false),
    ).toEqual({
      categoryIds: ['coffee', 'beer'],
      openNow: true,
    });
    expect(keepHiddenCategories({ categoryIds: ['coffee', 'tea'] }, { categoryIds: ['beer', 'coffee'] }, false)).toEqual({
      categoryIds: ['coffee', 'tea', 'beer'],
    });
    expect(keepHiddenCategories({ priceTiers: [1] }, { categoryIds: ['beer'] }, false)).toEqual({ priceTiers: [1], categoryIds: ['beer'] });
  });

  it('changes nothing when nothing is hidden; Reset and Any category clear it', () => {
    const next = { categoryIds: ['coffee' as const] };
    expect(keepHiddenCategories(next, { categoryIds: ['beer'] }, true)).toBe(next);
    expect(keepHiddenCategories({}, { categoryIds: ['beer'] }, false)).toEqual({});
    expect(keepHiddenCategories({ categoryIds: [] }, { categoryIds: ['beer'] }, false)).toEqual({ categoryIds: [] });
  });
});

describe('sanitiseFilters', () => {
  it('keeps only well-formed values', () => {
    expect(sanitiseFilters(null)).toEqual({});
    expect(sanitiseFilters('x')).toEqual({});
    expect(
      sanitiseFilters({
        categoryIds: ['coffee', 'nope', 3],
        kinds: ['chain', 'mall'],
        priceTiers: [2, 7, '1'],
        neighborhoods: ['Yorkville', '', 4],
        openNow: 'yes',
        extra: true,
      }),
    ).toEqual({ categoryIds: ['coffee'], kinds: ['chain'], priceTiers: [2], neighborhoods: ['Yorkville'] });
    expect(sanitiseFilters({ openNow: true })).toEqual({ openNow: true });
  });
});

describe('the session store', () => {
  const g = globalThis as { sessionStorage?: unknown };
  let saved: unknown;
  let data: Map<string, string>;

  beforeEach(() => {
    saved = g.sessionStorage;
    data = new Map();
    g.sessionStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    useMapFilters.getState().reset();
  });
  afterEach(() => {
    g.sessionStorage = saved;
    useMapFilters.getState().reset();
  });

  it('holds the filters in canonical form and keeps them for the browser session', () => {
    useMapFilters.getState().setFilters({ priceTiers: [2, 1], kinds: [], openNow: true });
    expect(useMapFilters.getState().filters).toEqual({ priceTiers: [1, 2], openNow: true });
    expect(JSON.parse(data.get(MAP_FILTERS_KEY)!)).toEqual({ priceTiers: [1, 2], openNow: true });

    // A reload in the same tab reads them back.
    useMapFilters.setState({ filters: {} });
    reloadMapFiltersForTests();
    expect(useMapFilters.getState().filters).toEqual({ priceTiers: [1, 2], openNow: true });

    useMapFilters.getState().reset();
    expect(data.has(MAP_FILTERS_KEY)).toBe(false);
  });

  it('ignores junk in storage', () => {
    data.set(MAP_FILTERS_KEY, '{not json');
    reloadMapFiltersForTests();
    expect(useMapFilters.getState().filters).toEqual({});
    data.set(MAP_FILTERS_KEY, JSON.stringify({ kinds: ['spaceport'], openNow: true }));
    reloadMapFiltersForTests();
    expect(useMapFilters.getState().filters).toEqual({ openNow: true });
  });
});
