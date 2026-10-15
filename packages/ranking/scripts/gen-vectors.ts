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
  computeStreak,
  contentSimilarity,
  createPrng,
  currentPrompt,
  effectiveCategoryStats,
  EDGE_MIN_WEIGHT,
  EDGE_TOP_K,
  effectiveUserStats,
  edgeWeight,
  embeddingSimilarity,
  isDone,
  leaderboardOrder,
  localDayKey,
  localPeriodKey,
  placementResult,
  populationStats,
  profileSimilarity,
  randomInt,
  rankPoints,
  rankUsers,
  RANKING_CONSTANTS,
  RANKING_VERSION,
  respaceBucket,
  scoreFromPosition,
  startPlacement,
  storedScore,
  storedScoreCents,
  topEdges,
  treeSimilarity,
  undo,
  userStats,
  zScore,
  type BevFeatures,
  type Bucket,
  type ComparisonAnswer,
  type EdgeCandidate,
  type EdgeComponents,
  type FlavorProfile,
  type LeaderboardInputRow,
  type PlacementState,
  type RankUsersRow,
  type ScoredRanking,
  type Stats,
  type StreakPeriod,
  type Taxonomy,
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
  streakDayKey: 'calendar date of the ranking instant in the profile timezone: (created_at AT TIME ZONE timezone)::date; week = ISO week of that date (YYYY-Www)',
  rankOrder: 'points desc, bevsRanked desc, createdAt asc, userId asc; rank = 1 + count(points > mine); bevsRanked = 0 excluded',
  treeDepth: 'Wu-Palmer depth from an implicit root (depth 0) above the top-level categories; a top-level category (parent null or not in the taxonomy) has depth 1',
  profileRule: 'N / 300 with N = 3*(40*[base] + 15*[carbonated] + 10*[dairy] + 5*[alcohol]) + 15*(3 - |dCaffeine|) + 15*(3 - |dSweetness|)',
  embeddingRule: 'min(1, max(0, dot / sqrt(|a|^2 * |b|^2))); 0 when either vector is zero',
  edgeWeightRule: 'tree*0.25 + content*0.15 + emb*0.30 + profile*0.30 + cop*0, summed in that order, clamped to [0, 1]',
  edgeOrder: 'w desc, then bevId asc (code unit); keep w >= edgeMinWeight; at most edgeTopK',
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

// ---------------------------------------------------------------- streak
// No PRNG here, so adding these files leaves every earlier file's cases unchanged.

