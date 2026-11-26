import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { selectStarterSet, STARTER_CORE, STARTER_PICK_QUOTAS, type StarterCandidate } from '../src/index.ts';

const CATS = ['soda', 'diet_soda', 'energy', 'water', 'sparkling_water', 'sports', 'juice', 'tea', 'coffee', 'beer'];
const make = (n: number): StarterCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ id: `bev-${String(i).padStart(2, '0')}`, name: `Bev ${i}`, categoryId: CATS[i % CATS.length] as string, ratingCount: 100 - i }));

// A named pool for the picks cases. Most-rated: coke 100, dietcoke 95, pepsi 90 (the core: two
// sodas and a diet soda), then gatorade 85, redbull 80, bud 75, ...
const bev = (id: string, categoryId: string, ratingCount: number): StarterCandidate => ({ id, name: id, categoryId, ratingCount });
const SHELF: StarterCandidate[] = [
  bev('coke', 'soda', 100), bev('pepsi', 'soda', 90), bev('sprite', 'soda', 40), bev('drpepper', 'soda', 30),
  bev('dietcoke', 'diet_soda', 95), bev('cokezero', 'diet_soda', 50), bev('dietpepsi', 'diet_soda', 20),
  bev('redbull', 'energy', 80), bev('monster', 'energy', 70), bev('celsius', 'energy', 25),
  bev('poland', 'water', 60), bev('fiji', 'water', 35),
  bev('lacroix', 'sparkling_water', 55), bev('topo', 'sparkling_water', 45), bev('bubly', 'sparkling_water', 15),
  bev('arizona', 'tea', 65), bev('snapple', 'tea', 22),
  bev('frapp', 'coffee', 33), bev('coldbrew', 'coffee', 12),
  bev('oj', 'juice', 28), bev('applejuice', 'juice', 10),
  bev('gatorade', 'sports', 85), bev('powerade', 'sports', 18),
  bev('bud', 'beer', 75), bev('coors', 'beer', 5),
];
const CORE = ['coke', 'dietcoke', 'pepsi'];
const catOf = (id: string) => SHELF.find((c) => c.id === id)?.categoryId as string;
const perCategory = (ids: string[]) => {
  const m = new Map<string, number>();
  for (const id of ids) m.set(catOf(id), (m.get(catOf(id)) ?? 0) + 1);
  return m;
};

