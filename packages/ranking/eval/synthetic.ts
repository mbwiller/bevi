// A synthetic EvalDataset for exercising the harness. NOT an accuracy result: it is generated
// from test/snapshot-fixture.ts's syntheticSnapshot(), whose planted tastes follow the same
// category assumptions the model makes, so it flatters every arm.
//
// The snapshot's scores are the latent tastes. Each user ranks their Bevs in a seeded random
// order, one every few hours, through the real placement machine (startPlacement / answer /
// placementResult) with an oracle that answers from the latent score and is wrong with
// probability `noise`. Stored scores, positions and the comparison log therefore come from the
// actual pipeline, as DEVELOPMENT-MATT.md §11 asks.

import { BUCKET_ORDER, TASTE_NEIGHBOUR_K, TASTE_SIM_FLOOR } from '../src/constants.ts';
import { edgeWeight, topEdges, treeSimilarity } from '../src/edges.ts';
import { blendUserSimilarity, tasteCatalog, tasteVector, topUserNeighbours, zScoresFromRankings, type TasteVector } from '../src/graph.ts';
import { answer, currentPrompt, isDone, placementResult, startPlacement } from '../src/placement.ts';
import { createPrng, randomInt } from '../src/prng.ts';
import { bucketForScore, insertIntoBucket, respaceBucket } from '../src/score.ts';
import { contentSimilarity } from '../src/similarity.ts';
import type { BevEdge, BevFeatures, BevId, Bucket, PredictionSnapshot, UserId, UserNeighbour } from '../src/types.ts';
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

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Stand-in `user_neighbors` for a snapshot, built the way scripts/graph/neighbours-core.ts's
 * `buildNeighbours` builds the real ones, with this package's exports: z-scores from every ranking
 * in the snapshot (`zScoresFromRankings`, which for a fold snapshot equals what `snapshotContext`
 * computes); a taste catalog over every Bev in the snapshot; `blendUserSimilarity` for EVERY
 * unordered pair of users with a ranking (no candidate rule), in id order; each user keeping
 * `topUserNeighbours` (sim ≥ TASTE_SIM_FLOOR, top TASTE_NEIGHBOUR_K, sim desc then id); both
 * directions emitted independently; `sim` rounded to 4 dp afterwards, as `numeric(5,4)` stores it;
 * `common` from the blend. A user with no row gets no key, as a user absent from the table would.
 *
 * Differences from the job, all forced by what a snapshot carries: every Bev counts as active (an
 * eval export has no status), and `flavorBase` is null for every Bev because neither a snapshot nor
 * an eval export carries `bev_flavor_profiles.base`. So the only bridging attribute is the brand,
 * and the attribute term understates the real graph's.
 *
 * Used per fold by the harness for the `*-stored` arms (run.ts), on synthetic data and on a real
 * export alike: stored neighbours derive from rankings, so neighbours from the full dataset (or a
 * real `user_neighbors` dump) would leak the held-out rows.
 */
export function syntheticNeighbours(snapshot: PredictionSnapshot): Record<UserId, UserNeighbour[]> {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const catalog = tasteCatalog(Object.values(snapshot.bevs).map((b) => ({ id: b.id, categoryId: b.categoryId, brand: b.brandKey, flavorBase: null })));
  const z = zScoresFromRankings(snapshot.rankings);
  const users = [...z.keys()].sort(cmp);
  const vectors = new Map<UserId, TasteVector>(users.map((u) => [u, tasteVector(z.get(u) as Map<BevId, number>, catalog)]));
  const perUser = new Map<UserId, UserNeighbour[]>(users.map((u) => [u, []]));
  for (let i = 0; i < users.length; i++) {
    const u = users[i] as UserId;
    for (let j = i + 1; j < users.length; j++) {
      const v = users[j] as UserId;
      const r = blendUserSimilarity({ zu: z.get(u) as Map<BevId, number>, zv: z.get(v) as Map<BevId, number>, tu: vectors.get(u) as TasteVector, tv: vectors.get(v) as TasteVector }, catalog);
      if (r.sim < TASTE_SIM_FLOOR) continue;
      perUser.get(u)?.push({ userId: v, sim: r.sim, common: r.common });
      perUser.get(v)?.push({ userId: u, sim: r.sim, common: r.common });
    }
  }
  const out: Record<UserId, UserNeighbour[]> = {};
  for (const u of users) {
    const kept = topUserNeighbours(perUser.get(u) as UserNeighbour[], TASTE_NEIGHBOUR_K, TASTE_SIM_FLOOR);
    if (kept.length > 0) out[u] = kept.map((n) => ({ userId: n.userId, sim: round4(n.sim), common: n.common }));
  }
  return out;
}

/** syntheticSnapshot(seed, users, bevs) run through the placement pipeline, with `syntheticEdges`. */
export function syntheticDataset(seed = 'eval', nUsers = 40, nBevs = 80, noise = 0.1): EvalDataset {
  const snapshot = syntheticSnapshot(seed, nUsers, nBevs);
  return { ...datasetFromSnapshot(snapshot, { seed: `${seed}:placement`, noise }), edges: syntheticEdges(Object.values(snapshot.bevs)) };
}
