import { describe, expect, it } from 'vitest';
import {
  attributeSimilarity,
  blendUserSimilarity,
  categoryAffinity,
  CF_MIN_COMMON,
  CF_SIGNIFICANCE,
  cosineSimilarity,
  NEIGHBOUR_RELIABILITY_N,
  neighbourReliability,
  pearsonCorrelation,
  pearsonSimilarity,
  sharedAttributeCount,
  significanceWeight,
  TASTE_ALPHA,
  TASTE_BRIDGE_KINDS,
  TASTE_K,
  TASTE_MIN_ATTR_BEVS,
  TASTE_MIN_SHARED_ATTRS,
  TASTE_NEIGHBOUR_K,
  TASTE_SHARED_MIN,
  TASTE_SIM_FLOOR,
  tasteAttributes,
  tasteCatalog,
  tasteVector,
  topUserNeighbours,
  zScoresFromRankings,
  type TasteBev,
} from '../src/index.ts';
import { snapshotContext } from '../src/context.ts';
import { buildSnapshot } from './snapshot-fixture.ts';

// The worked example of docs/graph_db_implementation.md §1 ("Example: 3 users, 6 Bevs"), with the
// brands and flavour bases it lists. U1 and U2 share exactly one ranked Bev (b5), which is why
// today's userSimilarity(U1, U2) is 0 and the attribute bridge is the point of the graph.
const DOC_BEVS: TasteBev[] = [
  { id: 'b1', categoryId: 'soda', brand: 'Coca-Cola', flavorBase: 'cola' },
  { id: 'b2', categoryId: 'soda', brand: 'Pepsi', flavorBase: 'cola' },
  { id: 'b3', categoryId: 'diet_soda', brand: 'Coca-Cola', flavorBase: 'cola' },
  { id: 'b4', categoryId: 'soda', brand: 'Dr Pepper', flavorBase: 'cola' },
  { id: 'b5', categoryId: 'sparkling_water', brand: 'LaCroix', flavorBase: 'lemon-lime' },
  { id: 'b6', categoryId: 'energy', brand: 'Red Bull', flavorBase: 'herbal' },
];
const U1 = { b1: 1.2, b4: 0.6, b5: -1.3 };
const U2 = { b2: 1.1, b3: 0.8, b5: -0.9 };
const U3 = { b4: 1.0, b6: 0.9 };

describe('constants (docs/graph_db_implementation.md)', () => {
  it('are the doc’s values, and the Pearson term shares §8.9’s 2 and 5', () => {
    expect(TASTE_K).toBe(2); // K_T, line 255
    expect(TASTE_MIN_ATTR_BEVS).toBe(2); // line 269
    expect(TASTE_ALPHA).toBe(0.5); // line 264
    expect([TASTE_SHARED_MIN, TASTE_MIN_SHARED_ATTRS]).toEqual([0.2, 2]); // line 274
    expect([TASTE_SIM_FLOOR, TASTE_NEIGHBOUR_K]).toEqual([0.1, 25]); // lines 274–275
    expect(TASTE_BRIDGE_KINDS).toEqual(['brand', 'flavor']); // the candidate query, line 393
    expect([CF_MIN_COMMON, CF_SIGNIFICANCE]).toEqual([2, 5]); // line 261/264 = §8.9
    expect(NEIGHBOUR_RELIABILITY_N).toBe(15); // N₀, chosen (line 419 leaves it open)
  });
});

