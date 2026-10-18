// The evaluation driver: splits → leakage-safe folds → every arm's predictions → per-user
// aggregates → metrics with paired-bootstrap CIs, overall and per n_u cohort. Pure and
// deterministic for a given dataset and options.

import { MIN_N_USER, RANKING_VERSION } from '../src/constants.ts';
import { bucketForScore } from '../src/score.ts';
import type { BevId, PredictionSnapshot, UserId } from '../src/types.ts';
import { ARM_IDS, REFERENCE_ARM, armsById, type Arm, type ArmId } from './arms.ts';
import { prepareDataset, type EvalComparison, type EvalDataset, type EvalRanking, type PreparedDataset } from './dataset.ts';
import { countsByUser, foldSnapshot, holdOut, rowKey } from './folds.ts';
import { BUCKET_GAIN, bucketIndex, emptyConfusion, ndcgAtK, pairCredit, pairedBootstrap, spearman } from './metrics.ts';
import { similarityDiagnostics, type SimilarityDiagnostics } from './similarity-arms.ts';

export type SplitId = 'loo' | 'temporal';

export const COHORTS = [
  { id: '3-5', min: 3, max: 5 },
  { id: '6-14', min: 6, max: 14 },
  { id: '15+', min: 15, max: Number.POSITIVE_INFINITY },
] as const;
export type CohortId = (typeof COHORTS)[number]['id'];

export function cohortOf(nTrain: number): CohortId | null {
  return COHORTS.find((c) => nTrain >= c.min && nTrain <= c.max)?.id ?? null;
}

export const METRIC_IDS = ['concordance', 'concordanceMicro', 'spearman', 'ndcg10', 'bucketAccuracy', 'mae', 'cfCoverage'] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export interface EvalOptions {
  splits?: readonly SplitId[];
  /** Re-space a user's buckets after holding rows out (folds.ts leak 5). Default true. */
  respace?: boolean;
  /** Temporal cutoff: the `ranked_at` quantile; rows at or after it are the test set. Default 0.8. */
  temporalQuantile?: number;
  bootstrapIterations?: number;
  seed?: string;
  arms?: readonly ArmId[];
  ndcgK?: number;
}

export interface MetricCI {
  point: number;
  lo: number;
  hi: number;
}

export interface ArmSummary {
  arm: ArmId;
  experimental: boolean;
  metrics: Record<MetricId, MetricCI>;
  /** This arm minus REFERENCE_ARM on the same bootstrap resamples; null for the reference itself. */
  delta: Record<MetricId, MetricCI> | null;
  /** Rows = actual, columns = predicted, LOVED / FINE / DISLIKED. */
  confusion: number[][];
}

export interface GroupSummary {
  group: 'all' | CohortId;
  users: number;
  points: number;
  pairs: number;
  arms: ArmSummary[];
}

export interface SplitReport {
  split: SplitId;
  /** False for leave-one-out: Spearman and NDCG are not computed there (see SplitPredictions.sharedFold). */
  listMetrics: boolean;
  /** Temporal only: the ranked_at cutoff. */
  cutoff: string | null;
  folds: number;
  points: number;
  pairs: number;
  /** Comparisons answered "Too close to call": excluded from concordance. */
  tieComparisons: number;
  /** Users with fewer than MIN_N_USER training rankings (the app shows them no prediction). */
  ineligibleUsers: number;
  groups: GroupSummary[];
}

export interface EvalReport {
  rankingVersion: string;
  dataset: { bevs: number; users: number; rankings: number; comparisons: number; dropped: PreparedDataset['dropped'] };
  options: Required<Omit<EvalOptions, 'arms'>> & { arms: ArmId[]; reference: ArmId };
  splits: SplitReport[];
  /** Cosine vs Pearson over the full data (descriptive; no predictions involved). */
  similarity: SimilarityDiagnostics;
}

interface ArmAgg {
  concNum: number;
  concDen: number;
  absErr: number;
  points: number;
  bucketCorrect: number;
  confusion: number[][];
  covNum: number;
  covDen: number;
  spearman: number | null;
  ndcg: number | null;
}

