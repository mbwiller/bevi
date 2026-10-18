import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BUCKET_ORDER, CONFIDENCE_LOCK, MIN_N_USER, RANKING_VERSION, rankUsers, storedScore } from '@bevi/ranking';
import { isApiError, type Session } from '@bevi/shared';

import { CATALOG_BEVS } from '../catalog';
import { STORAGE_KEY, type StorageLike } from '../db';
import { buildFixtures } from '../fixtures';
import { FakeApi } from '../FakeApi';
import { ALCOHOLIC_BEV_ID, FAKE_INVITE_CODE, FRIEND, ME } from '../people';

const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

/** Every test runs on a pinned clock, so streaks and "today" never depend on the real date. */
const FIXED_NOW = new Date('2026-10-11T16:00:00Z');
const make = (storage: StorageLike | null = null, now: Date = FIXED_NOW) => new FakeApi({ storage, latency: 0, now: () => now });

async function signInMe(api: FakeApi) {
  return api.signIn({ username: ME.handle, password: ME.password });
}

describe('seed', () => {
  it('uses exactly the catalog in data/catalog/bevs.csv, nothing invented', () => {
    const csv = readFileSync(resolve(__dirname, '../../../../../data/catalog/bevs.csv'), 'utf8');
    const slugs = csv.trim().split(/\r?\n/).slice(1).map((line) => line.split(',')[0]);
    expect(CATALOG_BEVS.map((b) => b.id)).toEqual(slugs);
    expect(buildFixtures(FIXED_NOW).bevs.map((b) => b.id)).toEqual(slugs);
  });

  it('fixture scores are exactly @bevi/ranking storedScore for every bucket position', () => {
    const db = buildFixtures(new Date('2026-10-11T12:00:00Z'));
    for (const user of db.users) {
      for (const bucket of BUCKET_ORDER) {
        const rows = db.rankings.filter((r) => r.userId === user.id && r.bucket === bucket).sort((a, z) => a.position - z.position);
        rows.forEach((r, i) => {
          expect(r.position).toBe(i);
          expect(r.score).toBe(storedScore(i, rows.length, bucket));
        });
      }
    }
  });
});

describe('fixtures through the API', () => {
  it('the test account has rankings, a feed, featured Bevs, a leaderboard and recommendations', async () => {
    const api = make();
    await signInMe(api);
    const me = await api.profile.getMe();
    expect(me).toMatchObject({ handle: 'tester', onboarded: true, canSeeAlcohol: true });
    expect((await api.rankings.listMine()).items).toHaveLength(12);
    expect((await api.feed.getFeed()).items.length).toBeGreaterThan(10);
    expect((await api.feed.getFeatured()).length).toBeGreaterThanOrEqual(3);
    expect((await api.leaderboard.bevs()).items.length).toBeGreaterThan(0);
    expect((await api.leaderboard.users()).items.length).toBeGreaterThan(3);
    const stats = await api.stats.getMine();
    expect(stats.following).toBe(4);
    expect(stats).toMatchObject({ currentStreak: 2, longestStreak: 2, streakAliveToday: true });
    const recs = await api.recs.getRecommendations();
    expect(recs.items.length).toBeGreaterThan(5);
    expect(recs.rankingVersion).toBe(RANKING_VERSION);
    expect((await api.bevs.get(recs.items[0]!.bev.id)).prediction).not.toBeNull();
  });

  it('category leaderboard rows carry the board\'s Bayesian score on the Bev too', async () => {
    const api = make();
    await signInMe(api);
    const rows = (await api.leaderboard.bevs({ categoryId: 'soda' })).items;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.bev.bayesScore).toBe(row.bayesScore);
  });

  it('theo (under 21) never sees alcoholic categories, Bevs or featured items', async () => {
    const api = make();
    api.signInAs('minor_user');
    expect((await api.profile.getMe()).canSeeAlcohol).toBe(false);
    expect((await api.categories.list()).some((c) => c.isAlcoholic)).toBe(false);
    expect((await api.feed.getFeatured()).map((f) => f.bev.id)).not.toContain(ALCOHOLIC_BEV_ID);
    expect((await api.bevs.search({ q: '', limit: 100 })).items.map((b) => b.id)).not.toContain(ALCOHOLIC_BEV_ID);
    expect((await api.bevs.getStarterCandidates()).length).toBeGreaterThanOrEqual(30);
    await expect(api.bevs.get(ALCOHOLIC_BEV_ID)).rejects.toMatchObject({ code: 'age_restricted' });
  });

  it('bevs.create rejects a photo that is still processing (validation), then accepts it once ready', async () => {
    let now = new Date('2026-10-11T12:00:00Z');
    const api = new FakeApi({ storage: null, latency: 0, now: () => now });
    await signInMe(api);
    const up = await api.media.upload({ kind: 'bev-photo', file: new Blob(['x']), mimeType: 'image/jpeg' });
    expect(up.status).toBe('processing');
    const input = { name: 'Garage Cola', categoryId: 'soda' as const, priceTier: 1 as const, priceEstimated: false, photoAssetId: up.assetId };
    await expect(api.bevs.create(input)).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'photoAssetId', reason: 'asset_not_ready' },
    });
    now = new Date(now.getTime() + 5000);
    const bev = await api.bevs.create(input);
    expect(bev).toMatchObject({ photoStatus: 'ready', photoUrl: up.url });
  });
});