describe('pearsonCorrelation', () => {
  it.each([
    ['perfect positive', [1, 2, 3], [2, 4, 6], 1],
    ['perfect negative', [1, 2, 3], [3, 2, 1], -1],
    // (1, 0, −1) · (0.5, 0.5, −1) centred: means 0 and 0; Σxy = 1.5, Σx² = 2, Σy² = 1.5 → 1.5/√3 = √3/2.
    ['√3/2', [1, 0, -1], [0.5, 0.5, -1], Math.sqrt(3) / 2],
    // Doc line 130: both users' shared Bevs sit above their own means, in opposite order.
    ['re-centred: above both means, opposite order', [0.5, 1.5], [1.5, 0.5], -1],
    ['two entries are ±1', [0.2, 0.9], [-1, 3], 1],
    ['zero variance on one side', [1, 1, 1], [2, 4, 6], 0],
    ['zero variance on both sides', [0.3, 0.3], [0.7, 0.7], 0],
    ['one entry', [1], [2], 0],
    ['empty', [], [], 0],
  ])('%s', (_name, a, b, expected) => {
    expect(pearsonCorrelation(a, b)).toBeCloseTo(expected, 12);
    expect(pearsonCorrelation(b, a)).toBe(pearsonCorrelation(a, b));
  });

  it('cosine on the same pair says 0.6: the bug Stage 3 fixes', () => {
    // (0.5·1.5 + 1.5·0.5) / (0.25 + 2.25) = 1.5 / 2.5
    expect(cosineSimilarity([0.5, 1.5], [1.5, 0.5])).toBeCloseTo(0.6, 12);
  });

  it('treats exactly equal entries as constant, never as rounding noise', () => {
    // 0.1 + 0.2 ≠ 0.3 in doubles, but a vector of equal doubles is constant however it was made.
    const c = 0.1 + 0.2;
    expect(pearsonCorrelation([c, c, c, c], [1, 2, 3, 4])).toBe(0);
    expect(pearsonCorrelation([1e-12, 1e-12, 1e-12], [1, 2, 3])).toBe(0);
  });

  it('rejects unequal lengths and non-finite entries', () => {
    expect(() => pearsonCorrelation([1, 2], [1])).toThrow(RangeError);
    expect(() => pearsonCorrelation([1, Number.NaN], [1, 2])).toThrow(RangeError);
    expect(() => pearsonCorrelation([Number.POSITIVE_INFINITY], [1])).toThrow(RangeError);
  });
});

describe('significanceWeight = min(1, |common| / 5)', () => {
  it.each([
    [0, 0],
    [1, 0.2],
    [2, 0.4],
    [3, 0.6],
    [5, 1],
    [8, 1],
  ])('|common| = %i → %f', (n, w) => {
    expect(significanceWeight(n)).toBeCloseTo(w, 15);
    expect(significanceWeight(n)).toBe(Math.min(n, CF_SIGNIFICANCE) / CF_SIGNIFICANCE); // §8.9's form, bit for bit
  });
  it('rejects negative and fractional counts', () => {
    expect(() => significanceWeight(-1)).toThrow(RangeError);
    expect(() => significanceWeight(2.5)).toThrow(RangeError);
  });
});

