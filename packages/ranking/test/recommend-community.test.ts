// recommend() with diversity / exploration 'community' (1.8.0, LaTeX §7; off by default). Table tests
// on small hand-built snapshots. `community` in `bevGraph` is the Bev's taste family.
import { describe, expect, it } from 'vitest';
import {
  createPrng,
  DIVERSITY_PENALTY,
  diversifyByCommunity,
  effectiveDiversity,
  effectiveExploration,
  EXPLORE_BRIDGE_WEIGHT,
  explorationSlots,
  gaussian,
  globalScore,
  JITTER_SD,
  predictScore,
  RANKING_CONSTANTS,
  recommend,
  type BevFeatures,
  type BevGraphStats,
  type PredictionSnapshot,
  type RecommendOptions,
} from '../src/index.ts';
import { bevGraphLookup, communityKeyOf } from '../src/context.ts';
import { buildSnapshot, syntheticSnapshot } from './snapshot-fixture.ts';

const bev = (id: string, categoryId: string, brandKey: string | null, flavorTokens: string[]): BevFeatures => ({
  id,
  categoryId,
  brandKey,
  flavorTokens,
  priceTier: 2,
  ratingCount: 0,
  mean: 0,
  stddev: 0,
  isAlcoholic: false,
});
const node = (community: string, bridge = 0, pagerank = 0.01): BevGraphStats => ({ community, pagerank, bridge });
const ids = (recs: ReturnType<typeof recommend>) => recs.map((r) => r.bevId);

// ---------------------------------------------------------------- the cola lover
// u loves colas and is lukewarm on tea; three other users love tea and berry waters and are lukewarm
// on the candidate colas. The candidates: four colas (one taste family across two brands), two teas,
// two berry waters.
const colaBevs = [
  bev('r-coke', 'soda', 'coke', ['cola']),
  bev('r-pepsi', 'soda', 'pepsi', ['cola']),
  bev('r-rc', 'soda', 'rc', ['cola']),
  bev('r-cherry', 'soda', 'coke', ['cherry', 'cola']),
  bev('r-tea', 'tea', 'lipton', ['lemon']),
  bev('r-ginger', 'soda', 'canada', ['ginger']),
  bev('r-energy', 'energy', 'redbull', ['taurine']),
  bev('r-energy2', 'energy', 'monster', ['taurine']),
  bev('cola-1', 'soda', 'coke', ['cola', 'vanilla']),
  bev('cola-2', 'soda', 'pepsi', ['cola', 'lime']),
  bev('cola-3', 'soda', 'rc', ['cola', 'lime']),
  bev('cola-4', 'soda', 'pepsi', ['cola', 'vanilla']),
  bev('tea-1', 'tea', 'lipton', ['peach']),
  bev('tea-2', 'tea', 'arizona', ['lemon']),
  bev('ber-1', 'sparkling_water', 'lacroix', ['berry']),
  bev('ber-2', 'sparkling_water', 'bubly', ['berry']),
];
const r = (userId: string, bevId: string, score: number) => ({ userId, bevId, score });
const colaRankings = [
  r('u', 'r-coke', 9.8),
  r('u', 'r-pepsi', 9.4),
  r('u', 'r-rc', 9.0),
  r('u', 'r-cherry', 8.6),
  r('u', 'r-tea', 6.5),
  r('u', 'r-ginger', 3),
  r('u', 'r-energy', 2),
  r('u', 'r-energy2', 1.5),
  ...['v1', 'v2', 'v3'].flatMap((v) => [
    r(v, 'tea-1', 9),
    r(v, 'tea-2', 8.8),
    r(v, 'ber-1', 8.5),
    r(v, 'ber-2', 8.2),
    r(v, 'cola-1', 6),
    r(v, 'cola-2', 5.5),
    r(v, 'cola-3', 5),
    r(v, 'cola-4', 4.5),
    r(v, 'r-energy', 2),
  ]),
];
const colaPlain = buildSnapshot(colaRankings, colaBevs);
const family = (id: string): string => (id.includes('cola') || ['r-coke', 'r-pepsi', 'r-rc', 'r-cherry'].includes(id) ? 'COLA' : id.includes('tea') ? 'TEA' : id.includes('ber') ? 'BERRY' : id.includes('energy') ? 'ENERGY' : 'GINGER');
const colaGraph: Record<string, BevGraphStats> = Object.fromEntries(colaBevs.map((b) => [b.id, node(family(b.id))]));
const cola: PredictionSnapshot = { ...colaPlain, bevGraph: colaGraph };
const COLA_CANDIDATES = ['ber-1', 'ber-2', 'cola-1', 'cola-2', 'cola-3', 'cola-4', 'tea-1', 'tea-2'];

