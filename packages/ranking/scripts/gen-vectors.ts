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
  attributeSimilarity,
  bayesianAverage,
  blendUserSimilarity,
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
  effectiveBevSimilarity,
  effectiveUserSimilarity,
  isDone,
  layer1,
  layer2,
  leaderboardOrder,
  localDayKey,
  localPeriodKey,
  neighbourReliability,
  pearsonCorrelation,
  pearsonSimilarity,
  placementPhase,
  placementResult,
  placementTiers,
  populationStats,
  predictScore,
  profileSimilarity,
  randomInt,
  rankPoints,
  rankUsers,
  RANKING_CONSTANTS,
  RANKING_VERSION,
  respaceBucket,
  scoreFromPosition,
  sharedAttributeCount,
  significanceWeight,
  startPlacement,
  storedScore,
  storedScoreCents,
  tasteCatalog,
  tasteVector,
  topEdges,
  topUserNeighbours,
  treeSimilarity,
  undo,
  userSimilarity,
  userStats,
  zScore,
  zScoresFromRankings,
  type BevFeatures,
  type Bucket,
  type ComparisonAnswer,
  type EdgeCandidate,
  type EdgeComponents,
  type FlavorProfile,
  type LeaderboardInputRow,
  type PredictionSnapshot,
  type PlacementBevKind,
  type PlacementListBev,
  type PlacementState,
  type PlacementTier,
  type RankUsersRow,
  type ScoredRanking,
  type Stats,
  type StreakPeriod,
  type TasteBev,
  type TasteCatalog,
  type TasteVector,
  type Taxonomy,
  type UserNeighbour,
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
  nameOrder: 'Unicode code point, not UTF-16 code unit (SQL collate "C" on UTF-8), then bevId the same way',
  streakDayKey: 'calendar date of the ranking instant in the profile timezone: (created_at AT TIME ZONE timezone)::date; week = ISO week of that date (YYYY-Www)',
  rankOrder: 'points desc, bevsRanked desc, createdAt asc, userId asc; rank = 1 + count(points > mine); bevsRanked = 0 excluded',
  treeDepth: 'Wu-Palmer depth from an implicit root (depth 0) above the top-level categories; a top-level category (parent null or not in the taxonomy) has depth 1',
  profileRule: 'N / 300 with N = 3*(40*[base] + 15*[carbonated] + 10*[dairy] + 5*[alcohol]) + 15*(3 - |dCaffeine|) + 15*(3 - |dSweetness|)',
  embeddingRule: 'min(1, max(0, dot / sqrt(|a|^2 * |b|^2))); 0 when either vector is zero',
  edgeWeightRule: 'tree*0.25 + content*0.15 + emb*0.30 + profile*0.30 + cop*0, summed in that order, clamped to [0, 1]',
  edgeOrder: 'w desc, then bevId asc (code unit); keep w >= edgeMinWeight; at most edgeTopK',
  pearsonRule:
    'r over common(u, v) = R(u) & R(v) in bevId order: sum((x - mean x)(y - mean y)) / sqrt(sum((x - mean x)^2) * sum((y - mean y)^2)), clamped to [-1, 1]; 0 when |common| < cfMinCommon or either side is constant (all entries equal); sim = r * min(1, |common| / cfSignificance)',
  tasteAttributeKey: "'category:' + categoryId, 'brand:' + normaliseBrand(brand) when non-empty, 'flavor:' + trim(flavorBase) when non-empty; kept when it covers >= tasteMinAttrBevs catalog Bevs",
  tasteVectorRule: 't_u[a] = sum of z_{u,b} over b in R(u) carrying a / (n_{u,a} + tasteK); Bevs outside the catalog skipped',
  attributeSimilarityRule: 'cosine of the taste vectors as sparse vectors (missing = 0), clamped to [-1, 1]; 0 when either is all zeros',
  sharedAttrsRule:
    'count of attributes a of a tasteBridgeKinds kind with |t_u[a]| >= tasteSharedMin and |t_v[a]| >= tasteSharedMin that u and v reach through distinct Bevs: some b in R(u) and b2 in R(v) carry a with b != b2 (one co-rated Bev is not a bridge)',
  blendRule:
    'alpha = tasteAlpha if |common| >= cfMinCommon else 0; attributeSim = attributeSimilarity if |common| >= cfMinCommon or sharedAttrs >= tasteMinSharedAttrs else 0; sim = alpha * pearson.sim + (1 - alpha) * attributeSim, clamped to [-1, 1]; method = attr (alpha 0), pearson (alpha 1), else blend',
  neighbourOrder: 'sim desc, then userId asc (code point, SQL collate "C"); keep sim >= tasteSimFloor; at most tasteNeighbourK',
  reliabilityRule: 'min(1, n_v / neighbourReliabilityN); applied by Layer 2 per neighbour, not stored in user_neighbors.sim',
  bayesStoredRule:
    'bev_stats.bayes_score numeric(4,2) from exact inputs: m with at most 3 dp (global_stats.mean_score numeric(5,3), or the exact category mean), scores in cents; N = C*m_thousandths + 10*sum(score_cents), D = C + n; storedCents = round half away from zero of N / (10*D) = floor((2N + 10D) / (20D)); never round the floating-point bayes',
  streakEvents:
    'streakFromTimestamps.timestamps are ranking EVENTS (submit_ranking and rerank_bev), never deleted: a re-rank adds its own day and keeps the original one; a removal adds and deletes nothing. When a case lists input.events, timestamps = events.map(at)',
  layer1EdgesRule:
    "bevSimilarity 'edges': sim(b, b') = w of the snapshot.edges row for the unordered pair {b, b'} (either orientation), 0 when there is none; pairs with sim < simMin dropped as in 'content'; content = sum(sim * z) / (sum(sim) + 1); conf1 mass = n_{u,cat(b)} + sum(sim); affinity and g unchanged. A snapshot without an edges field (absent or null) uses contentSimilarity ('content'); an empty array means no edges",
  layer2StoredRule:
    "userSimilarity 'stored' (Stage 4), for the user u: N(u) = snapshot.userNeighbours[u] (u's user_neighbors rows, any order); sim'(u, v) = sim * min(1, n_v / neighbourReliabilityN) for v in N(u), with sim as stored and n_v = users[v].stats.n (derived from v's rankings when v is missing from users; 0 when v is unknown to the snapshot, so the row weighs 0); sim'(u, v) = 0 for every v not in N(u), whatever their co-ratings. Then Layer 2 exactly as in 'cosine' mode: the raters of b other than u with sim' > 0 (so a negative stored sim is dropped), sim' desc then userId asc, at most cfK; support = sum(sim'); z2 = sum(sim' * z_{v,b}) / support, 0 without neighbours. common is carried and read by no formula. Falls back to 'cosine' (the in-snapshot sim' of section 8.9) when the snapshot has no userNeighbours field (absent or null) or u has no rows (key missing or empty list). source = the similarity actually used. predictScore: lambda and confidence read this support",
  placementTiersRule:
    'tier of a bucket Bev l relative to the new Bev b (placementTier constants): sameLeaf (1) when categoryId (the root) is equal and both leafCategoryId are non-null and equal; sameRoot (2) when categoryId is equal otherwise (a null leaf on either side, i.e. kind unknown, never reaches tier 1); edge (3) when the roots differ and weights[l.id] (the bev_edges w of {b, l}) is >= edgeMinWeight; null otherwise (no weight, or a weight below the floor). Without weights only tiers 1 and 2 occur',
  anchoredPlacementRule:
    'startPlacement with tiers (one per orderedBevIds entry, filtered with the Bev itself): anchors A = the entries other than bevId whose tier equals the smallest non-null tier among the entries other than bevId (on a re-rank the Bev is still in the list and its tier against itself is ignored), in list order, at positions p_1 < ... < p_k of the filtered list; no anchors = the plain search. Phase 1 = binary search over anchor slots [aLo, aHi] = [0, k]: ask a_j with j = floor((aLo + aHi) / 2) (0-based), NEW_BETTER aHi = j, EXISTING_BETTER aLo = j + 1, TIE ends the placement at p_j + 1; after each answer the insertion range is lo = (aLo = 0 ? 0 : p_{aLo - 1} + 1), hi = (aHi = k ? n : p_{aHi}). Phase 2 = the plain search on [lo, hi] once aLo = aHi (none when lo = hi). insertIndex = lo; comparisons in the order asked; maxSteps = maxComparisons(k) + maxComparisons(widest gap between consecutive anchors, or before the first / after the last), constant. Undo restores lo, hi, aLo, aHi',
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
  // Paper Example 5.9: scores 7.6 and 2.0 with m = 6.6333… (= 19.9 / 3) give 5.9. No PRNG here.
  avg('paper Example 5.9: 7.6 and 2.0, m = 6.6333…', (7.6 + 2.0) / 2, 2, 19.9 / 3);
  // M-22: results exactly on a half cent, so the SQL numeric(4,2) store is pinned (bayesStoredRule).
  const stored = (name: string, scores: number[], m: number) => {
    const n = scores.length;
    const sum = scores.reduce((t, x) => t + x, 0);
    cases.push({
      name,
      fn: 'bayesScoreStored',
      input: { scores, n, sumScore: sum, m, C: BAYES_C },
      expected: { bayes: bayesianAverage(sum / n, n, { m, C: BAYES_C }), storedCents: storedBayesCents(scores, m, BAYES_C), stored: storedBayesCents(scores, m, BAYES_C) / 100 },
    });
  };
  stored('7.6 and 2.0, m = 6.675: exactly 5.925 (the double is 5.92499999…), stored 5.93', [7.6, 2.0], 6.675);
  stored('7.61 and 2.00, m = 6.705: exactly 5.945, stored 5.95 (live shows 5.9, stored shows 6.0)', [7.61, 2.0], 6.705);
  stored('7.6 and 2.0, m = 6.625: exactly 5.895, stored 5.90', [7.6, 2.0], 6.625);
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
  // 1.3.0: names compare by code point (collate "C" on UTF-8), not by UTF-16 code unit. JS `<` put
  // U+1F600 (a surrogate pair, 0xD83D 0xDE00) before U+FF23 and U+FFFD. No PRNG here.
  const unicode: LeaderboardInputRow[] = [
    { bevId: 'emoji', bayes: 7, n: 3, name: '\u{1F600} Soda' },
    { bevId: 'replacement', bayes: 7, n: 3, name: '\uFFFD Soda' },
    { bevId: 'fullwidth', bayes: 7, n: 3, name: '\uFF23\uFF4F\uFF4C\uFF41' },
    { bevId: 'private-use', bayes: 7, n: 3, name: '\uE000 Cola' },
    { bevId: 'ascii', bayes: 7, n: 3, name: 'Zevia' },
  ];
  cases.push({ name: 'names by code point: an astral name after U+E000-U+FFFF names', fn: 'leaderboardOrder', input: { rows: unicode }, expected: leaderboardOrder(unicode) });
  return cases;
}

