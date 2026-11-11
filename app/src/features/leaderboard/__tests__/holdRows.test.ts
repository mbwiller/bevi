import type { UserLeaderboardRow } from '@bevi/shared';

import { holdRows } from '../PeopleBoard';

const row = (handle: string, rank: number, points = 10): UserLeaderboardRow => ({
  rank,
  points,
  bevsRanked: 1,
  currentStreak: 0,
  profile: {
    id: `user-${handle}`,
    handle,
    displayName: handle,
    avatarUrl: null,
    timezone: 'UTC',
    createdAt: '2026-01-01T00:00:00Z',
    birthdate: null,
    canSeeAlcohol: true,
    onboarded: true,
  },
});
const shown = (rows: UserLeaderboardRow[]) => rows.map((r) => `${r.rank} ${r.profile.handle}`);

describe('holdRows', () => {
  it('keeps the held rows in their order and ranks, then appends live rows that are not held', () => {
    const held = [row('a', 1), row('b', 2), row('c', 3)];
    // b was unfollowed; the live board has moved up and a second page has arrived.
    const live = [row('a', 1), row('c', 2), row('d', 3), row('e', 4)];
    expect(shown(holdRows(held, live))).toEqual(['1 a', '2 b', '3 c', '3 d', '4 e']);
  });

  it("takes a held row's data from the live row when there is one, keeping the held rank", () => {
    const held = [row('a', 1, 10), row('b', 2, 8)];
    const live = [row('b', 1, 12), row('a', 2, 10)];
    const out = holdRows(held, live);
    expect(shown(out)).toEqual(['1 a', '2 b']);
    expect(out[1]!.points).toBe(12);
  });

  it('keeps a held row the live board no longer has', () => {
    expect(shown(holdRows([row('a', 1), row('b', 2)], [row('a', 1)]))).toEqual(['1 a', '2 b']);
  });
});
