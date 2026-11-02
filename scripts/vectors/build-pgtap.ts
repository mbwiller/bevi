/**
 * Generates the golden vectors in shared/fixtures as pgTAP, run against their SQL twins (A-14
 * follow-up 3.7, seam 4 in DEVELOPMENT-ARJUN.md). Two files, because the cases split cleanly in
 * two:
 *
 *   supabase/tests/20_vectors.test.sql          pure function calls, no fixture rows
 *   supabase/tests/25_vectors_fixtures.test.sql cases that need users, rankings or a board
 *
 *   npm run vectors:pgtap               # rewrite both files
 *   npm run vectors:pgtap -- --check    # exit 1 if either committed file is out of date (CI)
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
const OUT_FIXTURES = join(ROOT, "supabase", "tests", "25_vectors_fixtures.test.sql");

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
  categoryPrior: "category and global rankings; bayes_prior(category) is pinned by 09 (30 soda rankings, water below) and 19 (juice at 29, then 30)",
  leaderboardOrder: "a board of Bevs; get_bev_leaderboard's order is pinned by 09 (ties, collate \"C\", id) and 19 (n desc, the unrounded figure)",
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

// ---------------------------------------------------------------------------
// The two kinds that need fixture rows. They go to 25_vectors_fixtures.test.sql.
// ---------------------------------------------------------------------------

/** A uuid in the …0000000024xxx band this file owns (checked against every other test file). */
const uuid = (tail: string): string => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** The one user whose bucket gets respaced, and the 13 catalog Bevs it is filled from. */
const RESPACE_UID = uuid("2400");

/**
 * respaceBucket -> respace_bucket(uid, bucket) over a real bucket.
 *
 * ranking_score is already pinned exhaustively by storedScore in the pure file, so what these
 * cases add is the bucket-wide application: that `n` is the bucket's own count, that position i
 * gets the score for (bucket, i, n), and that an empty bucket is a no-op rather than an error.
 * Each case rebuilds the bucket from scratch with a deliberately wrong score (0), calls
 * respace_bucket, and compares the whole bucket's scores in position order.
 */
function respaceBucket(file: VectorFile): Section {
  const bucketDb = obj(file.constants.bucketDb, "score-from-position constants.bucketDb");
  const lines: string[] = [];
  let count = 0;
  for (const c of file.cases.filter((x) => x.fn === "respaceBucket")) {
    const bucket = String(c.input.bucket);
    const db = int(bucketDb[bucket], `bucketDb.${bucket}`);
    const ids = c.input.orderedBevIds;
    if (!Array.isArray(ids)) fail(`${c.name} orderedBevIds is not an array`);
    const expected = c.expected;
    if (!Array.isArray(expected)) fail(`${c.name} expected is not an array`);
    if (expected.length !== ids.length) fail(`${c.name}: ${ids.length} ids but ${expected.length} expected rows`);
    if (ids.length > 13) fail(`${c.name}: ${ids.length} Bevs, but the fixture only holds 13`);

    // The emitted comparison is by position, so the expected rows must be in position order and
    // name the input's Bevs in that same order. Checked rather than assumed.
    const scores = expected.map((e, i) => {
      const row = obj(e, `${c.name} expected[${i}]`);
      if (int(row.position, `${c.name} expected[${i}].position`) !== i) fail(`${c.name}: expected[${i}].position is not ${i}`);
      if (row.bevId !== ids[i]) fail(`${c.name}: expected[${i}].bevId is not orderedBevIds[${i}]`);
      return num(row.score, `${c.name} expected[${i}].score`);
    });

    lines.push("", `-- ${c.name}`, `delete from public.rankings where user_id = ${q(RESPACE_UID)};`);
    if (ids.length > 0) {
      lines.push(
        "insert into public.rankings (user_id, bev_id, bucket, position, score)",
        `select ${q(RESPACE_UID)}, b.id, ${db}::smallint, b.idx, 0`,
        `  from t_respace_bevs b where b.idx < ${ids.length};`,
      );
    }
    lines.push(`select public.respace_bucket(${q(RESPACE_UID)}, ${db}::smallint);`);
    if (ids.length === 0) {
      lines.push(
        `select is((select count(*)::int from public.rankings where user_id = ${q(RESPACE_UID)}), 0,`,
        `          ${q(`respaceBucket: ${c.name}: an empty bucket stays empty and the call does not raise`)});`,
      );
    } else {
      lines.push(
        "select is(",
        "  (select array_agg(r.score order by r.position) from public.rankings r",
        `    where r.user_id = ${q(RESPACE_UID)} and r.bucket = ${db}::smallint),`,
        `  array[${scores.map(lit).join(", ")}]::numeric[],`,
        `  ${q(`respaceBucket: ${c.name}`)});`,
      );
    }
    count += 1;
  }
  return { title: "score-from-position.vectors.json: respaceBucket -> respace_bucket(uid, bucket) over a real bucket", lines, count };
}