describe('selectStarterSet', () => {
  it('takes the 3 most-rated as the core, then 7 seeded draws when there are no picks', () => {
    expect(STARTER_CORE).toBe(3);
    const cands = make(30);
    const a = selectStarterSet(cands, { seed: 'user-1' });
    expect(a).toHaveLength(10);
    expect(a.slice(0, 3)).toEqual(['bev-00', 'bev-01', 'bev-02']);
    expect(selectStarterSet(cands, { seed: 'user-1' })).toEqual(a);
    const others = new Set(Array.from({ length: 20 }, (_, i) => selectStarterSet(cands, { seed: `u${i}` }).slice(3).join()));
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
    expect(selectStarterSet(cands, { seed: 's', picks: ['soda'] })).toHaveLength(4);
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

describe('selectStarterSet with go-to categories', () => {
  it('quotas are 2, 2, 1 by pick rank', () => {
    expect(STARTER_PICK_QUOTAS).toEqual([2, 2, 1]);
  });

  it('no picks: the core, then 7 draws, the same draw as before picks existed', () => {
    const set = selectStarterSet(SHELF, { seed: 'user-1' });
    // Pinned from the pre-picks implementation run with core: 3 over SHELF (the shuffle is unchanged).
    expect(set).toEqual(['coke', 'dietcoke', 'pepsi', 'snapple', 'poland', 'coors', 'cokezero', 'fiji', 'topo', 'arizona']);
    expect(selectStarterSet(SHELF, { seed: 'user-1', picks: [] })).toEqual(set);
  });

  it('typical: 3 core + 2/2/1 from the picks + 2 wildcards, in the order the user sees them', () => {
    const set = selectStarterSet(SHELF, { seed: 'user-1', picks: ['energy', 'water', 'tea'] });
    expect(set).toHaveLength(10);
    // [p1a, p2a, p3a, c1, c2, c3, p1b, p2b, w1, w2]
    expect(set.slice(0, 8)).toEqual(['redbull', 'poland', 'arizona', ...CORE, 'monster', 'fiji']);
    const wild = set.slice(8);
    // The set already spans 5 categories and soda is at the cap: the wildcards come from
    // non-picked categories under the cap.
    for (const id of wild) expect(['soda', 'energy', 'water', 'tea']).not.toContain(catOf(id));
    expect(perCategory(set).get('energy')).toBe(2);
    expect(perCategory(set).get('water')).toBe(2);
    expect(perCategory(set).get('tea')).toBe(1);
    // Two users with the same picks share the first 8 and differ only in the wildcards.
    const other = selectStarterSet(SHELF, { seed: 'user-2', picks: ['energy', 'water', 'tea'] });
    expect(other.slice(0, 8)).toEqual(set.slice(0, 8));
    expect(selectStarterSet(SHELF, { seed: 'user-1', picks: ['energy', 'water', 'tea'] })).toEqual(set);
  });

  it('a pick whose category is in the core: the core counts toward its quota, freed slots become wildcards', () => {
    // diet_soda already has dietcoke in the core: quota 2 tops up with one more (cokezero).
    // soda already has coke and pepsi: quota 2 is met, it takes nothing and leads nothing.
    const set = selectStarterSet(SHELF, { seed: 'user-1', picks: ['soda', 'diet_soda', 'tea'] });
    expect(set.slice(0, 5)).toEqual(['cokezero', 'arizona', ...CORE]);
    expect(set).toHaveLength(10);
    const counts = perCategory(set);
    expect(counts.get('soda')).toBe(2);
    expect(counts.get('diet_soda')).toBe(2);
    expect(counts.get('tea')).toBe(1);
    // 3 core + 2 top-ups → 5 wildcards, none from a picked category.
    for (const id of set.slice(5)) expect(['soda', 'diet_soda', 'tea']).not.toContain(catOf(id));
  });

  it('a pick does not stack past its quota even when the cap would allow it', () => {
    const set = selectStarterSet(SHELF, { seed: 'user-1', picks: ['soda'], maxPerCategory: 3 });
    expect(set.slice(0, 3)).toEqual(CORE);
    expect(perCategory(set).get('soda')).toBe(2);
  });

  it('one pick and two picks', () => {
    const one = selectStarterSet(SHELF, { seed: 'user-1', picks: ['tea'] });
    expect(one.slice(0, 5)).toEqual(['arizona', ...CORE, 'snapple']);
    expect(one).toHaveLength(10);
    for (const id of one.slice(5)) expect(catOf(id)).not.toBe('tea');

    const two = selectStarterSet(SHELF, { seed: 'user-1', picks: ['energy', 'water'] });
    expect(two.slice(0, 7)).toEqual(['redbull', 'poland', ...CORE, 'monster', 'fiji']);
    expect(two).toHaveLength(10);
    for (const id of two.slice(7)) expect(['energy', 'water']).not.toContain(catOf(id));
  });

  it('ignores picks after the third and repeated picks', () => {
    const three = selectStarterSet(SHELF, { seed: 'user-1', picks: ['energy', 'water', 'tea'] });
    expect(selectStarterSet(SHELF, { seed: 'user-1', picks: ['energy', 'water', 'tea', 'coffee', 'juice'] })).toEqual(three);
    expect(selectStarterSet(SHELF, { seed: 'user-1', picks: ['energy', 'energy', 'water', 'energy', 'tea', 'coffee'] })).toEqual(three);
  });

  it('ignores a pick in an excluded category, without it using up a pick rank', () => {
    const opts = { seed: 'teen', excludeCategoryIds: ['beer'] };
    const set = selectStarterSet(SHELF, { ...opts, picks: ['beer', 'energy', 'water', 'tea'] });
    expect(set).toEqual(selectStarterSet(SHELF, { ...opts, picks: ['energy', 'water', 'tea'] }));
    expect(set.slice(0, 8)).toEqual(['redbull', 'poland', 'arizona', ...CORE, 'monster', 'fiji']);
    expect(set.map(catOf)).not.toContain('beer');
    expect(selectStarterSet(SHELF, { ...opts, picks: ['beer'] })).toEqual(selectStarterSet(SHELF, opts));
  });

  it('a picked category with fewer starters than its quota gives what it has; the shortfall becomes wildcards', () => {
    const shelf = [...SHELF, bev('kombu', 'kombucha', 8)];
    const set = selectStarterSet(shelf, { seed: 'user-1', picks: ['kombucha', 'energy'] });
    expect(set.slice(0, 6)).toEqual(['kombu', 'redbull', ...CORE, 'monster']);
    expect(set).toHaveLength(10); // 3 core + 3 from the picks + 4 wildcards
    // A pick with no starters at all still uses its rank and takes nothing.
    expect(selectStarterSet(SHELF, { seed: 'user-1', picks: ['matcha'] })).toEqual(selectStarterSet(SHELF, { seed: 'user-1' }));
    expect(selectStarterSet(SHELF, { seed: 'user-1', picks: ['matcha', 'energy'] }).slice(0, 5)).toEqual(['redbull', ...CORE, 'monster']);
  });

  it('a cap below a quota wins', () => {
    const set = selectStarterSet(SHELF, { seed: 'user-1', picks: ['energy', 'water', 'tea'], maxPerCategory: 1 });
    // With one per category the core skips pepsi for gatorade.
    expect(set.slice(0, 6)).toEqual(['redbull', 'poland', 'arizona', 'coke', 'dietcoke', 'gatorade']);
    expect(set).toHaveLength(10);
    expect(Math.max(...perCategory(set).values())).toBe(1);
  });

  it('stops at k even inside the picks', () => {
    expect(selectStarterSet(SHELF, { seed: 'user-1', k: 4, picks: ['energy', 'water'] })).toEqual(['redbull', ...CORE]);
  });

  it('a tiny pool: everything, in the same order rules', () => {
    const tiny = [bev('coke', 'soda', 9), bev('sprite', 'soda', 8), bev('redbull', 'energy', 7), bev('poland', 'water', 1)];
    expect(selectStarterSet(tiny, { seed: 's', picks: ['water', 'soda'] })).toEqual(['poland', 'coke', 'sprite', 'redbull']);
    expect(selectStarterSet(tiny, { seed: 's', picks: ['energy'] })).toEqual(['coke', 'sprite', 'redbull', 'poland']);
    expect(selectStarterSet([], { seed: 's', picks: ['soda'] })).toEqual([]);
  });
});