describe('pearsonSimilarity (users, common subset)', () => {
  const zs = (xs: number[], prefix = 'b') => Object.fromEntries(xs.map((x, i) => [`${prefix}${i}`, x]));

  it('identical users: r = 1, full weight at 5 common', () => {
    const u = zs([1.2, -0.4, 0.3, -1.1, 0.7]);
    expect(pearsonSimilarity(u, u)).toEqual({ r: 1, common: 5, sim: 1 });
  });

  it('opposite users: r = −1', () => {
    const u = zs([1.2, -0.4, 0.3, -1.1, 0.7]);
    const v = zs([-1.2, 0.4, -0.3, 1.1, -0.7]);
    expect(pearsonSimilarity(u, v)).toEqual({ r: -1, common: 5, sim: -1 });
  });

  it('fewer than 2 common Bevs: 0', () => {
    expect(pearsonSimilarity({ a: 1, b: 2 }, { a: 3, c: 1 })).toEqual({ r: 0, common: 1, sim: 0 });
    expect(pearsonSimilarity({ a: 1 }, { b: 1 })).toEqual({ r: 0, common: 0, sim: 0 });
    expect(pearsonSimilarity(U1, U2)).toEqual({ r: 0, common: 1, sim: 0 }); // the doc's U1, U2 share only b5
  });

  it('zero variance on the common Bevs: 0, even with other Bevs that vary', () => {
    expect(pearsonSimilarity({ a: 0.4, b: 0.4, c: 0.4, x: -2 }, { a: -1, b: 0.5, c: 1 })).toEqual({ r: 0, common: 3, sim: 0 });
  });

  it.each([
    [1, 0, 0],
    [3, 1, 0.6],
    [5, 1, 1],
    [8, 1, 1],
  ])('shrinkage at %i common Bevs: r = %f, sim = %f', (n, r, sim) => {
    // v = 2u + 0.3 on the common Bevs (perfect correlation), plus Bevs only one of them ranked.
    const base = [0.9, -0.2, 0.4, -1.3, 1.1, 0.05, -0.6, 0.75].slice(0, n);
    const u = { ...zs(base), onlyU: 2 };
    const v = { ...zs(base.map((x) => 2 * x + 0.3)), onlyV: -2 };
    const p = pearsonSimilarity(u, v);
    expect(p.common).toBe(n);
    expect(p.r).toBeCloseTo(r, 12);
    expect(p.sim).toBeCloseTo(sim, 12);
  });

  it('only the common Bevs count, and their order does not matter', () => {
    // Common = b1, b2, b3. u = (1.5, 0.5, 1.0), mean 1 → (0.5, −0.5, 0); v = (1, 0, 1), mean 2/3 →
    // (1/3, −2/3, 1/3). Σ = 1/6 + 1/3 = 0.5; Σu² = 0.5; Σv² = 2/3 → r = 0.5/√(1/3) = √3/2; sim = 0.6·r.
    const u = { b3: 1.0, b1: 1.5, b2: 0.5, b9: -3 };
    const v = { b1: 1.0, b2: 0.0, b3: 1.0, b6: -0.5 };
    const p = pearsonSimilarity(u, v);
    expect(p.common).toBe(3);
    expect(p.r).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(p.sim).toBeCloseTo(0.6 * (Math.sqrt(3) / 2), 12);
    expect(pearsonSimilarity(new Map(Object.entries(u)), new Map(Object.entries(v)))).toEqual(p);
    expect(pearsonSimilarity(v, u)).toEqual(p);
  });
});

describe('tasteAttributes / tasteCatalog', () => {
  it('keys category, normalised brand and flavour base', () => {
    expect(tasteAttributes({ categoryId: 'soda', brand: '  Coca-Cola ', flavorBase: 'cola' })).toEqual(['brand:coca-cola', 'category:soda', 'flavor:cola']);
    expect(tasteAttributes({ categoryId: 'water', brand: null, flavorBase: null })).toEqual(['category:water']);
    expect(tasteAttributes({ categoryId: 'water', brand: ' ', flavorBase: '' })).toEqual(['category:water']);
    expect(() => tasteAttributes({ categoryId: '', brand: null, flavorBase: null })).toThrow(RangeError);
  });

  it('a category and a flavour base with the same name are different attributes', () => {
    const cat = tasteCatalog([
      { id: 'x', categoryId: 'coffee', brand: null, flavorBase: 'coffee' },
      { id: 'y', categoryId: 'coffee', brand: null, flavorBase: 'coffee' },
    ]);
    expect(cat.attributes.get('x')).toEqual(['category:coffee', 'flavor:coffee']);
  });

  it('drops attributes covering fewer than 2 catalog Bevs (doc example)', () => {
    const cat = tasteCatalog(DOC_BEVS);
    // soda covers b1, b2, b4; coke covers b1, b3; cola covers b1–b4. Everything else covers one Bev.
    expect(Object.fromEntries(cat.attributes)).toEqual({
      b1: ['brand:coca-cola', 'category:soda', 'flavor:cola'],
      b2: ['category:soda', 'flavor:cola'],
      b3: ['brand:coca-cola', 'flavor:cola'],
      b4: ['category:soda', 'flavor:cola'],
      b5: [],
      b6: [],
    });
    expect(cat.coverage.get('flavor:cola')).toBe(4);
    expect(cat.coverage.get('brand:pepsi')).toBe(1);
  });

  it('rejects a duplicate Bev', () => {
    expect(() => tasteCatalog([DOC_BEVS[0]!, DOC_BEVS[0]!])).toThrow(RangeError);
  });
});

