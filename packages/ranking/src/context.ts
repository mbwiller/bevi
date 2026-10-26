// Derived data for one PredictionSnapshot (effective stats, z-scores, raters per Bev, user
// similarities), computed once per snapshot and cached in a WeakMap. Snapshots are treated as
// immutable once passed to predictScore / recommend.

import { RANKING_VERSION } from './constants.ts';
import { effectiveGlobalStats, effectiveUserStats, populationStats, zScore } from './stats.ts';
import type { BevId, MeanStd, PredictionSnapshot, Stats, UserId } from './types.ts';

export interface SnapshotContext {
  globalEffective: MeanStd;
  userStats: Map<UserId, Stats>;
  userEffective: Map<UserId, MeanStd>;
  /** z_{u,b} for every ranking, keyed user → Bev. */
  z: Map<UserId, Map<BevId, number>>;
  /** Users who ranked each Bev, with their z. */
  raters: Map<BevId, Array<{ userId: UserId; z: number }>>;
  /** Lazily filled: u → (v → sim'(u, v)), the cosine of §8.9 (the default). */
  userSims: Map<UserId, Map<UserId, number>>;
  /** Lazily filled: u → (v → Pearson · min(1, |common| / 5)), for `userSimilarity: 'pearson'`. */
  userSimsPearson: Map<UserId, Map<UserId, number>>;
}

const cache = new WeakMap<PredictionSnapshot, SnapshotContext>();
const EMPTY_STATS: Stats = { n: 0, mean: 0, stddev: 0 };

export function assertVersion(snapshot: PredictionSnapshot): void {
  if (snapshot.version !== RANKING_VERSION) {
    throw new Error(`PredictionSnapshot version ${snapshot.version} does not match RANKING_VERSION ${RANKING_VERSION}`);
  }
}

/**
 * Builds (or returns the cached) context. Choices where §8–§9 are silent:
 * - A user's μ, σ, n come from `snapshot.users[u].stats` (complete even when Arjun restricts
 *   `rankings` past ~500 users); a user missing from `users` gets stats from their rankings here.
 * - Global stats fall back to GLOBAL_FALLBACK only when `rankings` is empty.
 * - A duplicated (userId, bevId) ranking keeps the last row.
 */
export function snapshotContext(snapshot: PredictionSnapshot): SnapshotContext {
  assertVersion(snapshot);
  const hit = cache.get(snapshot);
  if (hit) return hit;

  const scores = new Map<UserId, Map<BevId, number>>();
  for (const r of snapshot.rankings) {
    let m = scores.get(r.userId);
    if (!m) scores.set(r.userId, (m = new Map()));
    m.set(r.bevId, r.score);
  }

  const global: Stats = { n: snapshot.rankings.length, mean: snapshot.global.mean, stddev: snapshot.global.stddev };
  const globalEffective = effectiveGlobalStats(global);
  const userStats = new Map<UserId, Stats>();
  const userEffective = new Map<UserId, MeanStd>();
  const ids = new Set<UserId>([...Object.keys(snapshot.users), ...scores.keys()]);
  for (const u of ids) {
    const s = snapshot.users[u]?.stats ?? (scores.has(u) ? populationStats([...(scores.get(u) as Map<BevId, number>).values()]) : EMPTY_STATS);
    userStats.set(u, s);
    userEffective.set(u, effectiveUserStats(s, global));
  }

  const z = new Map<UserId, Map<BevId, number>>();
  const raters = new Map<BevId, Array<{ userId: UserId; z: number }>>();
  for (const u of [...scores.keys()].sort()) {
    const eff = userEffective.get(u) as MeanStd;
    const zu = new Map<BevId, number>();
    for (const [b, s] of scores.get(u) as Map<BevId, number>) {
      const zv = zScore(s, eff);
      zu.set(b, zv);
      let list = raters.get(b);
      if (!list) raters.set(b, (list = []));
      list.push({ userId: u, z: zv });
    }
    z.set(u, zu);
  }

  const ctx: SnapshotContext = { globalEffective, userStats, userEffective, z, raters, userSims: new Map(), userSimsPearson: new Map() };
  cache.set(snapshot, ctx);
  return ctx;
}

export function effectiveStatsOf(ctx: SnapshotContext, u: UserId): MeanStd {
  return ctx.userEffective.get(u) ?? ctx.globalEffective;
}

export function nOf(ctx: SnapshotContext, u: UserId): number {
  return ctx.userStats.get(u)?.n ?? 0;
}
