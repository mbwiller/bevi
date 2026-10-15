import { describe, expect, it } from 'vitest';
import {
  contentSimilarity,
  EDGE_MIN_WEIGHT,
  EDGE_TOP_K,
  EDGE_WEIGHTS,
  edgeWeight,
  embeddingSimilarity,
  profileSimilarity,
  PROFILE_WEIGHTS,
  topEdges,
  treeSimilarity,
  type BevFeatures,
  type FlavorProfile,
  type Taxonomy,
} from '../src/index.ts';

// Hand-built inputs for the §10.1 worked example. Profiles are the catalog's labels
// (data/catalog/flavor-profiles.csv); the taxonomy is illustrative until D-04 settles the real one.

const taxonomy: Taxonomy = {
  soda: null,
  cola: 'soda',
  lemon_lime: 'soda',
  water: null,
  sparkling_water: 'water',
  still_water: 'water',
  coffee: null,
  hot_coffee: 'coffee',
  iced_coffee: 'coffee',
  mocha: 'iced_coffee',
};

const features = (o: Partial<BevFeatures>): BevFeatures => ({
  id: 'b',
  categoryId: 'cola',
  brandKey: null,
  flavorTokens: [],
  priceTier: 1,
  ratingCount: 0,
  mean: 0,
  stddev: 0,
  isAlcoholic: false,
  ...o,
});

const profile = (o: Partial<FlavorProfile>): FlavorProfile => ({
  base: 'cola',
  carbonated: true,
  caffeine: 1,
  sweetness: 3,
  dairy: false,
  alcohol: false,
  ...o,
});

const coke = {
  features: features({ id: 'coca-cola', categoryId: 'cola', brandKey: 'Coca-Cola', flavorTokens: ['coca', 'cola'] }),
  profile: profile({}),
  // Unit vectors standing in for gte-small: cos(coke, pepsi) = 0.9, cos(coke, lacroix) = 0.6.
  embedding: [1, 0, 0],
};
const pepsi = {
  features: features({ id: 'pepsi', categoryId: 'cola', brandKey: 'Pepsi', flavorTokens: ['pepsi'] }),
  profile: profile({}),
  embedding: [0.9, Math.sqrt(1 - 0.81), 0],
};
const lacroix = {
  features: features({ id: 'lacroix-lime', categoryId: 'sparkling_water', brandKey: 'LaCroix', flavorTokens: ['lacroix', 'lime'] }),
  profile: profile({ base: 'citrus', caffeine: 0, sweetness: 0 }),
  embedding: [0.6, 0, 0.8],
};

type Bev = typeof coke;
const components = (a: Bev, b: Bev, t: Taxonomy) => ({
  tree: treeSimilarity(a.features.categoryId, b.features.categoryId, t),
  content: contentSimilarity(a.features, b.features),
  emb: embeddingSimilarity(a.embedding, b.embedding),
  profile: profileSimilarity(a.profile, b.profile),
});

describe('§10.1 worked example', () => {
  it('Coca-Cola and Pepsi: tree 1, content 0.5, emb 0.9, profile 1, w ≈ 0.90 ≥ 0.8', () => {
    const c = components(coke, pepsi, taxonomy);
    expect(c.tree).toBe(1);
    expect(c.content).toBeCloseTo(0.5, 12);
    expect(c.emb).toBeCloseTo(0.9, 12);
    expect(c.profile).toBe(1);
    const w = edgeWeight(c);
    expect(w).toBeCloseTo(0.25 + 0.075 + 0.27 + 0.3, 12);
    expect(w).toBeGreaterThanOrEqual(0.8);
  });

  it('Coca-Cola and a sparkling water: every term falls and w < 0.4', () => {
    for (const t of [taxonomy, {}]) {
      const c = components(coke, lacroix, t);
      expect(c.tree).toBe(0);
      expect(c.content).toBeCloseTo(0.1, 12); // price tier only
      expect(c.emb).toBeCloseTo(0.6, 12);
      expect(c.profile).toBeCloseTo(0.4, 15); // carbonation, dairy, alcohol, caffeine 1 vs 0
      expect(edgeWeight(c)).toBeCloseTo(0.015 + 0.18 + 0.12, 12);
      expect(edgeWeight(c)).toBeLessThan(0.4);
    }
  });

  it('Coca-Cola and a sparkling water stay below 0.4 for any embedding up to 0.88', () => {
    const c = components(coke, lacroix, taxonomy);
    expect(edgeWeight({ ...c, emb: 0.88 })).toBeLessThan(0.4);
    expect(edgeWeight({ ...c, emb: 0.89 })).toBeGreaterThan(0.4);
  });

  it('content alone would have put the colas at 0.5', () => {
    expect(contentSimilarity(coke.features, pepsi.features)).toBeCloseTo(0.5, 12);
  });
});

