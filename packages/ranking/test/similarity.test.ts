import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { contentSimilarity, flavorTokens, jaccard, normaliseBrand, type BevFeatures } from '../src/index.ts';

const bev = (o: Partial<BevFeatures>): BevFeatures => ({
  id: 'b',
  categoryId: 'soda',
  brandKey: null,
  flavorTokens: [],
  priceTier: 1,
  ratingCount: 0,
  mean: 0,
  stddev: 0,
  isAlcoholic: false,
  ...o,
});

describe('flavorTokens', () => {
  it('lowercases, drops stopwords and sizes', () => {
    expect(flavorTokens('Coca-Cola Classic 12oz Can', null)).toEqual(['coca', 'cola']);
    expect(flavorTokens('LaCroix', 'Pamplemousse')).toEqual(['lacroix', 'pamplemousse']);
    expect(flavorTokens("Dr Pepper's Original 2L Bottle", 'Cherry')).toEqual(['cherry', 'dr', 'peppers']);
    expect(flavorTokens('Topo Chico 500 ml', 'Lime Lime')).toEqual(['chico', 'lime', 'topo']);
  });
});

describe('normaliseBrand / jaccard', () => {
  it('normalises', () => {
    expect(normaliseBrand('  Coca  Cola ')).toBe('coca cola');
    expect(normaliseBrand('  ')).toBeNull();
    expect(normaliseBrand(null)).toBeNull();
  });
  it('jaccard', () => {
    expect(jaccard([], [])).toBe(0);
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 12);
  });
});

describe('contentSimilarity', () => {
  it('weights 0.40 / 0.30 / 0.20 / 0.10', () => {
    const coke = bev({ categoryId: 'soda', brandKey: 'coca cola', flavorTokens: ['coke'], priceTier: 1 });
    expect(contentSimilarity(coke, coke)).toBeCloseTo(1, 12);
    const dietCoke = bev({ categoryId: 'diet_soda', brandKey: 'Coca Cola', flavorTokens: ['coke', 'diet'], priceTier: 1 });
    expect(contentSimilarity(coke, dietCoke)).toBeCloseTo(0.3 + 0.2 * 0.5 + 0.1, 12);
    const water = bev({ categoryId: 'water', brandKey: null, flavorTokens: [], priceTier: 4 });
    expect(contentSimilarity(coke, water)).toBe(0);
    const noBrand = bev({ brandKey: null });
    expect(contentSimilarity(noBrand, noBrand)).toBeCloseTo(0.4 + 0.1, 12); // missing brands never match
  });

  it('is symmetric and in [0, 1]', () => {
    const arb = fc.record({
      categoryId: fc.constantFrom('soda', 'water', 'energy'),
      brandKey: fc.option(fc.constantFrom('coke', 'pepsi', '')),
      flavorTokens: fc.uniqueArray(fc.constantFrom('lime', 'cherry', 'cola', 'diet'), { maxLength: 4 }),
      priceTier: fc.constantFrom(1, 2, 3, 4) as fc.Arbitrary<1 | 2 | 3 | 4>,
    });
    fc.assert(
      fc.property(arb, arb, (a, b) => {
        const x = contentSimilarity(bev(a), bev(b));
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1 + 1e-12);
        expect(x).toBeCloseTo(contentSimilarity(bev(b), bev(a)), 12);
      }),
    );
  });
});
