// Blend (§8.10): one code path for Phase 2 (Layer 1 only, support = 0) and Phase 3.

import { LAMBDA_MAX, LAMBDA_USER_N } from './constants.ts';
import { effectiveStatsOf, nOf, snapshotContext } from './context.ts';
import { bevOf, layer1 } from './layer1.ts';
import { layer2 } from './layer2.ts';
import type { BevId, Prediction, PredictionSnapshot, PredictOptions, UserId } from './types.ts';

/** λ = Λ_MAX · support / (support + 1) · min(1, n_u / 15). */
export function blendLambda(support: number, nUser: number): number {
  return ((LAMBDA_MAX * support) / (support + 1)) * Math.min(1, nUser / LAMBDA_USER_N);
}

/**
 * ẑ = (1 − λ)·ẑ1 + λ·ẑ2; score ŝ = clamp(μ*_u + σ*_u·ẑ, 0, 10) with the user's effective stats
 * (§8.4); confidence = max(conf1, min(1, support)). Throws if the snapshot's version is not
 * RANKING_VERSION or the Bev is not in it. A user absent from the snapshot predicts from the
 * global stats with zero confidence. `opts.userSimilarity` is passed to Layer 2 (default 'cosine').
 */
export function predictScore(snapshot: PredictionSnapshot, userId: UserId, bevId: BevId, opts?: PredictOptions): Prediction {
  const ctx = snapshotContext(snapshot);
  bevOf(snapshot, bevId);
  const l1 = layer1(snapshot, userId, bevId);
  const l2 = layer2(snapshot, userId, bevId, opts);
  const lambda = blendLambda(l2.support, nOf(ctx, userId));
  const z = (1 - lambda) * l1.z + lambda * l2.z;
  const eff = effectiveStatsOf(ctx, userId);
  const score = Math.min(10, Math.max(0, eff.mean + eff.stddev * z));
  const confidence = Math.max(l1.confidence, Math.min(1, l2.support));
  return { bevId, z, score, confidence, lambda, layer1: l1, layer2: l2 };
}
