// Plain-text rendering of an EvalReport. Pure.

import { BUCKET_ORDER } from '../src/constants.ts';
import { ARMS, REFERENCE_ARM } from './arms.ts';
import type { EvalReport, GroupSummary, MetricCI, MetricId, SplitReport } from './run.ts';

export const SYNTHETIC_BANNER = [
  '#'.repeat(78),
  '# SYNTHETIC DATA: NOT AN ACCURACY RESULT.',
  '# syntheticSnapshot() plants tastes with the same category assumptions the model',
  '# makes, so every arm is flattered. Use this output only to check that the harness',
  '# runs and how sensitive each metric is, never to judge or tune the engine.',
  '#'.repeat(78),
].join('\n');

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '  —  ');
const signed = (x: number) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '  —  ');
const ci = (m: MetricCI, fmt = f3) => (Number.isFinite(m.point) ? `${fmt(m.point)} [${fmt(m.lo)}, ${fmt(m.hi)}]` : '—');
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

const COLUMNS: Array<[MetricId, string]> = [
  ['concordance', 'concordance (macro)'],
  ['spearman', 'Spearman (macro)'],
  ['ndcg10', 'NDCG@10 (macro)'],
  ['bucketAccuracy', 'bucket acc'],
  ['mae', 'MAE'],
  ['cfCoverage', 'CF coverage'],
];

function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i] as number)).join('  ').trimEnd();
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

function groupBlock(g: GroupSummary): string {
  const title = g.group === 'all' ? 'All eligible users' : `Cohort n_u ${g.group}`;
  const head = `${title}: ${g.users} users, ${g.points} held-out rankings, ${g.pairs} held-out comparisons`;
  if (g.users === 0) return `${head}\n  (no users)`;
  const rows = g.arms.map((a) => [
    a.arm + (a.experimental ? ' *' : ''),
    ...COLUMNS.map(([m]) => ci(a.metrics[m])),
    a.delta ? ci(a.delta.concordance, signed) : '(reference)',
  ]);
  return `${head}\n${table(['arm', ...COLUMNS.map(([, h]) => h), `Δ concordance vs ${REFERENCE_ARM}`], rows)}`;
}

function confusionBlock(g: GroupSummary): string {
  const ref = g.arms.find((a) => a.arm === REFERENCE_ARM);
  if (!ref) return '';
  const rows = BUCKET_ORDER.map((b, i) => [b, ...(ref.confusion[i] as number[]).map(String)]);
  return `Bucket confusion, ${REFERENCE_ARM}, all users (rows actual, columns predicted)\n${table(['actual \\ predicted', ...BUCKET_ORDER], rows)}`;
}

function splitBlock(s: SplitReport): string {
  const name = s.split === 'loo' ? 'LEAVE-ONE-OUT' : `TEMPORAL (test = ranked_at ≥ ${s.cutoff ?? '—'})`;
  const head = [
    `=== ${name} ===`,
    `${s.folds} folds, ${s.points} held-out rankings, ${s.pairs} held-out comparisons (${s.tieComparisons} "too close to call" excluded), ${s.ineligibleUsers} users below MIN_N_USER skipped`,
  ];
  if (!s.listMetrics) {
    head.push(
      'Spearman and NDCG@10 are not reported for leave-one-out: each held-out Bev comes from its own fold, and the fold mean',
      'μ_u moves by −s_b/(n−1), which makes any mean-based arm anti-correlated with the held-out score. See the temporal split.',
    );
  }
  return [...head, '', ...s.groups.flatMap((g) => [groupBlock(g), '']), confusionBlock(s.groups[0] as GroupSummary)].join('\n');
}

export function formatReport(r: EvalReport, opts: { synthetic: boolean; source: string }): string {
  const sim = r.similarity;
  const share = (k: number) => (sim.pairsEligible > 0 ? `${((100 * k) / sim.pairsEligible).toFixed(1)}%` : '—');
  const out = [
    ...(opts.synthetic ? [SYNTHETIC_BANNER, ''] : []),
    `Bevi offline evaluation (graph Stage 1 baseline), RANKING_VERSION ${r.rankingVersion}`,
    `Source: ${opts.source}`,
    `Data: ${r.dataset.users} users, ${r.dataset.rankings} rankings, ${r.dataset.comparisons} comparisons, ${r.dataset.bevs} Bevs` +
      ` (dropped: ${r.dataset.dropped.rankingsUnknownBev} rankings and ${r.dataset.dropped.comparisonsUnknownBev} comparisons on unknown Bevs, ${r.dataset.dropped.rankingsDuplicate} duplicate rankings)`,
    `Options: respace=${r.options.respace}, temporalQuantile=${r.options.temporalQuantile}, bootstrap=${r.options.bootstrapIterations} resamples over users (seed "${r.options.seed}"), NDCG@${r.options.ndcgK}`,
    'Every value: point estimate [95% paired-bootstrap CI over users]. Primary metric: pairwise concordance on comparisons.',
    'Cohorts use n_u = rankings visible when predicting (LOO: n − 1; temporal: rankings before the cutoff).',
    '',
    ...r.splits.flatMap((s) => [splitBlock(s), '']),
    '=== Arms ===',
    ...ARMS.filter((a) => r.options.arms.includes(a.id)).map((a) => `${pad(a.id + (a.experimental ? ' *' : ''), 20)} ${a.description}`),
    '* experimental, eval-only; not the production engine.',
    '',
    '=== layer2.ts cosine vs Pearson over the common subset (EXPERIMENTAL diagnostic, full data) ===',
    `${sim.users} users, ${sim.userPairs} user pairs, ${sim.pairsEligible} with ≥ 2 co-rated Bevs (${sim.pairsCommon2} with exactly 2, where Pearson is ±1 or 0)`,
    `cosine > 0: ${share(sim.cosinePositive)}; Pearson > 0: ${share(sim.pearsonPositive)}; sign disagrees: ${share(sim.signDisagree)};` +
      ` neighbour under cosine but not Pearson: ${share(sim.cosineOnlyNeighbours)}; mean |cos − Pearson| ${f3(sim.meanAbsDiff)}`,
    `Median co-raters per pair of rated Bevs: ${sim.medianCoRatersPerItemPair} (§8.9: consider item-item at ≥ 3 or ≥ 200 users)`,
  ];
  if (opts.synthetic) out.push('', SYNTHETIC_BANNER);
  return out.join('\n');
}
