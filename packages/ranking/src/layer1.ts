// Layer 1 (§8.5, §8.6, §8.8): category affinity + content similarity + the Bev's global score.

import { CONF1_MASS, CONF1_USER_N, K_AFF, K_G, LAYER1_WEIGHTS, SIM_MIN } from './constants.ts';
import { edgeLookup, nOf, snapshotContext } from './context.ts';
import { contentSimilarity } from './similarity.ts';
import type { BevFeatures, BevId, BevSimilarityKind, Layer1Result, PredictionSnapshot, PredictOptions, UserId } from './types.ts';

export function bevOf(snapshot: PredictionSnapshot, bevId: BevId): BevFeatures {
  const bev = snapshot.bevs[bevId];
  if (!bev) throw new RangeError(`unknown bevId "${bevId}" in snapshot`);
  return bev;
}

/**
 * The option's value, default 'content'. Throws on anything else, so a typo from untyped JS can't
 * silently fall back to the default.
 */
export function bevSimilarityKind(opts?: PredictOptions): BevSimilarityKind {
  const kind = opts?.bevSimilarity ?? 'content';
  if (kind !== 'content' && kind !== 'edges') throw new RangeError(`bevSimilarity must be 'content' or 'edges', got ${String(kind)}`);
  return kind;
}

/**
 * The Bev–Bev similarity Layer 1 actually uses for this snapshot: 'edges' only when the option asks
 * for it AND the snapshot carries an `edges` field (an empty array counts: it means "no edges");
 * otherwise 'content'. The fallback keeps the app working if the flag is switched on before
 * `get_prediction_snapshot` returns edges (TASKS.md S-21). Throws on a malformed `edges` field in
 * edges mode (see `edgeLookup`).
 */
export function effectiveBevSimilarity(snapshot: PredictionSnapshot, opts?: PredictOptions): BevSimilarityKind {
  return bevSimilarityKind(opts) === 'edges' && edgeLookup(snapshot) !== null ? 'edges' : 'content';
}

/**
 * Normalised global score g_b = Σ_{v ranked b} z_{v,b} / (n_b + K_G): the mean z across raters,
 * shrunk toward 0 (§8.6). New Bev → 0. n_b is the number of raters present in
 * `snapshot.rankings` (so the sum and the count always cover the same rows); every rater counts,
 * including the target user if they ranked b, as the doc's formula says.
 */
export function globalScore(snapshot: PredictionSnapshot, bevId: BevId): number {
  const raters = snapshotContext(snapshot).raters.get(bevId) ?? [];
  let sum = 0;
  for (const r of raters) sum += r.z;
  return sum / (raters.length + K_G);
}

/**
 * ẑ1 = 0.40·affinity_{u,cat(b)} + 0.40·content_{u,b} + 0.20·g_b and
 * conf1 = min(1, n_u / 10) · min(1, (n_{u,cat(b)} + Σ sim(b, b')) / 4).
 *
 * - affinity = Σ z over u's rankings in cat(b) / (n_{u,c} + K_AFF), z against u's OVERALL
 *   effective stats; n_{u,c} counts those rankings (b included if u ranked it, per §8.5).
 * - content = Σ_{b' ranked by u, b' ≠ b} sim·z_{u,b'} / (Σ sim + 1), pairs with sim < SIM_MIN dropped
 *   from both sums; ranked Bevs missing from `snapshot.bevs` are skipped.
 * - n_u is `users[u].stats.n` (all the user's rankings).
 *
 * `opts.bevSimilarity` picks sim (see `effectiveBevSimilarity`):
 * - 'content' (default): sim = contentSimilarity(b, b'), the live engine, unchanged since 1.1.0;
 * - 'edges': sim = the stored edge weight w(b, b') from `snapshot.edges`, and 0 for a pair with no
 *   stored edge (it was pruned: below EDGE_MIN_WEIGHT or outside both Bevs' top EDGE_TOP_K), never
 *   the computed sim, so the sums never mix the two scales. SIM_MIN still applies to w (a no-op
 *   while EDGE_MIN_WEIGHT = 0.3 > SIM_MIN = 0.1). The same sim feeds conf1's similarity mass, so
 *   conf1 is lower where the graph links b to few of the user's Bevs. Affinity and g_b are
 *   unchanged. Falls back to 'content' when the snapshot has no `edges` field.
 */
export function layer1(snapshot: PredictionSnapshot, userId: UserId, bevId: BevId, opts?: PredictOptions): Layer1Result {
  const ctx = snapshotContext(snapshot);
  const bev = bevOf(snapshot, bevId);
  const zu = ctx.z.get(userId) ?? new Map<BevId, number>();
  const edges = effectiveBevSimilarity(snapshot, opts) === 'edges' ? (edgeLookup(snapshot) as Map<BevId, Map<BevId, number>>) : null;
  const linked = edges ? edges.get(bevId) : undefined;

  let catSum = 0;
  let catN = 0;
  let simZ = 0;
  let simMass = 0;
  for (const [other, z] of zu) {
    const o = snapshot.bevs[other];
    if (!o) continue;
    if (o.categoryId === bev.categoryId) {
      catSum += z;
      catN++;
    }
    if (other === bevId) continue;
    const sim = edges ? (linked?.get(other) ?? 0) : contentSimilarity(bev, o);
    if (sim < SIM_MIN) continue;
    simZ += sim * z;
    simMass += sim;
  }

  const affinity = catSum / (catN + K_AFF);
  const content = simZ / (simMass + 1);
  const global = globalScore(snapshot, bevId);
  const z = LAYER1_WEIGHTS.affinity * affinity + LAYER1_WEIGHTS.content * content + LAYER1_WEIGHTS.global * global;
  const confidence = Math.min(1, nOf(ctx, userId) / CONF1_USER_N) * Math.min(1, (catN + simMass) / CONF1_MASS);
  return { z, confidence, parts: { affinity, content, global } };
}