interface RankUser {
  userId: string;
  bevsRanked: number;
  currentStreak: number;
  bevsCreated: number;
  createdAt: string;
  uuid: string;
}

/**
 * rankUsers -> get_user_leaderboard(50).
 *
 * The SQL twin is the leaderboard RPC, not user_rank_points: the ordering these cases encode
 * (points desc, then bevsRanked desc, then createdAt asc, then userId) lives in
 * get_user_leaderboard's ORDER BY, while user_rank_points returns an unordered set and only the
 * `rank()` window. So each case is asserted three ways -- the order, the points and the rank.
 *
 * The fixture maps each case's userIds to uuids IN SORTED userId ORDER, so `p.id asc` -- the last
 * tie-break in SQL -- is the same comparison as rankUsers' `userId` fall-back. Each user's inputs
 * come from the three tables user_rank_points reads: user_stats.rating_count for bevsRanked,
 * streaks for the streak (with last_ranked_on set to today, so effective_streak keeps it), and
 * profiles.created_at. bevsCreated is the awkward one -- it is a count of Bevs the user created
 * that someone else has ranked -- so it is built out of real rows rather than written down.
 *
 * A case ends by zeroing its own users' rating_count, which drops them from the board (the RPC
 * filters `bevs_ranked > 0`), so the next case sees only its own users and the empty case sees
 * none.
 */
