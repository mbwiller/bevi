import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARMS } from '../eval/arms.ts';
import { parseExport, prepareDataset, toExport, type EvalDataset } from '../eval/dataset.ts';
import { formatReport, SYNTHETIC_BANNER } from '../eval/report.ts';
import { COHORTS, cohortOf, dedupeComparisons, evaluate, temporalCutoff } from '../eval/run.ts';
import { makeEngine, similarityDiagnostics } from '../eval/similarity-arms.ts';
import { syntheticDataset } from '../eval/synthetic.ts';
import { cosineSimilarity, layer2, predictScore } from '../src/index.ts';
import { syntheticSnapshot } from './snapshot-fixture.ts';

describe('the experimental similarity arm differs from the engine only in the similarity', () => {
  it('makeEngine(cosineSimilarity) reproduces predictScore() and layer2() exactly', () => {
    const snap = syntheticSnapshot('engine-equiv', 14, 40);
    const cosine = makeEngine(cosineSimilarity);
    for (const u of Object.keys(snap.users)) {
      for (const b of Object.keys(snap.bevs)) {
        expect(cosine.layer2(snap, u, b)).toEqual(layer2(snap, u, b));
        expect(cosine.predict(snap, u, b).score).toBe(predictScore(snap, u, b).score);
      }
    }
  });

  it('similarityDiagnostics counts pairs cosine admits and Pearson rejects', () => {
    const snap = syntheticSnapshot('diag', 20, 30);
    const d = similarityDiagnostics(snap);
    expect(d.userPairs).toBe((d.users * (d.users - 1)) / 2);
    expect(d.pairsEligible).toBeLessThanOrEqual(d.userPairs);
    expect(d.cosineOnlyNeighbours).toBeLessThanOrEqual(d.cosinePositive);
    expect(d.signDisagree).toBeGreaterThanOrEqual(d.cosineOnlyNeighbours);
  });
});

describe('export parsing', () => {
  const ok = toExport(syntheticDataset('parse', 4, 10));
  it('accepts numeric strings for score (Postgres numeric) and rejects malformed rows', () => {
    const withString = { ...ok, rankings: ok.rankings.map((r, i) => (i === 0 ? { ...r, score: String(r.score) } : r)) };
    expect(parseExport(withString).rankings[0]?.score).toBe(ok.rankings[0]?.score);
    expect(() => parseExport({ ...ok, format: 'x' })).toThrow(/format/);
    expect(() => parseExport({ ...ok, formatVersion: 2 })).toThrow(/formatVersion/);
    expect(() => parseExport({ ...ok, rankings: [{ ...ok.rankings[0], bucket: 4 }] })).toThrow(/rankings\[0\].*bucket/);
    expect(() => parseExport({ ...ok, rankings: [{ ...ok.rankings[0], rankedAt: 'yesterday' }] })).toThrow(/rankedAt/);
    expect(() => parseExport({ ...ok, bevs: [{ ...ok.bevs[0], priceTier: 5 }] })).toThrow(/priceTier/);
  });
  it('drops rows on unknown Bevs and keeps the latest duplicate ranking', () => {
    const ds = parseExport(ok);
    const r0 = ds.rankings[0] as EvalDataset['rankings'][number];
    const p = prepareDataset({
      ...ds,
      rankings: [...ds.rankings, { ...r0, bevId: 'ghost' }, { ...r0, score: 1.23, rankedAt: '2030-01-01T00:00:00Z' }],
      comparisons: [...ds.comparisons, { userId: 'x', submissionId: 's', winnerBevId: 'ghost', loserBevId: r0.bevId, tie: false, createdAt: '2026-10-01T00:00:00Z' }],
    });
    expect(p.dropped).toEqual({ rankingsUnknownBev: 1, rankingsDuplicate: 1, comparisonsUnknownBev: 1 });
    expect(p.rankings.find((r) => r.userId === r0.userId && r.bevId === r0.bevId)?.score).toBe(1.23);
  });
});