/** bayesStoredRule: the numeric(4,2) value SQL stores, by exact integer arithmetic. */
function storedBayesCents(scores: readonly number[], m: number, C: number): number {
  const cents = scores.map((x) => Math.round(x * 100));
  scores.forEach((x, i) => {
    if (Math.abs(x * 100 - (cents[i] as number)) > 1e-9) throw new Error(`score ${x} is not in cents`);
  });
  const mThousandths = Math.round(m * 1000);
  if (Math.abs(m * 1000 - mThousandths) > 1e-9) throw new Error(`prior ${m} has more than 3 decimals`);
  const N = C * mThousandths + 10 * cents.reduce((t, x) => t + x, 0);
  const D = C + scores.length;
  if (N < 0) throw new Error('negative bayes');
  return Math.floor((2 * N + 10 * D) / (20 * D));
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
  // 1.5.0 (M-21): anchored placement (placementTiersRule, anchoredPlacementRule). Hand-built, no PRNG,
  // and appended after the oracle cases, so every earlier case in this file is unchanged.
  cases.push(...placementTierCases(), ...anchoredCases());
  return cases;
}

/** placementTiers over D-04 §3's pairs: a catalogue of six kinds of Bev. */
function placementTierCases(): Case[] {
  const cases: Case[] = [];
  const kind = (categoryId: string, leafCategoryId: string | null): PlacementBevKind => ({ categoryId, leafCategoryId });
  const coke = kind('soda', 'cola');
  const unknownSoda = kind('soda', null);
  const dietCoke = kind('diet_soda', 'diet_cola');
  const fiji = kind('water', null);
  const list: PlacementListBev[] = [
    { id: 'pepsi', ...kind('soda', 'cola') },
    { id: 'aw-root-beer', ...kind('soda', 'root_beer') },
    { id: 'mystery-soda', ...unknownSoda },
    { id: 'diet-coke', ...dietCoke },
    { id: 'diet-pepsi', ...kind('diet_soda', 'diet_cola') },
    { id: 'evian', ...fiji },
    { id: 'gatorade', ...kind('sports', null) },
    { id: 'cold-brew', ...kind('coffee', 'cold_brew') },
  ];
  const tiers = (name: string, newBev: PlacementBevKind, weights?: Map<string, number>) =>
    cases.push({
      name,
      fn: 'placementTiers',
      input: { newBev, list, ...(weights ? { weights: Object.fromEntries(weights) } : {}) },
      expected: placementTiers(newBev, list, weights),
    });
  tiers('Coke: Pepsi same leaf; A&W and the unknown soda same root; the rest none', coke);
  tiers('a soda of unknown kind: nothing is same leaf, every soda is same root (D-04 §3: T1 empty)', unknownSoda);
  tiers('Diet Coke: Diet Pepsi same leaf; Coke-like sodas are a different root', dietCoke);
  tiers('Fiji: Evian is same root (unsplit water); Gatorade is not', fiji);
  tiers('Coke with edges: Diet Coke 0.7 and Evian 0.3 become tier 3; 0.29 on cold brew does not; 0.9 on A&W stays tier 2', coke, new Map([
    ['diet-coke', 0.7],
    ['evian', 0.3],
    ['cold-brew', 0.29],
    ['aw-root-beer', 0.9],
  ]));
  tiers('Diet Coke with an edge to Pepsi only', dietCoke, new Map([['pepsi', 0.55]]));
  return cases;
}