function rankUsers(file: VectorFile): Section {
  const lines: string[] = [];
  let count = 0;
  let ci = 0;
  for (const c of file.cases.filter((x) => x.fn === "rankUsers")) {
    ci += 1;
    const rows = obj(c.input, `${c.name} input`).rows;
    if (!Array.isArray(rows)) fail(`${c.name} input.rows is not an array`);
    const sorted = [...rows]
      .map((r, i) => {
        const row = obj(r, `${c.name} rows[${i}]`);
        if (typeof row.userId !== "string") fail(`${c.name} rows[${i}].userId is not a string`);
        if (typeof row.createdAt !== "string") fail(`${c.name} rows[${i}].createdAt is not a string`);
        return {
          userId: row.userId,
          bevsRanked: int(row.bevsRanked, `${c.name} ${row.userId} bevsRanked`),
          currentStreak: int(row.currentStreak, `${c.name} ${row.userId} currentStreak`),
          bevsCreated: int(row.bevsCreated, `${c.name} ${row.userId} bevsCreated`),
          createdAt: row.createdAt,
          uuid: "",
        } satisfies RankUser;
      })
      .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    sorted.forEach((u, i) => {
      u.uuid = uuid(`24${ci}${pad2(i)}`);
    });
    const byId = new Map(sorted.map((u) => [u.userId, u]));

    const expected = c.expected;
    if (!Array.isArray(expected)) fail(`${c.name} expected is not an array`);
    const want = expected.map((e, i) => {
      const row = obj(e, `${c.name} expected[${i}]`);
      const u = byId.get(String(row.userId));
      if (!u) fail(`${c.name}: expected[${i}] names "${String(row.userId)}", which is not in rows`);
      return { uuid: u.uuid, points: int(row.points, `${c.name} expected[${i}].points`), rank: int(row.rank, `${c.name} expected[${i}].rank`) };
    });

    lines.push("", `-- ${c.name}`);
    if (sorted.length > 0) {
      lines.push("insert into auth.users (id, email, raw_user_meta_data, aud, role) values");
      lines.push(
        sorted
          .map(
            (u, i) =>
              `  (${q(u.uuid)}, 'pgtapru${ci}${pad2(i)}@users.bevi.app', '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated')`,
          )
          .join(",\n") + ";",
      );
      // handle_new_user has already inserted a user_stats and a streaks row for each, so these
      // are updates. profiles.created_at is not one of the columns protect_profile_columns pins.
      for (const u of sorted) {
        lines.push(
          `update public.user_stats set rating_count = ${u.bevsRanked} where user_id = ${q(u.uuid)};`,
          `update public.streaks set current_days = ${u.currentStreak},`,
          `       last_ranked_on = (now() at time zone 'UTC')::date where user_id = ${q(u.uuid)};`,
          `update public.profiles set timezone = 'UTC', created_at = ${q(u.createdAt)}::timestamptz where id = ${q(u.uuid)};`,
        );
      }
      // bevsCreated: a Bev the user created, that a DIFFERENT user in the same case has ranked.
      // `source = 'seed'` keeps the embed trigger (which fires on `source = 'user'`) quiet.
      let bev = 0;
      for (const u of sorted.filter((x) => x.bevsCreated > 0)) {
        const ranker = sorted.find((x) => x.uuid !== u.uuid);
        if (!ranker) fail(`${c.name}: ${u.userId} has bevsCreated > 0 but there is no other user to rank them`);
        for (let k = 0; k < u.bevsCreated; k += 1) {
          const bevId = uuid(`24b${ci}${pad2(bev)}`);
          lines.push(
            "insert into public.bevs (id, name, brand, category_id, price_tier, status, source, created_by)",
            `values (${q(bevId)}, 'pgTAP Rank ${ci}-${pad2(bev)}', 'pgTAP', 'soda', 1, 'active', 'seed', ${q(u.uuid)});`,
            "insert into public.rankings (user_id, bev_id, bucket, position, score)",
            `values (${q(ranker.uuid)}, ${q(bevId)}, 3::smallint, ${bev}, 0);`,
          );
          bev += 1;
        }
      }
    }

    const board = "(select user_id, points, bevi_rank, row_number() over () as rn from public.get_user_leaderboard(50)) l";
    if (want.length === 0) {
      lines.push(
        `select is((select count(*)::int from public.get_user_leaderboard(50)), 0,`,
        `          ${q(`rankUsers: ${c.name}: the board is empty`)});`,
      );
      count += 1;
    } else {
      lines.push(
        `select is((select array_agg(l.user_id order by l.rn) from ${board}),`,
        `          array[${want.map((w) => q(w.uuid)).join(", ")}]::uuid[],`,
        `          ${q(`rankUsers: ${c.name}: order`)});`,
        `select is((select array_agg(l.points order by l.rn) from ${board}),`,
        `          array[${want.map((w) => w.points).join(", ")}]::integer[],`,
        `          ${q(`rankUsers: ${c.name}: points`)});`,
        `select is((select array_agg(l.bevi_rank order by l.rn) from ${board}),`,
        `          array[${want.map((w) => w.rank).join(", ")}]::integer[],`,
        `          ${q(`rankUsers: ${c.name}: rank`)});`,
      );
      count += 3;
    }
    if (sorted.length > 0) {
      lines.push(
        `update public.user_stats set rating_count = 0`,
        ` where user_id = any(array[${sorted.map((u) => q(u.uuid)).join(", ")}]::uuid[]);`,
      );
    }
  }
  return { title: "rank-points.vectors.json: rankUsers -> get_user_leaderboard(50) (order, points and rank)", lines, count };
}

const EMITTED = new Set(["storedScore", "populationStats", "bayesianAverage", "bayesScoreStored", "rankPoints", "respaceBucket", "rankUsers"]);

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