export interface UserAgg {
  userId: UserId;
  nTrain: number;
  cohort: CohortId;
  points: number;
  pairs: number;
  arms: Map<ArmId, ArmAgg>;
}

interface PointPred {
  userId: UserId;
  actual: EvalRanking;
  preds: Map<ArmId, { score: number; support?: number }>;
}
interface PairPred {
  userId: UserId;
  preds: Map<ArmId, { winner: number; loser: number }>;
}

/** Latest answer per (user, unordered pair); returns the decisive ones and the tie count. */
export function dedupeComparisons(cs: readonly EvalComparison[]): { decisive: EvalComparison[]; ties: number } {
  const latest = new Map<string, EvalComparison>();
  for (const c of cs) {
    if (c.winnerBevId === c.loserBevId) continue;
    const [a, b] = c.winnerBevId < c.loserBevId ? [c.winnerBevId, c.loserBevId] : [c.loserBevId, c.winnerBevId];
    const k = `${c.userId}\u0000${a}\u0000${b}`;
    const prev = latest.get(k);
    if (!prev || Date.parse(c.createdAt) >= Date.parse(prev.createdAt)) latest.set(k, c);
  }
  const all = [...latest.values()].sort((x, y) => (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0) || Date.parse(x.createdAt) - Date.parse(y.createdAt) || (x.winnerBevId < y.winnerBevId ? -1 : 1));
  const decisive = all.filter((c) => !c.tie);
  return { decisive, ties: all.length - decisive.length };
}

function predictAll(arms: readonly Arm[], snap: PredictionSnapshot, u: UserId, b: BevId): Map<ArmId, { score: number; support?: number }> {
  const out = new Map<ArmId, { score: number; support?: number }>();
  for (const a of arms) out.set(a.id, a.predict(snap, u, b));
  return out;
}

interface SplitPredictions {
  /**
   * Whether a user's held-out Bevs share one fold. Within-user list metrics (Spearman, NDCG) are
   * only valid then: in leave-one-out every Bev comes from its own fold, and the fold's μ_u
   * (mean of the OTHER rankings) moves by −s_b/(n−1), so any mean-based predictor is
   * anti-correlated with the held-out score by construction (constant μ_u scores Spearman ≈ −0.9).
   */
  sharedFold: boolean;
  cutoff: string | null;
  folds: number;
  nTrain: Map<UserId, number>;
  points: PointPred[];
  pairs: PairPred[];
  ties: number;
}

function pairPredictions(
  arms: readonly Arm[],
  prepared: PreparedDataset,
  base: readonly EvalRanking[],
  baseSnap: PredictionSnapshot,
  comparisons: readonly EvalComparison[],
  nTrain: ReadonlyMap<UserId, number>,
  respace: boolean,
): { pairs: PairPred[]; folds: number } {
  const ranked = new Set(base.map((r) => rowKey(r.userId, r.bevId)));
  const baseCounts = countsByUser(base);
  const pairs: PairPred[] = [];
  let folds = 0;
  for (const c of comparisons) {
    const n = nTrain.get(c.userId) ?? 0;
    if (n < MIN_N_USER) continue;
    const keys = new Set([rowKey(c.userId, c.winnerBevId), rowKey(c.userId, c.loserBevId)].filter((k) => ranked.has(k)));
    // Both Bevs of the pair are held out together, so neither prediction can see the other's score.
    if ((baseCounts.get(c.userId) ?? 0) - keys.size < MIN_N_USER) continue;
    const snap = keys.size === 0 ? baseSnap : foldSnapshot(prepared.catalog, holdOut(base, keys, respace));
    if (keys.size > 0) folds++;
    const preds = new Map<ArmId, { winner: number; loser: number }>();
    for (const a of arms) preds.set(a.id, { winner: a.predict(snap, c.userId, c.winnerBevId).score, loser: a.predict(snap, c.userId, c.loserBevId).score });
    pairs.push({ userId: c.userId, preds });
  }
  return { pairs, folds };
}

