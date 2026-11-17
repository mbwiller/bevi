// Cosine vs Pearson over every user pair of one snapshot: how often the two similarities of
// Layer 2 (src/layer2.ts, `userSimilarity: 'cosine' | 'pearson'`) disagree, which is the
// re-centring issue of docs/graph_db_implementation.md ("Why this work is worth doing"). The
// predictions themselves come from the real engine with the option set (arms.ts); this file only
// describes the data.

import { CF_MIN_COMMON } from '../src/constants.ts';
import { snapshotContext, type SnapshotContext } from '../src/context.ts';
import { pearsonSimilarity } from '../src/graph.ts';
import { cosineSimilarity } from '../src/layer2.ts';
import type { PredictionSnapshot, UserId } from '../src/types.ts';

function commonZ(ctx: SnapshotContext, u: UserId, v: UserId): [number[], number[]] {
  const zu = ctx.z.get(u);
  const zv = ctx.z.get(v);
  const a: number[] = [];
  const b: number[] = [];
  if (!zu || !zv || u === v) return [a, b];
  for (const [bev, z] of zu) {
    const other = zv.get(bev);
    if (other !== undefined) {
      a.push(z);
      b.push(other);
    }
  }
  return [a, b];
}

export interface SimilarityDiagnostics {
  users: number;
  userPairs: number;
  /** Pairs with |common| ≥ CF_MIN_COMMON (the only pairs Layer 2 can use). */
  pairsEligible: number;
  /** Of those, pairs with exactly 2 common Bevs (Pearson is ±1 or 0 there by construction). */
  pairsCommon2: number;
  cosinePositive: number;
  pearsonPositive: number;
  /** Eligible pairs where sign(cosine) ≠ sign(Pearson). */
  signDisagree: number;
  /** Eligible pairs admitted as neighbours by cosine (> 0) but not by Pearson (≤ 0). */
  cosineOnlyNeighbours: number;
  meanAbsDiff: number;
  /** Median number of co-raters per pair of rated Bevs (the §8.9 user-user → item-item switch input). */
  medianCoRatersPerItemPair: number;
}

/** Cosine vs Pearson over every user pair of one snapshot (raw, unweighted similarities). */
export function similarityDiagnostics(snapshot: PredictionSnapshot): SimilarityDiagnostics {
  const ctx = snapshotContext(snapshot);
  const users = [...ctx.z.keys()].sort();
  const d: SimilarityDiagnostics = {
    users: users.length, userPairs: 0, pairsEligible: 0, pairsCommon2: 0, cosinePositive: 0, pearsonPositive: 0,
    signDisagree: 0, cosineOnlyNeighbours: 0, meanAbsDiff: 0, medianCoRatersPerItemPair: 0,
  };
  let absSum = 0;
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      d.userPairs++;
      const u = users[i] as UserId;
      const v = users[j] as UserId;
      const [a, b] = commonZ(ctx, u, v);
      if (a.length < CF_MIN_COMMON) continue;
      d.pairsEligible++;
      if (a.length === 2) d.pairsCommon2++;
      const c = cosineSimilarity(a, b);
      const p = pearsonSimilarity(ctx.z.get(u) ?? new Map(), ctx.z.get(v) ?? new Map()).r;
      if (c > 0) d.cosinePositive++;
      if (p > 0) d.pearsonPositive++;
      if (Math.sign(c) !== Math.sign(p)) d.signDisagree++;
      if (c > 0 && p <= 0) d.cosineOnlyNeighbours++;
      absSum += Math.abs(c - p);
    }
  }
  d.meanAbsDiff = d.pairsEligible > 0 ? absSum / d.pairsEligible : 0;

  const rated = [...ctx.raters.keys()].sort();
  const raterSets = rated.map((b) => new Set((ctx.raters.get(b) ?? []).map((r) => r.userId)));
  const coRaters: number[] = [];
  for (let i = 0; i < rated.length; i++) {
    for (let j = i + 1; j < rated.length; j++) {
      const A = raterSets[i] as Set<UserId>;
      const B = raterSets[j] as Set<UserId>;
      let k = 0;
      for (const u of A) if (B.has(u)) k++;
      coRaters.push(k);
    }
  }
  coRaters.sort((x, y) => x - y);
  const m = coRaters.length >> 1;
  d.medianCoRatersPerItemPair = coRaters.length === 0 ? 0 : coRaters.length % 2 ? (coRaters[m] as number) : ((coRaters[m - 1] as number) + (coRaters[m] as number)) / 2;
  return d;
}
