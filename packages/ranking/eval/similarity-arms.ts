// EXPERIMENTAL, eval-only: Layer 2 and the blend with a pluggable user-user similarity, to
// quantify (not fix) the cosineSimilarity re-centring issue in src/layer2.ts
// (docs/graph_db_implementation.md, "Why this work is worth doing"). The production engine is
// untouched; `makeEngine(cosineSimilarity)` reproduces predictScore() exactly (asserted in tests),
// so the Pearson arm differs from the engine in the similarity function and nothing else.

import { CF_K, CF_MIN_COMMON, CF_SIGNIFICANCE } from '../src/constants.ts';
import { effectiveStatsOf, nOf, snapshotContext, type SnapshotContext } from '../src/context.ts';
import { blendLambda } from '../src/blend.ts';
import { layer1 } from '../src/layer1.ts';
import { cosineSimilarity } from '../src/layer2.ts';
import type { BevId, Layer2Result, PredictionSnapshot, UserId } from '../src/types.ts';

export type SimilarityFn = (a: readonly number[], b: readonly number[]) => number;

/** Pearson correlation of two equal-length vectors (re-centred on their own means); 0 when either is constant. */
export function pearsonSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n === 0) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] as number;
    mb += b[i] as number;
  }
  ma /= n;
  mb /= n;
  const da = a.map((x) => x - ma);
  const db = b.map((y) => y - mb);
  return cosineSimilarity(da, db);
}

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

export interface EngineResult {
  score: number;
  z: number;
  lambda: number;
  layer2: Layer2Result;
}

/**
 * predictScore() with `sim` in place of cosineSimilarity; significance weighting, |common| ≥ 2,
 * top-K neighbour selection, λ and the clamp are the production ones.
 */
export function makeEngine(sim: SimilarityFn): {
  layer2: (snapshot: PredictionSnapshot, userId: UserId, bevId: BevId) => Layer2Result;
  predict: (snapshot: PredictionSnapshot, userId: UserId, bevId: BevId) => EngineResult;
} {
  const cache = new WeakMap<PredictionSnapshot, Map<UserId, Map<UserId, number>>>();
  const simsOf = (snapshot: PredictionSnapshot, ctx: SnapshotContext, u: UserId): Map<UserId, number> => {
    let perUser = cache.get(snapshot);
    if (!perUser) cache.set(snapshot, (perUser = new Map()));
    let m = perUser.get(u);
    if (!m) {
      m = new Map();
      for (const v of ctx.z.keys()) {
        if (v === u) continue;
        const [a, b] = commonZ(ctx, u, v);
        m.set(v, a.length < CF_MIN_COMMON ? 0 : (sim(a, b) * Math.min(a.length, CF_SIGNIFICANCE)) / CF_SIGNIFICANCE);
      }
      perUser.set(u, m);
    }
    return m;
  };
  const layer2 = (snapshot: PredictionSnapshot, userId: UserId, bevId: BevId): Layer2Result => {
    const ctx = snapshotContext(snapshot);
    const sims = simsOf(snapshot, ctx, userId);
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
  };
  const predict = (snapshot: PredictionSnapshot, userId: UserId, bevId: BevId): EngineResult => {
    const ctx = snapshotContext(snapshot);
    const l1 = layer1(snapshot, userId, bevId);
    const l2 = layer2(snapshot, userId, bevId);
    const lambda = blendLambda(l2.support, nOf(ctx, userId));
    const z = (1 - lambda) * l1.z + lambda * l2.z;
    const eff = effectiveStatsOf(ctx, userId);
    return { score: Math.min(10, Math.max(0, eff.mean + eff.stddev * z)), z, lambda, layer2: l2 };
  };
  return { layer2, predict };
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
      const [a, b] = commonZ(ctx, users[i] as UserId, users[j] as UserId);
      if (a.length < CF_MIN_COMMON) continue;
      d.pairsEligible++;
      if (a.length === 2) d.pairsCommon2++;
      const c = cosineSimilarity(a, b);
      const p = pearsonSimilarity(a, b);
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