/** Leave-one-out: one fold per (user, Bev) for point metrics, one per comparison for pairs. */
export function leaveOneOut(prepared: PreparedDataset, arms: readonly Arm[], respace: boolean): SplitPredictions {
  const rows = prepared.rankings;
  const counts = countsByUser(rows);
  const nTrain = new Map([...counts].map(([u, n]) => [u, n - 1] as [UserId, number]));
  const points: PointPred[] = [];
  let folds = 0;
  const ordered = [...rows].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0) || (a.bevId < b.bevId ? -1 : a.bevId > b.bevId ? 1 : 0));
  for (const r of ordered) {
    if ((nTrain.get(r.userId) ?? 0) < MIN_N_USER) continue;
    const snap = foldSnapshot(prepared.catalog, holdOut(rows, new Set([rowKey(r.userId, r.bevId)]), respace));
    folds++;
    points.push({ userId: r.userId, actual: r, preds: predictAll(arms, snap, r.userId, r.bevId) });
  }
  const { decisive, ties } = dedupeComparisons(prepared.comparisons);
  // n_u for pairs is checked per fold inside pairPredictions against the rows actually removed.
  const pp = pairPredictions(arms, prepared, rows, foldSnapshot(prepared.catalog, rows), decisive, nTrain, respace);
  return { sharedFold: false, cutoff: null, folds: folds + pp.folds, nTrain, points, pairs: pp.pairs, ties };
}

/** The `ranked_at` value at quantile q (rows at or after it are the test set). */
export function temporalCutoff(rows: readonly EvalRanking[], q: number): string | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => Date.parse(a.rankedAt) - Date.parse(b.rankedAt));
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return (sorted[i] as EvalRanking).rankedAt;
}

/**
 * Temporal: train on every ranking before the cutoff (all users, so no future information from
 * anyone), test on the held-out user's rankings at or after it, and on comparisons made at or after
 * it (with both Bevs of the pair removed from the user's training rows).
 */
export function temporalSplit(prepared: PreparedDataset, arms: readonly Arm[], respace: boolean, q: number): SplitPredictions {
  const rows = prepared.rankings;
  const cutoff = temporalCutoff(rows, q);
  if (cutoff === null) return { sharedFold: true, cutoff, folds: 0, nTrain: new Map(), points: [], pairs: [], ties: 0 };
  const T = Date.parse(cutoff);
  const test = rows.filter((r) => Date.parse(r.rankedAt) >= T);
  const base = holdOut(rows, new Set(test.map((r) => rowKey(r.userId, r.bevId))), respace);
  const nTrain = countsByUser(base);
  const snap = foldSnapshot(prepared.catalog, base);
  const points: PointPred[] = [];
  const orderedTest = [...test].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0) || (a.bevId < b.bevId ? -1 : a.bevId > b.bevId ? 1 : 0));
  for (const r of orderedTest) {
    if ((nTrain.get(r.userId) ?? 0) < MIN_N_USER) continue;
    points.push({ userId: r.userId, actual: r, preds: predictAll(arms, snap, r.userId, r.bevId) });
  }
  const { decisive, ties } = dedupeComparisons(prepared.comparisons.filter((c) => Date.parse(c.createdAt) >= T));
  const pp = pairPredictions(arms, prepared, base, snap, decisive, nTrain, respace);
  return { sharedFold: true, cutoff, folds: 1 + pp.folds, nTrain, points, pairs: pp.pairs, ties };
}

function emptyAgg(): ArmAgg {
  return { concNum: 0, concDen: 0, absErr: 0, points: 0, bucketCorrect: 0, confusion: emptyConfusion(), covNum: 0, covDen: 0, spearman: null, ndcg: null };
}

