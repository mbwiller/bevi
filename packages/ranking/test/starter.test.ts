import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { selectStarterSet, type StarterCandidate } from '../src/index.ts';

const CATS = ['soda', 'diet_soda', 'energy', 'water', 'sparkling_water', 'sports', 'juice', 'tea', 'coffee', 'beer'];
const make = (n: number): StarterCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ id: `bev-${String(i).padStart(2, '0')}`, name: `Bev ${i}`, categoryId: CATS[i % CATS.length] as string, ratingCount: 100 - i }));

describe('selectStarterSet', () => {
  it('takes the 6 most-rated as the core, then 4 seeded draws', () => {
    const cands = make(30);
    const a = selectStarterSet(cands, { seed: 'user-1' });
    expect(a).toHaveLength(10);
    expect(a.slice(0, 6)).toEqual(['bev-00', 'bev-01', 'bev-02', 'bev-03', 'bev-04', 'bev-05']);
    expect(selectStarterSet(cands, { seed: 'user-1' })).toEqual(a);
    const others = new Set(Array.from({ length: 20 }, (_, i) => selectStarterSet(cands, { seed: `u${i}` }).slice(6).join()));
    expect(others.size).toBeGreaterThan(1);
  });

  it('breaks rating ties by name and respects the cap in the core', () => {
    const cands: StarterCandidate[] = [
      { id: 'z', name: 'Coke', categoryId: 'soda', ratingCount: 9 },
      { id: 'y', name: 'Sprite', categoryId: 'soda', ratingCount: 9 },
      { id: 'x', name: 'Pepsi', categoryId: 'soda', ratingCount: 9 },
      { id: 'w', name: 'Water', categoryId: 'water', ratingCount: 1 },
    ];
    expect(selectStarterSet(cands, { seed: 's', k: 2, core: 2 })).toEqual(['z', 'x']);
    expect(selectStarterSet(cands, { seed: 's', k: 3, core: 3 })).toEqual(['z', 'x', 'w']);
  });

  it('breaks rating ties by code point, not UTF-16 code unit', () => {
    const cands: StarterCandidate[] = [
      { id: 'emoji', name: '🥤 Cola', categoryId: 'soda', ratingCount: 9 }, // U+1F964
      { id: 'fullwidth', name: 'Ｃｏｌａ', categoryId: 'water', ratingCount: 9 }, // U+FF23
    ];
    expect(selectStarterSet(cands, { seed: 's', k: 1, core: 1 })).toEqual(['fullwidth']);
  });

  it('drops excluded categories', () => {
    const set = selectStarterSet(make(30), { seed: 'teen', excludeCategoryIds: ['beer'] });
    expect(set.some((id) => make(30).find((c) => c.id === id)?.categoryId === 'beer')).toBe(false);
  });

  it('relaxes the cap only when k is otherwise unreachable', () => {
    const cands = make(4).map((c) => ({ ...c, categoryId: 'soda' }));
    expect(selectStarterSet(cands, { seed: 's' })).toHaveLength(4);
  });

  it('size = min(k, pool), unique, ≤ maxPerCategory and ≥ 5 categories when the pool allows', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), fc.string(), (n, seed) => {
        const cands = make(n);
        const set = selectStarterSet(cands, { seed });
        expect(set).toHaveLength(Math.min(10, n));
        expect(new Set(set).size).toBe(set.length);
        const perCat = new Map<string, number>();
        for (const id of set) {
          const c = cands.find((x) => x.id === id)?.categoryId as string;
          perCat.set(c, (perCat.get(c) ?? 0) + 1);
        }
        if (n >= 10) {
          expect(Math.max(...perCat.values())).toBeLessThanOrEqual(2);
          expect(perCat.size).toBeGreaterThanOrEqual(5);
        }
        expect(selectStarterSet(cands, { seed })).toEqual(set);
      }),
    );
  });
});