function streakCases(): Case[] {
  const cases: Case[] = [];
  const dayKey = (name: string, isoTimestamp: string, timeZone: string) =>
    cases.push({ name, fn: 'localDayKey', input: { isoTimestamp, timeZone }, expected: localDayKey(isoTimestamp, timeZone) });
  dayKey('LA 23:59 PDT stays on the local day', '2026-10-11T06:59:00Z', 'America/Los_Angeles');
  dayKey('LA 00:00 PDT starts the next day', '2026-10-11T07:00:00Z', 'America/Los_Angeles');
  dayKey('LA 23:59 PST the night clocks spring forward', '2026-03-08T07:59:00Z', 'America/Los_Angeles');
  dayKey('LA 23:59 PDT on the 23-hour day', '2026-03-09T06:59:00Z', 'America/Los_Angeles');
  dayKey('LA 01:30 PDT before the fall-back repeat', '2026-11-01T08:30:00Z', 'America/Los_Angeles');
  dayKey('LA 01:30 PST after the fall-back repeat', '2026-11-01T09:30:00Z', 'America/Los_Angeles');
  dayKey('LA 23:59 PST on the 25-hour day', '2026-11-02T07:59:00Z', 'America/Los_Angeles');
  dayKey('UTC 23:59:59', '2026-10-10T23:59:59Z', 'UTC');
  dayKey('UTC midnight', '2026-10-11T00:00:00Z', 'UTC');
  dayKey('Kolkata 23:59 IST (UTC+05:30)', '2026-10-10T18:29:00Z', 'Asia/Kolkata');
  dayKey('Kolkata 00:00 IST', '2026-10-10T18:30:00Z', 'Asia/Kolkata');

  // From ranking timestamps + profile timezone + "now" to the streak, as touch_streak / the reset cron see it.
  const streak = (name: string, timestamps: string[], timeZone: string, now: string, period: StreakPeriod = 'day') => {
    const keys = [...new Set(timestamps.map((t) => localPeriodKey(t, timeZone, period)))].sort();
    const todayKey = localPeriodKey(now, timeZone, period);
    cases.push({ name, fn: 'streakFromTimestamps', input: { timestamps, timeZone, now, period }, expected: { periodKeys: keys, todayKey, ...computeStreak(keys, todayKey, period) } });
  };
  streak('LA: four nights at 23:30 across the spring-forward change, ranked today', ['2026-03-07T07:30:00Z', '2026-03-08T07:30:00Z', '2026-03-09T06:30:00Z', '2026-03-10T06:30:00Z'], 'America/Los_Angeles', '2026-03-10T06:45:00Z');
  streak('LA: the 25-hour fall-back day, two rankings, alive from yesterday', ['2026-10-31T19:00:00Z', '2026-11-01T07:30:00Z', '2026-11-02T07:30:00Z'], 'America/Los_Angeles', '2026-11-02T18:00:00Z');
  streak('LA: a ranking at 23:59 local keeps the streak, the next one at 00:01 extends it', ['2026-10-09T18:00:00Z', '2026-10-11T06:59:00Z', '2026-10-11T07:01:00Z'], 'America/Los_Angeles', '2026-10-11T20:00:00Z');
  streak('UTC: the same instants as the previous case', ['2026-10-09T18:00:00Z', '2026-10-11T06:59:00Z', '2026-10-11T07:01:00Z'], 'UTC', '2026-10-11T20:00:00Z');
  streak('UTC: two rankings in one day count once', ['2026-10-10T08:00:00Z', '2026-10-10T21:00:00Z', '2026-10-11T09:00:00Z'], 'UTC', '2026-10-11T23:00:00Z');
  streak('UTC: alive but not extended yet', ['2026-10-08T12:00:00Z', '2026-10-09T12:00:00Z', '2026-10-10T12:00:00Z'], 'UTC', '2026-10-11T12:00:00Z');
  streak('UTC: broken two days ago, longest kept', ['2026-10-01T12:00:00Z', '2026-10-02T12:00:00Z', '2026-10-03T12:00:00Z', '2026-10-09T12:00:00Z'], 'UTC', '2026-10-11T12:00:00Z');
  streak('Kolkata: 23:59 IST and 00:01 IST are two days', ['2026-10-10T18:29:00Z', '2026-10-10T18:31:00Z'], 'Asia/Kolkata', '2026-10-11T05:00:00Z');
  streak('Kolkata: ranked today only', ['2026-10-11T03:00:00Z'], 'Asia/Kolkata', '2026-10-11T18:29:00Z');
  streak('no rankings', [], 'UTC', '2026-10-11T12:00:00Z');
  streak('weekly: three ISO weeks across the new year', ['2026-12-23T12:00:00Z', '2026-12-31T12:00:00Z', '2027-01-05T12:00:00Z'], 'UTC', '2027-01-12T12:00:00Z', 'week');

  const keys = (name: string, periodKeys: string[], todayKey: string, period: StreakPeriod = 'day') =>
    cases.push({ name, fn: 'computeStreak', input: { periodKeys, todayKey, period }, expected: computeStreak(periodKeys, todayKey, period) });
  keys('empty', [], '2026-10-11');
  keys('today only', ['2026-10-11'], '2026-10-11');
  keys('duplicates count once', ['2026-10-10', '2026-10-11', '2026-10-11'], '2026-10-11');
  keys('across a month end and a leap day', ['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01');
  keys('longest run earlier than the current one', ['2026-09-01', '2026-09-02', '2026-09-03', '2026-10-10', '2026-10-11'], '2026-10-11');
  keys('keys after today are ignored', ['2026-10-11', '2026-10-12'], '2026-10-11');
  keys('weekly: W53 to W01', ['2026-W52', '2026-W53', '2027-W01'], '2027-W01', 'week');
  return cases;
}

// ---------------------------------------------------------------- rank points

function rankPointsCases(): Case[] {
  const cases: Case[] = [];
  for (const [name, a] of [
    ['all zero', { bevsRanked: 0, currentStreak: 0, bevsCreated: 0 }],
    ['ranked only', { bevsRanked: 12, currentStreak: 0, bevsCreated: 0 }],
    ['streak weighs 3', { bevsRanked: 0, currentStreak: 1, bevsCreated: 0 }],
    ['adopted creations weigh 2', { bevsRanked: 0, currentStreak: 0, bevsCreated: 1 }],
    ['everything', { bevsRanked: 40, currentStreak: 4, bevsCreated: 2 }],
  ] as Array<[string, { bevsRanked: number; currentStreak: number; bevsCreated: number }]>) {
    cases.push({ name, fn: 'rankPoints', input: a, expected: rankPoints(a) });
  }
  const row = (userId: string, bevsRanked: number, currentStreak: number, bevsCreated: number, createdAt: string): RankUsersRow => ({ userId, bevsRanked, currentStreak, bevsCreated, createdAt });
  const boards: Array<[string, RankUsersRow[]]> = [
    ['ties share a rank and the next rank skips; tie order bevsRanked desc then createdAt asc', [
      row('carol', 10, 0, 0, '2026-10-01T00:00:00Z'),
      row('arjun', 4, 2, 0, '2026-10-03T00:00:00Z'),
      row('bob', 10, 0, 0, '2026-09-30T00:00:00Z'),
      row('matt', 20, 5, 1, '2026-10-05T00:00:00Z'),
      row('dana', 3, 0, 0, '2026-10-01T00:00:00Z'),
    ]],
    ['users with bevsRanked = 0 are Unranked: left out and not counted', [
      row('ghost', 0, 0, 5, '2026-09-01T00:00:00Z'),
      row('one', 1, 1, 0, '2026-10-01T00:00:00Z'),
      row('two', 2, 0, 0, '2026-10-01T00:00:00Z'),
    ]],
    ['equal points, bevsRanked and createdAt fall back to userId', [
      row('u-b', 5, 0, 0, '2026-10-01T00:00:00Z'),
      row('u-a', 5, 0, 0, '2026-10-01T00:00:00Z'),
    ]],
    ['empty', []],
  ];
  for (const [name, rows] of boards) cases.push({ name, fn: 'rankUsers', input: { rows }, expected: rankUsers(rows) });
  return cases;
}

// ---------------------------------------------------------------- edges (LaTeX §10.1)
// No PRNG here either. Hand-built inputs; the taxonomy is illustrative until D-04 settles the real one.

function edgeCases(): Case[] {
  const cases: Case[] = [];
  const taxonomy: Taxonomy = {
    soda: null,
    cola: 'soda',
    lemon_lime: 'soda',
    water: null,
    sparkling_water: 'water',
    still_water: 'water',
    coffee: null,
    hot_coffee: 'coffee',
    iced_coffee: 'coffee',
    mocha: 'iced_coffee',
  };
  const tree = (name: string, catA: string, catB: string, t: Taxonomy = taxonomy) =>
    cases.push({ name, fn: 'treeSimilarity', input: { catA, catB, taxonomy: t }, expected: treeSimilarity(catA, catB, t) });
  tree('same leaf', 'cola', 'cola');
  tree('same top-level category', 'soda', 'soda');
  tree('siblings under one parent', 'cola', 'lemon_lime');
  tree('leaf and its parent', 'cola', 'soda');
  tree('depth 3 and depth 2 under one root', 'mocha', 'hot_coffee');
  tree('depth 3 and its grandparent', 'mocha', 'coffee');
  tree('different top-level trees', 'cola', 'sparkling_water');
  tree('unknown category is top-level', 'kombucha', 'cola');
  tree('flat taxonomy, same category', 'soda', 'soda', {});
  tree('flat taxonomy, different categories', 'soda', 'water', {});

  const fp = (o: Partial<FlavorProfile>): FlavorProfile => ({ base: 'cola', carbonated: true, caffeine: 1, sweetness: 3, dairy: false, alcohol: false, ...o });
  const cola = fp({});
  const lime = fp({ base: 'citrus', caffeine: 0, sweetness: 0 });
  const latte = fp({ base: 'coffee', carbonated: false, caffeine: 2, sweetness: 1, dairy: true });
  const ipa = fp({ base: 'hop', caffeine: 0, sweetness: 0, alcohol: true });
  const prof = (name: string, a: FlavorProfile, b: FlavorProfile) =>
    cases.push({ name, fn: 'profileSimilarity', input: { a, b }, expected: profileSimilarity(a, b) });
  prof('Coca-Cola / Pepsi: identical profiles', cola, cola);
  prof('Coca-Cola / LaCroix Lime', cola, lime);
  prof('caffeine one level apart', cola, fp({ caffeine: 2 }));
  prof('sweetness three levels apart', cola, fp({ sweetness: 0 }));
  prof('only the base differs', cola, fp({ base: 'citrus' }));
  prof('latte / Coca-Cola', latte, cola);
  prof('IPA / latte', ipa, latte);
  prof('nothing in common', fp({ caffeine: 3, dairy: true, alcohol: true }), fp({ base: 'tea', carbonated: false, caffeine: 0, sweetness: 0 }));

  const emb = (name: string, a: number[], b: number[]) =>
    cases.push({ name, fn: 'embeddingSimilarity', input: { a, b }, expected: embeddingSimilarity(a, b) });
  const eCoke = [1, 0, 0];
  const ePepsi = [0.9, Math.sqrt(1 - 0.81), 0];
  const eLime = [0.6, 0, 0.8];
  emb('Coca-Cola / Pepsi: cosine 0.9', eCoke, ePepsi);
  emb('Coca-Cola / LaCroix Lime: cosine 0.6', eCoke, eLime);
  emb('identical', [0.6, 0.8], [0.6, 0.8]);
  emb('orthogonal', [1, 0], [0, 1]);
  emb('negative cosine is clamped to 0', [1, 0], [-0.6, 0.8]);
  emb('unnormalised: the norms cancel', [2, 0], [3, 3]);
  emb('zero vector', [0, 0], [1, 0]);

  const bev = (o: Partial<BevFeatures>): BevFeatures => ({ id: 'b', categoryId: 'cola', brandKey: null, flavorTokens: [], priceTier: 1, ratingCount: 0, mean: 0, stddev: 0, isAlcoholic: false, ...o });
  const coke = bev({ id: 'coca-cola', brandKey: 'Coca-Cola', flavorTokens: ['coca', 'cola'] });
  const pepsi = bev({ id: 'pepsi', brandKey: 'Pepsi', flavorTokens: ['pepsi'] });
  const lacroix = bev({ id: 'lacroix-lime', categoryId: 'sparkling_water', brandKey: 'LaCroix', flavorTokens: ['lacroix', 'lime'] });
  const content = (name: string, a: BevFeatures, b: BevFeatures) =>
    cases.push({ name, fn: 'contentSimilarity', input: { a, b }, expected: contentSimilarity(a, b) });
  content('Coca-Cola / Pepsi: same category and tier, no shared tokens', coke, pepsi);
  content('Coca-Cola / LaCroix Lime: tier only', coke, lacroix);

  const weight = (name: string, c: EdgeComponents) => cases.push({ name, fn: 'edgeWeight', input: c, expected: edgeWeight(c) });
  weight('Coca-Cola / Pepsi (§10.1 worked example, >= 0.8)', {
    tree: treeSimilarity('cola', 'cola', taxonomy),
    content: contentSimilarity(coke, pepsi),
    emb: embeddingSimilarity(eCoke, ePepsi),
    profile: profileSimilarity(cola, cola),
    cop: 0,
  });
  weight('Coca-Cola / LaCroix Lime (§10.1 worked example, < 0.4)', {
    tree: treeSimilarity('cola', 'sparkling_water', taxonomy),
    content: contentSimilarity(coke, lacroix),
    emb: embeddingSimilarity(eCoke, eLime),
    profile: profileSimilarity(cola, lime),
    cop: 0,
  });
  weight('all zero', { tree: 0, content: 0, emb: 0, profile: 0, cop: 0 });
  weight('all one', { tree: 1, content: 1, emb: 1, profile: 1, cop: 1 });
  weight('tree only', { tree: 1, content: 0, emb: 0, profile: 0, cop: 0 });
  weight('content only', { tree: 0, content: 1, emb: 0, profile: 0, cop: 0 });
  weight('embedding only', { tree: 0, content: 0, emb: 1, profile: 0, cop: 0 });
  weight('profile only', { tree: 0, content: 0, emb: 0, profile: 1, cop: 0 });
  weight('co-preference is off in v1', { tree: 0, content: 0, emb: 0, profile: 0, cop: 1 });
  weight('siblings, middling terms', { tree: 0.5, content: 0.4, emb: 0.7, profile: 0.85, cop: 0 });

  // k and min are written out even where the call uses the defaults (EDGE_TOP_K, EDGE_MIN_WEIGHT).
  const top = (name: string, candidates: EdgeCandidate[], k?: number, min?: number) =>
    cases.push({ name, fn: 'topEdges', input: { candidates, k: k ?? EDGE_TOP_K, min: min ?? EDGE_MIN_WEIGHT }, expected: topEdges(candidates, k, min) });
  top('min is inclusive; ties by bevId', [
    { bevId: 'c', w: 0.5 },
    { bevId: 'a', w: 0.9 },
    { bevId: 'low', w: 0.29 },
    { bevId: 'edge', w: 0.3 },
    { bevId: 'b', w: 0.5 },
  ]);
  const many = Array.from({ length: 25 }, (_, i) => ({ bevId: `b${String(i).padStart(2, '0')}`, w: 0.4 + i / 100 }));
  top('25 candidates, default k = 20', many);
  top('k = 3', many, 3);
  top('k = 50, min = 0.6', many, 50, 0.6);
  top('k = 0', many, 0);
  top('empty', []);
  return cases;
}

// ---------------------------------------------------------------- write / check

const files: Record<string, Case[]> = {
  'score-from-position.vectors.json': scoreCases(),
  'bev-stats.vectors.json': bevStatsCases(),
  'user-stats.vectors.json': userStatsCases(),
  'bayesian.vectors.json': bayesianCases(),
  'placement.vectors.json': placementCases(),
  'streak.vectors.json': streakCases(),
  'rank-points.vectors.json': rankPointsCases(),
  'edges.vectors.json': edgeCases(),
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
