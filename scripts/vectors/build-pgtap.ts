/**
 * Generates supabase/tests/20_vectors.test.sql: the golden vectors in shared/fixtures run against
 * their SQL twins (A-14 follow-up 3.7, seam 4 in DEVELOPMENT-ARJUN.md).
 *
 *   npm run vectors:pgtap               # rewrite the test file
 *   npm run vectors:pgtap -- --check    # exit 1 if the committed file is out of date (CI)
 *
 * The output is a pure function of the four fixture files: cases in file order, no timestamp and
 * no RANKING_VERSION, so a version bump that changes no case needs no regeneration, and a fixture
 * change that does change a case fails `--check` in CI until this is re-run and the result
 * committed. Every `fn` in the four files must be either emitted or listed in SKIPPED below; an
 * unknown one is an error, so a new kind of case cannot be dropped silently.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const FIXTURES = join(ROOT, "shared", "fixtures");
const OUT = join(ROOT, "supabase", "tests", "20_vectors.test.sql");

interface VectorCase {
  name: string;
  fn: string;
  input: Record<string, unknown>;
  expected: unknown;
}

interface VectorFile {
  constants: Record<string, unknown>;
  cases: VectorCase[];
}

/** Cases that need fixtures (users, rankings, a board) rather than one function call. */
const SKIPPED: Readonly<Record<string, string>> = {
  respaceBucket: "a user's whole bucket; respace_bucket runs inside every submit_ranking and remove_ranking, but no pgTAP file pins these cases yet",
  categoryPrior: "category and global rankings; bayes_prior(category) is pinned by 09 (30 soda rankings, water below) and 19 (juice at 29, then 30)",
  leaderboardOrder: "a board of Bevs; get_bev_leaderboard's order is pinned by 09 (ties, collate \"C\", id) and 19 (n desc, the unrounded figure)",
  rankUsers: "profiles, user_stats and streaks; user_rank_points()'s ranking is not pinned against these cases yet (rank_points' sum is, below)",
};

function load(file: string): VectorFile {
  return JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as VectorFile;
}

function fail(message: string): never {
  throw new Error(`vectors:pgtap: ${message}`);
}

/** A single-quoted SQL string literal. */
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;

