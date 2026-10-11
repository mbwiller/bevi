import * as ranking from '@bevi/ranking';
import type { BevSummary, CategoryId } from '@bevi/shared';

import { ALCOHOLIC_CATEGORY_IDS, hasMoreStarters, selectStarterRound, starterSeed } from '../selection';

jest.mock('@bevi/ranking', () => {
  const actual = jest.requireActual('@bevi/ranking');
  return { ...actual, selectStarterSet: jest.fn(actual.selectStarterSet) };
});

const CATS: CategoryId[] = ['soda', 'diet_soda', 'juice', 'water', 'energy', 'coffee', 'tea', 'beer', 'wine', 'spirits_cocktails'];

function bev(i: number): BevSummary {
  return {
    id: `b${String(i).padStart(2, '0')}`,
    name: `Bev ${i}`,
    brand: null,
    flavor: null,
    categoryId: CATS[i % CATS.length]!,
    photoUrl: null,
    photoStatus: 'ready',
    priceTier: 1,
    priceEstimated: false,
    ratingCount: 100 - i,
    bayesScore: null,
  } as BevSummary;
}

const candidates = Array.from({ length: 30 }, (_, i) => bev(i));
const select = ranking.selectStarterSet as jest.MockedFunction<typeof ranking.selectStarterSet>;

beforeEach(() => select.mockClear());

it('seeds selectStarterSet with the user id and excludes alcoholic categories under 21', () => {
  const ids = selectStarterRound(candidates, { id: 'user-1', canSeeAlcohol: false }, 0);
  expect(select).toHaveBeenCalledWith(candidates, { seed: 'user-1', excludeCategoryIds: [...ALCOHOLIC_CATEGORY_IDS] });
  expect(ALCOHOLIC_CATEGORY_IDS).toEqual(['beer', 'wine', 'spirits_cocktails']);
  expect(ids).toHaveLength(10);
  const alcoholic = new Set<string>(ALCOHOLIC_CATEGORY_IDS);
  expect(ids.every((id) => !alcoholic.has(candidates.find((c) => c.id === id)!.categoryId))).toBe(true);
  // Deterministic for the user: the same 10 on a second visit.
  expect(selectStarterRound(candidates, { id: 'user-1', canSeeAlcohol: false }, 0)).toEqual(ids);
});

it('keeps alcoholic categories for 21+', () => {
  selectStarterRound(candidates, { id: 'user-1', canSeeAlcohol: true }, 0);
  expect(select).toHaveBeenCalledWith(candidates, { seed: 'user-1', excludeCategoryIds: undefined });
});

it('later rounds use a new seed over the Bevs not shown yet', () => {
  const me = { id: 'user-1', canSeeAlcohol: false };
  const first = selectStarterRound(candidates, me, 0);
  const seen = new Set(first);
  const second = selectStarterRound(candidates, me, 1, seen);
  expect(starterSeed('user-1', 1)).not.toBe('user-1');
  expect(select.mock.calls[1]![1].seed).toBe(starterSeed('user-1', 1));
  expect(second.some((id) => seen.has(id))).toBe(false);
  expect(second.length).toBeGreaterThan(0);
  const all = new Set([...first, ...second]);
  expect(hasMoreStarters(candidates, me, all)).toBe(true);
  for (const id of selectStarterRound(candidates, me, 2, all)) all.add(id);
  // 21 non-alcoholic candidates: three rounds show them all.
  expect(all.size).toBe(21);
  expect(hasMoreStarters(candidates, me, all)).toBe(false);
  expect(hasMoreStarters(candidates, { canSeeAlcohol: true }, all)).toBe(true);
});
