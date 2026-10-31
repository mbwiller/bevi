// A synthetic EvalDataset for exercising the harness. NOT an accuracy result: it is generated
// from test/snapshot-fixture.ts's syntheticSnapshot(), whose planted tastes follow the same
// category assumptions the model makes, so it flatters every arm.
//
// The snapshot's scores are the latent tastes. Each user ranks their Bevs in a seeded random
// order, one every few hours, through the real placement machine (startPlacement / answer /
// placementResult) with an oracle that answers from the latent score and is wrong with
// probability `noise`. Stored scores, positions and the comparison log therefore come from the
// actual pipeline, as DEVELOPMENT-MATT.md §11 asks.

import { BUCKET_ORDER } from '../src/constants.ts';
import { edgeWeight, topEdges, treeSimilarity } from '../src/edges.ts';
import { answer, currentPrompt, isDone, placementResult, startPlacement } from '../src/placement.ts';
import { createPrng, randomInt } from '../src/prng.ts';
import { bucketForScore, insertIntoBucket, respaceBucket } from '../src/score.ts';
import { contentSimilarity } from '../src/similarity.ts';
import type { BevEdge, BevFeatures, BevId, Bucket, PredictionSnapshot, UserId } from '../src/types.ts';
import { syntheticSnapshot } from '../test/snapshot-fixture.ts';
import type { EvalBev, EvalComparison, EvalDataset, EvalRanking } from './dataset.ts';

const START_MS = Date.parse('2026-09-01T00:00:00Z');
const HOUR = 3_600_000;

export function datasetFromSnapshot(snapshot: PredictionSnapshot, opts: { seed: string; noise?: number }): EvalDataset {
  const rand = createPrng(opts.seed);
  const noise = opts.noise ?? 0.1;
  const bevs: EvalBev[] = Object.values(snapshot.bevs)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((b) => ({
      id: b.id,
      // flavorTokens(name, null) of this name is exactly b.flavorTokens (no stopwords or sizes).
      name: b.flavorTokens.length > 0 ? b.flavorTokens.join(' ') : b.id,
      brand: b.brandKey,
      flavor: null,
      categoryId: b.categoryId,
      priceTier: b.priceTier,
      isAlcoholic: b.isAlcoholic,
    }));

  const latent = new Map<UserId, Array<{ bevId: BevId; score: number }>>();
  for (const r of snapshot.rankings) {
    const l = latent.get(r.userId);
    if (l) l.push({ bevId: r.bevId, score: r.score });
    else latent.set(r.userId, [{ bevId: r.bevId, score: r.score }]);
  }

  const rankings: EvalRanking[] = [];
  const comparisons: EvalComparison[] = [];
  for (const userId of [...latent.keys()].sort()) {
    const items = [...(latent.get(userId) as Array<{ bevId: BevId; score: number }>)].sort((a, b) => (a.bevId < b.bevId ? -1 : 1));
    for (let i = items.length - 1; i > 0; i--) {
      const j = randomInt(rand, i + 1);
      [items[i], items[j]] = [items[j] as (typeof items)[number], items[i] as (typeof items)[number]];
    }
    const taste = new Map(items.map((x) => [x.bevId, x.score]));
    const lists = new Map<Bucket, BevId[]>(BUCKET_ORDER.map((b) => [b, []]));
    const rankedAt = new Map<BevId, string>();
    let t = START_MS + randomInt(rand, 24) * HOUR;
    items.forEach((item, k) => {
      t += (1 + randomInt(rand, 48)) * HOUR;
      const at = new Date(t).toISOString();
      rankedAt.set(item.bevId, at);
      const bucket = bucketForScore(item.score);
      let s = startPlacement({ bevId: item.bevId, bucket, orderedBevIds: lists.get(bucket) as BevId[] });
      while (!isDone(s)) {
        const prompt = currentPrompt(s) as { comparedBevId: BevId };
        const better = item.score > (taste.get(prompt.comparedBevId) as number);
        const right = rand() >= noise;
        s = answer(s, better === right ? 'NEW_BETTER' : 'EXISTING_BETTER');
      }
      const res = placementResult(s);
      lists.set(bucket, insertIntoBucket(lists.get(bucket) as BevId[], item.bevId, res.insertIndex));
      for (const c of res.comparisons) comparisons.push({ userId, submissionId: `${userId}-sub-${k}`, ...c, createdAt: at });
    });
    for (const bucket of BUCKET_ORDER) {
      for (const r of respaceBucket(lists.get(bucket) as BevId[], bucket)) {
        rankings.push({ userId, bevId: r.bevId, bucket, position: r.position, score: r.score, rankedAt: rankedAt.get(r.bevId) as string });
      }
    }
  }
  return { bevs, rankings, comparisons };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Stand-in `bev_edges` for synthetic Bevs, built the way scripts/graph/build-edges.ts builds the
 * real ones: every pair weighed by `edgeWeight` with components rounded to 6 dp, each Bev keeping
 * its `topEdges` (w ≥ EDGE_MIN_WEIGHT, top EDGE_TOP_K), and a pair kept if either endpoint keeps it,
 * listed once as { a, b, w } with a < b. Synthetic Bevs have no embeddings or flavour profiles, so
 * emb = profile = 0 and only tree (flat taxonomy: same category) and content count; w is then at
 * most 0.4, and only same-category pairs clear 0.3. A plumbing exercise for edges mode, NOT a
 * model of the real graph's weights.
 */
export function syntheticEdges(bevs: ReadonlyArray<Pick<BevFeatures, 'id' | 'categoryId' | 'brandKey' | 'flavorTokens' | 'priceTier'>>): BevEdge[] {
  const sorted = [...bevs].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const full = (b: (typeof sorted)[number]): BevFeatures => ({ ...b, flavorTokens: [...b.flavorTokens], ratingCount: 0, mean: 0, stddev: 0, isAlcoholic: false });
  const candidates = new Map<BevId, Array<{ bevId: BevId; w: number }>>(sorted.map((b) => [b.id, []]));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i] as (typeof sorted)[number];
      const b = sorted[j] as (typeof sorted)[number];
      const w = round6(edgeWeight({ tree: round6(treeSimilarity(a.categoryId, b.categoryId, {})), content: round6(contentSimilarity(full(a), full(b))), emb: 0, profile: 0 }));
      candidates.get(a.id)?.push({ bevId: b.id, w });
      candidates.get(b.id)?.push({ bevId: a.id, w });
    }
  }
  const kept = new Map<string, BevEdge>();
  for (const [id, list] of candidates) {
    for (const e of topEdges(list)) {
      const [a, b] = id < e.bevId ? [id, e.bevId] : [e.bevId, id];
      kept.set(`${a}\u0000${b}`, { a, b, w: e.w });
    }
  }
  return [...kept.values()].sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
}

/** syntheticSnapshot(seed, users, bevs) run through the placement pipeline, with `syntheticEdges`. */
export function syntheticDataset(seed = 'eval', nUsers = 40, nBevs = 80, noise = 0.1): EvalDataset {
  const snapshot = syntheticSnapshot(seed, nUsers, nBevs);
  return { ...datasetFromSnapshot(snapshot, { seed: `${seed}:placement`, noise }), edges: syntheticEdges(Object.values(snapshot.bevs)) };
}
