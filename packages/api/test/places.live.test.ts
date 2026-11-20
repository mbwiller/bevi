// BEV-22: a ranking's place, end to end against a live local stack: the two
// migrations, PostgREST and this package together. Skipped without
// SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY like the other live suites, and also
// without SUPABASE_SERVICE_ROLE_KEY: a fresh stack has no venues (the import
// is a script, not a migration), and only the service role can insert one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBeviApi } from '../src/index.ts';
import type { AuthStorageAdapter } from '../src/client.ts';
import { randomTestUsername, TEST_INVITE_CODE } from './testUsername.ts';

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function memoryStorage(): AuthStorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

// Dublin: nothing imported is within thousands of kilometres, so "nearest" is exact.
const HERE = { lat: 53.3419, lng: -6.2643 };
const tag = `live${Date.now().toString(36)}`;
const NEAR_NAME = `${tag} Café Long Hall`;
const FAR_NAME = `${tag} Long Hall Annex`;

async function admin(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey!,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
}

describe.skipIf(!url || !publishableKey || !serviceKey)('where a Bev was had, against a live local stack', () => {
  const make = () => createBeviApi({ url: url!, publishableKey: publishableKey!, authStorage: memoryStorage() });
  const password = 'correct-horse-battery-staple';
  let nearId = '';
  let farId = '';

  beforeAll(async () => {
    const res = await admin('venues', {
      method: 'POST',
      body: JSON.stringify([
        { name: NEAR_NAME, kind: 'craft', lat: HERE.lat + 0.0001, lng: HERE.lng, address: '51 South Great George\'s Street', source: 'manual' },
        // PostgREST wants the same keys on every row of a bulk insert.
        { name: FAR_NAME, kind: 'craft', lat: HERE.lat + 0.01, lng: HERE.lng, address: null, source: 'manual' },
      ]),
    });
    expect(res.status).toBe(201);
    const rows = (await res.json()) as Array<{ id: string; name: string }>;
    nearId = rows.find((r) => r.name === NEAR_NAME)!.id;
    farId = rows.find((r) => r.name === FAR_NAME)!.id;
  });

  afterAll(async () => {
    await admin(`venues?name=like.${tag}*`, { method: 'DELETE' });
  });

  it('search: the nearest first, accents folded, and a venue outside New York is a venue', async () => {
    const api = make();
    await api.signUp({ username: randomTestUsername(), password, inviteCode: TEST_INVITE_CODE });
    try {
      const near = await api.venues.search({ query: '', near: HERE, limit: 2 });
      expect(near.map((m) => m.venue.id)).toEqual([nearId, farId]);
      expect(near[0]!.distanceMeters).toBeGreaterThan(5);
      expect(near[0]!.distanceMeters).toBeLessThan(20);

      // The annex shares the tag, so it may follow as a merely similar name; the match leads.
      const byName = await api.venues.search({ query: `${tag} cafe` });
      expect(byName[0]?.venue.name).toBe(NEAR_NAME);
      expect(byName[0]!.distanceMeters).toBeNull();

      await expect(api.venues.search({ query: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'validation' });
    } finally {
      await api.deleteAccount();
    }
  });

  it('a place is saved with the ranking, shown on the post and the map, kept by a re-rank and dropped with the ranking', async () => {
    const friend = make();
    const api = make();
    const { userId: friendId } = await friend.signUp({ username: randomTestUsername(), password, inviteCode: TEST_INVITE_CODE });
    const { userId: myId } = await api.signUp({ username: randomTestUsername(), password, inviteCode: TEST_INVITE_CODE });

    try {
      const [a, b] = await api.bevs.getStarterCandidates();
      const place = { bucket: 'LOVED' as const, insertIndex: 0, expectedBucketSize: 0, comparisons: [] };

      // A venue that does not exist fails the whole submit.
      await expect(
        api.rankings.submitRanking({ bevId: a!.id, ...place, venueId: '00000000-0000-4000-8000-00000000dead' }),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect((await api.rankings.listMine()).items).toEqual([]);

      await api.rankings.submitRanking({ bevId: a!.id, ...place, venueId: nearId });
      await friend.rankings.submitRanking({ bevId: b!.id, ...place, venueId: nearId });

      const mine = (await api.rankings.listMine()).items[0]?.venue;
      expect(mine).toMatchObject({ id: nearId, name: NEAR_NAME, kind: 'craft', hoursKnown: false });
      expect(mine?.lat).toBeCloseTo(HERE.lat + 0.0001, 6);
      expect((await api.feed.getFeed()).items[0]?.venue?.id).toBe(nearId);
      expect(await api.rankings.locationSummary()).toEqual({ rankedCount: 1, locatedCount: 1 });

      // The map: mine only until I follow them.
      expect(await api.venues.bevdMap()).toEqual([expect.objectContaining({ bevCount: 1, mineCount: 1 })]);
      await api.follows.follow(friendId);
      expect(await api.venues.bevdMap()).toEqual([
        expect.objectContaining({ venue: expect.objectContaining({ id: nearId }), bevCount: 2, mineCount: 1 }),
      ]);
      const at = await api.venues.bevdAt(nearId);
      expect(at.items.map((i) => i.user.id).sort()).toEqual([friendId, myId].sort());
      expect(at.items.every((i) => i.ranking.venue?.id === nearId)).toBe(true);
      expect((await api.venues.bevdAt(nearId, { scope: 'friends' })).items.map((i) => i.ranking.bev.id)).toEqual([b!.id]);
      expect((await api.feed.getFeed()).items.find((i) => i.actor.id === friendId)?.venue?.id).toBe(nearId);

      // A re-rank replaces the ranking row; the place is keyed by (user, Bev) and stays.
      const rerank = (venueId?: string | null) =>
        api.rankings.rerankBev({ bevId: a!.id, bucket: 'FINE', insertIndex: 0, expectedBucketSize: 0, comparisons: [], venueId });
      await rerank();
      expect((await api.rankings.listMine()).items[0]?.venue?.id).toBe(nearId);
      await rerank(farId);
      expect((await api.rankings.listMine()).items[0]?.venue?.id).toBe(farId);
      await rerank(null);
      expect((await api.rankings.listMine()).items[0]?.venue).toBeNull();

      // setVenue, then the ranking goes and takes the place with it.
      expect((await api.rankings.setVenue(a!.id, farId))?.id).toBe(farId);
      await api.rankings.removeRanking(a!.id);
      expect(await api.venues.bevdMap({ scope: 'mine' })).toEqual([]);
      await expect(api.rankings.setVenue(a!.id, farId)).rejects.toMatchObject({ code: 'not_found' });
    } finally {
      await api.deleteAccount();
      await friend.deleteAccount();
    }
  });
});
