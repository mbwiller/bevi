import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rankPoints, rankUsers, type RankUsersRow } from '../src/index.ts';

describe('rankPoints', () => {
  it('is bevsRanked + 3·streak + 2·created', () => {
    expect(rankPoints({ bevsRanked: 0, currentStreak: 0, bevsCreated: 0 })).toBe(0);
    expect(rankPoints({ bevsRanked: 40, currentStreak: 4, bevsCreated: 2 })).toBe(56);
  });

  it('rejects negative or fractional counts', () => {
    expect(() => rankPoints({ bevsRanked: -1, currentStreak: 0, bevsCreated: 0 })).toThrow(RangeError);
    expect(() => rankPoints({ bevsRanked: 1.5, currentStreak: 0, bevsCreated: 0 })).toThrow(RangeError);
  });

  it('is non-negative and monotone in every input', () => {
    const n = fc.integer({ min: 0, max: 10_000 });
    fc.assert(
      fc.property(n, n, n, (r, s, c) => {
        const p = rankPoints({ bevsRanked: r, currentStreak: s, bevsCreated: c });
        return (
          p >= 0 &&
          rankPoints({ bevsRanked: r + 1, currentStreak: s, bevsCreated: c }) > p &&
          rankPoints({ bevsRanked: r, currentStreak: s + 1, bevsCreated: c }) > p &&
          rankPoints({ bevsRanked: r, currentStreak: s, bevsCreated: c + 1 }) > p
        );
      }),
    );
  });
});

describe('rankUsers', () => {
  const row = (userId: string, bevsRanked: number, currentStreak: number, bevsCreated: number, createdAt: string): RankUsersRow => ({
    userId,
    bevsRanked,
    currentStreak,
    bevsCreated,
    createdAt,
  });

  it('orders by points, bevsRanked, createdAt and shares tied ranks', () => {
    const rows = [
      row('c', 10, 0, 0, '2026-10-01T00:00:00Z'), // 10
      row('a', 4, 2, 0, '2026-10-03T00:00:00Z'), // 10, fewer ranked
      row('b', 10, 0, 0, '2026-09-30T00:00:00Z'), // 10, older
      row('top', 20, 5, 1, '2026-10-05T00:00:00Z'), // 37
      row('low', 3, 0, 0, '2026-10-01T00:00:00Z'), // 3
      row('unranked', 0, 0, 5, '2026-10-01T00:00:00Z'),
    ];
    expect(rankUsers(rows)).toEqual([
      { userId: 'top', points: 37, rank: 1 },
      { userId: 'b', points: 10, rank: 2 },
      { userId: 'c', points: 10, rank: 2 },
      { userId: 'a', points: 10, rank: 2 },
      { userId: 'low', points: 3, rank: 5 },
    ]);
  });

  it('rank = 1 + number of users with more points', () => {
    const r = fc.record({
      userId: fc.uuid(),
      bevsRanked: fc.integer({ min: 0, max: 30 }),
      currentStreak: fc.integer({ min: 0, max: 10 }),
      bevsCreated: fc.integer({ min: 0, max: 5 }),
      createdAt: fc.constantFrom('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
    });
    fc.assert(
      fc.property(fc.uniqueArray(r, { selector: (x) => x.userId, maxLength: 40 }), (rows) => {
        const out = rankUsers(rows);
        expect(out.length).toBe(rows.filter((x) => x.bevsRanked > 0).length);
        for (const u of out) {
          expect(u.points).toBeGreaterThanOrEqual(0);
          expect(u.rank).toBe(1 + out.filter((v) => v.points > u.points).length);
        }
      }),
    );
  });
});
