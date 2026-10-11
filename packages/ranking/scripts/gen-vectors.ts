// Generates the golden test vectors in shared/fixtures/*.vectors.json. The app runs these formulas
// in TypeScript; Arjun's SQL runs them in Postgres; both must pass the same vectors.
//
//   npm run vectors -w packages/ranking            write the files
//   npm run vectors -w packages/ranking -- --check  exit 1 if the files on disk are stale
//
// Deterministic: a fixed seed and no clock. Never edit the output by hand; change a formula or
// constant, bump RANKING_VERSION, and regenerate.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  answer,
  bayesianAverage,
  BAYES_C,
  categoryAffinity,
  categoryPrior,
  createPrng,
  currentPrompt,
  effectiveCategoryStats,
  effectiveUserStats,
  isDone,
  leaderboardOrder,
  placementResult,
  populationStats,
  randomInt,
  RANKING_CONSTANTS,
  RANKING_VERSION,
  respaceBucket,
  scoreFromPosition,
  startPlacement,
  storedScore,
  storedScoreCents,
  undo,
  userStats,
  zScore,
  type Bucket,
  type ComparisonAnswer,
  type LeaderboardInputRow,
  type PlacementState,
  type ScoredRanking,
  type Stats,
} from '../src/index.ts';

const OUT_DIR = fileURLToPath(new URL('../../../shared/fixtures/', import.meta.url));
const BUCKETS: Bucket[] = ['LOVED', 'FINE', 'DISLIKED'];
const CATEGORIES = ['soda', 'diet_soda', 'sparkling_water', 'energy', 'coffee', 'boba'];

const rand = createPrng('bevi-vectors');
const pick = <T>(xs: readonly T[]): T => xs[randomInt(rand, xs.length)] as T;

interface Case {
  name: string;
  fn: string;
  input: unknown;
  expected: unknown;
}

const constants = {
  ...RANKING_CONSTANTS,
  storedScoreRule:
    'cents = floor((2N + D) / (2D)) with D = n + 1, N = 100*(hi*D - (hi - lo)*(index + 1)); capped at hi*100 - 1 for FINE and DISLIKED; storedScore = cents / 100',
  stddev: 'population (stddev_pop)',
  nameOrder: 'code point (SQL collate "C"), then bevId',
};

/** A plausible stored score: some position in some bucket. */
function randomStoredScore(): number {
  const n = 1 + randomInt(rand, 40);
  return storedScore(randomInt(rand, n), n, pick(BUCKETS));
}

// ---------------------------------------------------------------- score-from-position

function scoreCases(): Case[] {
  const cases: Case[] = [];
  const seen = new Set<string>();
  const add = (bucket: Bucket, n: number, index: number) => {
    const name = `${bucket} n=${n} i=${index}`;
    if (seen.has(name)) return;
    seen.add(name);
    cases.push({
      name,
      fn: 'storedScore',
      input: { bucket, n, index },
      expected: {
        score: scoreFromPosition(index, n, bucket),
        storedScore: storedScore(index, n, bucket),
        storedCents: storedScoreCents(index, n, bucket),
      },
    });
  };
  for (const bucket of BUCKETS) {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 50]) for (let i = 0; i < n; i++) add(bucket, n, i);
    // Exact half cents (n + 1 = 8, 16, 40) and the top-edge cap (n = 598, 599, 799, 800).
    for (const n of [15, 39, 598, 599, 799, 800]) {
      add(bucket, n, 0);
      add(bucket, n, 1);
      add(bucket, n, n - 1);
    }
  }
  for (const bucket of BUCKETS) {
    for (const n of [0, 1, 2, 5, 13]) {
      const ids = Array.from({ length: n }, (_, i) => `bev-${String.fromCharCode(97 + i)}`);
      cases.push({ name: `respace ${bucket} n=${n}`, fn: 'respaceBucket', input: { bucket, orderedBevIds: ids }, expected: respaceBucket(ids, bucket) });
    }
  }
  return cases;
}

// ---------------------------------------------------------------- bev-stats

function bevStatsCases(): Case[] {
  const sets: Array<[string, number[]]> = [
    ['one rating', [8.5]],
    ['identical ratings', [7.75, 7.75, 7.75]],
    ['two far apart', [9.25, 2]],
  ];
  for (const size of [3, 5, 10, 25, 100]) sets.push([`${size} random stored scores`, Array.from({ length: size }, randomStoredScore)]);
  return sets.map(([name, scores]) => ({ name, fn: 'populationStats', input: { scores }, expected: populationStats(scores) }));
}