function num(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${what} is not a finite number: ${JSON.stringify(value)}`);
  return value;
}

function int(value: unknown, what: string): number {
  const n = num(value, what);
  if (!Number.isInteger(n)) fail(`${what} is not an integer: ${n}`);
  return n;
}

/** A numeric literal; negatives are parenthesised so `x - -1` never appears. */
function lit(n: number): string {
  const s = String(n);
  return n < 0 ? `(${s})` : s;
}

/** Integer cents as an exact 2-dp literal: 593 -> 5.93. */
function cents(value: unknown, what: string): string {
  const c = int(value, what);
  if (c < 0) fail(`${what} is negative: ${c}`);
  return `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** Drops a double's representation noise (89.38999999999999 -> 89.39); moves the value by at most 5e-11. */
const clean = (n: number): number => Number(n.toFixed(10));

const obj = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${what} is not an object`);
  return value as Record<string, unknown>;
};

interface Section {
  title: string;
  lines: string[];
  count: number;
}

function storedScore(file: VectorFile): Section {
  const bucketDb = obj(file.constants.bucketDb, "score-from-position constants.bucketDb");
  const lines: string[] = [];
  for (const c of file.cases.filter((x) => x.fn === "storedScore")) {
    const bucket = String(c.input.bucket);
    const db = int(bucketDb[bucket], `bucketDb.${bucket}`);
    const n = int(c.input.n, `${c.name} n`);
    const index = int(c.input.index, `${c.name} index`);
    const expected = cents(obj(c.expected, `${c.name} expected`).storedCents, `${c.name} storedCents`);
    lines.push(`select is(public.ranking_score(${db}::smallint, ${index}, ${n}), ${expected}::numeric, ${q(`storedScore: ${c.name}`)});`);
  }
  return { title: "score-from-position.vectors.json: storedScore -> ranking_score(bucket_db, index, n), exact", lines, count: lines.length };
}

function populationStats(file: VectorFile, skippedEmpty: string[]): Section {
  const lines: string[] = [];
  for (const c of file.cases.filter((x) => x.fn === "populationStats")) {
    const scores = c.input.scores;
    if (!Array.isArray(scores)) fail(`${c.name} scores is not an array`);
    if (scores.length === 0) {
      skippedEmpty.push(c.name);
      continue;
    }
    const arr = `unnest(array[${scores.map((s, i) => lit(num(s, `${c.name} scores[${i}]`))).join(", ")}]::numeric[]) as v(x)`;
    const e = obj(c.expected, `${c.name} expected`);
    const n = int(e.n, `${c.name} n`);
    const mean = num(e.mean, `${c.name} mean`);
    const sd = num(e.stddev, `${c.name} stddev`);
    lines.push(`select is((select count(*)::int from ${arr}), ${n}, ${q(`populationStats: ${c.name}: n`)});`);
    lines.push(`select ok((select abs(avg(x) - ${lit(mean)}) < 1e-9 from ${arr}), ${q(`populationStats: ${c.name}: mean`)});`);
    lines.push(`select ok((select abs(stddev_pop(x) - ${lit(sd)}) < 1e-9 from ${arr}), ${q(`populationStats: ${c.name}: stddev_pop`)});`);
  }
  return { title: "bev-stats.vectors.json: populationStats -> count / avg / stddev_pop (refresh_bev_stats' aggregates), within 1e-9", lines, count: lines.length };
}

function bayesianAverage(file: VectorFile): Section {
  const lines: string[] = [];
  for (const c of file.cases.filter((x) => x.fn === "bayesianAverage")) {
    const mean = num(c.input.mean, `${c.name} mean`);
    const n = int(c.input.n, `${c.name} n`);
    const m = num(c.input.m, `${c.name} m`);
    const C = num(c.input.C, `${c.name} C`);
    const expected = num(c.expected, `${c.name} expected`);
    const sum = clean(mean * n);
    lines.push(
      `select ok(abs(public.bayes_score(${lit(sum)}, ${n}, ${lit(m)}, ${lit(C)}) - ${lit(expected)}) < 1e-9, ${q(`bayesianAverage: ${c.name}`)});`,
    );
  }
  return { title: "bayesian.vectors.json: bayesianAverage -> bayes_score(mean * n, n, m, C), within 1e-9", lines, count: lines.length };
}

function bayesScoreStored(file: VectorFile): Section {
  const lines: string[] = [];
  for (const c of file.cases.filter((x) => x.fn === "bayesScoreStored")) {
    const sum = num(c.input.sumScore, `${c.name} sumScore`);
    const n = int(c.input.n, `${c.name} n`);
    const m = num(c.input.m, `${c.name} m`);
    const C = num(c.input.C, `${c.name} C`);
    const stored = cents(obj(c.expected, `${c.name} expected`).storedCents, `${c.name} storedCents`);
    lines.push(
      `select is(public.bayes_score(${lit(sum)}, ${n}, ${lit(m)}, ${lit(C)})::numeric(4,2), ${stored}::numeric(4,2), ${q(`bayesScoreStored: ${c.name}`)});`,
    );
  }
  return {
    title: "bayesian.vectors.json: bayesScoreStored -> bayes_score(sumScore, n, m, C)::numeric(4,2), exact (the bev_stats.bayes_score expression)",
    lines,
    count: lines.length,
  };
}

function rankPoints(file: VectorFile): Section {
  const lines: string[] = [];
  for (const c of file.cases.filter((x) => x.fn === "rankPoints")) {
    const ranked = int(c.input.bevsRanked, `${c.name} bevsRanked`);
    const streak = int(c.input.currentStreak, `${c.name} currentStreak`);
    const created = int(c.input.bevsCreated, `${c.name} bevsCreated`);
    const expected = int(c.expected, `${c.name} expected`);
    lines.push(`select is(public.rank_points(${ranked}, ${streak}, ${created}), ${expected}, ${q(`rankPoints: ${c.name}`)});`);
  }
  return { title: "rank-points.vectors.json: rankPoints -> rank_points(bevsRanked, currentStreak, bevsCreated), exact", lines, count: lines.length };
}

const EMITTED = new Set(["storedScore", "populationStats", "bayesianAverage", "bayesScoreStored", "rankPoints"]);

export function buildVectorsSql(): string {
  const files: Array<[string, VectorFile]> = [
    ["score-from-position.vectors.json", load("score-from-position.vectors.json")],
    ["bev-stats.vectors.json", load("bev-stats.vectors.json")],
    ["bayesian.vectors.json", load("bayesian.vectors.json")],
    ["rank-points.vectors.json", load("rank-points.vectors.json")],
  ];

  const skipped = new Map<string, number>();
  for (const [name, file] of files) {
    if (!Array.isArray(file.cases)) fail(`${name} has no cases array`);
    for (const c of file.cases) {
      if (EMITTED.has(c.fn)) continue;
      if (!(c.fn in SKIPPED)) fail(`${name}: case "${c.name}" has fn "${c.fn}", which is neither emitted nor in SKIPPED`);
      skipped.set(c.fn, (skipped.get(c.fn) ?? 0) + 1);
    }
  }

  const [sfp, stats, bayes, points] = files.map(([, f]) => f) as [VectorFile, VectorFile, VectorFile, VectorFile];
  const skippedEmpty: string[] = [];
  const sections = [storedScore(sfp), populationStats(stats, skippedEmpty), bayesianAverage(bayes), bayesScoreStored(bayes), rankPoints(points)];
  const total = sections.reduce((a, s) => a + s.count, 0);
  if (total === 0) fail("no assertions emitted");

  const skippedLines = [...skipped]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fn, count]) => `--   ${fn} (${count}): needs fixtures; ${SKIPPED[fn]}.`);
  const emptyLine = skippedEmpty.length
    ? `--   populationStats with no scores (${skippedEmpty.length}): ${skippedEmpty.join(", ")}.`
    : "--   populationStats with no scores: none in the file today.";

  const header = [
    "-- GENERATED by scripts/vectors/build-pgtap.ts from shared/fixtures/*.vectors.json. Do not edit by hand:",
    "--   npm run vectors:pgtap               # regenerate after a fixture change, then commit",
    "--   npm run vectors:pgtap -- --check    # what CI runs (backend.yml, db job)",
    "--",
    "-- A-14 follow-up 3.7: the golden vectors against their SQL twins. Pure function calls, so no",
    "-- fixture rows and nothing to roll back but the plan.",
    "--",
    ...sections.map((s) => `--   ${s.title} (${s.count})`),
    "--",
    "-- bayesianAverage gives a mean and n, so the sum is mean * n as JS computes it, rounded to 10 dp to",
    "-- drop the double's noise (89.38999999999999 -> 89.39). That moves the figure by under 2e-11, well",
    "-- inside the 1e-9 tolerance.",
    "--",
    "-- Not emitted:",
    ...skippedLines,
    emptyLine,
    "--     avg and stddev_pop return NULL on no rows where populationStats returns 0 (stats.ts says",
    "--     callers check n), so the SQL twin has no defined output to compare.",
    "begin;",
    `select plan(${total});`,
  ];

  const body = sections.flatMap((s) => ["", `-- ${s.title}`, ...s.lines]);
  return [...header, ...body, "", "select * from finish();", "rollback;", ""].join("\n");
}

function main(argv: string[]): void {
  const sql = buildVectorsSql();
  if (argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(OUT, "utf8");
    } catch {
      console.error(`vectors:pgtap --check: ${OUT} does not exist. Run: npm run vectors:pgtap`);
      process.exit(1);
    }
    if (current !== sql) {
      console.error(
        `vectors:pgtap --check: ${OUT} doesn't match shared/fixtures. Regenerate and commit it:\n` + "  npm run vectors:pgtap",
      );
      process.exit(1);
    }
    console.log(`vectors:pgtap --check: ${OUT} is up to date`);
    return;
  }
  writeFileSync(OUT, sql);
  console.log(`wrote ${OUT}`);
}

main(process.argv.slice(2));