describe('persistence', () => {
  it('persists to storage and restores, including the session', async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await a.signUp({ username: 'persisted', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    const b = make(storage);
    expect(await b.getSession()).toMatchObject({ handle: 'persisted' });
  });

  it('re-seeds untouched fixtures for today, so the test user keeps its streak on later days', async () => {
    const storage = memoryStorage();
    await signInMe(make(storage));
    const later = make(storage, new Date(FIXED_NOW.getTime() + 9 * 24 * 60 * 60 * 1000));
    expect(await later.getSession()).toMatchObject({ handle: 'tester' });
    expect(await later.stats.getMine()).toMatchObject({ currentStreak: 2, streakAliveToday: true });
  });

  it('keeps a db with real changes as it is, so it ages like real data', async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await signInMe(a);
    await a.wantToTry.add('pepsi');
    const later = make(storage, new Date(FIXED_NOW.getTime() + 9 * 24 * 60 * 60 * 1000));
    expect((await later.wantToTry.list()).items.map((w) => w.bev.id)).toContain('pepsi');
    expect(await later.stats.getMine()).toMatchObject({ currentStreak: 0, longestStreak: 2, streakAliveToday: false });
  });

  it('falls back to fixtures when the stored db is corrupt', async () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    const api = make(storage);
    await expect(signInMe(api)).resolves.toMatchObject({ handle: 'tester' });
  });

  it('keeps working in memory when storage throws', async () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const api = make(throwing);
    await signInMe(api);
    await api.wantToTry.add('pepsi');
    expect((await api.wantToTry.list()).items.map((w) => w.bev.id)).toContain('pepsi');
    api.resetToFixtures();
  });
});