describe('treeSimilarity (Wu–Palmer, eq. 16)', () => {
  it.each([
    ['same leaf', 'cola', 'cola', 1],
    ['same top-level category', 'soda', 'soda', 1],
    ['siblings under one parent', 'cola', 'lemon_lime', 0.5],
    ['leaf and its parent', 'cola', 'soda', 2 / 3],
    ['depth 3 and depth 2 under one root', 'mocha', 'hot_coffee', 2 / 5],
    ['depth 3 and its grandparent', 'mocha', 'coffee', 2 / 4],
    ['different top-level trees', 'cola', 'sparkling_water', 0],
    ['different top-level categories', 'soda', 'water', 0],
    ['unknown category is top-level', 'kombucha', 'cola', 0],
    ['same unknown category', 'kombucha', 'kombucha', 1],
  ])('%s', (_name, a, b, expected) => {
    expect(treeSimilarity(a, b, taxonomy)).toBeCloseTo(expected, 15);
    expect(treeSimilarity(b, a, taxonomy)).toBe(treeSimilarity(a, b, taxonomy));
  });

  it('with a flat taxonomy it is the [same category] indicator of eq. 5', () => {
    expect(treeSimilarity('soda', 'soda', {})).toBe(1);
    expect(treeSimilarity('soda', 'water', {})).toBe(0);
    expect(treeSimilarity('soda', 'water', { soda: null, water: null })).toBe(0);
  });

  it('a parent outside the map is a top-level category', () => {
    expect(treeSimilarity('cola', 'lemon_lime', { cola: 'soda', lemon_lime: 'soda' })).toBe(0.5);
  });

  it('rejects a cycle', () => {
    expect(() => treeSimilarity('a', 'b', { a: 'b', b: 'a' })).toThrow(RangeError);
    expect(() => treeSimilarity('a', 'a', { a: 'a' })).toThrow(RangeError);
  });

  it('ignores inherited object keys', () => {
    expect(treeSimilarity('constructor', 'toString', {})).toBe(0);
  });
});

describe('profileSimilarity (eq. 17)', () => {
  const latte = profile({ base: 'coffee', carbonated: false, caffeine: 2, sweetness: 1, dairy: true });
  const ipa = profile({ base: 'hop', carbonated: true, caffeine: 0, sweetness: 0, alcohol: true });

  it.each([
    ['identical colas', profile({}), profile({}), 1],
    ['Coca-Cola and LaCroix Lime', coke.profile, lacroix.profile, 0.15 + 0.1 + 0.05 + 0.15 * (2 / 3)],
    ['caffeine one level apart', profile({ caffeine: 1 }), profile({ caffeine: 2 }), 1 - 0.05],
    ['sweetness three levels apart', profile({ sweetness: 3 }), profile({ sweetness: 0 }), 1 - 0.15],
    ['only the base differs', profile({}), profile({ base: 'citrus' }), 0.6],
    ['only dairy differs', profile({}), profile({ dairy: true }), 0.9],
    ['only alcohol differs', profile({}), profile({ alcohol: true }), 0.95],
    ['only carbonation differs', profile({}), profile({ carbonated: false }), 0.85],
    ['latte and Coca-Cola', latte, coke.profile, 0.05 + 0.15 * (2 / 3) + 0.15 * (1 / 3)],
    ['IPA and latte', ipa, latte, 0.15 * (1 / 3) + 0.15 * (2 / 3)],
    [
      'nothing in common',
      profile({ base: 'cola', carbonated: true, caffeine: 3, sweetness: 3, dairy: true, alcohol: true }),
      profile({ base: 'tea', carbonated: false, caffeine: 0, sweetness: 0, dairy: false, alcohol: false }),
      0,
    ],
  ])('%s', (_name, a, b, expected) => {
    expect(profileSimilarity(a, b)).toBeCloseTo(expected, 15);
    expect(profileSimilarity(b, a)).toBe(profileSimilarity(a, b));
  });

  it('weights sum to 1', () => {
    const sum = Object.values(PROFILE_WEIGHTS).reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(1, 15);
  });

  it('ignores serve and source', () => {
    const a = { ...profile({}), serve: 'cold', source: 'catalog' };
    const b = { ...profile({}), serve: 'hot', source: 'inferred' };
    expect(profileSimilarity(a, b)).toBe(1);
  });

  it('rejects levels outside 0..3', () => {
    expect(() => profileSimilarity(profile({ caffeine: 4 as 3 }), profile({}))).toThrow(RangeError);
    expect(() => profileSimilarity(profile({}), profile({ sweetness: 1.5 as 1 }))).toThrow(RangeError);
    expect(() => profileSimilarity(profile({ sweetness: -1 as 0 }), profile({}))).toThrow(RangeError);
  });
});

