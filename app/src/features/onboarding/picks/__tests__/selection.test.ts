import { MAX_CATEGORY_PICKS, type BevSummary, type CategoryId } from '@bevi/shared';

import { helperLine } from '../copy';
import { artBevsByCategory, pickableCategories, prefillPicks, rankOf, togglePick } from '../selection';

function bev(id: string, categoryId: CategoryId, ratingCount: number, name = id): BevSummary {
  return {
    id,
    name,
    brand: null,
    flavor: null,
    categoryId,
    photoUrl: null,
    iconUrl: null,
    iconLabelBand: null,
    photoStatus: 'ready',
    priceTier: 1,
    priceEstimated: false,
    ratingCount,
    bayesScore: null,
  };
}

describe('togglePick', () => {
  it('appends an unpicked category: it gets the next number', () => {
    let picks: readonly CategoryId[] = [];
    picks = togglePick(picks, 'coffee');
    picks = togglePick(picks, 'tea');
    expect(picks).toEqual(['coffee', 'tea']);
    expect(rankOf(picks, 'coffee')).toBe(1);
    expect(rankOf(picks, 'tea')).toBe(2);
    expect(rankOf(picks, 'boba')).toBeUndefined();
  });

  it('removes a picked one, and the later picks move up one', () => {
    const picks = togglePick(['coffee', 'tea', 'boba'], 'coffee');
    expect(picks).toEqual(['tea', 'boba']);
    expect(rankOf(picks, 'tea')).toBe(1);
    expect(rankOf(picks, 'boba')).toBe(2);
    expect(togglePick(['coffee', 'tea', 'boba'], 'tea')).toEqual(['coffee', 'boba']);
  });

  it('stops at MAX_CATEGORY_PICKS: a fourth tap returns the same list', () => {
    expect(MAX_CATEGORY_PICKS).toBe(3);
    const full: readonly CategoryId[] = ['coffee', 'tea', 'boba'];
    expect(togglePick(full, 'soda')).toBe(full);
    // Room again once one is dropped; the newcomer goes last.
    expect(togglePick(togglePick(full, 'tea'), 'soda')).toEqual(['coffee', 'boba', 'soda']);
  });
});

describe('prefillPicks', () => {
  const offered = pickableCategories(false).map((c) => c.id);

  it('keeps the saved order', () => {
    expect(prefillPicks(['tea', 'coffee'], offered)).toEqual(['tea', 'coffee']);
  });

  it('drops a saved category that is not offered now, and the rest move up', () => {
    expect(prefillPicks(['wine', 'tea', 'other'], offered)).toEqual(['tea']);
    expect(prefillPicks(['wine', 'tea'], pickableCategories(true).map((c) => c.id))).toEqual(['wine', 'tea']);
  });

  it('never repeats one or goes past the cap', () => {
    expect(prefillPicks(['tea', 'tea', 'soda', 'juice', 'coffee'], offered)).toEqual(['tea', 'soda', 'juice']);
    expect(prefillPicks([], offered)).toEqual([]);
  });
});

it('offers every visible category but Other: 14 for 21+, 11 otherwise', () => {
  const adult = pickableCategories(true).map((c) => c.id);
  const minor = pickableCategories(false).map((c) => c.id);
  expect(adult).toHaveLength(14);
  expect(minor).toHaveLength(11);
  expect(adult).not.toContain('other');
  expect(minor).not.toContain('other');
  expect(adult).toEqual(expect.arrayContaining(['beer', 'wine', 'spirits_cocktails']));
  expect(minor.some((id) => ['beer', 'wine', 'spirits_cocktails'].includes(id))).toBe(false);
});

it("picks each category's art: the most-rated starter, then name, then id", () => {
  const art = artBevsByCategory([
    bev('c2', 'coffee', 10, 'Latte'),
    bev('c1', 'coffee', 40, 'Cold Brew'),
    bev('t2', 'tea', 7, 'Matcha'),
    bev('t1', 'tea', 7, 'Chai'),
    bev('s2', 'soda', 3, 'Cola'),
    bev('s1', 'soda', 3, 'Cola'),
  ]);
  expect(art.get('coffee')!.id).toBe('c1');
  expect(art.get('tea')!.id).toBe('t1');
  expect(art.get('soda')!.id).toBe('s1');
  expect(art.has('boba')).toBe(false);
  expect(artBevsByCategory([]).size).toBe(0);
});

it('the helper line says what to do at each count', () => {
  expect(helperLine(0)).toBe('Tap your number 1 first.');
  expect(helperLine(1)).toBe('Pick up to 2 more, or continue.');
  expect(helperLine(2)).toBe('Pick 1 more, or continue.');
  expect(helperLine(3)).toBe("That's your 3. Tap one to swap it out.");
});