describe('dev controls', () => {
  it('failNext rejects only the next call, optionally for one method', async () => {
    const api = make();
    api.failNext('network');
    await expect(api.meta.getAppConfig()).rejects.toMatchObject({ code: 'network' });
    await expect(api.meta.getAppConfig()).resolves.toBeDefined();
    await signInMe(api);
    api.failNext('conflict', 'rankings.submitRanking');
    await expect(api.profile.getMe()).resolves.toBeDefined();
    const err = await api.rankings
      .submitRanking({ bevId: 'pepsi', bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] })
      .catch((e: unknown) => e);
    expect(isApiError(err) && err.code).toBe('conflict');
  });

  it('setLatency delays calls', async () => {
    const api = make();
    api.setLatency(40);
    const t = Date.now();
    await api.meta.getAppConfig();
    expect(Date.now() - t).toBeGreaterThanOrEqual(35);
  });

  it('resetToFixtures signs out (firing onAuthChange) and restores data', async () => {
    const api = make();
    await api.signUp({ username: 'temp_user', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    const events: (Session | null)[] = [];
    api.onAuthChange((s) => events.push(s));
    api.resetToFixtures();
    expect(events).toEqual([null]);
    expect(await api.getSession()).toBeNull();
    expect(await api.profile.checkHandle('temp_user')).toEqual({ available: true });
  });

  it('emptyUser gives the signed-in user a first-run state', async () => {
    const api = make();
    await signInMe(api);
    api.emptyUser();
    expect((await api.rankings.listMine()).items).toEqual([]);
    expect((await api.wantToTry.list()).items).toEqual([]);
    expect(await api.stats.getMine()).toMatchObject({ following: 0, followers: 0, bevdCount: 0 });
    expect(await api.profile.getMe()).toMatchObject({ onboarded: false, birthdate: null, canSeeAlcohol: false });
    expect((await api.recs.getRecommendations()).items).toEqual([]);
  });
});

describe('@bevi/ranking-backed predictions, recommendations, streaks and points', () => {
  const NOW = '2026-10-11T16:00:00Z';
  const clocked = (iso: string) => {
    const clock = { now: new Date(iso) };
    const api = new FakeApi({ storage: null, latency: 0, now: () => clock.now });
    return { api, clock };
  };
  /** Ranks each Bev into its own (empty) bucket: no comparisons needed. Up to three. */
  const rankInto = async (api: FakeApi, bevId: string, i: number) =>
    api.rankings.submitRanking({ bevId, bucket: BUCKET_ORDER[i]!, insertIndex: 0, expectedBucketSize: 0, comparisons: [] });

  it('the test user gets a prediction on an unranked Bev (above MIN_N_USER) and none on a ranked one', async () => {
    const { api } = clocked(NOW);
    await signInMe(api);
    const mine = (await api.rankings.listMine()).items;
    expect(mine.length).toBeGreaterThanOrEqual(MIN_N_USER);
    const ranked = new Set(mine.map((r) => r.bevId));
    const unranked = (await api.bevs.search({ q: '', limit: 100 })).items.find((b) => !ranked.has(b.id))!;
    const bev = await api.bevs.get(unranked.id);
    expect(bev.prediction).toMatchObject({ rankingVersion: RANKING_VERSION, generatedAt: new Date(NOW).toISOString() });
    expect(bev.prediction!.score).toBeGreaterThanOrEqual(0);
    expect(bev.prediction!.score).toBeLessThanOrEqual(10);
    expect(bev.prediction!.confidence).toBeGreaterThanOrEqual(0);
    expect(bev.prediction!.confidence).toBeLessThanOrEqual(1);
    expect((await api.bevs.get(mine[0]!.bevId)).prediction).toBeNull();
  });

  it('prediction is null below MIN_N_USER rankings and appears once the user reaches it', async () => {
    const { api } = clocked(NOW);
    await api.signUp({ username: 'predictor', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    const ids = (await api.bevs.getStarterCandidates()).map((b) => b.id);
    const target = ids[MIN_N_USER]!;
    for (let i = 0; i < MIN_N_USER; i++) {
      expect((await api.bevs.get(target)).prediction).toBeNull();
      await rankInto(api, ids[i]!, i);
    }
    expect((await api.bevs.get(target)).prediction).not.toBeNull();
  });

  it('the test user\'s Recommended list has unlocked bubbles and is stable within a local day', async () => {
    const { api, clock } = clocked('2026-10-11T12:00:00Z');
    await signInMe(api);
    const morning = await api.recs.getRecommendations();
    expect(morning.basedOnCount).toBe(12);
    expect(morning.items.filter((r) => r.confidence >= CONFIDENCE_LOCK).length).toBeGreaterThan(3);
    expect(morning.items.some((r) => r.isExploration)).toBe(true);
    // 20:00Z is still 2026-10-11 in the test user's America/New_York: same seed, same list.
    clock.now = new Date('2026-10-11T20:00:00Z');
    const evening = await api.recs.getRecommendations();
    const strip = (items: typeof morning.items) => items.map(({ generatedAt: _g, ...rest }) => rest);
    expect(strip(evening.items)).toEqual(strip(morning.items));
    expect(evening.generatedAt).toBe('2026-10-11T20:00:00.000Z');
  });

  it('streaks count local days in the profile timezone and break after a missed day', async () => {
    const { api, clock } = clocked('2026-10-12T03:00:00Z'); // 2026-10-11 23:00 in New York
    await api.signUp({ username: 'streaker', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    await api.profile.updateMe({ timezone: 'America/New_York' });
    const ids = (await api.bevs.getStarterCandidates()).map((b) => b.id);
    await rankInto(api, ids[0]!, 0);
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 1, longestStreak: 1, streakAliveToday: true });

    clock.now = new Date('2026-10-12T14:00:00Z'); // same UTC day, but the next local day
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 1, streakAliveToday: false });
    await rankInto(api, ids[1]!, 1);
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 2, longestStreak: 2, streakAliveToday: true });

    clock.now = new Date('2026-10-14T14:00:00Z'); // 2026-10-13 missed
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 0, longestStreak: 2, streakAliveToday: false });
    await rankInto(api, ids[2]!, 2);
    expect(await api.stats.getMine()).toMatchObject({ currentStreak: 1, longestStreak: 2, streakAliveToday: true });
  });

  it('removing today\'s ranking does not break the streak', async () => {
    const { api } = clocked(NOW);
    await api.signUp({ username: 'remover', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    const [id] = (await api.bevs.getStarterCandidates()).map((b) => b.id);
    await rankInto(api, id!, 0);
    await api.rankings.removeRanking(id!);
    expect(await api.stats.getMine()).toMatchObject({ bevdCount: 0, currentStreak: 1, streakAliveToday: true });
  });

  it('the user leaderboard\'s order, ranks and points are rankUsers over the fake\'s data', async () => {
    const now = new Date(NOW);
    const { api } = clocked(NOW);
    await signInMe(api);
    const db = buildFixtures(now);
    const rows = [];
    for (const u of db.users) {
      const stats = await api.stats.getUser(u.id);
      const created = new Set(db.bevs.filter((b) => b.createdById === u.id).map((b) => b.id));
      const bevsCreated = new Set(db.rankings.filter((r) => r.userId !== u.id && created.has(r.bevId)).map((r) => r.bevId)).size;
      rows.push({ userId: u.id, bevsRanked: stats.bevdCount, currentStreak: stats.currentStreak, bevsCreated, createdAt: u.createdAt });
      if (stats.rankOnBevi !== null) expect(stats.rankPoints).toBeGreaterThan(0);
    }
    const expected = rankUsers(rows);
    const board = (await api.leaderboard.users()).items;
    expect(board.map((r) => ({ userId: r.profile.id, points: r.points, rank: r.rank }))).toEqual(expected);
    for (const r of board) {
      const stats = await api.stats.getUser(r.profile.id);
      expect(stats).toMatchObject({ rankOnBevi: r.rank, rankPoints: r.points, currentStreak: r.currentStreak });
    }
    // The seed plants streaks (the test user ranked today and yesterday).
    expect((await api.stats.getMine()).currentStreak).toBeGreaterThanOrEqual(2);
  });
});

