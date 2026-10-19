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
import { answer, currentPrompt, isDone, placementResult, startPlacement } from '../src/placement.ts';
import { createPrng, randomInt } from '../src/prng.ts';
import { bucketForScore, insertIntoBucket, respaceBucket } from '../src/score.ts';
import type { BevId, Bucket, PredictionSnapshot, UserId } from '../src/types.ts';
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

/** syntheticSnapshot(seed, users, bevs) run through the placement pipeline. */
export function syntheticDataset(seed = 'eval', nUsers = 40, nBevs = 80, noise = 0.1): EvalDataset {
  return datasetFromSnapshot(syntheticSnapshot(seed, nUsers, nBevs), { seed: `${seed}:placement`, noise });
}