/**
 * Anchored placement scripts: the questions asked (with their phase), the anchors, maxSteps and
 * the result. `fn: 'anchoredPlacement'`; `steps` may contain 'UNDO'.
 */
function anchoredCases(): Case[] {
  const cases: Case[] = [];
  const add = (name: string, bevId: string, bucket: Bucket, orderedBevIds: string[], tiers: PlacementTier[], steps: Step[]) => {
    let s = startPlacement({ bevId, bucket, orderedBevIds, tiers });
    const maxSteps = currentPrompt(s)?.maxSteps ?? 0;
    const questions: Array<{ comparedBevId: string; phase: string }> = [];
    for (const step of steps) {
      if (step === 'UNDO') s = undo(s);
      else {
        questions.push({ comparedBevId: currentPrompt(s)?.comparedBevId ?? '', phase: placementPhase(s) });
        s = answer(s, step);
      }
    }
    if (!isDone(s)) throw new Error(`anchored case "${name}" does not finish`);
    const anchors = s.anchored ? s.anchored.positions.map((p) => s.list[p]) : [];
    cases.push({ name, fn: 'anchoredPlacement', input: { bevId, bucket, orderedBevIds, tiers, steps }, expected: { anchors, maxSteps, questions, result: placementResult(s) } });
  };
  // The paper's figure: L = l0 … l7, anchors l1, l4, l6.
  const L = Array.from({ length: 8 }, (_, i) => `l${i}`);
  const fig: PlacementTier[] = [null, 1, null, null, 1, null, 1, null];
  add('figure: lands between a1 and a2, then in the gap l2 l3 (asks l4, l1, l3, l2)', 'new', 'LOVED', L, fig, ['NEW_BETTER', 'EXISTING_BETTER', 'NEW_BETTER', 'EXISTING_BETTER']);
  add('figure: best of all (asks l4, l1, l0)', 'new', 'LOVED', L, fig, ['NEW_BETTER', 'NEW_BETTER', 'NEW_BETTER']);
  add('figure: worst of all (asks l4, l6, l7)', 'new', 'LOVED', L, fig, ['EXISTING_BETTER', 'EXISTING_BETTER', 'EXISTING_BETTER']);
  add('figure: tie in Phase 1 ends at p_j + 1 = 5', 'new', 'FINE', L, fig, ['TIE']);
  add('figure: tie in Phase 2, directly below l3', 'new', 'FINE', L, fig, ['NEW_BETTER', 'EXISTING_BETTER', 'TIE']);
  add('figure: between a2 and a3, gap l5 alone', 'new', 'DISLIKED', L, fig, ['EXISTING_BETTER', 'NEW_BETTER', 'EXISTING_BETTER']);
  add('figure: undo across the phase boundary, then the other answer', 'new', 'LOVED', L, fig, ['NEW_BETTER', 'EXISTING_BETTER', 'NEW_BETTER', 'UNDO', 'UNDO', 'NEW_BETTER', 'EXISTING_BETTER']);
  add('figure: undo after a Phase 1 tie', 'new', 'LOVED', L, fig, ['TIE', 'UNDO', 'EXISTING_BETTER', 'EXISTING_BETTER', 'NEW_BETTER']);
  add('figure: undo after done, in Phase 2', 'new', 'LOVED', L, fig, ['NEW_BETTER', 'EXISTING_BETTER', 'NEW_BETTER', 'EXISTING_BETTER', 'UNDO', 'NEW_BETTER']);
  add('re-rank: l4 itself is in the list with a tier and is filtered out (anchors l1, l6)', 'l4', 'LOVED', L, fig, ['NEW_BETTER', 'EXISTING_BETTER', 'NEW_BETTER', 'EXISTING_BETTER']);
  add('the smallest tier present wins: tier 2 anchors when no tier 1 (l0, l3, l5)', 'new', 'LOVED', L, [2, 3, null, 2, null, 2, 3, null], ['EXISTING_BETTER', 'NEW_BETTER', 'NEW_BETTER']);
  add('tier 3 (edges) alone: anchors l2, l7', 'new', 'LOVED', L, [null, null, 3, null, null, null, null, 3], ['NEW_BETTER', 'EXISTING_BETTER', 'NEW_BETTER', 'NEW_BETTER', 'EXISTING_BETTER']);
  add('adjacent anchors, empty gap: no Phase 2 question', 'new', 'LOVED', ['a', 'b', 'c', 'd'], [null, 1, 1, null], ['NEW_BETTER', 'EXISTING_BETTER']);
  add('one anchor at the top of the list', 'new', 'LOVED', L, [1, null, null, null, null, null, null, null], ['EXISTING_BETTER', 'NEW_BETTER', 'EXISTING_BETTER', 'NEW_BETTER']);
  add('one anchor at the bottom of the list', 'new', 'LOVED', L, [null, null, null, null, null, null, null, 1], ['NEW_BETTER', 'EXISTING_BETTER', 'EXISTING_BETTER', 'NEW_BETTER']);
  add('no anchors (every tier null): the plain search, same questions and result as "best of five"', 'new', 'LOVED', ['coke', 'sprite', 'pepsi', 'fanta', 'dew'], [null, null, null, null, null], ['NEW_BETTER', 'NEW_BETTER', 'NEW_BETTER']);
  add('every Bev in one tier: the plain search, same questions and result as "worst of five"', 'new', 'LOVED', ['coke', 'sprite', 'pepsi', 'fanta', 'dew'], [2, 2, 2, 2, 2], ['EXISTING_BETTER', 'EXISTING_BETTER']);
  add('empty bucket with tiers', 'new', 'LOVED', [], [], []);
  // A consistent oracle on a 20-Bev list with 7 anchors, for every true slot that exercises both phases.
  const twenty = Array.from({ length: 20 }, (_, i) => `b${i}`);
  const spread: PlacementTier[] = twenty.map((_, i) => ([2, 5, 6, 9, 13, 14, 18].includes(i) ? 1 : i % 3 === 0 ? 2 : null));
  for (const t of [0, 3, 7, 12, 19, 20]) {
    let s = startPlacement({ bevId: 'new', bucket: 'LOVED', orderedBevIds: twenty, tiers: spread });
    const steps: Step[] = [];
    while (!isDone(s)) {
      const j = twenty.indexOf(currentPrompt(s)?.comparedBevId ?? '');
      const a: ComparisonAnswer = t <= j ? 'NEW_BETTER' : 'EXISTING_BETTER';
      steps.push(a);
      s = answer(s, a);
    }
    add(`oracle n=20, 7 anchors, t=${t}`, 'new', 'LOVED', twenty, spread, steps);
  }
  // Integrator review of 7e19458: on a re-rank the Bev's own tier (1 against itself) must not decide the anchors.
  add('re-rank: the Bev is the only tier-1 entry (itself); the anchors are the tier-2 Bevs latte1, latte2', 'mocha', 'LOVED', ['latte1', 'mocha', 'cola', 'latte2'], [2, 1, null, 2], ['NEW_BETTER', 'EXISTING_BETTER', 'EXISTING_BETTER']);
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
  // M-22 (paper impl:streak): timestamps are ranking EVENTS, so history survives re-ranks and removals.
  // The rows-based SQL (touch_streak over rankings.ranked_at) would see fewer days in both cases.
  type StreakEvent = { bevId: string; kind: 'submit' | 'rerank'; at: string };
  const events = (name: string, evs: StreakEvent[], timeZone: string, now: string) => {
    const timestamps = evs.map((e) => e.at);
    const keys = [...new Set(timestamps.map((t) => localPeriodKey(t, timeZone, 'day')))].sort();
    const todayKey = localPeriodKey(now, timeZone, 'day');
    cases.push({ name, fn: 'streakFromTimestamps', input: { timestamps, timeZone, now, period: 'day', events: evs }, expected: { periodKeys: keys, todayKey, ...computeStreak(keys, todayKey, 'day') } });
  };
  events('events: the 9th\'s only ranking is re-ranked on the 11th, and the 9th still counts (rows alone would give 2)', [
    { bevId: 'coke', kind: 'submit', at: '2026-10-09T12:00:00Z' },
    { bevId: 'pepsi', kind: 'submit', at: '2026-10-10T12:00:00Z' },
    { bevId: 'coke', kind: 'rerank', at: '2026-10-11T09:00:00Z' },
  ], 'UTC', '2026-10-11T20:00:00Z');
  events('events: the 10th\'s only ranking is removed on the 11th; the removal adds nothing and the 10th still counts (rows alone would give 1)', [
    { bevId: 'coke', kind: 'submit', at: '2026-10-09T12:00:00Z' },
    { bevId: 'sprite', kind: 'submit', at: '2026-10-10T12:00:00Z' },
    { bevId: 'pepsi', kind: 'submit', at: '2026-10-11T12:00:00Z' },
  ], 'UTC', '2026-10-11T20:00:00Z');
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

  // 1.4.0 (M-27 (a)): Layer 1's content term in bevSimilarity 'edges' mode, on a hand-built snapshot
  // (layer1EdgesRule). The consumer is S-21: the rows get_prediction_snapshot returns as `edges`.
  const snap = layer1Snapshot();
  const edges = [
    { a: 'coke', b: 'pepsi', w: 0.9001 },
    { a: 'topo', b: 'lacroix', w: 0.71 },
    { a: 'monster', b: 'redbull', w: 0.88 },
    { a: 'coke', b: 'sprite', w: 0.55 },
  ];
  const l1 = (name: string, userId: string, bevId: string, bevSimilarity: 'content' | 'edges', withEdges: boolean) => {
    const snapshot: PredictionSnapshot = withEdges ? { ...snap, edges } : snap;
    cases.push({
      name,
      fn: 'layer1',
      input: { snapshot, userId, bevId, bevSimilarity },
      expected: { source: effectiveBevSimilarity(snapshot, { bevSimilarity }), ...layer1(snapshot, userId, bevId, { bevSimilarity }) },
    });
  };
  l1('edges: pepsi–coke has an edge (w 0.9001); pepsi–sprite and pepsi–lacroix have none and weigh 0', 'u', 'pepsi', 'edges', true);
  l1('edges: the row topo–lacroix is stored the other way round; orientation does not matter', 'u', 'topo', 'edges', true);
  l1('edges: monster has no edge to any Bev u ranked (only to redbull), so content is 0', 'u', 'monster', 'edges', true);
  l1('edges requested, snapshot without the edges field: falls back to contentSimilarity', 'u', 'pepsi', 'edges', false);
  l1('content (the default) ignores a present edges field', 'u', 'pepsi', 'content', true);
  return cases;
}