/** recommend()'s jittered ẑ, replicated: one gaussian per candidate in bevId order. */
function jitteredOf(s: PredictionSnapshot, user: string, candidates: readonly string[], seed: string): Map<string, number> {
  const rand = createPrng(seed);
  return new Map(candidates.map((b) => [b, predictScore(s, user, b).z + gaussian(rand, JITTER_SD)]));
}

describe('constants', () => {
  it('ship in RANKING_CONSTANTS', () => {
    expect(DIVERSITY_PENALTY).toBe(0.2);
    expect(EXPLORE_BRIDGE_WEIGHT).toBe(1);
    expect(RANKING_CONSTANTS.diversityPenalty).toBe(0.2);
    expect(RANKING_CONSTANTS.exploreBridgeWeight).toBe(1);
  });
});

describe('diversifyByCommunity (the greedy, hand arithmetic)', () => {
  const items = [
    { id: 'cola-a', z: 1.0, community: 'C' },
    { id: 'cola-b', z: 0.95, community: 'C' },
    { id: 'cola-c', z: 0.9, community: 'C' },
    { id: 'cola-d', z: 0.85, community: 'C' },
    { id: 'tea-a', z: 0.8, community: 'T' },
    { id: 'tea-b', z: 0.5, community: 'T' },
    { id: 'berry-a', z: 0.7, community: 'B' },
  ];
  it('interleaves the families: the worked example', () => {
    // 1: cola-a 1.00 (nothing taken yet).
    // 2: cola-b 0.95 − 0.2 = 0.75 < tea-a 0.80 → tea-a.
    // 3: cola-b 0.75, tea-b 0.50 − 0.2 = 0.30, berry-a 0.70 → cola-b.
    // 4: cola-c 0.90 − 0.4 = 0.50, tea-b 0.30, berry-a 0.70 → berry-a.
    // 5: cola-c 0.50, tea-b 0.30 → cola-c.
    // 6: cola-d 0.85 − 0.6 = 0.25 < tea-b 0.30 → tea-b.   7: cola-d.
    expect(diversifyByCommunity(items, 7).map((x) => x.id)).toEqual(['cola-a', 'tea-a', 'cola-b', 'berry-a', 'cola-c', 'tea-b', 'cola-d']);
    // Penalty 0 is the plain order: z desc, then id.
    expect(diversifyByCommunity(items, 7, 0).map((x) => x.id)).toEqual(['cola-a', 'cola-b', 'cola-c', 'cola-d', 'tea-a', 'berry-a', 'tea-b']);
  });

  it('stops after `count` picks, a prefix of the full greedy list; input order does not matter', () => {
    const full = diversifyByCommunity(items, 7).map((x) => x.id);
    for (let k = 0; k <= 9; k++) expect(diversifyByCommunity(items, k).map((x) => x.id)).toEqual(full.slice(0, Math.min(k, 7)));
    expect(diversifyByCommunity([...items].reverse(), 7).map((x) => x.id)).toEqual(full);
    expect(diversifyByCommunity([], 3)).toEqual([]);
  });

  it('does not bury a much stronger candidate: a gap above the accumulated penalty keeps the run', () => {
    // A's four are 0.7 above B: the fourth A pays 3 · 0.2 = 0.6 < 0.7, so the run of A stays first.
    const strong = [
      { id: 'a1', z: 3.0, community: 'A' },
      { id: 'a2', z: 2.9, community: 'A' },
      { id: 'a3', z: 2.8, community: 'A' },
      { id: 'a4', z: 2.7, community: 'A' },
      { id: 'b1', z: 2.0, community: 'B' },
      { id: 'c1', z: 1.9, community: 'C' },
    ];
    expect(diversifyByCommunity(strong, 6).map((x) => x.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'b1', 'c1']);
    // At 2.45 the fourth A pays 0.6 and drops to 1.85: below b1 (2.0) and c1 (1.9), so it goes last.
    const weaker = strong.map((x) => (x.id === 'a4' ? { ...x, z: 2.45 } : x));
    expect(diversifyByCommunity(weaker, 6).map((x) => x.id)).toEqual(['a1', 'a2', 'a3', 'b1', 'c1', 'a4']);
  });

  it('breaks exact ties by id', () => {
    const tie = [
      { id: 'b', z: 1, community: 'X' },
      { id: 'a', z: 1, community: 'Y' },
      { id: 'c', z: 1.2, community: 'X' },
    ];
    // 1: c 1.2. 2: b 1 − 0.2 = 0.8, a 1 → a. 3: b.
    expect(diversifyByCommunity(tie, 3).map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(diversifyByCommunity(tie, 3, 0).map((x) => x.id)).toEqual(['c', 'a', 'b']);
    const flat = [
      { id: 'y', z: 0.5, community: 'P' },
      { id: 'x', z: 0.5, community: 'Q' },
    ];
    expect(diversifyByCommunity(flat, 2).map((x) => x.id)).toEqual(['x', 'y']);
  });

  it('rejects a negative or non-finite penalty', () => {
    expect(() => diversifyByCommunity(items, 2, -0.1)).toThrow(RangeError);
    expect(() => diversifyByCommunity(items, 2, Number.NaN)).toThrow(RangeError);
    expect(() => diversifyByCommunity(items, 2, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("diversity: 'community' in recommend (the cola lover)", () => {
  it('the snapshot: colas predicted above the teas and berry waters', () => {
    const z = (b: string) => predictScore(cola, 'u', b).z;
    for (const c of ['cola-1', 'cola-2', 'cola-3', 'cola-4']) for (const o of ['tea-1', 'tea-2', 'ber-1', 'ber-2']) expect(z(c)).toBeGreaterThan(z(o));
  });

  it("'none' is a run of colas; 'community' interleaves, as the penalty arithmetic says", () => {
    // Seed 'b', ε = 0. Jittered ẑ (4 dp): cola-4 0.3284, cola-3 0.2740, cola-1 0.2358, cola-2 0.2319,
    // tea-1 0.1709, ber-2 0.0319, ber-1 0.0233, tea-2 0.0004.
    const j = jitteredOf(cola, 'u', COLA_CANDIDATES, 'b');
    const at4 = (b: string) => Math.round((j.get(b) as number) * 1e4) / 1e4;
    expect(['cola-4', 'cola-3', 'cola-1', 'cola-2', 'tea-1', 'ber-2', 'ber-1', 'tea-2'].map(at4)).toEqual([0.3284, 0.274, 0.2358, 0.2319, 0.1709, 0.0319, 0.0233, 0.0004]);
    const opts: RecommendOptions = { n: 8, seed: 'b', epsilon: 0 };
    expect(ids(recommend(cola, 'u', opts))).toEqual(['cola-4', 'cola-3', 'cola-1', 'cola-2', 'tea-1', 'ber-2', 'ber-1', 'tea-2']);
    // 1: cola-4 0.3284.  2: cola-3 0.2740 − 0.2 = 0.0740 < tea-1 0.1709 → tea-1.
    // 3: cola-3 0.0740, tea-2 0.0004 − 0.2, ber-2 0.0319 → cola-3.
    // 4: cola-1 0.2358 − 0.4 = −0.1642, tea-2 −0.1996, ber-2 0.0319 → ber-2.
    // 5: cola-1 −0.1642, tea-2 −0.1996, ber-1 0.0233 − 0.2 = −0.1767 → cola-1.
    // 6: cola-2 0.2319 − 0.6 = −0.3681, tea-2 −0.1996, ber-1 −0.1767 → ber-1.  7: tea-2.  8: cola-2.
    const div = recommend(cola, 'u', { ...opts, diversity: 'community' });
    expect(ids(div)).toEqual(['cola-4', 'tea-1', 'cola-3', 'ber-2', 'cola-1', 'ber-1', 'tea-2', 'cola-2']);
    // Only the order changes: the same items, each with its un-jittered prediction.
    for (const rec of div) {
      const p = predictScore(cola, 'u', rec.bevId);
      expect(rec.score).toBe(p.score);
      expect(rec.confidence).toBe(p.confidence);
    }
    // And it is exactly diversifyByCommunity over the replicated jitter.
    const expected = diversifyByCommunity(COLA_CANDIDATES.map((id) => ({ id, z: j.get(id) as number, community: family(id) })), 8).map((x) => x.id);
    expect(ids(div)).toEqual(expected);
    expect(effectiveDiversity(cola, { diversity: 'community' })).toBe('community');
  });

  it('a much stronger candidate stays first: the top normal pick never moves', () => {
    for (let i = 0; i < 40; i++) {
      const seed = `strong-${i}`;
      const a = recommend(cola, 'u', { n: 8, seed, epsilon: 0 });
      const b = recommend(cola, 'u', { n: 8, seed, epsilon: 0, diversity: 'community' });
      expect(b[0]).toEqual(a[0]);
    }
  });

  it('with exploration slots: the slots and their picks do not move, only the normal order', () => {
    for (let i = 0; i < 30; i++) {
      const seed = `slots-${i}`;
      const a = recommend(cola, 'u', { n: 8, seed, epsilon: 0.3 });
      const b = recommend(cola, 'u', { n: 8, seed, epsilon: 0.3, diversity: 'community' });
      expect(b.filter((x) => x.isExploration)).toEqual(a.filter((x) => x.isExploration));
      expect(b.map((x) => x.isExploration)).toEqual(a.map((x) => x.isExploration));
      // Exploration picks do not count toward the penalty: the normal picks are the greedy list over
      // the normal candidates alone.
      const j = jitteredOf(cola, 'u', COLA_CANDIDATES, seed);
      const normal = COLA_CANDIDATES.filter((id) => !a.some((x) => x.isExploration && x.bevId === id));
      const greedy = diversifyByCommunity(normal.map((id) => ({ id, z: j.get(id) as number, community: family(id) })), b.filter((x) => !x.isExploration).length).map((x) => x.id);
      expect(b.filter((x) => !x.isExploration).map((x) => x.bevId)).toEqual(greedy);
    }
  });
});

describe('defaults, explicit defaults and the absent field (byte-identical to 1.7.0; see recommend-compat)', () => {
  const synth = syntheticSnapshot('recommend', 12, 40);
  const synthGraph: Record<string, BevGraphStats> = Object.fromEntries(Object.keys(synth.bevs).map((b, i) => [b, node(`F${i % 4}`, (i % 5) / 5)]));
  const synthWith = { ...synth, bevGraph: synthGraph };
  const users = Object.keys(synth.users).sort();

  it("omitted = explicit 'none' / 'category', with and without bevGraph present", () => {
    for (const s of [synth, synthWith, cola, colaPlain]) {
      for (const u of s === cola || s === colaPlain ? ['u', 'v1', 'nobody'] : users) {
        const base = recommend(s, u, { n: 20, seed: `${u}:2026-11-10` });
        expect(recommend(s, u, { n: 20, seed: `${u}:2026-11-10`, diversity: 'none' })).toEqual(base);
        expect(recommend(s, u, { n: 20, seed: `${u}:2026-11-10`, exploration: 'category' })).toEqual(base);
        expect(recommend(s, u, { n: 20, seed: `${u}:2026-11-10`, diversity: 'none', exploration: 'category' })).toEqual(base);
      }
    }
    // A present bevGraph is ignored by the default: same output as the snapshot without it.
    for (const u of users) expect(recommend(synthWith, u, { n: 20, seed: u })).toEqual(recommend(synth, u, { n: 20, seed: u }));
  });

  it("'community' with bevGraph absent (undefined or null) equals the default; the effective helpers say so", () => {
    const community: Pick<RecommendOptions, 'diversity' | 'exploration'> = { diversity: 'community', exploration: 'community' };
    for (const s of [synth, { ...synth, bevGraph: null }]) {
      expect(effectiveDiversity(s, community)).toBe('none');
      expect(effectiveExploration(s, community)).toBe('category');
      for (const u of users) {
        const base = recommend(s, u, { n: 20, seed: u });
        expect(recommend(s, u, { n: 20, seed: u, ...community })).toEqual(base);
        expect(recommend(s, u, { n: 20, seed: u, diversity: 'community' })).toEqual(base);
        expect(recommend(s, u, { n: 20, seed: u, exploration: 'community' })).toEqual(base);
      }
    }
    expect(effectiveDiversity(synthWith, community)).toBe('community');
    expect(effectiveExploration(synthWith, community)).toBe('community');
    expect(effectiveDiversity(synthWith, {})).toBe('none');
    expect(effectiveExploration(synthWith, {})).toBe('category');
    expect(effectiveDiversity(synthWith)).toBe('none');
    // An empty object is a provided field: every Bev a singleton.
    expect(effectiveDiversity({ ...synth, bevGraph: {} }, community)).toBe('community');
  });

  it("'community' over all-singleton families equals 'none' exactly", () => {
    const singles = { ...synth, bevGraph: Object.fromEntries(Object.keys(synth.bevs).map((b) => [b, node(`solo-${b}`)])) };
    const empty = { ...synth, bevGraph: {} };
    for (const u of users) {
      for (const eps of [0, 0.15, 0.5]) {
        const base = recommend(synth, u, { n: 25, seed: u, epsilon: eps });
        expect(recommend(singles, u, { n: 25, seed: u, epsilon: eps, diversity: 'community' })).toEqual(base);
        expect(recommend(empty, u, { n: 25, seed: u, epsilon: eps, diversity: 'community' })).toEqual(base);
      }
    }
  });
});

// ---------------------------------------------------------------- exploration
// u ranked into the COLA and TEA families. Candidates: two colas and a tea (charted), a berry water
// with bridge 0.9 and a citrus water with bridge 0 (uncharted). Nobody else ranks anything, so every
// g_b = 0 ≥ 0. n = 5 gives round(0.15 · 5) = 1 slot, at position 2.
const exBevs = [
  bev('r-coke', 'soda', 'coke', ['cola']),
  bev('r-pepsi', 'soda', 'pepsi', ['cola']),
  bev('r-tea', 'tea', 'lipton', ['lemon']),
  bev('cola-1', 'soda', 'coke', ['cherry', 'cola']),
  bev('cola-2', 'soda', 'pepsi', ['cola', 'vanilla']),
  bev('tea-1', 'tea', 'arizona', ['peach']),
  bev('x-bridge', 'sparkling_water', 'lacroix', ['berry']),
  bev('y-interior', 'sparkling_water', 'bubly', ['lime']),
];
const exRankings = [r('u', 'r-coke', 9), r('u', 'r-pepsi', 8), r('u', 'r-tea', 4)];
const exGraph: Record<string, BevGraphStats> = {
  'r-coke': node('COLA'),
  'r-pepsi': node('COLA'),
  'r-tea': node('TEA'),
  'cola-1': node('COLA'),
  'cola-2': node('COLA'),
  'tea-1': node('TEA'),
  'x-bridge': node('BERRY', 0.9),
  'y-interior': node('CITRUS', 0),
};
const ex: PredictionSnapshot = { ...buildSnapshot(exRankings, exBevs), bevGraph: exGraph };

describe("exploration: 'community'", () => {
  it('draws only from uncharted families when any qualify', () => {
    expect(explorationSlots(5, Math.round(0.15 * 5))).toEqual([2]);
    for (let i = 0; i < 200; i++) {
      const recs = recommend(ex, 'u', { n: 5, seed: `ex-${i}`, exploration: 'community' });
      const picks = recs.filter((x) => x.isExploration).map((x) => x.bevId);
      expect(picks.length).toBe(1);
      expect(['x-bridge', 'y-interior']).toContain(picks[0]);
      expect(recs.findIndex((x) => x.isExploration)).toBe(2);
    }
  });

  it('a bridge Bev is drawn more often than an interior Bev with the same g_b (weights 1.9 : 1)', () => {
    expect(globalScore(ex, 'x-bridge')).toBe(0);
    expect(globalScore(ex, 'y-interior')).toBe(0);
    let bridge = 0;
    let interior = 0;
    for (let i = 0; i < 2000; i++) {
      const pick = recommend(ex, 'u', { n: 5, seed: `bridge-${i}`, exploration: 'community' }).find((x) => x.isExploration)?.bevId;
      if (pick === 'x-bridge') bridge++;
      else if (pick === 'y-interior') interior++;
    }
    expect(bridge + interior).toBe(2000);
    // Expected share 1.9 / 2.9 ≈ 0.655, i.e. about 1310 against 690 (sd ≈ 21). Fixed seeds, so the
    // counts are deterministic; the bound below is far from both the expectation and from 1 : 1.
    expect(bridge).toBeGreaterThan(1.5 * interior);
    expect(bridge).toBeLessThan(2.5 * interior);
  });

  it('a charted family is never drawn, even with a far larger weight', () => {
    const heavy: PredictionSnapshot = { ...ex, bevGraph: { ...exGraph, 'cola-1': node('COLA', 1) } };
    for (let i = 0; i < 100; i++) {
      const pick = recommend(heavy, 'u', { n: 5, seed: `h-${i}`, exploration: 'community' }).find((x) => x.isExploration)?.bevId;
      expect(['x-bridge', 'y-interior']).toContain(pick);
    }
  });

  it('an empty community pool (every family charted) falls back to the category rule exactly', () => {
    // Every candidate in a family u has ranked into.
    const charted: PredictionSnapshot = { ...ex, bevGraph: { ...exGraph, 'x-bridge': node('COLA', 0.9), 'y-interior': node('TEA') } };
    expect(effectiveExploration(charted, { exploration: 'community' })).toBe('community');
    for (let i = 0; i < 100; i++) {
      for (const n of [3, 5, 8]) {
        const o = { n, seed: `fb-${i}`, epsilon: 0.4 };
        expect(recommend(charted, 'u', { ...o, exploration: 'community' })).toEqual(recommend(charted, 'u', o));
      }
    }
  });

  it('an empty community pool (every uncharted candidate has g_b < 0) falls back to the category rule exactly', () => {
    // v and w rank both uncharted waters well below their own means, so g_b < 0 for both.
    const neg = [...exRankings, ...['v', 'w'].flatMap((x) => [r(x, 'x-bridge', 1), r(x, 'y-interior', 1.5), r(x, 'cola-1', 9), r(x, 'tea-1', 8)])];
    const s: PredictionSnapshot = { ...buildSnapshot(neg, exBevs), bevGraph: exGraph };
    expect(globalScore(s, 'x-bridge')).toBeLessThan(0);
    expect(globalScore(s, 'y-interior')).toBeLessThan(0);
    for (let i = 0; i < 100; i++) {
      const o = { n: 5, seed: `neg-${i}`, epsilon: 0.4 };
      const recs = recommend(s, 'u', { ...o, exploration: 'community' });
      expect(recs).toEqual(recommend(s, 'u', o));
      for (const x of recs.filter((y) => y.isExploration)) expect(['x-bridge', 'y-interior']).not.toContain(x.bevId);
    }
  });

  it('a pool smaller than the slots fills what it can; the rest of the slots take normal picks', () => {
    // 3 slots (ε = 0.6, n = 5), 2 uncharted candidates.
    const recs = recommend(ex, 'u', { n: 5, seed: 's', epsilon: 0.6, exploration: 'community' });
    expect(explorationSlots(5, 3)).toEqual([0, 2, 3]);
    expect(recs.map((x) => x.isExploration)).toEqual([true, false, true, false, false]);
    expect(recs.filter((x) => x.isExploration).map((x) => x.bevId).sort()).toEqual(['x-bridge', 'y-interior']);
  });
});

describe('a Bev with no bevGraph entry', () => {
  it('is a singleton family of its own that cannot collide with a real family id', () => {
    // 'newbie' has no entry; real families named 'newbie', 'b:newbie' and 'c:newbie' exist.
    const bevs = [...exBevs, bev('newbie', 'soda', null, ['ginger'])];
    const g: Record<string, BevGraphStats> = { ...exGraph, 'cola-1': node('newbie'), 'cola-2': node('b:newbie'), 'tea-1': node('c:newbie'), 'gone-from-bevs': node('COLA') };
    const s: PredictionSnapshot = { ...buildSnapshot(exRankings, bevs), bevGraph: g };
    const lookup = bevGraphLookup(s) as NonNullable<ReturnType<typeof bevGraphLookup>>;
    expect(lookup.get('newbie')).toEqual({ community: 'b:newbie', pagerank: 0, bridge: 0 });
    const keys = ['newbie', 'cola-1', 'cola-2', 'tea-1'].map((id) => communityKeyOf(lookup, id));
    expect(new Set(keys).size).toBe(4);
    // Entries for Bevs not in `bevs` are ignored; every Bev in `bevs` has a node.
    expect(lookup.has('gone-from-bevs')).toBe(false);
    expect([...lookup.keys()].sort()).toEqual(Object.keys(s.bevs).sort());
    // As a candidate it is uncharted, so it can be an exploration pick, with bridge 0.
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) for (const x of recommend(s, 'u', { n: 5, seed: `nb-${i}`, exploration: 'community' })) if (x.isExploration) seen.add(x.bevId);
    expect(seen.has('newbie')).toBe(true);
    for (const id of seen) expect(['x-bridge', 'y-interior', 'newbie', 'cola-1', 'cola-2', 'tea-1']).toContain(id);
  });

  it('a ranked Bev with no entry charts nothing but itself', () => {
    // u's tea has no entry, so the TEA family is uncharted and tea-1 joins the pool.
    const g = { ...exGraph };
    delete g['r-tea'];
    const s: PredictionSnapshot = { ...ex, bevGraph: g };
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) for (const x of recommend(s, 'u', { n: 5, seed: `rt-${i}`, exploration: 'community' })) if (x.isExploration) seen.add(x.bevId);
    expect([...seen].sort()).toEqual(['tea-1', 'x-bridge', 'y-interior']);
  });

  it('never pays a diversity penalty: its own family has no other member', () => {
    const items = [
      { id: 'a', z: 1, community: 'c:F' },
      { id: 'b', z: 0.9, community: 'c:F' },
      { id: 'n', z: 0.75, community: 'b:n' },
    ];
    expect(diversifyByCommunity(items, 3).map((x) => x.id)).toEqual(['a', 'n', 'b']);
  });
});

describe('validation', () => {
  it('throws on an unknown option value, with or without bevGraph (null, like undefined, is the default)', () => {
    expect(recommend(ex, 'u', { n: 3, seed: 's', diversity: null as never, exploration: null as never })).toEqual(recommend(ex, 'u', { n: 3, seed: 's' }));
    for (const s of [ex, { ...ex, bevGraph: undefined }]) {
      for (const bad of [{ diversity: 'category' }, { diversity: 'communities' }, { exploration: 'none' }, { exploration: 'graph' }, { diversity: 0 }]) {
        expect(() => recommend(s, 'u', { n: 3, seed: 's', ...(bad as object) })).toThrow(RangeError);
      }
    }
    expect(() => effectiveDiversity(ex, { diversity: 'x' as never })).toThrow(RangeError);
    expect(() => effectiveExploration(ex, { exploration: 'x' as never })).toThrow(RangeError);
  });

  const malformed: Array<[string, unknown]> = [
    ['empty community', { 'cola-1': { community: '', pagerank: 0.1, bridge: 0 } }],
    ['community not a string', { 'cola-1': { community: 7, pagerank: 0.1, bridge: 0 } }],
    ['missing community', { 'cola-1': { pagerank: 0.1, bridge: 0 } }],
    ['negative pagerank', { 'cola-1': { community: 'A', pagerank: -0.1, bridge: 0 } }],
    ['NaN pagerank', { 'cola-1': { community: 'A', pagerank: Number.NaN, bridge: 0 } }],
    ['infinite pagerank', { 'cola-1': { community: 'A', pagerank: Number.POSITIVE_INFINITY, bridge: 0 } }],
    ['pagerank as a string', { 'cola-1': { community: 'A', pagerank: '0.1', bridge: 0 } }],
    ['bridge above 1', { 'cola-1': { community: 'A', pagerank: 0.1, bridge: 1.01 } }],
    ['bridge negative', { 'cola-1': { community: 'A', pagerank: 0.1, bridge: -0.01 } }],
    ['bridge NaN', { 'cola-1': { community: 'A', pagerank: 0.1, bridge: Number.NaN } }],
    ['entry null', { 'cola-1': null }],
    ['entry an array', { 'cola-1': ['A', 0.1, 0] }],
    ['malformed entry for a Bev not in bevs', { 'gone': { community: '', pagerank: 0, bridge: 0 } }],
    ['field an array', [{ community: 'A', pagerank: 0.1, bridge: 0 }]],
    ['field a string', 'COLA'],
    ['empty key', { '': { community: 'A', pagerank: 0.1, bridge: 0 } }],
  ];

  it('throws a RangeError naming the Bev on a malformed bevGraph, in community mode only', () => {
    for (const [name, field] of malformed) {
      const s = { ...ex, bevGraph: field } as unknown as PredictionSnapshot;
      expect(() => recommend(s, 'u', { n: 5, seed: 's', diversity: 'community' }), name).toThrow(RangeError);
      expect(() => recommend(s, 'u', { n: 5, seed: 's', exploration: 'community' }), name).toThrow(RangeError);
      expect(() => bevGraphLookup(s), name).toThrow(RangeError);
      // The default never reads the field.
      const plain = { ...ex, bevGraph: undefined };
      expect(recommend(s, 'u', { n: 5, seed: 's' }), name).toEqual(recommend(plain, 'u', { n: 5, seed: 's' }));
    }
    const s = { ...ex, bevGraph: { 'cola-1': { community: 'A', pagerank: 0.1, bridge: 2 } } } as unknown as PredictionSnapshot;
    expect(() => bevGraphLookup(s)).toThrow(/cola-1/);
  });

  it('accepts the edges of the ranges: pagerank 0, bridge 0 and 1', () => {
    const s = { ...ex, bevGraph: { ...exGraph, 'cola-1': { community: 'A', pagerank: 0, bridge: 1 }, 'cola-2': { community: 'A', pagerank: 1, bridge: 0 } } };
    expect(() => recommend(s, 'u', { n: 5, seed: 's', diversity: 'community', exploration: 'community' })).not.toThrow();
  });
});
