import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareCodePoints,
  selectStarterSet,
  STARTER_CORE,
  STARTER_K,
  STARTER_MIN_CATEGORIES,
  STARTER_PICK_QUOTAS,
  type StarterCandidate,
  type StarterOptions,
} from '../src/index.ts';

// Few ids, names and rating counts, so duplicates and ties are common; 'matcha' is a pickable
// category with no starters. 12 categories, so that even a cap of 1 can reach k.
const CATS = ['soda', 'diet_soda', 'energy', 'water', 'sparkling_water', 'sports', 'tea', 'coffee', 'juice', 'milk', 'beer', 'wine'];
const candidate = fc.record({
  id: fc.integer({ min: 0, max: 40 }).map((i) => `b${i}`),
  name: fc.constantFrom('Coke', 'Coke Zero', 'Sprite', 'Zevia', 'arizona', ''),
  categoryId: fc.constantFrom(...CATS),
  ratingCount: fc.integer({ min: 0, max: 6 }),
});
// size: 'max' so pools often exceed k; the default 'small' size keeps most arrays under 10.
const candidates = fc.array(candidate, { maxLength: 50, size: 'max' });
const picks = fc.option(fc.array(fc.constantFrom(...CATS, 'matcha'), { maxLength: 6 }), { nil: undefined });
const options = fc.record({
  seed: fc.string(),
  picks,
  excludeCategoryIds: fc.option(fc.subarray(CATS), { nil: undefined }),
  maxPerCategory: fc.integer({ min: 1, max: 3 }),
});

interface Model {
  pool: Map<string, StarterCandidate>;
  avail: Map<string, number>;
  counted: string[];
  core: string[];
  cap: number;
}

/** What the inputs imply, computed independently of the implementation. */
function model(cands: readonly StarterCandidate[], o: StarterOptions): Model {
  const excluded = new Set(o.excludeCategoryIds ?? []);
  const cap = o.maxPerCategory ?? 2;
  const pool = new Map<string, StarterCandidate>();
  for (const c of cands) if (!excluded.has(c.categoryId) && !pool.has(c.id)) pool.set(c.id, c);
  const avail = new Map<string, number>();
  for (const c of pool.values()) avail.set(c.categoryId, (avail.get(c.categoryId) ?? 0) + 1);
  const counted = [...new Set((o.picks ?? []).filter((p) => !excluded.has(p)))].slice(0, STARTER_PICK_QUOTAS.length);
  const sorted = [...pool.values()].sort((a, b) => b.ratingCount - a.ratingCount || compareCodePoints(a.name, b.name) || compareCodePoints(a.id, b.id));
  const core: string[] = [];
  const inCore = new Map<string, number>();
  for (const c of sorted) {
    if (core.length >= Math.min(STARTER_CORE, STARTER_K)) break;
    if ((inCore.get(c.categoryId) ?? 0) < cap) {
      core.push(c.id);
      inCore.set(c.categoryId, (inCore.get(c.categoryId) ?? 0) + 1);
    }
  }
  return { pool, avail, counted, core, cap };
}

function perCategory(set: string[], m: Model): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of set) {
    const cat = (m.pool.get(id) as StarterCandidate).categoryId;
    out.set(cat, (out.get(cat) ?? 0) + 1);
  }
  return out;
}