describe('likes (S-02)', () => {
  it('like and unlike are idempotent and show on the feed item; an unknown post is not_found', async () => {
    const api = make();
    await signInMe(api);
    const [post] = (await api.feed.getFeed()).items;
    expect(post).toMatchObject({ likeCount: 0, likedByMe: false });

    await api.feed.like(post!.id);
    await api.feed.like(post!.id);
    expect((await api.feed.getFeed()).items.find((i) => i.id === post!.id)).toMatchObject({ likeCount: 1, likedByMe: true });

    await api.feed.unlike(post!.id);
    await api.feed.unlike(post!.id);
    expect((await api.feed.getFeed()).items.find((i) => i.id === post!.id)).toMatchObject({ likeCount: 0, likedByMe: false });

    const missing = await api.feed.like('feed-does-not-exist').catch((e: unknown) => e);
    expect(isApiError(missing) && missing.code).toBe('not_found');
  });
});

describe('comments (S-03)', () => {
  /** FRIEND's newest post, which ME (following FRIEND) can see. */
  async function friendsPost(api: FakeApi) {
    const post = (await api.feed.getFeed()).items.find((i) => i.actor.handle === FRIEND.handle);
    expect(post).toBeDefined();
    return post!;
  }

  it('add trims, lists newest first in keyset pages, and the feed carries the count and the first seven', async () => {
    const api = make();
    await signInMe(api);
    const post = await friendsPost(api);
    expect(post).toMatchObject({ commentCount: 0, comments: [] });

    const added = await api.comments.add(post.id, '  one  ');
    expect(added).toMatchObject({ body: 'one', author: { handle: ME.handle } });
    for (let i = 2; i <= 9; i++) await api.comments.add(post.id, `c${i}`);

    const first = await api.comments.list(post.id, { limit: 5 });
    expect(first.items.map((c) => c.body)).toEqual(['c9', 'c8', 'c7', 'c6', 'c5']);
    // A comment added between pages doesn't shift the next one.
    await api.comments.add(post.id, 'c10');
    const second = await api.comments.list(post.id, { cursor: first.nextCursor!, limit: 5 });
    expect(second.items.map((c) => c.body)).toEqual(['c4', 'c3', 'c2', 'one']);
    expect(second.nextCursor).toBeNull();

    const item = (await api.feed.getFeed()).items.find((i) => i.id === post.id)!;
    expect(item.commentCount).toBe(10);
    expect(item.comments.map((c) => c.body)).toEqual(['one', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  });

  it('add refuses empty and over 280 characters; an unseen post is not_found', async () => {
    const api = make();
    await signInMe(api);
    const post = await friendsPost(api);
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (isApiError(e) ? e.code : e));
    expect(await code(api.comments.add(post.id, ' \n\t '))).toBe('validation');
    expect(await code(api.comments.add(post.id, 'x'.repeat(281)))).toBe('validation');
    expect(await code(api.comments.add(post.id, 'x'.repeat(280)))).toBe('ok');
    expect(await code(api.comments.add('feed-does-not-exist', 'hi'))).toBe('not_found');
    expect(await code(api.comments.list('feed-does-not-exist'))).toBe('not_found');
  });

  it("remove is own comments only and idempotent; removed comments leave the count", async () => {
    const api = make();
    await signInMe(api);
    const post = await friendsPost(api);
    const mine = await api.comments.add(post.id, 'mine');
    api.signInAs(FRIEND.handle);
    const theirs = await api.comments.add(post.id, 'theirs');
    const removeTheirs = await api.comments.remove(mine.id).catch((e: unknown) => e);
    expect(isApiError(removeTheirs) && removeTheirs.code).toBe('not_found');

    api.signInAs(ME.handle);
    await api.comments.remove(mine.id);
    await api.comments.remove(mine.id);
    expect((await api.comments.list(post.id)).items.map((c) => c.id)).toEqual([theirs.id]);
    expect((await api.feed.getFeed()).items.find((i) => i.id === post.id)).toMatchObject({ commentCount: 1 });
  });
});

describe('feed.getBevOfPeriod', () => {
  // Fixtures are built at 2026-10-11; the clock then moves past all of them, so the
  // only rankings in November are this test's.
  const setup = async () => {
    const clock = { now: new Date('2026-10-11T16:00:00Z') };
    const api = new FakeApi({ storage: null, latency: 0, now: () => clock.now });
    await api.signUp({ username: 'periodic', password: 'password1', inviteCode: FAKE_INVITE_CODE });
    await api.profile.setBirthDate('1990-05-05');
    return { api, clock };
  };
  const rankFirst = (api: FakeApi, bevId: string) =>
    api.rankings.submitRanking({ bevId, bucket: 'LOVED', insertIndex: 0, expectedBucketSize: 0, comparisons: [] });

  it('uses the New York day and ISO week, and falls back to the latest non-empty period', async () => {
    const { api, clock } = await setup();
    const [bev] = await api.bevs.getStarterCandidates();
    // Tuesday 2026-11-10, 22:30 in New York (already the 11th in UTC).
    clock.now = new Date('2026-11-11T03:30:00Z');
    await rankFirst(api, bev!.id);

    const now = await api.feed.getBevOfPeriod();
    expect(now.day).toMatchObject({ bev: { id: bev!.id }, periodStart: '2026-11-10', isCurrent: true, rankingsInPeriod: 1 });
    expect(now.week).toMatchObject({ bev: { id: bev!.id }, periodStart: '2026-11-09', isCurrent: true });
    // One rating is enough to win, and the card gets the score it won with.
    expect(typeof now.day!.bev.bayesScore).toBe('number');

    clock.now = new Date('2026-11-13T17:00:00Z'); // Friday: nothing ranked today
    const friday = await api.feed.getBevOfPeriod();
    expect(friday.day).toMatchObject({ periodStart: '2026-11-10', isCurrent: false });
    expect(friday.week).toMatchObject({ periodStart: '2026-11-09', isCurrent: true });

    clock.now = new Date('2026-11-18T17:00:00Z'); // the next week, still empty
    expect((await api.feed.getBevOfPeriod()).week).toMatchObject({ periodStart: '2026-11-09', isCurrent: false });
  });

  it('never gives a minor an alcoholic winner', async () => {
    const { api, clock } = await setup();
    clock.now = new Date('2026-11-11T17:00:00Z');
    await rankFirst(api, ALCOHOLIC_BEV_ID);
    expect((await api.feed.getBevOfPeriod()).day).toMatchObject({ bev: { id: ALCOHOLIC_BEV_ID }, isCurrent: true });

    api.signInAs('minor_user');
    const minor = await api.feed.getBevOfPeriod();
    expect([minor.day?.bev.id, minor.week?.bev.id]).not.toContain(ALCOHOLIC_BEV_ID);
    // Its latest visible period is from the fixtures, not today.
    expect(minor.day?.isCurrent).toBe(false);
  });
});
