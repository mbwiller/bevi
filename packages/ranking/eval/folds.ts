// Leakage-safe folds. A fold is "the dataset as it would have been had these (user, Bev) rows
// never been ranked": a brand-new PredictionSnapshot object built from the training rows only.
//
// Leaks this closes (each has a test in test/eval-folds.test.ts):
//   1. User stats. snapshotContext prefers snapshot.users[u].stats over deriving them, so a stale
//      μ, σ, n would leak the held-out score through ŝ = μ_u + σ_u·ẑ. Every user's stats (and
//      categoryStats) are recomputed from the training rows.
//   2. Context cache. snapshotContext caches in a WeakMap keyed on the snapshot object, so each fold
//      is a fresh object (fresh users, bevs, rankings and global records); nothing is mutated.
//   3. Bev stats and raters. Each Bev's ratingCount / mean / stddev are recomputed from training
//      rows, and `rankings` omits the held-out rows, so the raters globalScore() sums over (and the
//      Bayesian baseline's counts) cannot include the held-out z.
//   4. Global stats. global mean / stddev / byCategoryMean are recomputed from training rows.
//   5. Re-spacing (on by default). A stored score depends on the bucket's size and the Bev's
//      position, so the remaining scores of a user still "remember" a held-out Bev (a gap in the
//      spacing, one more Bev in the bucket). With `respace`, every user who lost a row has their
//      buckets re-spaced from position order with storedScore(), which is exactly what the app
//      would have stored had the Bev never been ranked (absent later re-ranks).

import { RANKING_VERSION } from '../src/constants.ts';
import { storedScore } from '../src/score.ts';
import { populationStats } from '../src/stats.ts';
import type { BevFeatures, BevId, CategoryId, PredictionSnapshot, Stats, UserId, UserSnapshot } from '../src/types.ts';
import type { CatalogFeatures, EvalRanking } from './dataset.ts';

export const rowKey = (userId: UserId, bevId: BevId): string => `${userId}\u0000${bevId}`;

/**
 * The rows minus `heldOut` (keys from `rowKey`). With `respace`, every user who lost a row gets
 * their remaining buckets re-spaced (order by position, then bevId; positions 0..n−1, stored score
 * from storedScore). Users who lost nothing keep their rows untouched. Never mutates its input.
 */
export function holdOut(rows: readonly EvalRanking[], heldOut: ReadonlySet<string>, respace: boolean): EvalRanking[] {
  if (heldOut.size === 0) return [...rows];
  const kept: EvalRanking[] = [];
  const touched = new Set<UserId>();
  for (const r of rows) {
    if (heldOut.has(rowKey(r.userId, r.bevId))) touched.add(r.userId);
    else kept.push(r);
  }
  if (!respace || touched.size === 0) return kept;

  const groups = new Map<string, EvalRanking[]>();
  for (const r of kept) {
    if (!touched.has(r.userId)) continue;
    const k = `${r.userId}\u0000${r.bucket}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const replaced = new Map<EvalRanking, EvalRanking>();
  for (const g of groups.values()) {
    g.sort((a, b) => a.position - b.position || (a.bevId < b.bevId ? -1 : a.bevId > b.bevId ? 1 : 0));
    const n = g.length;
    g.forEach((r, i) => replaced.set(r, { ...r, position: i, score: storedScore(i, n, r.bucket) }));
  }
  return kept.map((r) => replaced.get(r) ?? r);
}

/**
 * A fresh PredictionSnapshot from `rows` (which must already exclude held-out rows) and the
 * catalog. Every statistic is recomputed from `rows`; equivalent to test/snapshot-fixture.ts's
 * buildSnapshot() (asserted in the tests) but over every category and in O(rows + catalog).
 * Every user can see alcohol: evaluation scores every held-out Bev, recommend()'s age gate is not
 * under test. Rows on Bevs missing from the catalog are dropped.
 */
export function foldSnapshot(catalog: ReadonlyMap<BevId, CatalogFeatures>, rows: readonly EvalRanking[]): PredictionSnapshot {
  const rankings: PredictionSnapshot['rankings'] = [];
  const byBev = new Map<BevId, number[]>();
  const byUser = new Map<UserId, number[]>();
  const byUserCat = new Map<UserId, Map<CategoryId, number[]>>();
  const byCat = new Map<CategoryId, number[]>();
  const push = <K>(m: Map<K, number[]>, k: K, v: number) => {
    const l = m.get(k);
    if (l) l.push(v);
    else m.set(k, [v]);
  };
  for (const r of rows) {
    const bev = catalog.get(r.bevId);
    if (!bev) continue;
    rankings.push({ userId: r.userId, bevId: r.bevId, score: r.score });
    push(byBev, r.bevId, r.score);
    push(byUser, r.userId, r.score);
    push(byCat, bev.categoryId, r.score);
    let uc = byUserCat.get(r.userId);
    if (!uc) byUserCat.set(r.userId, (uc = new Map()));
    push(uc, bev.categoryId, r.score);
  }

  const bevs: Record<BevId, BevFeatures> = {};
  for (const [id, f] of catalog) {
    const s = populationStats(byBev.get(id) ?? []);
    bevs[id] = { ...f, flavorTokens: [...f.flavorTokens], ratingCount: s.n, mean: s.mean, stddev: s.stddev };
  }
  const users: Record<UserId, UserSnapshot> = {};
  for (const [id, scores] of byUser) {
    const categoryStats: Record<CategoryId, Stats> = {};
    for (const [c, s] of byUserCat.get(id) as Map<CategoryId, number[]>) categoryStats[c] = populationStats(s);
    users[id] = { id, stats: populationStats(scores), categoryStats, canSeeAlcohol: true };
  }
  const byCategoryMean: Record<CategoryId, number> = {};
  for (const c of [...byCat.keys()].sort()) byCategoryMean[c] = populationStats(byCat.get(c) as number[]).mean;
  const g = populationStats(rankings.map((r) => r.score));
  return {
    version: RANKING_VERSION,
    generatedAt: 'eval-fold',
    global: { mean: g.mean, stddev: g.stddev, byCategoryMean },
    bevs,
    users,
    rankings,
  };
}

/** Number of rankings each user has in `rows`. */
export function countsByUser(rows: readonly EvalRanking[]): Map<UserId, number> {
  const m = new Map<UserId, number>();
  for (const r of rows) m.set(r.userId, (m.get(r.userId) ?? 0) + 1);
  return m;
}