describe('selectStarterSet properties (default k and core, any cap 1–3, any picks)', () => {
  it('unique ids from the pool, length min(k, pool after exclusion), nothing excluded, deterministic', () => {
    fc.assert(
      fc.property(candidates, options, (cands, o) => {
        const m = model(cands, o);
        const set = selectStarterSet(cands, o);
        expect(new Set(set).size).toBe(set.length);
        expect(set).toHaveLength(Math.min(STARTER_K, m.pool.size));
        const excluded = new Set(o.excludeCategoryIds ?? []);
        for (const id of set) {
          expect(m.pool.has(id)).toBe(true);
          expect(excluded.has((m.pool.get(id) as StarterCandidate).categoryId)).toBe(false);
        }
        expect(selectStarterSet(cands, o)).toEqual(set);
      }),
      { numRuns: 500 },
    );
  });

  it('the core is one contiguous block, in core order, identical across seeds and picks, after at most one lead Bev per counted pick', () => {
    fc.assert(
      fc.property(candidates, options, fc.string(), picks, (cands, o, seed2, picks2) => {
        const m = model(cands, o);
        for (const opts of [o, { ...o, seed: seed2, picks: picks2 }]) {
          const set = selectStarterSet(cands, opts);
          if (m.core.length === 0) continue;
          const start = set.indexOf(m.core[0] as string);
          expect(start).toBeGreaterThanOrEqual(0);
          expect(set.slice(start, start + m.core.length)).toEqual(m.core);
          // What precedes the core: at most one Bev per counted pick, from those categories, in pick order.
          const counted = model(cands, opts).counted;
          const lead = set.slice(0, start).map((id) => (m.pool.get(id) as StarterCandidate).categoryId);
          expect(new Set(lead).size).toBe(lead.length);
          const ranks = lead.map((cat) => counted.indexOf(cat));
          expect(ranks.every((r) => r >= 0)).toBe(true);
          expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('absent picks, empty picks and picks only in excluded categories give the same set', () => {
    fc.assert(
      fc.property(candidates, options, (cands, o) => {
        const base = { ...o, picks: undefined };
        const set = selectStarterSet(cands, base);
        expect(selectStarterSet(cands, { ...o, picks: [] })).toEqual(set);
        expect(selectStarterSet(cands, { ...o, picks: o.excludeCategoryIds ?? [] })).toEqual(set);
      }),
      { numRuns: 300 },
    );
  });

  it('each counted pick i holds at least min(quota_i, cap, its starters in the pool) Bevs', () => {
    fc.assert(
      fc.property(candidates, options, (cands, o) => {
        const m = model(cands, o);
        const counts = perCategory(selectStarterSet(cands, o), m);
        m.counted.forEach((cat, i) => {
          const want = Math.min(STARTER_PICK_QUOTAS[i] as number, m.cap, m.avail.get(cat) ?? 0);
          expect(counts.get(cat) ?? 0).toBeGreaterThanOrEqual(want);
        });
      }),
      { numRuns: 500 },
    );
  });

  it('a pick goes past max(min(quota, cap), its core members) only once every non-picked category is at the cap or exhausted', () => {
    fc.assert(
      fc.property(candidates, options, (cands, o) => {
        const m = model(cands, o);
        const set = selectStarterSet(cands, o);
        const counts = perCategory(set, m);
        const coreCounts = perCategory(m.core, m);
        const stacked = m.counted.some(
          (cat, i) => (counts.get(cat) ?? 0) > Math.max(Math.min(STARTER_PICK_QUOTAS[i] as number, m.cap), coreCounts.get(cat) ?? 0),
        );
        if (!stacked) return;
        for (const [cat, n] of m.avail) {
          if (!m.counted.includes(cat)) expect(counts.get(cat) ?? 0).toBeGreaterThanOrEqual(Math.min(m.cap, n));
        }
      }),
      { numRuns: 500 },
    );
  });

  it('a category exceeds the cap exactly when Σ_c min(cap, starters in c) < min(k, pool), i.e. k is unreachable under the cap', () => {
    fc.assert(
      fc.property(candidates, options, (cands, o) => {
        const m = model(cands, o);
        const counts = perCategory(selectStarterSet(cands, o), m);
        let underCap = 0;
        for (const n of m.avail.values()) underCap += Math.min(m.cap, n);
        const over = [...counts.values()].some((n) => n > m.cap);
        expect(over).toBe(underCap < Math.min(STARTER_K, m.pool.size));
      }),
      { numRuns: 500 },
    );
  });

  it('spans at least min(STARTER_MIN_CATEGORIES, categories in the pool) categories', () => {
    // True with the default k (10) and core (3) for any cap ≥ 1 and any picks: the picks take at
    // most 2 + 2 + 1 = 5 slots, each pick that takes one adds its category, and the wildcards
    // (at least 2 slots) reach new categories first while the set spans fewer than 5. Before the
    // wildcards the set spans s categories with w = 7 − t slots left, t the top-up Bevs, and
    // t ≤ s + 2 in every case, so s + w ≥ 5.
    fc.assert(
      fc.property(candidates, options, (cands, o) => {
        const m = model(cands, o);
        const counts = perCategory(selectStarterSet(cands, o), m);
        expect(counts.size).toBeGreaterThanOrEqual(Math.min(STARTER_MIN_CATEGORIES, m.avail.size));
      }),
      { numRuns: 1000 },
    );
  });
});