describe('tasteVector (doc example)', () => {
  const cat = tasteCatalog(DOC_BEVS);

  it('t_u[a] = Σz / (n_{u,a} + 2) over the kept attributes', () => {
    // U1: soda ← b1, b4: (1.2 + 0.6)/4 = 0.45; coke ← b1: 1.2/3 = 0.4; cola ← b1, b4: 0.45. b5 has no kept attribute.
    const t1 = tasteVector(U1, cat);
    expect(Object.keys(t1)).toEqual(['brand:coca-cola', 'category:soda', 'flavor:cola']);
    expect(t1['category:soda']).toBeCloseTo(0.45, 12);
    expect(t1['brand:coca-cola']).toBeCloseTo(0.4, 12);
    expect(t1['flavor:cola']).toBeCloseTo(0.45, 12);
    // U2: soda ← b2: 1.1/3; coke ← b3: 0.8/3; cola ← b2, b3: 1.9/4 = 0.475.
    const t2 = tasteVector(U2, cat);
    expect(t2['category:soda']).toBeCloseTo(1.1 / 3, 12);
    expect(t2['brand:coca-cola']).toBeCloseTo(0.8 / 3, 12);
    expect(t2['flavor:cola']).toBeCloseTo(0.475, 12);
    // U3: soda and cola ← b4: 1/3 each; b6 has no kept attribute.
    expect(tasteVector(U3, cat)).toEqual({ 'category:soda': 1 / 3, 'flavor:cola': 1 / 3 });
  });

  it('a second LaCroix in the catalog puts the shared dislike in both taste vectors', () => {
    const cat7 = tasteCatalog([...DOC_BEVS, { id: 'b7', categoryId: 'sparkling_water', brand: 'LaCroix', flavorBase: 'citrus' }]);
    const t1 = tasteVector(U1, cat7);
    const t2 = tasteVector(U2, cat7);
    expect(t1['brand:lacroix']).toBeCloseTo(-1.3 / 3, 12);
    expect(t2['category:sparkling_water']).toBeCloseTo(-0.3, 12);
    // It moves the cosine, but lacroix does not bridge: both users reach it only through b5, the
    // Bev they co-rated, so it is not a two-hop path. Coke and cola still are.
    expect(sharedAttributeCount({ zu: U1, zv: U2, tu: t1, tv: t2 }, cat7)).toBe(2);
  });

  it('its category entries are categoryAffinity (§8.5, same K = 2)', () => {
    const t1 = tasteVector(U1, cat);
    expect(t1['category:soda']).toBeCloseTo(categoryAffinity([U1.b1, U1.b4]), 15);
  });

  it('ignores Bevs outside the catalog, row order, and the Map/object form', () => {
    expect(tasteVector({ ...U1, gone: 3 }, cat)).toEqual(tasteVector(U1, cat));
    expect(tasteVector({ b5: -1.3, b4: 0.6, b1: 1.2 }, cat)).toEqual(tasteVector(U1, cat));
    expect(tasteVector(new Map(Object.entries(U1)), cat)).toEqual(tasteVector(U1, cat));
    expect(tasteVector({}, cat)).toEqual({});
  });

  it('rejects a non-finite z', () => {
    expect(() => tasteVector({ b1: Number.NaN }, cat)).toThrow(RangeError);
  });
});

