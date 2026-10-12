// The caller's PredictionSnapshot, for @bevi/ranking's predictScore() and
// recommend(), which run here in the client (no Edge Function at Bevi's
// size). `get_prediction_snapshot()` (20261012000600) returns the data as one
// jsonb value; this maps it to the snapshot type, plus a BevSummary per Bev so
// recommendation cards need no second round trip. Cached per signed-in user
// for a few minutes and dropped on every write that changes rankings or Bevs.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RANKING_VERSION,
  flavorTokens,
  normaliseBrand,
  type BevFeatures,
  type PredictionSnapshot,
  type Stats,
  type UserSnapshot,
} from '@bevi/ranking';
import { ApiError, type BevSummary, type CategoryId, type PhotoStatus, type PriceTier } from '@bevi/shared';
import { mapError } from './errors';
import { publicUrl } from './mappers';

const TTL_MS = 5 * 60 * 1000;

type Num = number | string | null;
type BevTuple = [string, string, string | null, string | null, string, number, boolean, string | null, boolean, number, Num, Num, Num];

interface SnapshotJson {
  generatedAt: string;
  viewer: { id: string; timezone: string | null; canSeeAlcohol: boolean; rankingCount: number };
  global: { n: number; mean: Num; stddev: Num; byCategoryMean: Record<string, Num> };
  users: Array<[string, number, Num, Num]>;
  categoryStats: Array<[string, string, number, Num, Num]>;
  bevs: BevTuple[];
  rankings: Array<[string, string, Num]>;
}

export interface ViewerSnapshot {
  snapshot: PredictionSnapshot;
  /** Card data for every Bev in the snapshot, by id. */
  summaries: Map<string, BevSummary>;
  viewer: { id: string; timezone: string; canSeeAlcohol: boolean; rankingCount: number };
}

/** numeric comes back from Postgres as a number or a string; null means no data. */
const num = (v: Num, fallback = 0): number => (v === null || v === undefined ? fallback : Number(v));
const stats = (n: number, mean: Num, sd: Num): Stats => ({ n, mean: num(mean), stddev: num(sd) });

export function toViewerSnapshot(client: SupabaseClient, json: SnapshotJson): ViewerSnapshot {
  const viewer = {
    id: json.viewer.id,
    timezone: json.viewer.timezone ?? 'UTC',
    canSeeAlcohol: json.viewer.canSeeAlcohol,
    rankingCount: json.viewer.rankingCount,
  };

  const bevs: Record<string, BevFeatures> = {};
  const summaries = new Map<string, BevSummary>();
  for (const [id, name, brand, flavor, categoryId, priceTier, priceEstimated, photoPath, isAlcoholic, ratingCount, mean, sd, bayes] of json.bevs) {
    bevs[id] = {
      id,
      categoryId: categoryId as CategoryId,
      brandKey: normaliseBrand(brand),
      flavorTokens: flavorTokens(name, flavor),
      priceTier: priceTier as PriceTier,
      ratingCount,
      mean: num(mean),
      stddev: num(sd),
      isAlcoholic,
    };
    summaries.set(id, {
      id,
      name,
      brand,
      flavor,
      categoryId: categoryId as CategoryId,
      photoUrl: publicUrl(client, 'bev-photos', photoPath),
      photoStatus: 'ready' as PhotoStatus,
      priceTier: priceTier as PriceTier,
      priceEstimated,
      ratingCount,
      bayesScore: bayes === null ? null : num(bayes),
    });
  }

  const users: Record<string, UserSnapshot> = {};
  for (const [alias, n, mean, sd] of json.users) {
    users[alias] = { id: alias, stats: stats(n, mean, sd), categoryStats: {}, canSeeAlcohol: alias === viewer.id && viewer.canSeeAlcohol };
  }
  for (const [alias, categoryId, n, mean, sd] of json.categoryStats) {
    const u = users[alias];
    if (u) u.categoryStats[categoryId as CategoryId] = stats(n, mean, sd);
  }

  const byCategoryMean: Record<string, number> = {};
  for (const [c, m] of Object.entries(json.global.byCategoryMean)) byCategoryMean[c] = num(m);

  const snapshot: PredictionSnapshot = {
    version: RANKING_VERSION,
    generatedAt: json.generatedAt,
    global: { mean: num(json.global.mean), stddev: num(json.global.stddev), byCategoryMean },
    bevs,
    users,
    rankings: json.rankings.map(([userId, bevId, score]) => ({ userId, bevId, score: num(score) })),
  };
  return { snapshot, summaries, viewer };
}

export interface SnapshotCache {
  /** `userId`'s snapshot (the signed-in user), fetched at most once per few minutes per user. */
  get(userId: string): Promise<ViewerSnapshot>;
  /** Forget it (after a ranking, re-rank, removal, new Bev, or a sign-in/out). */
  invalidate(): void;
}

export function createSnapshotCache(client: SupabaseClient): SnapshotCache {
  let cached: { userId: string; at: number; value: Promise<ViewerSnapshot> } | null = null;
  let generation = 0;
  return {
    get(userId) {
      if (cached && cached.userId === userId && Date.now() - cached.at < TTL_MS) return cached.value;
      const mine = ++generation;
      const value = (async () => {
        const { data, error } = await client.rpc('get_prediction_snapshot');
        if (error) throw mapError(error);
        const json = data as SnapshotJson;
        // The session can change between reading the user id and this call;
        // never file another user's snapshot under this one's key.
        if (json.viewer.id !== userId) throw new ApiError('unauthorized', 'The signed-in user changed');
        return toViewerSnapshot(client, json);
      })();
      cached = { userId, at: Date.now(), value };
      // A failed fetch isn't cached.
      value.catch(() => {
        if (generation === mine) cached = null;
      });
      return value;
    },
    invalidate() {
      generation++;
      cached = null;
    },
  };
}