/** A small snapshot for the layer1 cases: u ranks coke, sprite, lacroix; v ranks coke, pepsi, topo. */
function layer1Snapshot(): PredictionSnapshot {
  const bev = (id: string, categoryId: string, brandKey: string, flavorTokens: string[], priceTier: 1 | 2 | 3 | 4): BevFeatures => ({
    id, categoryId, brandKey, flavorTokens, priceTier, ratingCount: 0, mean: 0, stddev: 0, isAlcoholic: false,
  });
  const list = [
    bev('coke', 'soda', 'coca-cola', ['cola'], 1),
    bev('pepsi', 'soda', 'pepsi', ['cola'], 1),
    bev('sprite', 'soda', 'coca-cola', ['lemon', 'lime'], 1),
    bev('lacroix', 'sparkling_water', 'lacroix', ['lime'], 2),
    bev('topo', 'sparkling_water', 'topo chico', ['mineral'], 2),
    bev('monster', 'energy', 'monster', ['energy'], 2),
    bev('redbull', 'energy', 'red bull', ['energy'], 3),
  ];
  const rankings = [
    { userId: 'u', bevId: 'coke', score: 9 },
    { userId: 'u', bevId: 'sprite', score: 6.5 },
    { userId: 'u', bevId: 'lacroix', score: 3 },
    { userId: 'v', bevId: 'coke', score: 8 },
    { userId: 'v', bevId: 'pepsi', score: 7 },
    { userId: 'v', bevId: 'topo', score: 5 },
  ];
  const bevs: Record<string, BevFeatures> = {};
  for (const b of list) {
    const st = populationStats(rankings.filter((r) => r.bevId === b.id).map((r) => r.score));
    bevs[b.id] = { ...b, ratingCount: st.n, mean: st.mean, stddev: st.stddev };
  }
  const users: PredictionSnapshot['users'] = {};
  for (const u of ['u', 'v']) {
    const mine = rankings.filter((r) => r.userId === u);
    const categoryStats: Record<string, Stats> = {};
    for (const c of [...new Set(mine.map((r) => (bevs[r.bevId] as BevFeatures).categoryId))].sort()) {
      categoryStats[c] = populationStats(mine.filter((r) => (bevs[r.bevId] as BevFeatures).categoryId === c).map((r) => r.score));
    }
    users[u] = { id: u, stats: populationStats(mine.map((r) => r.score)), categoryStats, canSeeAlcohol: true };
  }
  const g = populationStats(rankings.map((r) => r.score));
  const byCategoryMean: Record<string, number> = {};
  for (const c of ['soda', 'sparkling_water']) byCategoryMean[c] = populationStats(rankings.filter((r) => (bevs[r.bevId] as BevFeatures).categoryId === c).map((r) => r.score)).mean;
  return { version: RANKING_VERSION, generatedAt: '2026-10-31T00:00:00Z', global: { mean: g.mean, stddev: g.stddev, byCategoryMean }, bevs, users, rankings };
}