describe('attributeSimilarity and sharedAttributeCount', () => {
  const cat = tasteCatalog(DOC_BEVS);
  const [t1, t2, t3] = [U1, U2, U3].map((u) => tasteVector(u, cat)) as [Record<string, number>, Record<string, number>, Record<string, number>];

  it('cosine of the taste vectors', () => {
    // dot = 0.45·(1.1/3) + 0.4·(0.8/3) + 0.45·0.475 = 0.165 + 0.10667 + 0.21375 = 0.48542
    // |t1|² = 0.2025 + 0.16 + 0.2025 = 0.565; |t2|² = 0.13444 + 0.07111 + 0.22563 = 0.43118
    const dot = 0.45 * (1.1 / 3) + 0.4 * (0.8 / 3) + 0.45 * 0.475;
    const n1 = 0.45 ** 2 + 0.4 ** 2 + 0.45 ** 2;
    const n2 = (1.1 / 3) ** 2 + (0.8 / 3) ** 2 + 0.475 ** 2;
    expect(attributeSimilarity(t1, t2)).toBeCloseTo(dot / Math.sqrt(n1 * n2), 12);
    expect(attributeSimilarity(t1, t2)).toBeCloseTo(0.98347, 5);
    // t1 · t3 = (0.45 + 0.45)/3 = 0.3 over √0.565 · √(2/9)
    expect(attributeSimilarity(t1, t3)).toBeCloseTo(0.3 / Math.sqrt(0.565 * (2 / 9)), 12);
  });

  it.each([
    ['identical', { 'flavor:cola': 0.4, 'brand:x': -0.2 }, { 'flavor:cola': 0.4, 'brand:x': -0.2 }, 1],
    ['opposite', { 'flavor:cola': 0.4, 'brand:x': -0.2 }, { 'flavor:cola': -0.4, 'brand:x': 0.2 }, -1],
    ['no attribute in common', { 'flavor:cola': 0.4 }, { 'brand:x': 0.9 }, 0],
    ['a zero vector', { 'flavor:cola': 0 }, { 'flavor:cola': 0.9 }, 0],
    ['empty', {}, { 'flavor:cola': 0.9 }, 0],
    ['scale-free', { a: 0.01, b: 0.02 }, { a: 1, b: 2 }, 1],
  ])('%s', (_name, a, b, expected) => {
    expect(attributeSimilarity(a, b)).toBeCloseTo(expected, 12);
    expect(attributeSimilarity(b, a)).toBe(attributeSimilarity(a, b));
  });

  it('doc example: brand and flavour attributes with |t| ≥ 0.2 on both sides', () => {
    expect(sharedAttributeCount({ zu: U1, zv: U2, tu: t1, tv: t2 }, cat)).toBe(2); // coke (b1 / b3), cola (b1, b4 / b2, b3)
    expect(sharedAttributeCount({ zu: U1, zv: U3, tu: t1, tv: t3 }, cat)).toBe(1); // cola only: U3 has no brand left
  });

  // k1 and k2 share brand X, flavour cola and category soda; k3 and k4 share brand Y and citrus.
  const kCat = tasteCatalog([
    { id: 'k1', categoryId: 'soda', brand: 'X', flavorBase: 'cola' },
    { id: 'k2', categoryId: 'soda', brand: 'X', flavorBase: 'cola' },
    { id: 'k3', categoryId: 'soda', brand: 'Y', flavorBase: 'citrus' },
    { id: 'k4', categoryId: 'soda', brand: 'Y', flavorBase: 'citrus' },
  ]);
  const shared = (zu: Record<string, number>, zv: Record<string, number>) =>
    sharedAttributeCount({ zu, zv, tu: tasteVector(zu, kCat), tv: tasteVector(zv, kCat) }, kCat);

  it.each([
    // t = z/3 for one Bev: 0.9 → 0.3. k1 and k2 are different Bevs, so brand X and cola bridge; soda never does.
    ['the same attributes through two different Bevs (categories never bridge)', { k1: 0.9 }, { k2: 0.9 }, 2],
    // The reviewer's case: both reach brand X and cola only through k1, which they co-rated.
    ['one co-rated Bev is not a bridge', { k1: 1.0 }, { k1: 0.8 }, 0],
    ['a co-rated Bev plus another Bev with the attribute is', { k1: 1.0 }, { k1: 0.8, k2: 0.6 }, 2],
    // (0.5 + 0.3) / 4 = 0.2 exactly; v reaches through k1, u through k1 and k2.
    ['|t| = 0.2 counts, and the signs may differ', { k1: 0.5, k2: 0.3 }, { k1: -0.9 }, 2],
    ['|t| = 0.19 does not', { k1: 0.57 }, { k2: 0.9 }, 0],
    ['different attributes do not bridge', { k1: 0.9 }, { k3: 0.9 }, 0],
  ])('%s', (_name, zu, zv, expected) => {
    expect(shared(zu, zv)).toBe(expected);
    expect(shared(zv, zu)).toBe(expected);
  });
});

