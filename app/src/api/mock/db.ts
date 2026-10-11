// The mock's in-memory database and its persistence. MOCK ONLY: everything under
// app/src/api/mock/ is deleted when the real API takes over (see client.ts).

import type { Bucket, CategoryId, FeedEventKind, PriceTier } from '@bevi/shared';

export interface MockUser {
  id: string;
  handle: string;
  /** Plain text: this is a local mock, never a real credential store. */
  password: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  createdAt: string;
  birthdate: string | null;
  onboarded: boolean;
}

export interface MockBev {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  categoryId: CategoryId;
  priceTier: PriceTier;
  priceEstimated: boolean;
  isStarter: boolean;
  aliases: string[];
  /** Asset ids from `media.upload`; null for seeded Bevs (the UI falls back to BevArt). */
  photoAssetId: string | null;
  labelAssetId: string | null;
  createdById: string | null;
  createdAt: string;
  /** true for the ~40 mock-only Bevs that are not in data/catalog. */
  mockOnly: boolean;
}

export interface MockRanking {
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

export interface MockComparison {
  rankingId: string;
  userId: string;
  winnerBevId: string;
  loserBevId: string;
  tie: boolean;
  createdAt: string;
}

export interface MockFollow {
  followerId: string;
  followeeId: string;
  createdAt: string;
}

export interface MockWantToTry {
  userId: string;
  bevId: string;
  savedAt: string;
  viaUserId: string | null;
}

export interface MockFeedEvent {
  id: string;
  type: FeedEventKind;
  actorId: string;
  bevId: string;
  createdAt: string;
}

export interface MockFeatured {
  bevId: string;
  heroImageUrl: string;
  tagline: string | null;
  startsAt: string;
  endsAt: string | null;
}

export interface MockAsset {
  id: string;
  userId: string;
  kind: 'bev-photo' | 'label';
  url: string;
  mimeType: string;
  /** Background removal "finishes" at this time (status flips to 'ready'). */
  readyAt: string;
}

export interface MockReport {
  bevId: string;
  userId: string;
  reason: string;
  createdAt: string;
}

export interface MockDb {
  schema: number;
  users: MockUser[];
  bevs: MockBev[];
  rankings: MockRanking[];
  comparisons: MockComparison[];
  follows: MockFollow[];
  wantToTry: MockWantToTry[];
  feed: MockFeedEvent[];
  featured: MockFeatured[];
  assets: MockAsset[];
  reports: MockReport[];
  /** The signed-in user, persisted like a real session. */
  sessionUserId: string | null;
  /** Monotonic id counter. */
  seq: number;
  /**
   * false while the data is exactly the seeded fixtures (signing in or out doesn't count). A clean
   * stored db is re-seeded relative to "now" on load, so the demo's streaks and recent activity
   * stay current on later days; once anything is written it is kept as is. Missing = dirty.
   */
  dirty?: boolean;
}

/** Bump when MockDb's shape changes; a stored db with another schema is discarded. */
export const MOCK_DB_SCHEMA = 1;

export const STORAGE_KEY = 'bevi.mock.db';

/** The subset of the Web Storage API the mock uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `localStorage` when it exists and works (web), else null (memory only). Never throws. */
export function webStorage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!ls) return null;
    const probe = `${STORAGE_KEY}.probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

export function loadDb(storage: StorageLike | null): MockDb | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const db = JSON.parse(raw) as MockDb;
    return db && db.schema === MOCK_DB_SCHEMA ? db : null;
  } catch {
    return null;
  }
}

/** Best effort: a full or blocked storage leaves the in-memory state authoritative. */
export function saveDb(storage: StorageLike | null, db: MockDb): void {
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

/** Deep copy of plain JSON data, so callers can never mutate the mock's state. */
export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
