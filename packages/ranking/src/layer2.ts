// Layer 2 (§8.9): user-user collaborative filtering in z-units.

import { CF_K, CF_MIN_COMMON, CF_SIGNIFICANCE } from './constants.ts';
import { neighbourLookup, nOf, snapshotContext, type SnapshotContext } from './context.ts';
import { neighbourReliability, pearsonSimilarity } from './graph.ts';
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
  if (kind !== 'cosine' && kind !== 'pearson' && kind !== 'stored') throw new RangeError(`userSimilarity must be 'cosine', 'pearson' or 'stored', got ${String(kind)}`);
  return kind;
}

/**
 * The user–user similarity Layer 2 actually uses for `userId` on this snapshot: 'stored' only when
 * the option asks for it AND the snapshot carries a `userNeighbours` field (not undefined or null)
 * AND that field holds a non-empty list for `userId`; a stored request otherwise falls back to
 * 'cosine', today's live engine (never 'pearson'). "No rows" covers both a user the nightly job has
 * not synced yet and one with nobody above TASTE_SIM_FLOOR; docs/graph_db_implementation.md §5
 * ("New users before the nightly sync") sends both to the in-snapshot computation, and the
 * fallback keeps the app working if the flag is switched on before `get_prediction_snapshot`
 * returns neighbours. 'cosine' and 'pearson' are returned as asked, without reading the field.
 * Throws on a malformed `userNeighbours` field in stored mode (see `neighbourLookup`), even when
 * `userId` has no rows.
 */
export function effectiveUserSimilarity(snapshot: PredictionSnapshot, userId: UserId, opts?: PredictOptions): UserSimilarityKind {
  const kind = userSimilarityKind(opts);
  if (kind !== 'stored') return kind;
  const rows = neighbourLookup(snapshot)?.get(userId);
  return rows !== undefined && rows.size > 0 ? 'stored' : 'cosine';
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

/**
 * sim'(u, v) = sim_B(u, v) · min(1, n_v / N₀) for each v in u's stored list (n_v from `nOf`: 0 for a
 * user unknown to the snapshot, so such a row weighs 0). Only listed users are keys.
 */
function storedSims(ctx: SnapshotContext, lookup: Map<UserId, Map<UserId, number>>, u: UserId): Map<UserId, number> {
  let m = ctx.userSimsStored.get(u);
  if (!m) {
    m = new Map();
    for (const [v, sim] of lookup.get(u) ?? []) m.set(v, sim * neighbourReliability(nOf(ctx, v)));
    ctx.userSimsStored.set(u, m);
  }
  return m;
}

/** u's similarities under `kind`, the EFFECTIVE kind (see `effectiveUserSimilarity`). */
function simsOf(snapshot: PredictionSnapshot, ctx: SnapshotContext, u: UserId, kind: UserSimilarityKind): Map<UserId, number> {
  if (kind === 'stored') return storedSims(ctx, neighbourLookup(snapshot) as Map<UserId, Map<UserId, number>>, u);
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
 * The similarity sim'(u, v) that Layer 2 weights u's neighbours by (0 for u = v):
 * - `userSimilarity: 'cosine'` (default, §8.9): cosine(z_u[common], z_v[common]) · min(|common|, 5) / 5,
 *   0 when |common| < 2;
 * - `userSimilarity: 'pearson'`: `pearsonSimilarity(z_u, z_v).sim`, i.e. Pearson re-centred on the
 *   common Bevs · min(1, |common| / 5) (docs/graph_db_implementation.md Stage 3; 0 when |common| < 2
 *   or either user is constant on the common Bevs);
 * - `userSimilarity: 'stored'` (Stage 4, LaTeX §6.4): sim_B(u, v) · min(1, n_v / N₀) when v is in
 *   u's stored list `snapshot.userNeighbours[u]` (sim_B as stored, N₀ = NEIGHBOUR_RELIABILITY_N,
 *   n_v = v's ranking count, 0 when v is unknown to the snapshot), and 0 for every v not listed,
 *   whatever their co-ratings say. |common| is not read: a listed neighbour with one co-rated Bev,
 *   whom the cosine gives 0, counts. Not symmetric (u's list and v's list are separate rows, and
 *   the reliability is v's). Falls back to 'cosine' when u has no stored rows.
 */
export function userSimilarity(snapshot: PredictionSnapshot, u: UserId, v: UserId, opts?: PredictOptions): number {
  const ctx = snapshotContext(snapshot);
  const kind = effectiveUserSimilarity(snapshot, u, opts);
  return u === v ? 0 : (simsOf(snapshot, ctx, u, kind).get(v) ?? 0);
}

/**
 * N_k = the top K = 10 users v with sim'(u, v) > 0 who ranked b (ties: userId asc);
 * ẑ2 = Σ sim'·z_{v,b} / Σ sim'; support = Σ sim'. No neighbour → { z: 0, support: 0 }.
 * `opts.userSimilarity` picks sim' (see `userSimilarity`, and `effectiveUserSimilarity` for the
 * stored mode's fallback); everything else is the same in every mode. In stored mode the
 * candidates are therefore u's listed neighbours who ranked b, and a negative stored sim is
 * dropped by the sim' > 0 rule like any other.
 */
export function layer2(snapshot: PredictionSnapshot, userId: UserId, bevId: BevId, opts?: PredictOptions): Layer2Result {
  const ctx = snapshotContext(snapshot);
  const sims = simsOf(snapshot, ctx, userId, effectiveUserSimilarity(snapshot, userId, opts));
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