describe('blendUserSimilarity', () => {
  const cat = tasteCatalog(DOC_BEVS);
  const pair = (zu: Record<string, number>, zv: Record<string, number>) => ({ zu, zv, tu: tasteVector(zu, cat), tv: tasteVector(zv, cat) });
  const blend = (zu: Record<string, number>, zv: Record<string, number>, opts?: { alpha?: number }) => blendUserSimilarity(pair(zu, zv), cat, opts);

  it('doc example U1–U2: one common Bev, so α = 0 and the attribute bridge is the whole similarity', () => {
    const b = blend(U1, U2);
    expect(b).toMatchObject({ method: 'attr', alpha: 0, common: 1, pearson: 0, pearsonSim: 0, sharedAttrs: 2 });
    expect(b.sim).toBe(b.attribute);
    expect(b.sim).toBeCloseTo(0.98347, 5); // today's userSimilarity(U1, U2) is 0
  });

  it('doc example U1–U3: one shared bridging attribute, so no neighbour', () => {
    const b = blend(U1, U3);
    expect(b).toMatchObject({ method: 'attr', sim: 0, sharedAttrs: 1, attributeSim: 0 });
    expect(b.attribute).toBeGreaterThan(0.8); // the cosine alone would have admitted them
  });

  it('three common Bevs: α = 0.5 blend of shrunk Pearson and the attribute cosine', () => {
    // Pearson as in the pearsonSimilarity table: r = √3/2, sim = 0.6·r = 0.51962.
    // t4: coke ← b1, b3 = 2.5/4 = 0.625; soda ← b1, b2 = 2/4 = 0.5; cola ← b1, b2, b3 = 3/5 = 0.6.
    // t5: coke = 2/4 = 0.5; soda = 1/4 = 0.25; cola = 2/5 = 0.4 (b6's attributes are not kept).
    // cos = (0.3125 + 0.125 + 0.24) / √(1.000625 · 0.4725) = 0.6775 / 0.68760 = 0.98531; coke and cola shared.
    const u4 = { b1: 1.5, b2: 0.5, b3: 1.0 };
    const u5 = { b1: 1.0, b2: 0.0, b3: 1.0, b6: -0.5 };
    const b = blend(u4, u5);
    const cos = 0.6775 / Math.sqrt(1.000625 * 0.4725);
    expect(b).toMatchObject({ method: 'blend', alpha: 0.5, common: 3, sharedAttrs: 2 });
    expect(b.pearson).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(b.pearsonSim).toBeCloseTo(0.6 * (Math.sqrt(3) / 2), 12);
    expect(b.attribute).toBeCloseTo(cos, 12);
    expect(b.sim).toBeCloseTo(0.5 * 0.6 * (Math.sqrt(3) / 2) + 0.5 * cos, 12);
  });

  it('a co-rated pair needs no bridging attributes: the bridge gate is for attribute-only pairs', () => {
    const u = { b1: 1.0, b2: 0.2, b4: -0.5 };
    const v = { b1: 0.8, b2: 0.4, b4: -0.9 };
    const b = blend(u, v);
    expect(b.method).toBe('blend');
    expect(b.sharedAttrs).toBeLessThan(2);
    expect(b.attributeSim).toBe(b.attribute);
    expect(b.sim).toBe(0.5 * b.pearsonSim + 0.5 * b.attribute);
  });

  it('identical users: 1, opposite users: −1, however faint their taste vectors', () => {
    // t: coke 0.625, soda −0.04, cola 0.133: one bridging attribute reaches 0.2, and it doesn't matter.
    const u = { b1: 1.5, b2: -0.5, b3: 1.0, b4: -1.2, b6: 0.4 };
    const v = Object.fromEntries(Object.entries(u).map(([k, x]) => [k, -x]));
    expect(blend(u, u)).toMatchObject({ sim: 1, sharedAttrs: 1, common: 5 });
    expect(blend(u, v).sim).toBe(-1);
  });

  it('zero variance on the common Bevs leaves only the attribute half', () => {
    const u = { b1: 0.8, b2: 0.8, b3: 0.8 };
    const v = { b1: 1.0, b2: 0.2, b3: 1.4 };
    const b = blend(u, v);
    expect(b).toMatchObject({ method: 'blend', pearson: 0, pearsonSim: 0 });
    expect(b.sim).toBe(0.5 * b.attributeSim);
  });

  it('the reviewer’s case: one co-rated Bev carrying a kept brand and flavour is gated out', () => {
    const c = tasteCatalog([
      { id: 'x', categoryId: 'soda', brand: 'Coca-Cola', flavorBase: 'cola' },
      { id: 'y', categoryId: 'soda', brand: 'Coca-Cola', flavorBase: 'cola' },
      { id: 'p', categoryId: 'water', brand: 'LaCroix', flavorBase: 'lime' },
      { id: 'q', categoryId: 'water', brand: 'LaCroix', flavorBase: 'lime' },
    ]);
    const run = (zu: Record<string, number>, zv: Record<string, number>) => blendUserSimilarity({ zu, zv, tu: tasteVector(zu, c), tv: tasteVector(zv, c) }, c);
    const gated = run({ x: 1.0, p: -0.1 }, { x: 0.8, q: 0.05 });
    expect(gated).toMatchObject({ sim: 0, method: 'attr', common: 1, sharedAttrs: 0, attributeSim: 0 });
    expect(gated.attribute).toBeGreaterThan(0.98); // was admitted at ≈ 0.987 before the distinct-Bev rule
    // The same attributes reached through two different Bevs do bridge.
    const bridged = run({ x: 1.0 }, { y: 0.8 });
    expect(bridged).toMatchObject({ method: 'attr', common: 0, sharedAttrs: 2 });
    expect(bridged.sim).toBeCloseTo(1, 12);
  });

  it('alpha = 1 is the Pearson arm, alpha = 0 the attribute arm, and below 2 common α is 0 anyway', () => {
    const u4 = { b1: 1.5, b2: 0.5, b3: 1.0 };
    const u5 = { b1: 1.0, b2: 0.0, b3: 1.0, b6: -0.5 };
    const p = blend(u4, u5, { alpha: 1 });
    expect(p).toMatchObject({ method: 'pearson', alpha: 1 });
    expect(p.sim).toBe(p.pearsonSim);
    const a = blend(u4, u5, { alpha: 0 });
    expect(a).toMatchObject({ method: 'attr', alpha: 0 });
    expect(a.sim).toBe(a.attributeSim);
    expect(blend(U1, U2, { alpha: 1 })).toMatchObject({ method: 'attr', alpha: 0 });
    expect(() => blend(U1, U2, { alpha: 1.5 })).toThrow(RangeError);
    expect(() => blend(U1, U2, { alpha: Number.NaN })).toThrow(RangeError);
  });
});