describe('splits', () => {
  it('cohorts are n_u ∈ {3–5, 6–14, 15+}', () => {
    expect(COHORTS.map((c) => c.id)).toEqual(['3-5', '6-14', '15+']);
    expect([2, 3, 5, 6, 14, 15, 80].map(cohortOf)).toEqual([null, '3-5', '3-5', '6-14', '6-14', '15+', '15+']);
  });
  it('comparisons: latest answer per unordered pair, ties counted and excluded', () => {
    const c = (w: string, l: string, at: string, tie = false) => ({ userId: 'u', submissionId: 's', winnerBevId: w, loserBevId: l, tie, createdAt: at });
    const { decisive, ties } = dedupeComparisons([c('a', 'b', '2026-10-01T00:00:00Z'), c('b', 'a', '2026-10-02T00:00:00Z'), c('c', 'd', '2026-10-01T00:00:00Z', true)]);
    expect(decisive).toEqual([c('b', 'a', '2026-10-02T00:00:00Z')]);
    expect(ties).toBe(1);
  });
  it('hour-truncated timestamps: equal createdAt keeps the later answer in array order, stable order', () => {
    const c = (w: string, l: string, sub: string) => ({ userId: 'u', submissionId: sub, winnerBevId: w, loserBevId: l, tie: false, createdAt: '2026-10-01T13:00:00+00:00' });
    const cs = [c('a', 'b', 's1'), c('c', 'd', 's1'), c('b', 'a', 's2')];
    expect(dedupeComparisons(cs).decisive).toEqual([c('b', 'a', 's2'), c('c', 'd', 's1')]);
    expect(dedupeComparisons([...cs].reverse()).decisive.map((x) => x.winnerBevId)).toEqual(['a', 'c']);
  });
  it('temporal split at hour precision: the whole cutoff hour, and its comparisons, are test', () => {
    const at = (h: number) => `2026-10-01T${String(h).padStart(2, '0')}:00:00+00:00`;
    const bevs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id, brand: null, flavor: null, categoryId: 'soda', priceTier: 1 as const, isAlcoholic: false }));
    const r = (bevId: string, position: number, h: number) => ({ userId: 'u', bevId, bucket: 'FINE' as const, position, score: 6.5 - position * 0.4, rankedAt: at(h) });
    // Four rankings in hour 1, then e and f both in hour 5 (one submission each, same truncated hour).
    const rankings = [r('a', 0, 1), r('b', 1, 1), r('c', 2, 1), r('d', 3, 1), r('e', 4, 5), r('f', 5, 5)];
    const comparisons = [
      { userId: 'u', submissionId: 'x', winnerBevId: 'c', loserBevId: 'e', tie: false, createdAt: at(5) },
      { userId: 'u', submissionId: 'y', winnerBevId: 'e', loserBevId: 'f', tie: false, createdAt: at(5) },
      { userId: 'u', submissionId: 'z', winnerBevId: 'a', loserBevId: 'b', tie: false, createdAt: at(1) },
    ];
    const rep = evaluate({ bevs, rankings, comparisons }, { splits: ['temporal'], temporalQuantile: 0.7, bootstrapIterations: 10, arms: ['user-mean', 'engine'] });
    const t = rep.splits[0]!;
    expect(t.cutoff).toBe(at(5));
    expect(t.points).toBe(2);
    expect(t.pairs).toBe(2);
  });
  it('temporal cutoff is the ranked_at quantile', () => {
    const rows = [0, 1, 2, 3, 4].map((d) => ({ userId: 'u', bevId: `b${d}`, bucket: 'FINE' as const, position: d, score: 5, rankedAt: `2026-10-0${d + 1}T00:00:00Z` }));
    expect(temporalCutoff(rows, 0.8)).toBe('2026-10-05T00:00:00Z');
    expect(temporalCutoff([], 0.8)).toBeNull();
  });
});

describe('evaluate (end to end on synthetic data, NOT an accuracy result)', () => {
  const ds = syntheticDataset('e2e', 20, 40);
  const report = evaluate(ds, { bootstrapIterations: 50, seed: 'e2e' });

  it('is deterministic', () => {
    expect(evaluate(ds, { bootstrapIterations: 50, seed: 'e2e' })).toEqual(report);
  });

  it('reports every arm, the reference delta, and sane ranges', () => {
    for (const s of report.splits) {
      const all = s.groups[0]!;
      expect(all.group).toBe('all');
      expect(all.arms.map((a) => a.arm)).toEqual(ARMS.map((a) => a.id));
      expect(s.groups.slice(1).reduce((n, g) => n + g.users, 0)).toBe(all.users);
      for (const a of all.arms) {
        const conc = a.metrics.concordance;
        expect(conc.point).toBeGreaterThanOrEqual(0);
        expect(conc.point).toBeLessThanOrEqual(1);
        expect(conc.lo).toBeLessThanOrEqual(conc.hi);
        expect(conc.iterations).toBe(50);
        expect(conc.draws).toBeLessThanOrEqual(50);
        expect(a.confusion.flat().reduce((x, y) => x + y, 0)).toBe(all.points);
        expect(a.delta === null).toBe(a.arm === 'engine');
        expect(Number.isNaN(a.metrics.cfCoverage.point)).toBe(!['layer2', 'engine', 'engine-pearson'].includes(a.arm));
        expect(Number.isFinite(a.metrics.spearman.point)).toBe(s.listMetrics);
      }
      // A constant predictor orders nothing.
      expect(all.arms.find((a) => a.arm === 'user-mean')!.metrics.concordance.point).toBe(0.5);
    }
    expect(report.splits.map((s) => [s.split, s.listMetrics])).toEqual([['loo', false], ['temporal', true]]);
  });

  it('the synthetic report is labelled as not an accuracy result', () => {
    const text = formatReport(report, { synthetic: true, source: 'test' });
    expect(text.startsWith(SYNTHETIC_BANNER)).toBe(true);
    expect(text.endsWith(SYNTHETIC_BANNER)).toBe(true);
    expect(formatReport(report, { synthetic: false, source: 'x' })).not.toContain('SYNTHETIC');
  });

  it('within-user list metrics are biased under leave-one-out (why LOO omits them)', () => {
    // Leave-one-out μ_u = mean of the OTHER scores: anti-correlated with the held-out score.
    const scores = [2, 4, 5, 7, 9];
    const loo = scores.map((_, i) => scores.filter((__, j) => j !== i).reduce((a, b) => a + b, 0) / 4);
    expect(loo.every((m, i) => i === 0 || m < (loo[i - 1] as number))).toBe(true);
  });
});

describe('eval/ stays pure apart from the CLI', () => {
  it('no Node APIs, clock or Math.random outside eval/cli.ts', () => {
    const dir = fileURLToPath(new URL('../eval/', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'cli.ts');
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const code = readFileSync(dir + f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/from 'node:|\bprocess\b|\bDate\.now\b|new Date\(\s*\)|Math\.random|\bfetch\s*\(/);
    }
  });
});
