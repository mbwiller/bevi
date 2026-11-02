// The predictors compared by the harness. Each maps (fold snapshot, user, Bev) to a 0–10 score
// (clamped like predictScore) and, for the collaborative arms, the Layer 2 support. Every arm reads
// only the fold snapshot, so every arm inherits the fold's leakage guarantees.

import { BAYES_C } from '../src/constants.ts';
import { effectiveStatsOf, snapshotContext } from '../src/context.ts';
import { bayesianAverage, globalPrior } from '../src/bayesian.ts';
import { predictScore } from '../src/blend.ts';
import { bevOf, globalScore, layer1 } from '../src/layer1.ts';
import { layer2 } from '../src/layer2.ts';
import { effectiveCategoryStats } from '../src/stats.ts';
import type { BevId, PredictionSnapshot, UserId } from '../src/types.ts';

export const ARM_IDS = [
  'global-mean',
  'user-mean',
  'category-mean',
  'user-category-mean',
  'bayes-bev',
  'item-mean-z',
  'l1-affinity',
  'l1-content',
  'l1-content-edges',
  'layer1',
  'layer1-edges',
  'layer2',
  'layer2-pearson',
  'engine',
  'engine-pearson',
  'engine-edges',
  'layer2-stored',
  'engine-stored',
] as const;
export type ArmId = (typeof ARM_IDS)[number];

/** The arm every Δ is measured against. */
export const REFERENCE_ARM: ArmId = 'engine';

export interface ArmPrediction {
  score: number;
  /** Layer 2 support; present only for arms that use collaborative filtering. */
  support?: number;
}

export interface Arm {
  id: ArmId;
  description: string;
  experimental: boolean;
  /**
   * True for the arms that read `snapshot.userNeighbours` (userSimilarity: 'stored'). The harness
   * then attaches neighbours computed from each fold's own training rows (folds.ts, leak 6).
   */
  readsNeighbours?: boolean;
  predict: (snapshot: PredictionSnapshot, userId: UserId, bevId: BevId) => ArmPrediction;
}

const clamp = (s: number) => Math.min(10, Math.max(0, s));

/** μ*_u + σ*_u·ẑ, the engine's z → score map. */
function fromZ(snapshot: PredictionSnapshot, userId: UserId, z: number): number {
  const eff = effectiveStatsOf(snapshotContext(snapshot), userId);
  return clamp(eff.mean + eff.stddev * z);
}