describe('topUserNeighbours', () => {
  const c = (userId: string, sim: number) => ({ userId, sim });

  it('keeps sim ≥ 0.1 (inclusive), most similar first, ties by userId, at most 25', () => {
    expect(topUserNeighbours([c('c', 0.5), c('a', 0.9), c('low', 0.09), c('edge', 0.1), c('b', 0.5), c('neg', -0.8)]).map((x) => x.userId)).toEqual(['a', 'b', 'c', 'edge']);
    const many = Array.from({ length: 30 }, (_, i) => c(`u${String(i).padStart(2, '0')}`, 0.2 + i / 100));
    const got = topUserNeighbours(many);
    expect(got).toHaveLength(25);
    expect(got[0]?.userId).toBe('u29');
    expect(got[24]?.userId).toBe('u05');
    expect(topUserNeighbours(many, 2).map((x) => x.userId)).toEqual(['u29', 'u28']);
  });

  it('carries the breakdown along and leaves the input untouched', () => {
    const input = [{ userId: 'x', sim: 0.4, method: 'attr' }, c('y', 0.8)];
    const copy = structuredClone(input);
    expect(topUserNeighbours(input)[1]).toEqual({ userId: 'x', sim: 0.4, method: 'attr' });
    expect(input).toEqual(copy);
  });

  it('rejects bad k, a non-finite sim and duplicate users', () => {
    expect(() => topUserNeighbours([], -1)).toThrow(RangeError);
    expect(() => topUserNeighbours([], 1, Number.NaN)).toThrow(RangeError);
    expect(() => topUserNeighbours([c('a', Number.NaN)])).toThrow(RangeError);
    expect(() => topUserNeighbours([c('a', 0.5), c('a', 0.6)])).toThrow(RangeError);
  });
});