export function buildFixtureVectorsSql(): string {
  const sfp = load("score-from-position.vectors.json");
  const points = load("rank-points.vectors.json");
  const sections = [respaceBucket(sfp), rankUsers(points)];
  const total = sections.reduce((a, s) => a + s.count, 0);
  if (total === 0) fail("no fixture assertions emitted");

  const header = [
    "-- GENERATED by scripts/vectors/build-pgtap.ts from shared/fixtures/*.vectors.json. Do not edit by hand:",
    "--   npm run vectors:pgtap               # regenerate after a fixture change, then commit",
    "--   npm run vectors:pgtap -- --check    # what CI runs (backend.yml, db job)",
    "--",
    "-- A-14 follow-up 3.7, second half: the vectors whose SQL twin needs rows rather than just a",
    "-- function call. 20_vectors.test.sql deliberately has no fixtures, so these live here.",
    "--",
    ...sections.map((s) => `--   ${s.title} (${s.count})`),
    "--",
    "-- Fixture uuid band: ...000000024xxx. The respace user is ...000000002400, a rankUsers user is",
    "-- ...00000024<case><index> and a Bev it created is ...0000024b<case><index>. Checked against",
    "-- every other file in supabase/tests/ (a1, b1..b2, c1..c3, d1..d6, e1..e3, f1..f4, ffff,",
    "-- ff01..ff14, dead, a14NN, a16NN, ab0NN, be0NN, c13NN, ca0NN, d11aNNN, d12NN, ed0NN, ed7aNNN,",
    "-- 23NN) and against seed.sql, which creates no users at all -- which is also why the board",
    "-- assertions below can expect an exact set of rows.",
    "--",
    "-- `row_number() over ()` with no ORDER BY numbers get_user_leaderboard's rows in the order the",
    "-- function emitted them. That is the point: the RPC's own ORDER BY is what these cases pin, so",
    "-- re-sorting here would test the test. It is the same order the app consumes.",
    "begin;",
    `select plan(${total});`,
    "",
    "-- The respace user, and the first 13 active seeded soda Bevs in a stable order to fill its",
    "-- bucket from (the largest respace case is n=13).",
    "insert into auth.users (id, email, raw_user_meta_data, aud, role)",
    `values (${q(RESPACE_UID)}, 'pgtaprespace@users.bevi.app',`,
    "        '{\"invite_code\": \"local-test-invite-code\"}', 'authenticated', 'authenticated');",
    "",
    "create temporary table t_respace_bevs (idx integer primary key, id uuid not null) on commit drop;",
    "insert into t_respace_bevs (idx, id)",
    "select rn - 1, id",
    "  from (select b.id, row_number() over (order by b.name collate \"C\", b.id) as rn",
    "          from public.bevs b",
    "         where b.category_id = 'soda' and b.source = 'seed' and b.status = 'active') s",
    " where rn <= 13;",
  ];

  const body = sections.flatMap((s) => ["", `-- ${s.title}`, ...s.lines]);
  return [...header, ...body, "", "select * from finish();", "rollback;", ""].join("\n");
}

function main(argv: string[]): void {
  const outputs: Array<[string, string]> = [
    [OUT, buildVectorsSql()],
    [OUT_FIXTURES, buildFixtureVectorsSql()],
  ];
  if (argv.includes("--check")) {
    for (const [path, sql] of outputs) {
      let current = "";
      try {
        current = readFileSync(path, "utf8");
      } catch {
        console.error(`vectors:pgtap --check: ${path} does not exist. Run: npm run vectors:pgtap`);
        process.exit(1);
      }
      if (current !== sql) {
        console.error(
          `vectors:pgtap --check: ${path} doesn't match shared/fixtures. Regenerate and commit it:\n` + "  npm run vectors:pgtap",
        );
        process.exit(1);
      }
    }
    console.log(`vectors:pgtap --check: ${outputs.map(([p]) => p).join(" and ")} are up to date`);
    return;
  }
  for (const [path, sql] of outputs) {
    writeFileSync(path, sql);
    console.log(`wrote ${path}`);
  }
}

main(process.argv.slice(2));