// ---------------------------------------------------------------- user-stats

function randomRankings(count: number, prefix: string): ScoredRanking[] {
  return Array.from({ length: count }, (_, i) => ({ bevId: `${prefix}-${i}`, categoryId: pick(CATEGORIES), score: randomStoredScore() }));
}

function userCase(name: string, rankings: ScoredRanking[], global: Stats): Case {
  const u = userStats(rankings);
  const effective = effectiveUserStats(u.overall, global);
  const z: Record<string, number> = {};
  for (const r of rankings) z[r.bevId] = zScore(r.score, effective);
  const byCategory: Record<string, unknown> = {};
  const affinity: Record<string, number> = {};
  for (const [cat, stats] of Object.entries(u.byCategory)) {
    byCategory[cat] = { stats, effective: effectiveCategoryStats(stats, effective) };
    affinity[cat] = categoryAffinity(rankings.filter((r) => r.categoryId === cat).map((r) => z[r.bevId] as number));
  }
  return { name, fn: 'userStats', input: { rankings, global }, expected: { overall: u.overall, effective, byCategory, z, affinity } };
}

function userStatsCases(): Case[] {
  const global = populationStats(Array.from({ length: 200 }, randomStoredScore));
  const empty: Stats = { n: 0, mean: 0, stddev: 0 };
  return [
    userCase('two rankings: global stats', randomRankings(2, 'u2'), global),
    userCase('one ranking, empty system: GLOBAL_FALLBACK', randomRankings(1, 'u1'), empty),
    userCase('three identical scores: stddev floored', [
      { bevId: 'same-0', categoryId: 'soda', score: 8.5 },
      { bevId: 'same-1', categoryId: 'soda', score: 8.5 },
      { bevId: 'same-2', categoryId: 'energy', score: 8.5 },
    ], global),
    userCase('five rankings', randomRankings(5, 'u5'), global),
    userCase('twelve rankings', randomRankings(12, 'u12'), global),
    userCase('thirty rankings', randomRankings(30, 'u30'), global),
  ];
}

// ---------------------------------------------------------------- bayesian

function bayesianCases(): Case[] {
  const cases: Case[] = [];
  const avg = (name: string, mean: number, n: number, m: number) =>
    cases.push({ name, fn: 'bayesianAverage', input: { mean, n, m, C: BAYES_C }, expected: bayesianAverage(mean, n, { m, C: BAYES_C }) });
  avg('one 10/10, m = 6', 10, 1, 6);
  avg('five 10/10s, m = 6', 10, 5, 6);
  avg('one 2/10, m = 6', 2, 1, 6);
  avg('no ratings', 0, 0, 6.2);
  for (let i = 0; i < 6; i++) {
    const scores = Array.from({ length: 1 + randomInt(rand, 30) }, randomStoredScore);
    const s = populationStats(scores);
    avg(`random ${i + 1} (n = ${s.n})`, s.mean, s.n, 5 + randomInt(rand, 300) / 100);
  }

  const global: Stats = { n: 120, mean: 6.4, stddev: 2 };
  for (const [name, category] of [
    ['category with 30 rankings uses its own mean', { n: 30, mean: 4.2, stddev: 1.1 }],
    ['category with 29 rankings uses the global mean', { n: 29, mean: 4.2, stddev: 1.1 }],
  ] as Array<[string, Stats]>) {
    cases.push({ name, fn: 'categoryPrior', input: { category, global }, expected: categoryPrior(category, global) });
  }
  const none: Stats = { n: 0, mean: 0, stddev: 0 };
  cases.push({ name: 'empty system prior', fn: 'categoryPrior', input: { category: none, global: none }, expected: categoryPrior(none, none) });

  const rows: LeaderboardInputRow[] = [
    { bevId: 'new', bayes: 9.9, n: 1, name: 'New Bev' },
    { bevId: 'b', bayes: 7.2, n: 4, name: 'Sprite' },
    { bevId: 'a', bayes: 7.2, n: 9, name: 'Coke' },
    { bevId: 'c', bayes: 7.2, n: 4, name: 'Fanta' },
    { bevId: 'd2', bayes: 8.1, n: 2, name: 'Topo Chico' },
    { bevId: 'd1', bayes: 8.1, n: 2, name: 'Topo Chico' },
    { bevId: 'lower', bayes: 6, n: 3, name: 'arizona' },
    { bevId: 'upper', bayes: 6, n: 3, name: 'Zevia' },
  ];
  cases.push({ name: 'eligibility and tie order', fn: 'leaderboardOrder', input: { rows }, expected: leaderboardOrder(rows) });
  return cases;
}

