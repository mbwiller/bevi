// Recommendations (§8.8 Layer 1 list, §8.10 blend, §8.11 exploration; community diversity and
// exploration, LaTeX §7, 1.8.0, off by default).

import { EPSILON, EXPLORE_BRIDGE_WEIGHT, JITTER_SD, LAYER1_WEIGHTS } from './constants.ts';
import { bevGraphLookup, communityKeyOf, snapshotContext, type BevGraphNode } from './context.ts';
import { predictScore } from './blend.ts';
import { diversifyByCommunity, explorationSlots, gaussian, weightedSample } from './explore.ts';
import { bevSimilarityKind } from './layer1.ts';
import { userSimilarityKind } from './layer2.ts';
import { createPrng } from './prng.ts';
import { categoryAffinity } from './stats.ts';
import type { BevId, CategoryId, DiversityKind, ExplorationKind, Prediction, PredictionSnapshot, Recommendation, RecommendationReason, RecommendOptions, UserId } from './types.ts';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The option's value, default 'none'. Throws on anything else, so a typo from untyped JS can't
 * silently fall back to the default.
 */
export function diversityKind(opts?: Pick<RecommendOptions, 'diversity'>): DiversityKind {
  const kind = opts?.diversity ?? 'none';
  if (kind !== 'none' && kind !== 'community') throw new RangeError(`diversity must be 'none' or 'community', got ${String(kind)}`);
  return kind;
}

/** The option's value, default 'category'. Throws on anything else, like `diversityKind`. */
export function explorationKind(opts?: Pick<RecommendOptions, 'exploration'>): ExplorationKind {
  const kind = opts?.exploration ?? 'category';
  if (kind !== 'category' && kind !== 'community') throw new RangeError(`exploration must be 'category' or 'community', got ${String(kind)}`);
  return kind;
}

/**
 * The diversity `recommend` actually applies for this snapshot: 'community' only when the option
 * asks for it AND the snapshot carries a `bevGraph` field (an empty object counts: every Bev is then
 * its own singleton, which orders exactly as 'none'); otherwise 'none'. The fallback keeps the app
 * working if the flag is switched on before `get_prediction_snapshot` returns the field. Throws on an
 * unknown option value, and on a malformed `bevGraph` in community mode (see `bevGraphLookup`).
 */
export function effectiveDiversity(snapshot: PredictionSnapshot, opts?: Pick<RecommendOptions, 'diversity'>): DiversityKind {
  return diversityKind(opts) === 'community' && bevGraphLookup(snapshot) !== null ? 'community' : 'none';
}

/**
 * The exploration rule `recommend` actually applies for this snapshot: 'community' only when the
 * option asks for it AND the snapshot carries a `bevGraph` field; otherwise 'category'. Within
 * 'community', a call whose community pool is empty still draws from the category pool (see
 * `recommend`); this reports the mode, not that per-call fallback. Throws as `effectiveDiversity`.
 */
export function effectiveExploration(snapshot: PredictionSnapshot, opts?: Pick<RecommendOptions, 'exploration'>): ExplorationKind {
  return explorationKind(opts) === 'community' && bevGraphLookup(snapshot) !== null ? 'community' : 'category';
}

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
 *
 * Two options read `snapshot.bevGraph`, whose `community` is the Bev's taste family (1.8.0, LaTeX
 * §7). Both are off by default and fall back to the default when the field is absent
 * (`effectiveDiversity`, `effectiveExploration`); omitted, or with the field absent, the output is
 * byte-identical to 1.7.0's and the field is never read.
 * - `exploration: 'community'`: the pool is the candidates with g_b ≥ 0 whose taste family holds
 *   none of the user's ranked Bevs ("uncharted"; a ranked Bev with no entry, or no longer in `bevs`,
 *   is a singleton and charts nothing else), drawn ∝ exp(g_b)·(1 + EXPLORE_BRIDGE_WEIGHT·bridge_b). If
 *   that pool is empty, this call uses the category pool and weights above. The number and positions
 *   of the slots, and the PRNG draws before them, are unchanged.
 * - `diversity: 'community'`: the non-exploration positions take `diversifyByCommunity` over the
 *   non-exploration candidates instead of the plain jittered order: each pick maximises
 *   jittered ẑ − DIVERSITY_PENALTY · (normal picks already taken from its family), ties by bevId.
 *   Exploration picks do not count toward the penalty and are not moved. Only the order of the
 *   normal picks changes: the same jitter draws, the same exploration picks in the same slots, and
 *   `score` stays the un-jittered prediction.
 */
export function recommend(snapshot: PredictionSnapshot, userId: UserId, opts: RecommendOptions): Recommendation[] {
  const ctx = snapshotContext(snapshot);
  if (!Number.isInteger(opts.n) || opts.n < 0) throw new RangeError(`n must be a non-negative integer, got ${opts.n}`);
  const epsilon = opts.epsilon ?? EPSILON;
  if (!(epsilon >= 0 && epsilon <= 1)) throw new RangeError(`epsilon must be in [0, 1], got ${epsilon}`);
  const predictOpts = { userSimilarity: userSimilarityKind(opts), bevSimilarity: bevSimilarityKind(opts) };
  const diversity = effectiveDiversity(snapshot, opts);
  const exploration = effectiveExploration(snapshot, opts);
  const graph = diversity === 'community' || exploration === 'community' ? (bevGraphLookup(snapshot) as Map<BevId, BevGraphNode>) : null;

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

  // Exploration pool. Community mode: uncharted communities, g_b ≥ 0, weighted up by bridge; if
  // that pool is empty, or in the default mode, the category pool below.
  const globalOf = (id: BevId) => (preds.get(id) as Prediction).layer1.parts.global;
  let pool: BevId[] = [];
  let weights: number[] = [];
  if (exploration === 'community') {
    const g = graph as Map<BevId, BevGraphNode>;
    const charted = new Set<string>();
    for (const b of ranked.keys()) charted.add(communityKeyOf(g, b));
    pool = candidates.filter((id) => globalOf(id) >= 0 && !charted.has(communityKeyOf(g, id)));
    weights = pool.map((id) => Math.exp(globalOf(id)) * (1 + EXPLORE_BRIDGE_WEIGHT * (g.get(id) as BevGraphNode).bridge));
  }
  if (pool.length === 0) {
    // Low-affinity or never-ranked categories, g_b ≥ 0.
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
    pool = candidates.filter((id) => {
      const p = preds.get(id) as Prediction;
      const a = affinity.get((snapshot.bevs[id] as { categoryId: CategoryId }).categoryId);
      return p.layer1.parts.global >= 0 && (a === undefined || a <= med);
    });
    weights = pool.map((id) => Math.exp((preds.get(id) as Prediction).layer1.parts.global));
  }
  const explore = weightedSample(pool, weights, slots.length, rand);

  const exploreSet = new Set(explore);
  const rest = candidates.filter((id) => !exploreSet.has(id));
  const normal =
    diversity === 'community'
      ? diversifyByCommunity(
          rest.map((id) => ({ id, z: jittered.get(id) as number, community: communityKeyOf(graph as Map<BevId, BevGraphNode>, id) })),
          length - explore.length,
        ).map((x) => x.id)
      : rest.sort((a, b) => (jittered.get(b) as number) - (jittered.get(a) as number) || cmp(a, b));

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