describe('neighbourReliability = min(1, n_v / 15)', () => {
  it.each([
    [0, 0],
    [3, 0.2],
    [10, 2 / 3],
    [15, 1],
    [80, 1],
  ])('n_v = %i → %f', (n, r) => {
    expect(neighbourReliability(n)).toBeCloseTo(r, 15);
  });
  it('rejects negative and non-finite counts', () => {
    expect(() => neighbourReliability(-1)).toThrow(RangeError);
    expect(() => neighbourReliability(Number.NaN)).toThrow(RangeError);
  });
});

describe('zScoresFromRankings', () => {
  const rows = [
    { userId: 'u', bevId: 'a', score: 9 },
    { userId: 'u', bevId: 'b', score: 7 },
    { userId: 'u', bevId: 'c', score: 2 },
    { userId: 'v', bevId: 'a', score: 9 },
    { userId: 'v', bevId: 'b', score: 8 },
    { userId: 'v', bevId: 'd', score: 6 },
    { userId: 'w', bevId: 'a', score: 3 },
    { userId: 'w', bevId: 'd', score: 4 },
    { userId: 'x', bevId: 'a', score: 6.5 },
    { userId: 'x', bevId: 'b', score: 6.5 },
    { userId: 'x', bevId: 'c', score: 6.5 },
  ];

  it('equals snapshotContext’s z exactly (own stats from 3 rankings, global below, σ floored)', () => {
    const z = zScoresFromRankings(rows);
    const bevs = ['a', 'b', 'c', 'd'].map((id) => ({ id, categoryId: 'soda', brandKey: null, flavorTokens: [], priceTier: 1 as const, ratingCount: 0, mean: 0, stddev: 0, isAlcoholic: false }));
    const ctx = snapshotContext(buildSnapshot(rows, bevs));
    expect(z).toEqual(ctx.z);
    expect(z.get('x')).toEqual(new Map([['a', 0], ['b', 0], ['c', 0]])); // σ = 0 floored to 1, all at the mean
  });

  it('rejects a duplicated (user, Bev) and a non-finite score', () => {
    expect(() => zScoresFromRankings([rows[0]!, rows[0]!])).toThrow(RangeError);
    expect(() => zScoresFromRankings([{ userId: 'u', bevId: 'a', score: Number.NaN }])).toThrow(RangeError);
  });
});
