// The FakeApi's in-memory database and its optional persistence. TEST-ONLY (src/testing/**).

import type { Bucket, CategoryId, FeedEventKind, PriceTier } from '@bevi/shared';

export interface FakeUser {
  id: string;
  handle: string;
  /** Plain text: an in-memory test double, never a real credential store. */
  password: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  createdAt: string;
  birthdate: string | null;
  onboarded: boolean;
}

export interface FakeBev {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  categoryId: CategoryId;
  /**
   * A-13: the Bev's leaf under `categoryId`, or null when it sits on the parent
   * -- the state of the two unsplit roots and of every Bev `bevs.create` makes,
   * since the wizard only offers the 15.
   */
  leafCategoryId: string | null;
  priceTier: PriceTier;
  priceEstimated: boolean;
  isStarter: boolean;
  aliases: string[];
  /** Asset ids from `media.upload`; null for seeded Bevs (the UI falls back to BevArt). */
  photoAssetId: string | null;
  labelAssetId: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface FakeRanking {
  id: string;
  userId: string;
  bevId: string;
  bucket: Bucket;
  position: number;
  score: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FakeComparison {
  rankingId: string;
  userId: string;
  winnerBevId: string;
  loserBevId: string;
  tie: boolean;
  createdAt: string;
}

export interface FakeFollow {
  followerId: string;
  followeeId: string;
  createdAt: string;
}

export interface FakeWantToTry {
  userId: string;
  bevId: string;
  savedAt: string;
  viaUserId: string | null;
}

export interface FakeFeedEvent {
  id: string;
  type: FeedEventKind;
  actorId: string;
  bevId: string;
  createdAt: string;
}

export interface FakeLike {
  userId: string;
  feedEventId: string;
}

export interface FakeComment {
  /** `comment-<seq>`: the seq orders comments and keys `comments.list`'s cursor. */
  id: string;
  feedEventId: string;
  userId: string;
  body: string;
  createdAt: string;
  /** Soft delete, as `delete_comment` does: a removed comment stays so a second remove is a no-op. */
  deleted?: boolean;
}

export interface FakeFeatured {
  bevId: string;
  heroImageUrl: string;
  tagline: string | null;
  startsAt: string;
  endsAt: string | null;
}

export interface FakeAsset {
  id: string;
  userId: string;
  kind: 'bev-photo' | 'label' | 'avatar';
  url: string;
  mimeType: string;
  /** Background removal "finishes" at this time (status flips to 'ready'). */
  readyAt: string;
}

export interface FakeReport {
  bevId: string;
  userId: string;
  reason: string;
  /** S-13: the Bev this one duplicates, when the report names one. Missing on older stored dbs. */
  duplicateOfId?: string | null;
  createdAt: string;
}

export interface FakeDb {
  schema: number;
  users: FakeUser[];
  bevs: FakeBev[];
  rankings: FakeRanking[];
  comparisons: FakeComparison[];
  follows: FakeFollow[];
  wantToTry: FakeWantToTry[];
  feed: FakeFeedEvent[];
  /** Optional so a db stored before likes existed still loads. */
  likes?: FakeLike[];
  /** Optional so a db stored before comments existed still loads. */
  comments?: FakeComment[];
  featured: FakeFeatured[];
  assets: FakeAsset[];
  reports: FakeReport[];
  /** The signed-in user, persisted like a real session. */
  sessionUserId: string | null;
  /** Monotonic id counter. */
  seq: number;
  /**
   * false while the data is exactly the seeded fixtures (signing in or out doesn't count). A clean
   * stored db is re-seeded relative to "now" on load, so streaks and recent activity stay current
   * on later days; once anything is written it is kept as is. Missing = dirty.
   */
  dirty?: boolean;
}

/** Bump when FakeDb's shape changes; a stored db with another schema is discarded. */
export const FAKE_DB_SCHEMA = 1;

export const STORAGE_KEY = 'bevi.fake.db';

/** The subset of the Web Storage API the FakeApi uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadDb(storage: StorageLike | null): FakeDb | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const db = JSON.parse(raw) as FakeDb;
    return db && db.schema === FAKE_DB_SCHEMA ? db : null;
  } catch {
    return null;
  }
}

/** Best effort: a full or blocked storage leaves the in-memory state authoritative. */
export function saveDb(storage: StorageLike | null, db: FakeDb): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Quota exceeded or storage blocked: keep going in memory.
  }
}

export function clearDb(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Deep copy of plain JSON data, so callers can never mutate the fake's state. */
export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
