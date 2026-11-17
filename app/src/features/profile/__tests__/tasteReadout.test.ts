import type { CategoryId } from '@bevi/shared';

import { TASTE_MIN_GAP, TASTE_MIN_RANKINGS, tasteReadout } from '../tasteReadout';

const row = (categoryId: CategoryId, mean: number, rankingCount = 5) => ({ categoryId, mean, rankingCount });

it('names the thresholds from the paper: 3 rankings and a 1.0 gap', () => {
  expect(TASTE_MIN_RANKINGS).toBe(3);
  expect(TASTE_MIN_GAP).toBe(1);
});

it('says nothing without a pair that qualifies', () => {
  expect(tasteReadout([])).toBeNull();
  expect(tasteReadout([row('coffee', 9)])).toBeNull();
  expect(tasteReadout([row('coffee', 8.1), row('soda', 7.5)])).toBeNull();
});

it('shows a gap of exactly 1.0 and hides 0.99', () => {
  expect(tasteReadout([row('coffee', 8), row('soda', 7)])).toBe('You prefer coffee over soda');
  expect(tasteReadout([row('coffee', 7.99), row('soda', 7)])).toBeNull();
  // 8.1 - 7.1 is 0.9999999999999991 in floating point; the stored means have 3 places.
  expect(tasteReadout([row('coffee', 8.1), row('soda', 7.1)])).toBe('You prefer coffee over soda');
});

it('names two preferred categories, highest first, over the lowest', () => {
  const rows = [row('coffee', 9), row('boba', 8.2), row('tea', 7.4), row('soda', 6.5)];
  expect(tasteReadout(rows)).toBe('You prefer coffee and boba over soda');
});

it('names at most two preferred categories', () => {
  const rows = [row('coffee', 9), row('boba', 8.5), row('tea', 8), row('soda', 5)];
  expect(tasteReadout(rows)).toBe('You prefer coffee and boba over soda');
});

it('names one preferred category when only one clears the gap', () => {
  expect(tasteReadout([row('coffee', 9), row('boba', 7.5), row('soda', 7)])).toBe('You prefer coffee over soda');
  expect(tasteReadout([row('coffee', 9), row('boba', 7.9), row('soda', 7.5)])).toBe('You prefer coffee over soda');
});

it('ignores a category with fewer than 3 rankings, as the best or as the worst', () => {
  expect(tasteReadout([row('coffee', 9, 2), row('soda', 6)])).toBeNull();
  expect(tasteReadout([row('coffee', 9), row('boba', 8.5, 2), row('soda', 7.9)])).toBe('You prefer coffee over soda');
  // The 2-ranking category is the lowest mean, but not the one to compare against.
  expect(tasteReadout([row('coffee', 9), row('boba', 3, 2), row('soda', 8.5)])).toBeNull();
  expect(tasteReadout([row('coffee', 9, TASTE_MIN_RANKINGS), row('soda', 7, TASTE_MIN_RANKINGS)])).toBe('You prefer coffee over soda');
});

it("writes someone else's with their name", () => {
  expect(tasteReadout([row('coffee', 9), row('soda', 7)], 'Sam')).toBe('Sam prefers coffee over soda');
  expect(tasteReadout([row('coffee', 9), row('soda', 8)], 'Sam')).toBe('Sam prefers coffee over soda');
});

it('lowercases the category labels', () => {
  expect(tasteReadout([row('spirits_cocktails', 9), row('sports', 7)])).toBe('You prefer spirits & cocktails over sports drink');
  expect(tasteReadout([row('diet_soda', 9), row('soda', 7)])).toBe('You prefer diet soda over soda');
});

it('does not depend on row order', () => {
  expect(tasteReadout([row('soda', 7), row('coffee', 9)])).toBe('You prefer coffee over soda');
});