// ---------------------------------------------------------------- taste neighbourhoods (graph.ts, M-28)
// No PRNG: hand-built inputs, so adding this file leaves every earlier file's cases unchanged.
// The six Bevs and three users are docs/graph_db_implementation.md §1's worked example.

function graphCases(): Case[] {
  const cases: Case[] = [];
  const corr = (name: string, a: number[], b: number[]) => cases.push({ name, fn: 'pearsonCorrelation', input: { a, b }, expected: pearsonCorrelation(a, b) });
  corr('perfect positive', [1, 2, 3], [2, 4, 6]);
  corr('perfect negative', [1, 2, 3], [3, 2, 1]);
  corr('sqrt(3)/2', [1, 0, -1], [0.5, 0.5, -1]);
  corr('re-centred: both above their means, opposite order (cosine says 0.6)', [0.5, 1.5], [1.5, 0.5]);
  corr('two entries are +-1', [0.2, 0.9], [-1, 3]);
  corr('zero variance on one side', [1, 1, 1], [2, 4, 6]);
  corr('one entry', [1], [2]);
  corr('empty', [], []);
  corr('general', [0.2, -1.1, 0.7, 1.4, -0.35], [0.5, -0.3, 0.1, 1.0, -0.8]);

  for (const n of [0, 1, 2, 3, 4, 5, 8]) cases.push({ name: `|common| = ${n}`, fn: 'significanceWeight', input: { common: n }, expected: significanceWeight(n) });

  const zs = (xs: number[], prefix = 'b') => Object.fromEntries(xs.map((x, i) => [`${prefix}${i}`, x]));
  const users = (name: string, zu: Record<string, number>, zv: Record<string, number>) =>
    cases.push({ name, fn: 'pearsonSimilarity', input: { zu, zv }, expected: pearsonSimilarity(zu, zv) });
  const five = [1.2, -0.4, 0.3, -1.1, 0.7];
  users('identical users, 5 common', zs(five), zs(five));
  users('opposite users, 5 common', zs(five), zs(five.map((x) => -x)));
  users('1 common Bev', { a: 1, b: 2 }, { a: 3, c: 1 });
  users('no common Bev', { a: 1 }, { b: 1 });
  users('zero variance on the common Bevs', { a: 0.4, b: 0.4, c: 0.4, x: -2 }, { a: -1, b: 0.5, c: 1 });
  const base = [0.9, -0.2, 0.4, -1.3, 1.1, 0.05, -0.6, 0.75];
  for (const n of [1, 3, 5, 8]) {
    const xs = base.slice(0, n);
    users(`shrinkage at ${n} common (v = 2u + 0.3)`, { ...zs(xs), onlyU: 2 }, { ...zs(xs.map((x) => 2 * x + 0.3)), onlyV: -2 });
  }
  users('3 common of 4 and 4: r = sqrt(3)/2, sim = 0.6 r', { b3: 1.0, b1: 1.5, b2: 0.5, b9: -3 }, { b1: 1.0, b2: 0.0, b3: 1.0, b6: -0.5 });
  users('re-centred: shared Bevs above both means, opposite order', { a: 0.539, b: 0.863, c: -1.402 }, { a: 0.863, b: 0.539, d: -1.402 });

  const docBevs: TasteBev[] = [
    { id: 'b1', categoryId: 'soda', brand: 'Coca-Cola', flavorBase: 'cola' },
    { id: 'b2', categoryId: 'soda', brand: 'Pepsi', flavorBase: 'cola' },
    { id: 'b3', categoryId: 'diet_soda', brand: 'Coca-Cola', flavorBase: 'cola' },
    { id: 'b4', categoryId: 'soda', brand: 'Dr Pepper', flavorBase: 'cola' },
    { id: 'b5', categoryId: 'sparkling_water', brand: 'LaCroix', flavorBase: 'lemon-lime' },
    { id: 'b6', categoryId: 'energy', brand: 'Red Bull', flavorBase: 'herbal' },
  ];
  const withB7: TasteBev[] = [...docBevs, { id: 'b7', categoryId: 'sparkling_water', brand: 'LaCroix', flavorBase: 'citrus' }];
  const sorted = <V>(m: ReadonlyMap<string, V>) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const catalogs: Array<[string, TasteBev[]]> = [
    ['doc example, 6 Bevs', docBevs],
    ['doc example plus a second LaCroix', withB7],
    ['category and flavour base with the same name; blank brand and base', [
      { id: 'x', categoryId: 'coffee', brand: '  Blue  Bottle ', flavorBase: 'coffee' },
      { id: 'y', categoryId: 'coffee', brand: 'blue bottle', flavorBase: 'coffee' },
      { id: 'z', categoryId: 'coffee', brand: ' ', flavorBase: '' },
    ]],
  ];
  const built = new Map<string, TasteCatalog>();
  for (const [name, bevs] of catalogs) {
    const c = tasteCatalog(bevs);
    built.set(name, c);
    cases.push({ name, fn: 'tasteCatalog', input: { bevs }, expected: { attributes: sorted(c.attributes), coverage: sorted(c.coverage) } });
  }
  const docCatalog = built.get('doc example, 6 Bevs') as TasteCatalog;
  const b7Catalog = built.get('doc example plus a second LaCroix') as TasteCatalog;

  const U1 = { b1: 1.2, b4: 0.6, b5: -1.3 };
  const U2 = { b2: 1.1, b3: 0.8, b5: -0.9 };
  const U3 = { b4: 1.0, b6: 0.9 };
  const U4 = { b1: 1.5, b2: 0.5, b3: 1.0 };
  const U5 = { b1: 1.0, b2: 0.0, b3: 1.0, b6: -0.5 };
  const faint = { b1: 1.5, b2: -0.5, b3: 1.0, b4: -1.2, b6: 0.4 };
  const faintOpposite = Object.fromEntries(Object.entries(faint).map(([k, x]) => [k, -x]));
  const flat = { b1: 0.8, b2: 0.8, b3: 0.8 };
  const varied = { b1: 1.0, b2: 0.2, b3: 1.4 };
  const weakU = { b1: 1.0, b2: 0.2, b4: -0.5 };
  const weakV = { b1: 0.8, b2: 0.4, b4: -0.9 };
  const vectors: Array<[string, Record<string, number>, string, TasteBev[], TasteCatalog]> = [
    ['U1', U1, 'doc example, 6 Bevs', docBevs, docCatalog],
    ['U2', U2, 'doc example, 6 Bevs', docBevs, docCatalog],
    ['U3', U3, 'doc example, 6 Bevs', docBevs, docCatalog],
    ['U1 with a second LaCroix', U1, 'doc example plus a second LaCroix', withB7, b7Catalog],
    ['U2 with a second LaCroix', U2, 'doc example plus a second LaCroix', withB7, b7Catalog],
    ['a Bev outside the catalog is skipped', { ...U1, gone: 3 }, 'doc example, 6 Bevs', docBevs, docCatalog],
    ['no rankings', {}, 'doc example, 6 Bevs', docBevs, docCatalog],
  ];
  const tv = new Map<string, TasteVector>();
  for (const [name, z, , bevs, c] of vectors) {
    const t = tasteVector(z, c);
    tv.set(name, t);
    cases.push({ name, fn: 'tasteVector', input: { z, catalogBevs: bevs }, expected: t });
  }
  const t = (name: string) => tv.get(name) as TasteVector;

  const attr = (name: string, a: TasteVector, b: TasteVector) =>
    cases.push({ name, fn: 'attributeSimilarity', input: { a, b }, expected: attributeSimilarity(a, b) });
  attr('doc example U1-U2', t('U1'), t('U2'));
  attr('doc example U1-U3', t('U1'), t('U3'));
  attr('doc example U2-U3', t('U2'), t('U3'));
  attr('U1-U2 with a second LaCroix: the shared dislike enters the cosine', t('U1 with a second LaCroix'), t('U2 with a second LaCroix'));
  attr('identical', { 'flavor:cola': 0.4, 'brand:x': -0.2 }, { 'flavor:cola': 0.4, 'brand:x': -0.2 });
  attr('opposite', { 'flavor:cola': 0.4, 'brand:x': -0.2 }, { 'flavor:cola': -0.4, 'brand:x': 0.2 });
  attr('no attribute in common', { 'flavor:cola': 0.4 }, { 'brand:x': 0.9 });
  attr('a zero vector', { 'flavor:cola': 0 }, { 'flavor:cola': 0.9 });

  // sharedAttributeCount needs the ranked Bevs and the catalog: an attribute bridges only if the two
  // users reach it through different Bevs. k1/k2 share brand X, cola and soda; k3/k4 brand Y, citrus.
  const kBevs: TasteBev[] = [
    { id: 'k1', categoryId: 'soda', brand: 'X', flavorBase: 'cola' },
    { id: 'k2', categoryId: 'soda', brand: 'X', flavorBase: 'cola' },
    { id: 'k3', categoryId: 'soda', brand: 'Y', flavorBase: 'citrus' },
    { id: 'k4', categoryId: 'soda', brand: 'Y', flavorBase: 'citrus' },
  ];
  const kCatalog = tasteCatalog(kBevs);
  const shared = (name: string, zu: Record<string, number>, zv: Record<string, number>, bevs: TasteBev[], c: TasteCatalog) =>
    cases.push({ name, fn: 'sharedAttributeCount', input: { zu, zv, catalogBevs: bevs }, expected: sharedAttributeCount({ zu, zv, tu: tasteVector(zu, c), tv: tasteVector(zv, c) }, c) });
  shared('doc example U1-U2: coke and cola, each through different Bevs', U1, U2, docBevs, docCatalog);
  shared('doc example U1-U3: cola only', U1, U3, docBevs, docCatalog);
  shared('U1-U2 with a second LaCroix: lacroix is reached only through co-rated b5, so not a bridge', U1, U2, withB7, b7Catalog);
  shared('the same attributes through two different Bevs; categories never bridge', { k1: 0.9 }, { k2: 0.9 }, kBevs, kCatalog);
  shared('one co-rated Bev is not a bridge', { k1: 1.0 }, { k1: 0.8 }, kBevs, kCatalog);
  shared('a co-rated Bev plus another Bev with the attribute is', { k1: 1.0 }, { k1: 0.8, k2: 0.6 }, kBevs, kCatalog);
  shared('|t| = 0.2 exactly counts, and the signs may differ', { k1: 0.5, k2: 0.3 }, { k1: -0.9 }, kBevs, kCatalog);
  shared('|t| = 0.19 does not count', { k1: 0.57 }, { k2: 0.9 }, kBevs, kCatalog);
  shared('different attributes do not bridge', { k1: 0.9 }, { k3: 0.9 }, kBevs, kCatalog);

  const blend = (name: string, zu: Record<string, number>, zv: Record<string, number>, bevs: TasteBev[], c: TasteCatalog, alpha?: number) => {
    const pair = { zu, zv, tu: tasteVector(zu, c), tv: tasteVector(zv, c) };
    cases.push({ name, fn: 'blendUserSimilarity', input: { zu, zv, catalogBevs: bevs, ...(alpha === undefined ? {} : { alpha }) }, expected: blendUserSimilarity(pair, c, alpha === undefined ? {} : { alpha }) });
  };
  blend('attribute only: doc U1-U2 share one Bev, bridged by coke and cola', U1, U2, docBevs, docCatalog);
  blend('attribute only, gated out: doc U1-U3 share one bridging attribute', U1, U3, docBevs, docCatalog);
  blend('attribute only, no common Bev: doc U2-U3', U2, U3, docBevs, docCatalog);
  blend('blend: 3 common Bevs, r = sqrt(3)/2, two bridging attributes', U4, U5, docBevs, docCatalog);
  blend('blend: a co-rated pair with fewer than 2 bridging attributes is not gated', weakU, weakV, docBevs, docCatalog);
  blend('identical users with faint taste vectors', faint, faint, docBevs, docCatalog);
  blend('opposite users', faint, faintOpposite, docBevs, docCatalog);
  blend('zero variance on the common Bevs', flat, varied, docBevs, docCatalog);
  blend('alpha = 1: the Pearson arm', U4, U5, docBevs, docCatalog, 1);
  blend('alpha = 0: the attribute arm', U4, U5, docBevs, docCatalog, 0);
  blend('alpha = 1 below 2 common Bevs is still attribute only', U1, U2, docBevs, docCatalog, 1);
  // A single co-rated Bev carrying a kept brand and flavour is not a two-hop bridge (M-28 review).
  const xyBevs: TasteBev[] = [
    { id: 'x', categoryId: 'soda', brand: 'Coca-Cola', flavorBase: 'cola' },
    { id: 'y', categoryId: 'soda', brand: 'Coca-Cola', flavorBase: 'cola' },
    { id: 'p', categoryId: 'water', brand: 'LaCroix', flavorBase: 'lime' },
    { id: 'q', categoryId: 'water', brand: 'LaCroix', flavorBase: 'lime' },
  ];
  const xyCatalog = tasteCatalog(xyBevs);
  blend('attribute only, gated out: one co-rated Bev is not a bridge', { x: 1.0, p: -0.1 }, { x: 0.8, q: 0.05 }, xyBevs, xyCatalog);
  blend('attribute only: the same attributes through two different Bevs bridge', { x: 1.0 }, { y: 0.8 }, xyBevs, xyCatalog);

  // k and min are written out even where the call uses the defaults (TASTE_NEIGHBOUR_K, TASTE_SIM_FLOOR).
  const top = (name: string, candidates: Array<{ userId: string; sim: number }>, k?: number, min?: number) =>
    cases.push({ name, fn: 'topUserNeighbours', input: { candidates, k: k ?? RANKING_CONSTANTS.tasteNeighbourK, min: min ?? RANKING_CONSTANTS.tasteSimFloor }, expected: topUserNeighbours(candidates, k, min) });
  top('floor is inclusive; ties by userId; negatives dropped', [
    { userId: 'c', sim: 0.5 },
    { userId: 'a', sim: 0.9 },
    { userId: 'low', sim: 0.09 },
    { userId: 'edge', sim: 0.1 },
    { userId: 'b', sim: 0.5 },
    { userId: 'neg', sim: -0.8 },
  ]);
  const many = Array.from({ length: 30 }, (_, i) => ({ userId: `u${String(i).padStart(2, '0')}`, sim: 0.2 + i / 100 }));
  top('30 candidates, default k = 25', many);
  top('k = 3', many, 3);
  top('k = 0', many, 0);
  top('empty', []);

  for (const n of [0, 3, 10, 15, 80]) cases.push({ name: `n_v = ${n}`, fn: 'neighbourReliability', input: { n }, expected: neighbourReliability(n) });

  const rows = [
    { userId: 'u', bevId: 'a', score: 9 },
    { userId: 'u', bevId: 'b', score: 7 },
    { userId: 'u', bevId: 'c', score: 2 },
    { userId: 'v', bevId: 'a', score: 9 },
    { userId: 'v', bevId: 'b', score: 8 },
    { userId: 'v', bevId: 'd', score: 6 },
    { userId: 'w', bevId: 'a', score: 3 },
    { userId: 'w', bevId: 'd', score: 4 },
    { userId: 'x', bevId: 'a', score: 6.5 },
    { userId: 'x', bevId: 'b', score: 6.5 },
    { userId: 'x', bevId: 'c', score: 6.5 },
  ];
  const z = zScoresFromRankings(rows);
  cases.push({
    name: 'own stats at 3 rankings, global stats below, sigma floored',
    fn: 'zScoresFromRankings',
    input: { rankings: rows },
    expected: Object.fromEntries([...z].map(([u, m]) => [u, Object.fromEntries(m)])),
  });

  // 1.6.0 (Stage 4): Layer 2 in userSimilarity 'stored' mode (layer2StoredRule) on a hand-built
  // snapshot. The consumer is Arjun's Stage 4: the rows get_prediction_snapshot returns as
  // `userNeighbors`, mapped by packages/api onto `snapshot.userNeighbours`. Sims have 4 dp, as
  // user_neighbors.sim numeric(5,4) stores them.
  const s2 = layer2StoredSnapshot();
  const nb = (userId: string, sim: number, common: number): UserNeighbour => ({ userId, sim, common });
  const amyRow = nb('amy', 0.6213, 3);
  const amyList = [nb('u', 0.6213, 3), nb('dan', 0.5022, 3)];
  const stored = (name: string, userNeighbours: PredictionSnapshot['userNeighbours'] | undefined, userSimilarity: 'cosine' | 'stored', fn: 'layer2' | 'predictScore' = 'layer2') => {
    const snapshot: PredictionSnapshot = userNeighbours === undefined ? s2 : { ...s2, userNeighbours };
    const opts = { userSimilarity };
    const source = effectiveUserSimilarity(snapshot, 'u', opts);
    const result = fn === 'layer2' ? layer2(snapshot, 'u', 'pepsi', opts) : predictScore(snapshot, 'u', 'pepsi', opts);
    cases.push({ name, fn, input: { snapshot, userId: 'u', bevId: 'pepsi', userSimilarity }, expected: { source, ...result } });
    return result;
  };
  // Each case must exercise what its name says; the generator refuses to write one that doesn't.
  const assert = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`layer2 stored cases: ${what}`);
  };
  assert(userSimilarity(s2, 'u', 'dan') > 0, 'dan must be a cosine neighbour of u');
  assert(userSimilarity(s2, 'u', 'eve') === 0, 'eve must share fewer than 2 Bevs with u');
  assert(s2.users.eve === undefined && s2.users.amy?.stats.n === 18 && s2.users.ben?.stats.n === 3, 'n_v setup');
  const case1 = { u: [amyRow, nb('ben', 0.4507, 2)], amy: amyList };
  const c1 = stored('stored: amy (n_v = 18, reliability 1) and ben (n_v = 3, reliability 1/5) are listed and ranked pepsi', case1, 'stored') as { neighbours: string[] };
  assert(c1.neighbours.join() === 'amy,ben', 'case 1 neighbours');
  const c2 = stored('stored: cat is listed but did not rank pepsi; dan ranked it and is not listed, so he weighs 0 although the cosine weights him', { u: [nb('cat', 0.8, 3), amyRow], amy: amyList }, 'stored') as { neighbours: string[] };
  assert(c2.neighbours.join() === 'amy', 'case 2 neighbours');
  const c3 = stored('stored: eve shares one Bev with u (cosine 0) and counts through the attribute bridge; she is missing from users, so n_v = 4 comes from her rankings', { u: [nb('eve', 0.3511, 1)] }, 'stored') as { neighbours: string[] };
  assert(c3.neighbours.join() === 'eve', 'case 3 neighbours');
  const c4 = stored('stored: ghost is unknown to the snapshot (n_v = 0) and weighs 0', { u: [nb('ghost', 0.9, 4), amyRow] }, 'stored') as { neighbours: string[] };
  assert(c4.neighbours.join() === 'amy', 'case 4 neighbours');
  const cos = layer2(s2, 'u', 'pepsi');
  assert(cos.neighbours.includes('dan') && !cos.neighbours.includes('eve'), 'cosine neighbours');
  stored('stored requested, snapshot without the userNeighbours field: the in-snapshot cosine', undefined, 'stored');
  stored('stored requested, userNeighbours null: the in-snapshot cosine', null, 'stored');
  stored('stored requested, u has an empty list (nobody above the floor): the in-snapshot cosine', { u: [], amy: amyList }, 'stored');
  stored('stored requested, u has no key (not yet synced): the in-snapshot cosine', { amy: amyList }, 'stored');
  stored('cosine (the default) ignores a present userNeighbours field', case1, 'cosine');
  const c8 = stored('stored: a negative stored sim (ben) is excluded by sim\' > 0', { u: [nb('ben', -0.4, 2), amyRow] }, 'stored') as { neighbours: string[] };
  assert(c8.neighbours.join() === 'amy', 'case 8 neighbours');
  stored('predictScore, stored: case 1 (the support, hence lambda, comes from the stored neighbours)', case1, 'stored', 'predictScore');
  stored('predictScore, cosine: the same snapshot in the default mode', case1, 'cosine', 'predictScore');
  return cases;
}

