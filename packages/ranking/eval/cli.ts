// npm run eval -w packages/ranking -- <export.json> [options]
// npm run eval -w packages/ranking -- --synthetic [options]
//
// The only file in eval/ that does I/O (reads the export, writes the optional sample file).
//
// Options:
//   --synthetic             evaluate syntheticDataset() instead of an export (NOT an accuracy result)
//   --users N --bevs N      synthetic size (default 40 × 80)
//   --write-sample <path>   write the synthetic dataset as an export file (format reference) and exit
//   --split loo|temporal    run one split (default both)
//   --no-respace            do not re-space held-out users' buckets (folds.ts leak 5)
//   --quantile q            temporal cutoff quantile on ranked_at (default 0.8)
//   --bootstrap N           bootstrap resamples (default 1000)
//   --seed s                bootstrap / synthetic seed (default "bevi-eval")
//   --json                  print the EvalReport as JSON instead of the text report

import { readFileSync, writeFileSync } from 'node:fs';
import { parseExport, toExport, type EvalDataset } from './dataset.ts';
import { formatReport } from './report.ts';
import { evaluate, type SplitId } from './run.ts';
import { syntheticDataset } from './synthetic.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(['--users', '--bevs', '--write-sample', '--split', '--quantile', '--bootstrap', '--seed']);
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1] ?? ''));

const seed = value('--seed') ?? 'bevi-eval';
const synthetic = flag('--synthetic') || flag('--write-sample');
if (!synthetic && positional.length !== 1) {
  console.error('usage: npm run eval -w packages/ranking -- <export.json> | --synthetic   (see eval/README.md)');
  process.exit(2);
}

let ds: EvalDataset;
let source: string;
if (synthetic) {
  const users = Number(value('--users') ?? 40);
  const bevs = Number(value('--bevs') ?? 80);
  ds = syntheticDataset(seed, users, bevs);
  source = `syntheticDataset("${seed}", ${users} users, ${bevs} Bevs, 10% noisy placement answers)`;
  const out = value('--write-sample');
  if (out) {
    writeFileSync(out, `${JSON.stringify(toExport(ds, '2026-10-18T00:00:00Z'), null, 2)}\n`);
    console.log(`wrote ${out}: ${ds.rankings.length} rankings, ${ds.comparisons.length} comparisons (SYNTHETIC)`);
    process.exit(0);
  }
} else {
  source = positional[0] as string;
  ds = parseExport(JSON.parse(readFileSync(source, 'utf8')));
}

const split = value('--split');
if (split !== undefined && split !== 'loo' && split !== 'temporal') {
  console.error('--split must be loo or temporal');
  process.exit(2);
}
const report = evaluate(ds, {
  splits: split ? [split as SplitId] : undefined,
  respace: !flag('--no-respace'),
  temporalQuantile: value('--quantile') === undefined ? undefined : Number(value('--quantile')),
  bootstrapIterations: value('--bootstrap') === undefined ? undefined : Number(value('--bootstrap')),
  seed,
});
console.log(flag('--json') ? JSON.stringify({ synthetic, source, ...report }, null, 2) : formatReport(report, { synthetic, source }));
