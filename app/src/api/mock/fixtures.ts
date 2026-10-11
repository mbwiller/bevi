// Builds the mock's starting database from the catalog seed (seed/catalog.json, generated from
// data/catalog by app/scripts/build-mock-seed.mjs) and the mock-only extras (seed/extra.ts).
// Deterministic for a given `now`: rankings come from @bevi/ranking's seeded PRNG and respaceBucket,
// so every stored score is exactly what the real server would store for that position.

import { BUCKET_ORDER, createPrng, randomInt, respaceBucket, type Bucket } from '@bevi/ranking';
import type { CategoryId, PriceTier } from '@bevi/shared';

import { MOCK_DB_SCHEMA, type MockBev, type MockDb, type MockRanking, type MockUser } from './db';
import catalog from './seed/catalog.json';
import { EXTRA_BEVS, EXTRA_FEATURED, EXTRA_USERS } from './seed/extra';

const DAY = 24 * 60 * 60 * 1000;

export interface CatalogCategory {
  id: CategoryId;
  name: string;
  sortOrder: number;
  isAlcoholic: boolean;
}

export const CATEGORIES: readonly CatalogCategory[] = catalog.categories as CatalogCategory[];
export const ALCOHOLIC = new Set<CategoryId>(CATEGORIES.filter((c) => c.isAlcoholic).map((c) => c.id));