/**
 * The snapshot of the layer2 stored cases. u ranks coke, sprite, lacroix, topo. amy (whose complete
 * stats say n = 18; the snapshot carries 4 of her rankings, as get_prediction_snapshot may), ben
 * (n = 3), dan and eve ranked pepsi; cat did not. dan shares 3 Bevs with u, eve only coke, and eve is
 * missing from `users` (her n comes from her rankings).
 */
function layer2StoredSnapshot(): PredictionSnapshot {
  const bev = (id: string, categoryId: string, brandKey: string, flavorTokens: string[], priceTier: 1 | 2 | 3 | 4): BevFeatures => ({
    id, categoryId, brandKey, flavorTokens, priceTier, ratingCount: 0, mean: 0, stddev: 0, isAlcoholic: false,
  });
  const list = [
    bev('coke', 'soda', 'coca-cola', ['cola'], 1),
    bev('pepsi', 'soda', 'pepsi', ['cola'], 1),
    bev('sprite', 'soda', 'coca-cola', ['lemon', 'lime'], 1),
    bev('lacroix', 'sparkling_water', 'lacroix', ['lime'], 2),
    bev('topo', 'sparkling_water', 'topo chico', ['mineral'], 2),
    bev('monster', 'energy', 'monster', ['energy'], 2),
    bev('redbull', 'energy', 'red bull', ['energy'], 3),
  ];
  const r = (userId: string, bevId: string, score: number) => ({ userId, bevId, score });
  const rankings = [
    r('u', 'coke', 9), r('u', 'sprite', 6.5), r('u', 'lacroix', 3), r('u', 'topo', 5),
    r('amy', 'coke', 8), r('amy', 'sprite', 7), r('amy', 'pepsi', 8.5), r('amy', 'lacroix', 2),
    r('ben', 'coke', 7), r('ben', 'pepsi', 4), r('ben', 'topo', 6),
    r('cat', 'coke', 9), r('cat', 'sprite', 5), r('cat', 'lacroix', 4),
    r('dan', 'coke', 9.5), r('dan', 'sprite', 6), r('dan', 'lacroix', 2.5), r('dan', 'pepsi', 3),
    r('eve', 'coke', 8), r('eve', 'pepsi', 9), r('eve', 'monster', 4), r('eve', 'redbull', 3),
  ];
  const bevs: Record<string, BevFeatures> = {};
  for (const b of list) {
    const st = populationStats(rankings.filter((x) => x.bevId === b.id).map((x) => x.score));
    bevs[b.id] = { ...b, ratingCount: st.n, mean: st.mean, stddev: st.stddev };
  }
  const users: PredictionSnapshot['users'] = {};
  for (const u of ['u', 'amy', 'ben', 'cat', 'dan']) {
    const mine = rankings.filter((x) => x.userId === u);
    const categoryStats: Record<string, Stats> = {};
    for (const c of [...new Set(mine.map((x) => (bevs[x.bevId] as BevFeatures).categoryId))].sort()) {
      categoryStats[c] = populationStats(mine.filter((x) => (bevs[x.bevId] as BevFeatures).categoryId === c).map((x) => x.score));
    }
    users[u] = { id: u, stats: populationStats(mine.map((x) => x.score)), categoryStats, canSeeAlcohol: true };
  }
  (users.amy as { stats: Stats }).stats = { n: 18, mean: 6.1, stddev: 2.2 };
  const g = populationStats(rankings.map((x) => x.score));
  const byCategoryMean: Record<string, number> = {};
  for (const c of ['energy', 'soda', 'sparkling_water']) byCategoryMean[c] = populationStats(rankings.filter((x) => (bevs[x.bevId] as BevFeatures).categoryId === c).map((x) => x.score)).mean;
  return { version: RANKING_VERSION, generatedAt: '2026-10-31T00:00:00Z', global: { mean: g.mean, stddev: g.stddev, byCategoryMean }, bevs, users, rankings };
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
  'graph.vectors.json': graphCases(),
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
