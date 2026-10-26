// Layer 2 (§8.9): user-user collaborative filtering in z-units.

import { CF_K, CF_MIN_COMMON, CF_SIGNIFICANCE } from './constants.ts';
import { snapshotContext, type SnapshotContext } from './context.ts';
import { pearsonSimilarity } from './graph.ts';
import type { BevId, Layer2Result, PredictionSnapshot, PredictOptions, UserId, UserSimilarityKind } from './types.ts';

/** Cosine of two equal-length vectors; 0 when either is all zeros. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * The option's value, default 'cosine'. Throws on anything else, so a typo from untyped JS can't
 * silently fall back to the default.
 */
export function userSimilarityKind(opts?: PredictOptions): UserSimilarityKind {
  const kind = opts?.userSimilarity ?? 'cosine';
  if (kind !== 'cosine' && kind !== 'pearson') throw new RangeError(`userSimilarity must be 'cosine' or 'pearson', got ${String(kind)}`);
  return kind;
}

function computeSim(ctx: SnapshotContext, u: UserId, v: UserId): number {
  const zu = ctx.z.get(u);
  const zv = ctx.z.get(v);
  if (!zu || !zv || u === v) return 0;
  const a: number[] = [];
  const b: number[] = [];
  for (const [bev, z] of zu) {
    const other = zv.get(bev);
    if (other !== undefined) {
      a.push(z);
      b.push(other);
    }
  }
  if (a.length < CF_MIN_COMMON) return 0;
  return (cosineSimilarity(a, b) * Math.min(a.length, CF_SIGNIFICANCE)) / CF_SIGNIFICANCE;
}

function computePearsonSim(ctx: SnapshotContext, u: UserId, v: UserId): number {
  const zu = ctx.z.get(u);
  const zv = ctx.z.get(v);
  if (!zu || !zv || u === v) return 0;
  return pearsonSimilarity(zu, zv).sim;
}

function simsOf(ctx: SnapshotContext, u: UserId, kind: UserSimilarityKind): Map<UserId, number> {
  const cache = kind === 'pearson' ? ctx.userSimsPearson : ctx.userSims;
  const compute = kind === 'pearson' ? computePearsonSim : computeSim;
  let m = cache.get(u);
  if (!m) {
    m = new Map();
    for (const v of ctx.z.keys()) if (v !== u) m.set(v, compute(ctx, u, v));
    cache.set(u, m);
  }
  return m;
}

/**
 * The significance-weighted similarity sim'(u, v) that Layer 2 weights neighbours by, 0 when
 * |common| < 2 (or u = v):
 * - `userSimilarity: 'cosine'` (default, §8.9): cosine(z_u[common], z_v[common]) · min(|common|, 5) / 5;
 * - `userSimilarity: 'pearson'`: `pearsonSimilarity(z_u, z_v).sim`, i.e. Pearson re-centred on the
 *   common Bevs · min(1, |common| / 5) (docs/graph_db_implementation.md Stage 3; 0 when either user
 *   is constant on the common Bevs).
 */
export function userSimilarity(snapshot: PredictionSnapshot, u: UserId, v: UserId, opts?: PredictOptions): number {
  const ctx = snapshotContext(snapshot);
  const kind = userSimilarityKind(opts);
  return u === v ? 0 : (simsOf(ctx, u, kind).get(v) ?? 0);
}

/**
 * N_k = the top K = 10 users v with sim'(u, v) > 0 who ranked b (ties: userId asc);
 * ẑ2 = Σ sim'·z_{v,b} / Σ sim'; support = Σ sim'. No neighbour → { z: 0, support: 0 }.
 * `opts.userSimilarity` picks sim' (see `userSimilarity`); everything else is the same either way.
 */
export function layer2(snapshot: PredictionSnapshot, userId: UserId, bevId: BevId, opts?: PredictOptions): Layer2Result {
  const ctx = snapshotContext(snapshot);
  const sims = simsOf(ctx, userId, userSimilarityKind(opts));
  const candidates = (ctx.raters.get(bevId) ?? [])
    .filter((r) => r.userId !== userId)
    .map((r) => ({ userId: r.userId, z: r.z, sim: sims.get(r.userId) ?? 0 }))
    .filter((r) => r.sim > 0)
    .sort((a, b) => b.sim - a.sim || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .slice(0, CF_K);
  let support = 0;
  let weighted = 0;
  for (const c of candidates) {
    support += c.sim;
    weighted += c.sim * c.z;
  }
  return { z: support > 0 ? weighted / support : 0, support, neighbours: candidates.map((c) => c.userId) };
}
