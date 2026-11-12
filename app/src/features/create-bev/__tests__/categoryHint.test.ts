import type { BevSummary, CategoryId } from '@bevi/shared';

import { CATEGORIES, visibleCategories } from '@/lib/categories';

import { suggestCategory } from '../categoryHint';

const all = CATEGORIES;
const minor = visibleCategories(false);

let n = 0;
const bev = (name: string, categoryId: CategoryId) => ({ id: `b${++n}`, name, categoryId }) as BevSummary;

const redBull = [
  bev('Red Bull', 'sports'),
  bev('Red Bull Original', 'energy'),
  bev('Red Bull Watermelon', 'energy'),
  bev('Red Bull Tropical', 'energy'),
  bev('Red Bull Sugarfree', 'energy'),
];

describe('suggestCategory', () => {
  it('suggests the category most matches share when the chosen one differs (the Red Bull incident)', () => {
    expect(suggestCategory(redBull, 'sports', all)).toBe('energy');
  });

  it('suggests it when nothing is chosen yet', () => {
    expect(suggestCategory(redBull, null, all)).toBe('energy');
  });

  it('is null once the chosen category is the suggested one', () => {
    expect(suggestCategory(redBull, 'energy', all)).toBeNull();
  });

  it('is null when only one match is in the top category', () => {
    expect(suggestCategory([bev('A', 'energy'), bev('B', 'soda'), bev('C', 'tea')], 'sports', all)).toBeNull();
    expect(suggestCategory([bev('A', 'energy')], null, all)).toBeNull();
  });

  it('is null with no matches', () => {
    expect(suggestCategory([], 'sports', all)).toBeNull();
  });

  it('breaks a tie toward the category that appears first in the matches', () => {
    const matches = [bev('A', 'soda'), bev('B', 'energy'), bev('C', 'energy'), bev('D', 'soda')];
    expect(suggestCategory(matches, null, all)).toBe('soda');
    expect(suggestCategory([...matches].reverse(), null, all)).toBe('soda'); // D(soda) first now
    expect(suggestCategory([bev('A', 'energy'), bev('B', 'soda'), bev('C', 'soda'), bev('D', 'energy')], null, all)).toBe('energy');
  });

  it('ignores categories the user cannot see (alcohol for a minor)', () => {
    const matches = [bev('A', 'beer'), bev('B', 'beer'), bev('C', 'beer'), bev('D', 'soda'), bev('E', 'soda')];
    expect(suggestCategory(matches, 'tea', all)).toBe('beer');
    expect(suggestCategory(matches, 'tea', minor)).toBe('soda');
    expect(suggestCategory([bev('A', 'beer'), bev('B', 'beer'), bev('C', 'soda')], 'tea', minor)).toBeNull();
  });

  it('is null when the chosen category has as many matches as the top one, or more', () => {
    // 2 sports vs 2 energy, energy first: the chosen category holds its own.
    expect(suggestCategory([bev('A', 'energy'), bev('B', 'sports'), bev('C', 'energy'), bev('D', 'sports')], 'sports', all)).toBeNull();
    // Chosen is the more common one.
    expect(suggestCategory([bev('A', 'energy'), bev('B', 'sports'), bev('C', 'sports'), bev('D', 'sports'), bev('E', 'energy')], 'sports', all)).toBeNull();
  });
});