describe('embeddingSimilarity (cosine clamped at 0)', () => {
  it.each([
    ['identical', [0.6, 0.8], [0.6, 0.8], 1],
    ['orthogonal', [1, 0], [0, 1], 0],
    ['opposite is clamped to 0', [1, 0], [-1, 0], 0],
    ['negative cosine is clamped to 0', [1, 0], [-0.6, 0.8], 0],
    ['unnormalised vectors: the norms cancel', [2, 0], [3, 3], Math.SQRT1_2],
    ['unit vectors: the dot product', [0.6, 0.8], [0.8, 0.6], 0.96],
    ['a zero vector', [0, 0], [1, 0], 0],
    ['two zero vectors', [0, 0], [0, 0], 0],
    ['empty vectors', [], [], 0],
  ])('%s', (_name, a, b, expected) => {
    expect(embeddingSimilarity(a, b)).toBeCloseTo(expected, 12);
  });

  it('rejects mismatched lengths and non-finite values', () => {
    expect(() => embeddingSimilarity([1, 0], [1])).toThrow(RangeError);
    expect(() => embeddingSimilarity([Number.NaN, 0], [1, 0])).toThrow(RangeError);
    expect(() => embeddingSimilarity([Number.POSITIVE_INFINITY, 0], [1, 0])).toThrow(RangeError);
  });

  it('works at 384 dimensions', () => {
    const e = Array.from({ length: 384 }, (_, i) => Math.sin(i + 1));
    expect(embeddingSimilarity(e, e)).toBe(1);
  });
});

describe('edgeWeight (eq. 18)', () => {
  it('EDGE_WEIGHTS are (0.25, 0.15, 0.30, 0.30, 0) and sum to 1', () => {
    expect(EDGE_WEIGHTS).toEqual({ tree: 0.25, content: 0.15, emb: 0.3, profile: 0.3, cop: 0 });
    expect(Object.values(EDGE_WEIGHTS).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 15);
  });

  it.each([
    ['all zero', { tree: 0, content: 0, emb: 0, profile: 0 }, 0],
    ['all one', { tree: 1, content: 1, emb: 1, profile: 1, cop: 1 }, 1],
    ['tree only', { tree: 1, content: 0, emb: 0, profile: 0 }, 0.25],
    ['content only', { tree: 0, content: 1, emb: 0, profile: 0 }, 0.15],
    ['embedding only', { tree: 0, content: 0, emb: 1, profile: 0 }, 0.3],
    ['profile only', { tree: 0, content: 0, emb: 0, profile: 1 }, 0.3],
    ['co-preference is off in v1 (γ = 0)', { tree: 0, content: 0, emb: 0, profile: 0, cop: 1 }, 0],
  ])('%s', (_name, c, expected) => {
    expect(edgeWeight(c)).toBeCloseTo(expected, 15);
  });

  it('rejects components outside [0, 1]', () => {
    const ok = { tree: 0.5, content: 0.5, emb: 0.5, profile: 0.5 };
    for (const key of ['tree', 'content', 'emb', 'profile', 'cop'] as const) {
      expect(() => edgeWeight({ ...ok, [key]: 1.01 })).toThrow(RangeError);
      expect(() => edgeWeight({ ...ok, [key]: -0.01 })).toThrow(RangeError);
      expect(() => edgeWeight({ ...ok, [key]: Number.NaN })).toThrow(RangeError);
    }
  });
});

describe('topEdges', () => {
  const e = (bevId: string, w: number) => ({ bevId, w });

  it('keeps w ≥ min (inclusive), heaviest first, ties by bevId', () => {
    const got = topEdges([e('c', 0.5), e('a', 0.9), e('low', 0.29), e('edge', 0.3), e('b', 0.5)]);
    expect(got.map((x) => x.bevId)).toEqual(['a', 'b', 'c', 'edge']);
  });

  it('caps at k and defaults to K_E = 20, min 0.3', () => {
    expect(EDGE_TOP_K).toBe(20);
    expect(EDGE_MIN_WEIGHT).toBe(0.3);
    const many = Array.from({ length: 25 }, (_, i) => e(`b${String(i).padStart(2, '0')}`, 0.4 + i / 100));
    const got = topEdges(many);
    expect(got).toHaveLength(20);
    expect(got[0]?.bevId).toBe('b24');
    expect(got[19]?.bevId).toBe('b05');
    expect(topEdges(many, 3).map((x) => x.bevId)).toEqual(['b24', 'b23', 'b22']);
    expect(topEdges(many, 0)).toEqual([]);
    expect(topEdges(many, 50, 0.6).map((x) => x.bevId)).toEqual(['b24', 'b23', 'b22', 'b21', 'b20']);
  });

  it('carries extra fields and leaves the input untouched', () => {
    const input = [e('x', 0.4), { bevId: 'y', w: 0.8, tree: 1 }];
    const copy = structuredClone(input);
    const got = topEdges(input);
    expect(got[0]).toEqual({ bevId: 'y', w: 0.8, tree: 1 });
    expect(input).toEqual(copy);
  });

  it('rejects bad k, non-finite weights and duplicate Bevs', () => {
    expect(() => topEdges([], -1)).toThrow(RangeError);
    expect(() => topEdges([], 1.5)).toThrow(RangeError);
    expect(() => topEdges([], 20, Number.NaN)).toThrow(RangeError);
    expect(() => topEdges([e('a', Number.NaN)])).toThrow(RangeError);
    expect(() => topEdges([e('a', 0.5), e('a', 0.6)])).toThrow(RangeError);
  });
});