export function userIdFor(handle: string): string {
  return `mock-user-${handle}`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function ageOn(birthdate: string, now: Date): number {
  const [y, m, d] = birthdate.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}

/** age ≥ 21 on `now`; false with no birthdate. */
export function isAdult(birthdate: string | null, now: Date): boolean {
  return birthdate != null && ageOn(birthdate, now) >= 21;
}

export function buildFixtures(now: Date = new Date()): MockDb {
  const t = now.getTime();
  const catalogCreated = iso(t - 120 * DAY);

  const bevs: MockBev[] = [
    ...catalog.bevs.map((cb) => ({
      id: cb.id,
      name: cb.name,
      brand: cb.brand,
      flavor: cb.flavor,
      categoryId: cb.categoryId as CategoryId,
      priceTier: cb.priceTier as PriceTier,
      priceEstimated: cb.priceEstimated,
      isStarter: cb.isStarter,
      aliases: cb.aliases,
      photoAssetId: null,
      labelAssetId: null,
      createdById: null,
      createdAt: catalogCreated,
      mockOnly: false,
    })),
    ...EXTRA_BEVS.map((eb, i) => ({
      id: eb.id,
      name: eb.name,
      brand: eb.brand,
      flavor: eb.flavor,
      categoryId: eb.categoryId,
      priceTier: eb.priceTier,
      priceEstimated: false,
      isStarter: eb.isStarter,
      aliases: eb.aliases ?? [],
      photoAssetId: null,
      labelAssetId: null,
      createdById: eb.createdBy ? userIdFor(eb.createdBy) : null,
      createdAt: eb.createdBy ? iso(t - (20 + i) * DAY) : catalogCreated,
      mockOnly: true,
    })),
  ];
  const bevById = new Map(bevs.map((bev) => [bev.id, bev]));

  const users: MockUser[] = EXTRA_USERS.map((u) => ({
    id: userIdFor(u.handle),
    handle: u.handle,
    password: u.password,
    displayName: u.displayName,
    avatarUrl: null,
    timezone: u.timezone,
    createdAt: iso(t - u.joinedDaysAgo * DAY),
    birthdate: u.birthdate,
    onboarded: true,
  }));

  const rankings: MockRanking[] = [];
  const feed: MockDb['feed'] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  for (const u of EXTRA_USERS) {
    const userId = userIdFor(u.handle);
    const rand = createPrng(`bevi-mock-v1:${u.handle}`);
    const adult = isAdult(u.birthdate, now);
    // Shuffle the visible catalog (Fisher-Yates with the seeded PRNG) and take the first N.
    const pool = bevs.filter((bev) => adult || !ALCOHOLIC.has(bev.categoryId)).map((bev) => bev.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randomInt(rand, i + 1);
      [pool[i], pool[j]] = [pool[j] as string, pool[i] as string];
    }
    // Prefer Bevs they have a taste for so their lists look like a person's.
    const picked = pool
      .map((id) => ({ id, w: (u.taste[bevById.get(id)!.categoryId] ?? 0) + rand() }))
      .sort((a, z) => z.w - a.w)
      .slice(0, u.rankings)
      .map((p) => p.id);

    // Planted taste + noise → a bucket and an order within it.
    const valued = picked.map((id) => ({ id, v: (u.taste[bevById.get(id)!.categoryId] ?? 0) + (rand() - 0.5) * 1.4 }));
    const byBucket: Record<Bucket, string[]> = { LOVED: [], FINE: [], DISLIKED: [] };
    for (const { id, v } of valued.sort((a, z) => z.v - a.v)) {
      byBucket[v > 0.3 ? 'LOVED' : v < -0.3 ? 'DISLIKED' : 'FINE'].push(id);
    }

    // When each ranking happened: one per day for the streak (today backwards), the rest earlier.
    const times = picked.map((_, i) => {
      const day = i < u.streakDays ? i : u.streakDays + 1 + randomInt(rand, 40);
      const offset = day === 0 ? (0.25 + rand()) * 60 * 60 * 1000 : day * DAY + randomInt(rand, 8 * 60) * 60 * 1000;
      return t - offset;
    });
    const timeOf = new Map(picked.map((id, i) => [id, times[i] as number]));

    for (const bucket of BUCKET_ORDER) {
      for (const r of respaceBucket(byBucket[bucket], bucket)) {
        const at = iso(timeOf.get(r.bevId)!);
        const id = nextId('rank');
        rankings.push({ id, userId, bevId: r.bevId, bucket, position: r.position, score: r.score, note: null, createdAt: at, updatedAt: at });
        feed.push({ id: nextId('feed'), type: 'RANKING', actorId: userId, bevId: r.bevId, createdAt: at });
      }
    }
  }

  // A few notes so FeedPost's note line has content.
  const notes = ['Tastes like flat Sprite', 'Better ice cold', 'My 3pm ritual', 'Way too sweet for me', 'Underrated'];
  rankings
    .filter((_, i) => i % 7 === 0)
    .forEach((r, i) => {
      r.note = notes[i % notes.length] ?? null;
    });

  const follows: MockDb['follows'] = EXTRA_USERS.flatMap((u, i) =>
    u.follows.map((f) => ({ followerId: userIdFor(u.handle), followeeId: userIdFor(f), createdAt: iso(t - (30 - i) * DAY) })),
  );

  const ranked = new Set(rankings.map((r) => `${r.userId}:${r.bevId}`));
  const wantToTry: MockDb['wantToTry'] = [];
  EXTRA_USERS.forEach((u, i) => {
    u.wantToTry.forEach((w, j) => {
      const userId = userIdFor(u.handle);
      if (ranked.has(`${userId}:${w.bevId}`) || !bevById.has(w.bevId)) return;
      const savedAt = iso(t - (i + 1) * 3 * 60 * 60 * 1000 - j * DAY);
      wantToTry.push({ userId, bevId: w.bevId, savedAt, viaUserId: w.via ? userIdFor(w.via) : null });
      feed.push({ id: nextId('feed'), type: 'SAVED', actorId: userId, bevId: w.bevId, createdAt: savedAt });
    });
  });

  const featured: MockDb['featured'] = EXTRA_FEATURED.map((f) => ({
    bevId: f.bevId,
    // The contract types heroImageUrl as a string; the mock has no images, so it is empty and the
    // card falls back to BevArt.
    heroImageUrl: '',
    tagline: f.tagline,
    startsAt: iso(t - 7 * DAY),
    endsAt: null,
  }));

  return {
    schema: MOCK_DB_SCHEMA,
    users,
    bevs,
    rankings,
    comparisons: [],
    follows,
    wantToTry,
    feed,
    featured,
    assets: [],
    reports: [],
    sessionUserId: null,
    seq,
    dirty: false,
  };
}
