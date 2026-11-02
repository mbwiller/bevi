// Recommendations (§8.8 Layer 1 list, §8.10 blend, §8.11 exploration).

import { EPSILON, JITTER_SD, LAYER1_WEIGHTS } from './constants.ts';
import { snapshotContext } from './context.ts';
import { predictScore } from './blend.ts';
import { explorationSlots, gaussian, weightedSample } from './explore.ts';
import { bevSimilarityKind } from './layer1.ts';
import { userSimilarityKind } from './layer2.ts';
import { createPrng } from './prng.ts';
import { categoryAffinity } from './stats.ts';
import type { BevId, CategoryId, Prediction, PredictionSnapshot, Recommendation, RecommendationReason, RecommendOptions, UserId } from './types.ts';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Why a Bev is recommended: the largest term of the blended ẑ, i.e. the largest of
 * CATEGORY = (1−λ)·0.4·affinity, SIMILAR = (1−λ)·0.4·content, NEIGHBOURS = λ·ẑ2,
 * POPULAR = (1−λ)·0.2·g (ties in that order). With no signal at all (every term 0) → POPULAR.
 * §9 names the reasons but not the rule; this is the simplest one that explains the score.
 */
export function recommendationReason(p: Prediction): RecommendationReason {
  const w = 1 - p.lambda;
  const terms: Array<[RecommendationReason, number]> = [
    ['CATEGORY', w * LAYER1_WEIGHTS.affinity * p.layer1.parts.affinity],
    ['SIMILAR', w * LAYER1_WEIGHTS.content * p.layer1.parts.content],
    ['NEIGHBOURS', p.lambda * p.layer2.z],
    ['POPULAR', w * LAYER1_WEIGHTS.global * p.layer1.parts.global],
  ];
  if (terms.every(([, v]) => v === 0)) return 'POPULAR';
  let best = terms[0] as [RecommendationReason, number];
  for (const t of terms) if (t[1] > best[1]) best = t;
  return best[0];
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * Top-`n` untried Bevs for `userId`.
 *
 * Candidates: every Bev in the snapshot the user has not ranked, not in `excludeBevIds`, and not
 * alcoholic unless `users[userId].canSeeAlcohol` (a user missing from the snapshot cannot).
 *
 * Ordering (§8.11): ẑ + N(0, JITTER_SD) from `createPrng(seed)`, one draw per candidate in bevId
 * order; ties by bevId. The returned score is the un-jittered prediction.
 *
 * ε-slots: round(ε·n) slots at `explorationSlots(L, slots)` (L = list length) hold exploration
 * picks: candidates from categories where the user's affinity ≤ the median affinity over the
 * categories they have ranked, or that they have never ranked, with g_b ≥ 0; drawn without
 * replacement ∝ exp(g_b) with the same PRNG (after the jitter draws), candidates in bevId order.
 * Unfilled slots (small pool) fall back to normal picks; exploration picks are tagged and never
 * repeated among the normal picks.
 *
 * `opts.userSimilarity` is Layer 2's (default 'cosine', the live engine; 'stored' reads
 * `snapshot.userNeighbours`, see `layer2`) and `opts.bevSimilarity` Layer 1's (default 'content';
 * 'edges' reads `snapshot.edges`, see `layer1`). Both only change the predictions; candidates, the
 * jitter draws, the exploration pool and the reason rule read those predictions the same way in
 * every mode. In edges mode `content` is exactly 0 for a candidate
 * with no stored edge to the user's ranked Bevs; SIMILAR can then still win, at 0, when CATEGORY < 0
 * and NEIGHBOURS, POPULAR ≤ 0 (the reason rule's existing "largest term, ties in order" behaviour,
 * unchanged here).
 */
export function recommend(snapshot: PredictionSnapshot, userId: UserId, opts: RecommendOptions): Recommendation[] {
  const ctx = snapshotContext(snapshot);
  if (!Number.isInteger(opts.n) || opts.n < 0) throw new RangeError(`n must be a non-negative integer, got ${opts.n}`);
  const epsilon = opts.epsilon ?? EPSILON;
  if (!(epsilon >= 0 && epsilon <= 1)) throw new RangeError(`epsilon must be in [0, 1], got ${epsilon}`);
  const predictOpts = { userSimilarity: userSimilarityKind(opts), bevSimilarity: bevSimilarityKind(opts) };

  const ranked = ctx.z.get(userId) ?? new Map<BevId, number>();
  const excluded = new Set(opts.excludeBevIds ?? []);
  const canSeeAlcohol = snapshot.users[userId]?.canSeeAlcohol ?? false;
  const candidates = Object.keys(snapshot.bevs)
    .sort(cmp)
    .filter((id) => {
      const bev = snapshot.bevs[id];
      return bev !== undefined && !ranked.has(id) && !excluded.has(id) && (canSeeAlcohol || !bev.isAlcoholic);
    });

  const rand = createPrng(opts.seed);
  const preds = new Map<BevId, Prediction>();
  const jittered = new Map<BevId, number>();
  for (const id of candidates) {
    const p = predictScore(snapshot, userId, id, predictOpts);
    preds.set(id, p);
    jittered.set(id, p.z + gaussian(rand, JITTER_SD));
  }

  const length = Math.min(opts.n, candidates.length);
  const slots = explorationSlots(length, Math.round(epsilon * opts.n));

  // Exploration pool: low-affinity or never-ranked categories, g_b ≥ 0.
  const catZ = new Map<CategoryId, number[]>();
  for (const [b, z] of ranked) {
    const c = snapshot.bevs[b]?.categoryId;
    if (c === undefined) continue;
    const list = catZ.get(c);
    if (list) list.push(z);
    else catZ.set(c, [z]);
  }
  const affinity = new Map<CategoryId, number>();
  for (const [c, zs] of catZ) affinity.set(c, categoryAffinity(zs));
  const med = affinity.size > 0 ? median([...affinity.values()]) : 0;
  const pool = candidates.filter((id) => {
    const p = preds.get(id) as Prediction;
    const a = affinity.get((snapshot.bevs[id] as { categoryId: CategoryId }).categoryId);
    return p.layer1.parts.global >= 0 && (a === undefined || a <= med);
  });
  const explore = weightedSample(pool, pool.map((id) => Math.exp((preds.get(id) as Prediction).layer1.parts.global)), slots.length, rand);

  const exploreSet = new Set(explore);
  const normal = candidates
    .filter((id) => !exploreSet.has(id))
    .sort((a, b) => (jittered.get(b) as number) - (jittered.get(a) as number) || cmp(a, b));

  const out: Recommendation[] = [];
  const slotAt = new Map<number, BevId>(explore.map((id, k) => [slots[k] as number, id]));
  let next = 0;
  for (let pos = 0; pos < length; pos++) {
    const exp = slotAt.get(pos);
    const id = exp ?? (normal[next++] as BevId);
    const p = preds.get(id) as Prediction;
    out.push({ bevId: id, score: p.score, confidence: p.confidence, reason: recommendationReason(p), isExploration: exp !== undefined });
  }
  return out;
}