/** Per-user aggregates for every arm. Users without a cohort (n_u < 3) are dropped. */
export function aggregateUsers(sp: SplitPredictions, arms: readonly Arm[], ndcgK: number): UserAgg[] {
  const users = new Map<UserId, UserAgg>();
  const get = (u: UserId): UserAgg | null => {
    let a = users.get(u);
    if (!a) {
      const n = sp.nTrain.get(u) ?? 0;
      const cohort = cohortOf(n);
      if (cohort === null) return null;
      a = { userId: u, nTrain: n, cohort, points: 0, pairs: 0, arms: new Map(arms.map((x) => [x.id, emptyAgg()])) };
      users.set(u, a);
    }
    return a;
  };
  const byUser = new Map<UserId, PointPred[]>();
  for (const p of sp.points) {
    const u = get(p.userId);
    if (!u) continue;
    u.points++;
    const l = byUser.get(p.userId);
    if (l) l.push(p);
    else byUser.set(p.userId, [p]);
    for (const a of arms) {
      const pr = p.preds.get(a.id) as { score: number; support?: number };
      const agg = u.arms.get(a.id) as ArmAgg;
      agg.points++;
      agg.absErr += Math.abs(pr.score - p.actual.score);
      const predicted = bucketForScore(pr.score);
      if (predicted === p.actual.bucket) agg.bucketCorrect++;
      const cm = agg.confusion[bucketIndex(p.actual.bucket)] as number[];
      cm[bucketIndex(predicted)] = (cm[bucketIndex(predicted)] as number) + 1;
      if (pr.support !== undefined) {
        agg.covDen++;
        if (pr.support > 0) agg.covNum++;
      }
    }
  }
  for (const [uid, ps] of sp.sharedFold ? byUser : []) {
    const u = users.get(uid) as UserAgg;
    for (const a of arms) {
      const agg = u.arms.get(a.id) as ArmAgg;
      const preds = ps.map((p) => (p.preds.get(a.id) as { score: number }).score);
      agg.spearman = spearman(preds, ps.map((p) => p.actual.score));
      agg.ndcg = ndcgAtK(ps.map((p, i) => ({ pred: preds[i] as number, gain: BUCKET_GAIN[p.actual.bucket] })), ndcgK);
    }
  }
  for (const p of sp.pairs) {
    const u = get(p.userId);
    if (!u) continue;
    u.pairs++;
    for (const a of arms) {
      const pr = p.preds.get(a.id) as { winner: number; loser: number };
      const agg = u.arms.get(a.id) as ArmAgg;
      agg.concDen++;
      agg.concNum += pairCredit(pr.winner, pr.loser);
    }
  }
  return [...users.values()].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

const mean = (xs: number[]) => (xs.length === 0 ? Number.NaN : xs.reduce((s, x) => s + x, 0) / xs.length);
const ratio = (num: number, den: number) => (den === 0 ? Number.NaN : num / den);

/** Every metric for one arm over a set of users. NaN when undefined (no data, or no CF support for the arm). */
export function summarise(users: readonly UserAgg[], arm: ArmId): Record<MetricId, number> {
  const aggs = users.map((u) => u.arms.get(arm) as ArmAgg);
  let concNum = 0, concDen = 0, absErr = 0, points = 0, correct = 0, covNum = 0, covDen = 0;
  for (const a of aggs) {
    concNum += a.concNum;
    concDen += a.concDen;
    absErr += a.absErr;
    points += a.points;
    correct += a.bucketCorrect;
    covNum += a.covNum;
    covDen += a.covDen;
  }
  return {
    concordance: mean(aggs.filter((a) => a.concDen > 0).map((a) => a.concNum / a.concDen)),
    concordanceMicro: ratio(concNum, concDen),
    spearman: mean(aggs.flatMap((a) => (a.spearman === null ? [] : [a.spearman]))),
    ndcg10: mean(aggs.flatMap((a) => (a.ndcg === null ? [] : [a.ndcg]))),
    bucketAccuracy: ratio(correct, points),
    mae: ratio(absErr, points),
    cfCoverage: ratio(covNum, covDen),
  };
}

function summariseGroup(group: GroupSummary['group'], users: readonly UserAgg[], arms: readonly Arm[], iterations: number, seed: string): GroupSummary {
  const ids = arms.map((a) => a.id);
  const hasRef = ids.includes(REFERENCE_ARM);
  const others = hasRef ? ids.filter((id) => id !== REFERENCE_ARM) : [];
  const stat = (sample: readonly UserAgg[]): number[] => {
    const per = new Map(ids.map((id) => [id, summarise(sample, id)]));
    const out: number[] = [];
    for (const id of ids) for (const m of METRIC_IDS) out.push((per.get(id) as Record<MetricId, number>)[m]);
    if (hasRef) {
      const ref = per.get(REFERENCE_ARM) as Record<MetricId, number>;
      for (const id of others) for (const m of METRIC_IDS) out.push((per.get(id) as Record<MetricId, number>)[m] - ref[m]);
    }
    return out;
  };
  const bs = pairedBootstrap(users, stat, { iterations, seed: `${seed}:${group}` });
  const at = (i: number): MetricCI => ({ point: bs.point[i] as number, lo: bs.lo[i] as number, hi: bs.hi[i] as number });
  const block = (offset: number) => Object.fromEntries(METRIC_IDS.map((m, j) => [m, at(offset + j)])) as Record<MetricId, MetricCI>;
  const M = METRIC_IDS.length;
  const summaries: ArmSummary[] = arms.map((a, i) => {
    const confusion = emptyConfusion();
    for (const u of users) {
      const c = (u.arms.get(a.id) as ArmAgg).confusion;
      c.forEach((row, r) => row.forEach((v, k) => ((confusion[r] as number[])[k] = ((confusion[r] as number[])[k] as number) + v)));
    }
    const oi = others.indexOf(a.id);
    return { arm: a.id, experimental: a.experimental, metrics: block(i * M), delta: oi < 0 ? null : block((ids.length + oi) * M), confusion };
  });
  return { group, users: users.length, points: users.reduce((s, u) => s + u.points, 0), pairs: users.reduce((s, u) => s + u.pairs, 0), arms: summaries };
}

export function evaluate(ds: EvalDataset, options: EvalOptions = {}): EvalReport {
  const opts = {
    splits: options.splits ?? (['loo', 'temporal'] as const),
    respace: options.respace ?? true,
    temporalQuantile: options.temporalQuantile ?? 0.8,
    bootstrapIterations: options.bootstrapIterations ?? 1000,
    seed: options.seed ?? 'bevi-eval',
    arms: [...(options.arms ?? ARM_IDS)],
    ndcgK: options.ndcgK ?? 10,
  };
  if (!(opts.temporalQuantile > 0 && opts.temporalQuantile < 1)) throw new RangeError('temporalQuantile must be in (0, 1)');
  const prepared = prepareDataset(ds);
  const arms = armsById(opts.arms);
  const splits: SplitReport[] = opts.splits.map((split) => {
    const sp = split === 'loo' ? leaveOneOut(prepared, arms, opts.respace) : temporalSplit(prepared, arms, opts.respace, opts.temporalQuantile);
    const users = aggregateUsers(sp, arms, opts.ndcgK);
    const groups: GroupSummary[] = [summariseGroup('all', users, arms, opts.bootstrapIterations, `${opts.seed}:${split}`)];
    for (const c of COHORTS) groups.push(summariseGroup(c.id, users.filter((u) => u.cohort === c.id), arms, opts.bootstrapIterations, `${opts.seed}:${split}`));
    const ineligible = [...countsByUser(prepared.rankings).keys()].filter((u) => (sp.nTrain.get(u) ?? 0) < MIN_N_USER).length;
    return { split, listMetrics: sp.sharedFold, cutoff: sp.cutoff, folds: sp.folds, points: sp.points.length, pairs: sp.pairs.length, tieComparisons: sp.ties, ineligibleUsers: ineligible, groups };
  });
  return {
    rankingVersion: RANKING_VERSION,
    dataset: {
      bevs: prepared.catalog.size,
      users: countsByUser(prepared.rankings).size,
      rankings: prepared.rankings.length,
      comparisons: prepared.comparisons.length,
      dropped: prepared.dropped,
    },
    options: { ...opts, splits: [...opts.splits], reference: REFERENCE_ARM },
    splits,
    similarity: similarityDiagnostics(foldSnapshot(prepared.catalog, prepared.rankings)),
  };
}