export const ARMS: readonly Arm[] = [
  {
    id: 'global-mean',
    description: 'mean of every training score',
    experimental: false,
    predict: (s) => ({ score: clamp(s.global.mean) }),
  },
  {
    id: 'user-mean',
    description: 'constant μ*_u (the user’s effective mean)',
    experimental: false,
    predict: (s, u) => ({ score: fromZ(s, u, 0) }),
  },
  {
    id: 'category-mean',
    description: 'population mean of the Bev’s category (global mean if none)',
    experimental: false,
    predict: (s, _u, b) => ({ score: clamp(s.global.byCategoryMean[bevOf(s, b).categoryId] ?? s.global.mean) }),
  },
  {
    id: 'user-category-mean',
    description: 'the user’s own category mean (effectiveCategoryStats, falls back to μ*_u)',
    experimental: false,
    predict: (s, u, b) => {
      const ctx = snapshotContext(s);
      const cat = s.users[u]?.categoryStats[bevOf(s, b).categoryId] ?? { n: 0, mean: 0, stddev: 0 };
      return { score: clamp(effectiveCategoryStats(cat, effectiveStatsOf(ctx, u)).mean) };
    },
  },
  {
    id: 'bayes-bev',
    description: 'Bayesian Bev score (C = BAYES_C, global prior), from fold Bev stats',
    experimental: false,
    predict: (s, _u, b) => {
      const bev = bevOf(s, b);
      const m = globalPrior({ n: s.rankings.length, mean: s.global.mean, stddev: s.global.stddev });
      return { score: clamp(bayesianAverage(bev.mean, bev.ratingCount, { m, C: BAYES_C })) };
    },
  },
  {
    id: 'item-mean-z',
    description: 'μ*_u + σ*_u·g_b (globalScore, shrunk mean z of raters)',
    experimental: false,
    predict: (s, u, b) => ({ score: fromZ(s, u, globalScore(s, b)) }),
  },
  {
    id: 'l1-affinity',
    description: 'μ*_u + σ*_u·affinity_{u,cat(b)} (Layer 1 affinity term alone, weight 1)',
    experimental: false,
    predict: (s, u, b) => ({ score: fromZ(s, u, layer1(s, u, b).parts.affinity) }),
  },
  {
    id: 'l1-content',
    description: 'μ*_u + σ*_u·content_{u,b} (Layer 1 content term alone, weight 1)',
    experimental: false,
    predict: (s, u, b) => ({ score: fromZ(s, u, layer1(s, u, b).parts.content) }),
  },
  {
    id: 'l1-content-edges',
    description: "EXPERIMENTAL: l1-content with bevSimilarity: 'edges' (stored w, 0 without an edge; M-27 (a), off in production)",
    experimental: true,
    predict: (s, u, b) => ({ score: fromZ(s, u, layer1(s, u, b, { bevSimilarity: 'edges' }).parts.content) }),
  },
  {
    id: 'layer1',
    description: 'μ*_u + σ*_u·ẑ1 (full Layer 1, λ = 0)',
    experimental: false,
    predict: (s, u, b) => ({ score: fromZ(s, u, layer1(s, u, b).z) }),
  },
  {
    id: 'layer1-edges',
    description: "EXPERIMENTAL: layer1(…, { bevSimilarity: 'edges' }), full Layer 1 on stored edge weights (M-27 (a), off in production)",
    experimental: true,
    predict: (s, u, b) => ({ score: fromZ(s, u, layer1(s, u, b, { bevSimilarity: 'edges' }).z) }),
  },
  {
    id: 'layer2',
    description: 'μ*_u + σ*_u·ẑ2 (Layer 2 alone; ẑ2 = 0 without neighbours)',
    experimental: false,
    predict: (s, u, b) => {
      const l2 = layer2(s, u, b);
      return { score: fromZ(s, u, l2.z), support: l2.support };
    },
  },
  {
    id: 'layer2-pearson',
    description: "EXPERIMENTAL: layer2(…, { userSimilarity: 'pearson' }), Pearson over the common subset (M-28, off in production)",
    experimental: true,
    predict: (s, u, b) => {
      const l2 = layer2(s, u, b, { userSimilarity: 'pearson' });
      return { score: fromZ(s, u, l2.z), support: l2.support };
    },
  },
  {
    id: 'engine',
    description: 'predictScore(): the production blend',
    experimental: false,
    predict: (s, u, b) => {
      const p = predictScore(s, u, b);
      return { score: p.score, support: p.layer2.support };
    },
  },
  {
    id: 'engine-pearson',
    description: "EXPERIMENTAL: predictScore(…, { userSimilarity: 'pearson' }), the engine with Layer 2 on Pearson (M-28, off in production)",
    experimental: true,
    predict: (s, u, b) => {
      const p = predictScore(s, u, b, { userSimilarity: 'pearson' });
      return { score: p.score, support: p.layer2.support };
    },
  },
  {
    id: 'engine-edges',
    description: "EXPERIMENTAL: predictScore(…, { bevSimilarity: 'edges' }), the engine with Layer 1's content term on stored edge weights (M-27 (a), off in production)",
    experimental: true,
    predict: (s, u, b) => {
      const p = predictScore(s, u, b, { bevSimilarity: 'edges' });
      return { score: p.score, support: p.layer2.support };
    },
  },
  {
    id: 'layer2-stored',
    description:
      "EXPERIMENTAL: layer2(…, { userSimilarity: 'stored' }), Layer 2 on stored taste neighbours weighted sim_B · min(1, n_v / 15), rebuilt per fold from training rows (Stage 4, off in production)",
    experimental: true,
    readsNeighbours: true,
    predict: (s, u, b) => {
      const l2 = layer2(s, u, b, { userSimilarity: 'stored' });
      return { score: fromZ(s, u, l2.z), support: l2.support };
    },
  },
  {
    id: 'engine-stored',
    description: "EXPERIMENTAL: predictScore(…, { userSimilarity: 'stored' }), the engine with Layer 2 on stored taste neighbours (Stage 4, off in production)",
    experimental: true,
    readsNeighbours: true,
    predict: (s, u, b) => {
      const p = predictScore(s, u, b, { userSimilarity: 'stored' });
      return { score: p.score, support: p.layer2.support };
    },
  },
];

export function armsById(ids?: readonly ArmId[]): Arm[] {
  if (!ids) return [...ARMS];
  return ids.map((id) => {
    const a = ARMS.find((x) => x.id === id);
    if (!a) throw new RangeError(`unknown arm "${id}"`);
    return a;
  });
}