// ---------------------------------------------------------------- placement

type Step = ComparisonAnswer | 'UNDO';

function placementCase(name: string, bevId: string, bucket: Bucket, orderedBevIds: string[], steps: Step[]): Case {
  let s = startPlacement({ bevId, bucket, orderedBevIds });
  for (const step of steps) s = step === 'UNDO' ? undo(s) : answer(s, step);
  if (!isDone(s)) throw new Error(`placement case "${name}" does not finish`);
  return { name, fn: 'placement', input: { bevId, bucket, orderedBevIds, steps }, expected: placementResult(s) };
}

/** Answers until done, from a hidden true index t (consistent oracle). */
function oracleSteps(n: number, t: number): Step[] {
  const ids = Array.from({ length: n }, (_, i) => `b${i}`);
  let s: PlacementState = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: ids });
  const steps: Step[] = [];
  while (!isDone(s)) {
    const j = ids.indexOf(currentPrompt(s)?.comparedBevId ?? '');
    const a: ComparisonAnswer = t <= j ? 'NEW_BETTER' : 'EXISTING_BETTER';
    steps.push(a);
    s = answer(s, a);
  }
  return steps;
}

function placementCases(): Case[] {
  const five = ['coke', 'sprite', 'pepsi', 'fanta', 'dew'];
  const cases: Case[] = [
    placementCase('empty bucket', 'new', 'LOVED', [], []),
    placementCase('one Bev, new is better', 'new', 'FINE', ['coke'], ['NEW_BETTER']),
    placementCase('one Bev, existing is better', 'new', 'FINE', ['coke'], ['EXISTING_BETTER']),
    placementCase('one Bev, tie', 'new', 'FINE', ['coke'], ['TIE']),
    placementCase('best of five', 'new', 'LOVED', five, ['NEW_BETTER', 'NEW_BETTER', 'NEW_BETTER']),
    placementCase('worst of five', 'new', 'LOVED', five, ['EXISTING_BETTER', 'EXISTING_BETTER']),
    placementCase('tie on the first question', 'new', 'LOVED', five, ['TIE']),
    placementCase('tie on the second question', 'new', 'DISLIKED', five, ['NEW_BETTER', 'TIE']),
    placementCase('undo then change the answer', 'new', 'LOVED', five, ['NEW_BETTER', 'UNDO', 'EXISTING_BETTER', 'NEW_BETTER', 'EXISTING_BETTER']),
    placementCase('undo after done', 'new', 'FINE', ['coke'], ['NEW_BETTER', 'UNDO', 'EXISTING_BETTER']),
    placementCase('re-rank: the Bev is removed from its own list first', 'pepsi', 'LOVED', five, ['EXISTING_BETTER', 'NEW_BETTER']),
  ];
  for (const n of [3, 10, 31, 100]) {
    const ids = Array.from({ length: n }, (_, i) => `b${i}`);
    for (const t of [0, n, randomInt(rand, n + 1)]) {
      cases.push(placementCase(`oracle n=${n} t=${t}`, 'new', 'LOVED', ids, oracleSteps(n, t)));
    }
  }
  return cases;
}

// ---------------------------------------------------------------- write / check

const files: Record<string, Case[]> = {
  'score-from-position.vectors.json': scoreCases(),
  'bev-stats.vectors.json': bevStatsCases(),
  'user-stats.vectors.json': userStatsCases(),
  'bayesian.vectors.json': bayesianCases(),
  'placement.vectors.json': placementCases(),
};

const check = process.argv.includes('--check');
let stale = 0;
mkdirSync(OUT_DIR, { recursive: true });
for (const [file, cases] of Object.entries(files)) {
  const text = `${JSON.stringify({ version: RANKING_VERSION, constants, cases }, null, 2)}\n`;
  const path = OUT_DIR + file;
  if (check) {
    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {}
    if (current !== text) {
      console.error(`stale: shared/fixtures/${file}`);
      stale++;
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote shared/fixtures/${file} (${cases.length} cases)`);
  }
}
if (stale > 0) {
  console.error('Run `npm run vectors -w packages/ranking` and commit the result in a contract/vectors-* PR.');
  process.exit(1);
}
