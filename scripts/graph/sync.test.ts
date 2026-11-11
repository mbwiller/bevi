/**
 * Tests of the sync's orchestration (scripts/graph/sync.ts) against a FAKE
 * Neo4j client: what is sent in which order, when the transaction commits,
 * when it rolls back, and what is retried. No network, no credentials.
 *
 *   node --experimental-strip-types --test scripts/graph/sync.test.ts
 *   npm run test:scripts
 *
 * The Cypher itself is exercised against the real server by
 * `npm run graph:sync -- --fixture`, which runs the same statements in a
 * transaction that is rolled back.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { RANKING_VERSION } from "@bevi/ranking";

import { computeGraphStats, flavourProjection, graphStatsDbRows, graphStatsWrites } from "./analytics-core.ts";
import type { BevGraphStatsDbRow, GraphStats } from "./analytics-core.ts";
import { Neo4jError } from "./neo4j.ts";
import { PostgrestError } from "./postgrest.ts";
import type { Neo4jClient, Parameters, Row } from "./neo4j.ts";
import {
  COUNT_STAMPED,
  READ_BEV_ATTRIBUTES,
  READ_BEV_IDS,
  READ_META,
  READ_SIMILAR_TO,
  REPORT_NEIGHBOURS,
  REPORT_VECTOR,
  SET_BEV_GRAPH_STATS,
  STAMP_FAILED_ATTEMPT,
  STAMP_META,
  UPSERT_COMMUNITIES,
  UPSERT_IN_COMMUNITY,
  VERIFY_COUNTS,
  VERIFY_INVARIANTS,
  analyticsSweepSteps,
  analyticsWriteSteps,
  buildGraphPlan,
  expectedMemberships,
  expectedVerification,
  sweepSteps,
  writeSteps,
} from "./sync-core.ts";
import type { GraphPlan } from "./sync-core.ts";
import { FIXTURE_PSEUDONYM_SALT, FIXTURE_USERS, buildFixtureSource } from "./sync-fixture.ts";
import {
  GraphStatsPublishError,
  PSEUDONYM_SALT_MIN_LENGTH,
  VerificationError,
  assertSourceNotEmpty,
  checkEnvironment,
  communityIdentifier,
  newSyncId,
  parseOptions,
  postgresPublisher,
  pseudonymiser,
  runSync,
} from "./sync.ts";
import type { SyncDeps } from "./sync.ts";

const PLAN: GraphPlan = buildGraphPlan(buildFixtureSource(), {
  pseudonymOf: pseudonymiser(FIXTURE_PSEUDONYM_SALT),
  rankingVersion: RANKING_VERSION,
});
const SYNC_ID = "20261110T055000000Z-0123456789ab";

/** What the fake graph hands back to the analytics phase: the plan's Bevs, edges and memberships, as the real one would. */
const GRAPH_BEVS = PLAN.nodes.bevs.map((b) => ({ id: b.id }));
const GRAPH_EDGES = PLAN.relationships.similarTo.map((e) => ({ a: e.src, b: e.dst, w: e.w }));
const GRAPH_MEMBERSHIPS = expectedMemberships(PLAN);
const COMMUNITY_ID_OF = communityIdentifier(FIXTURE_PSEUDONYM_SALT);
/**
 * The stats the sync must compute from that read, computed here the same way:
 * SIMILAR_TO for centrality and bridge, the flavour projection for the taste
 * families.
 */
const STATS: GraphStats = computeGraphStats({
  nodes: GRAPH_BEVS.map((b) => b.id),
  similarity: GRAPH_EDGES,
  partition: flavourProjection(GRAPH_BEVS.map((b) => b.id), GRAPH_MEMBERSHIPS).partition,
  communityIdOf: COMMUNITY_ID_OF,
});

// ---------------------------------------------------------------------------
// The fake
// ---------------------------------------------------------------------------

interface Recorded {
  /** `tx<n>` for a statement inside the n-th transaction, `implicit` otherwise. */
  where: string;
  statement: string;
  parameters: Parameters;
}

interface FakeOptions {
  /** Rewrites what the verification reads return, to stage a mismatch. */
  verify?: (rows: Row[]) => Row[];
  /** Throw from a statement. Called for every statement, in or out of a transaction. */
  fail?: (recorded: Recorded, state: Fake) => Error | undefined;
  /** Throw from `commit()` in the n-th transaction (1-based). */
  failCommit?: (transaction: number) => Error | undefined;
  /** What the vector index answers. */
  vector?: Row[];
  /** Rewrites what the analytics phase reads back from the graph (`READ_BEV_IDS`, `READ_SIMILAR_TO`, `READ_BEV_ATTRIBUTES`). */
  readBack?: (statement: string, rows: Row[]) => Row[];
  /** What `replace_bev_graph_stats` does on its n-th call (1-based): throw, or answer a row count. Default: the number of rows sent. */
  publish?: (rows: readonly BevGraphStatsDbRow[], version: string, call: number) => number;
}

interface Published {
  rows: readonly BevGraphStatsDbRow[];
  version: string;
  /** How many transactions had COMMITTED when Postgres was written. */
  commitsBefore: number;
  /** How many statements had been sent to Neo4j by then. */
  statementsBefore: number;
}

interface Fake {
  client: Neo4jClient;
  statements: Recorded[];
  begins: number;
  commits: number;
  rollbacks: number;
  /** The syncId the committed graph holds, as the stamp inside a committed transaction left it. */
  committedSyncId: string | null;
  logs: string[];
  sleeps: number[];
  /** Every call of the Postgres write-back. */
  published: Published[];
  publish: NonNullable<SyncDeps["publishGraphStats"]>;
}

function fake(options: FakeOptions = {}): Fake {
  const expected = Object.entries(expectedVerification(PLAN, STATS)).map(([name, n]) => ({ name, n }));
  const counts = expected.filter((row) => row.name.startsWith("nodes.") || row.name.startsWith("relationships."));
  const invariants = expected.filter((row) => !counts.includes(row));

  const state: Fake = {
    statements: [],
    begins: 0,
    commits: 0,
    rollbacks: 0,
    committedSyncId: null,
    logs: [],
    sleeps: [],
    published: [],
    async publish(rows, version) {
      state.published.push({ rows, version, commitsBefore: state.commits, statementsBefore: state.statements.length });
      return options.publish === undefined ? rows.length : options.publish(rows, version, state.published.length);
    },
    client: {
      async query(statement, parameters = {}) {
        return answer({ where: "implicit", statement, parameters });
      },
      async beginTransaction() {
        const n = ++state.begins;
        let stamped: string | null = null;
        let open = true;
        return {
          async run(statement, parameters = {}) {
            const rows = answer({ where: `tx${n}`, statement, parameters });
            if (statement === STAMP_META) stamped = String(parameters.syncId);
            return rows;
          },
          async commit() {
            const error = options.failCommit?.(n);
            if (error !== undefined) throw error;
            state.commits++;
            state.committedSyncId = stamped;
            open = false;
          },
          async rollback() {
            if (!open) return;
            open = false;
            state.rollbacks++;
          },
        };
      },
    },
  };

  function answer(recorded: Recorded): Row[] {
    state.statements.push(recorded);
    const error = options.fail?.(recorded, state);
    if (error !== undefined) throw error;
    const { statement } = recorded;
    if (statement === VERIFY_COUNTS) return (options.verify ?? ((r) => r))(counts.map((r) => ({ ...r })));
    if (statement === VERIFY_INVARIANTS) return (options.verify ?? ((r) => r))(invariants.map((r) => ({ ...r })));
    if (statement === READ_BEV_IDS) return (options.readBack ?? ((_s, r) => r))(statement, GRAPH_BEVS.map((r) => ({ ...r })));
    if (statement === READ_SIMILAR_TO) return (options.readBack ?? ((_s, r) => r))(statement, GRAPH_EDGES.map((r) => ({ ...r })));
    if (statement === READ_BEV_ATTRIBUTES) return (options.readBack ?? ((_s, r) => r))(statement, GRAPH_MEMBERSHIPS.map((r) => ({ ...r })));
    if (statement === READ_META) return [{ syncId: state.committedSyncId, lastSyncAt: "2026-11-10T05:50:07Z" }];
    if (statement === COUNT_STAMPED) return [{ n: 0 }];
    if (statement === REPORT_NEIGHBOURS) return [{ name: "Pepsi", brand: "Pepsi", categoryId: "soda", w: 0.9001 }];
    if (statement === REPORT_VECTOR) return options.vector ?? [{ name: "Coca-Cola Classic", brand: "Coca-Cola", score: 1 }];
    return [];
  }

  return state;
}

const deps = (f: Fake): SyncDeps => ({
  client: f.client,
  log: (line: string) => void f.logs.push(line),
  sleep: async (ms: number) => void f.sleeps.push(ms),
  communityIdOf: COMMUNITY_ID_OF,
  publishGraphStats: f.publish,
});

/** One statement per request the step sends: `ceil(rows / batchSize)` copies. */
const requests = (steps: ReadonlyArray<{ statement: string; rows: readonly unknown[]; batchSize: number }>): string[] =>
  steps.flatMap((step) => new Array<string>(Math.ceil(step.rows.length / step.batchSize)).fill(step.statement));

const transient = (): Neo4jError =>
  new Neo4jError({ message: "HTTP 503", code: null, status: 503, statement: "UNWIND $rows AS row", transient: true });
const permanent = (): Neo4jError =>
  new Neo4jError({
    message: "HTTP 400 Neo.ClientError.Statement.SyntaxError",
    code: "Neo.ClientError.Statement.SyntaxError",
    status: 400,
    statement: "UNWIND $rows AS row",
    transient: false,
  });

/** What postgrest.ts raises: a status (null = no response arrived), and from it the one bit the write-back retries on. */
const postgrest = (status: number | null, body = ""): PostgrestError =>
  new PostgrestError({
    message:
      status === null
        ? "network failure (ECONNRESET) on /rpc/replace_bev_graph_stats"
        : `${status} on /rpc/replace_bev_graph_stats${body === "" ? "" : `\n  ${body}`}`,
    status,
    path: "/rpc/replace_bev_graph_stats",
  });

const inTx = (f: Fake, n: number): Recorded[] => f.statements.filter((s) => s.where === `tx${n}`);

// ---------------------------------------------------------------------------
// A real run
// ---------------------------------------------------------------------------

test("a real run: upserts, sweep, analytics, verification, stamp -- in that order, in ONE transaction -- then commit", async () => {
  const f = fake();
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f));

  assert.equal(f.begins, 1);
  assert.equal(f.commits, 1);
  assert.equal(f.rollbacks, 0);
  assert.equal(f.committedSyncId, SYNC_ID);

  const sent = inTx(f, 1).map((s) => s.statement);
  const expected = [
    ...requests(writeSteps(PLAN)),
    ...sweepSteps().map((s) => s.statement),
    // The analytics phase: read the graph back, write what was computed from
    // it, sweep last night's communities.
    READ_BEV_IDS,
    READ_SIMILAR_TO,
    READ_BEV_ATTRIBUTES,
    ...requests(analyticsWriteSteps(graphStatsWrites(STATS))),
    ...analyticsSweepSteps().map((s) => s.statement),
    VERIFY_COUNTS,
    VERIFY_INVARIANTS,
    STAMP_META,
  ];
  assert.deepEqual(sent, expected);
  // Nothing of the generation is written outside the transaction.
  for (const s of f.statements.filter((x) => x.where === "implicit")) {
    assert.ok(!/\b(MERGE|SET|DELETE|CREATE)\b/.test(s.statement), `an implicit write: ${s.statement.trim().split("\n")[0]}`);
  }
});

test("every batch carries this run's syncId, and no batch exceeds its size", async () => {
  const f = fake();
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f));
  const sizes = new Map(writeSteps(PLAN).map((step) => [step.statement, step.batchSize]));
  let rows = 0;
  for (const s of inTx(f, 1)) {
    const size = sizes.get(s.statement);
    if (size === undefined) continue;
    assert.equal(s.parameters.syncId, SYNC_ID);
    const batch = s.parameters.rows as unknown[];
    assert.ok(batch.length > 0 && batch.length <= size);
    rows += batch.length;
  }
  assert.equal(rows, writeSteps(PLAN).reduce((n, step) => n + step.rows.length, 0));
  for (const s of inTx(f, 1).filter((x) => sweepSteps().some((step) => step.statement === x.statement))) {
    assert.deepEqual(s.parameters, { syncId: SYNC_ID });
  }
  for (const s of inTx(f, 1).filter((x) => analyticsSweepSteps().some((step) => step.statement === x.statement))) {
    assert.deepEqual(s.parameters, { syncId: SYNC_ID });
  }
  const stamp = inTx(f, 1).find((s) => s.statement === STAMP_META);
  assert.equal(stamp?.parameters.syncId, SYNC_ID);
  assert.equal((stamp?.parameters.counts as Record<string, number>).Bev, PLAN.counts.nodes.Bev);
  assert.equal((stamp?.parameters.counts as Record<string, number>).Community, STATS.counts.communities);
  assert.equal((stamp?.parameters.counts as Record<string, number>).IN_COMMUNITY, PLAN.counts.nodes.Bev);
  assert.equal(stamp?.parameters.modularity, STATS.modularity);
  assert.equal(stamp?.parameters.analyticsVersion, RANKING_VERSION);
});

// ---------------------------------------------------------------------------
// The analytics phase
// ---------------------------------------------------------------------------

test("the analytics phase reads the graph back AFTER the mirror sweep and writes BEFORE the verification", async () => {
  const f = fake();
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f));
  const sent = inTx(f, 1).map((s) => s.statement);
  const last = (statement: string) => sent.lastIndexOf(statement);

  const lastUpsert = Math.max(...writeSteps(PLAN).map((step) => last(step.statement)));
  const lastMirrorSweep = Math.max(...sweepSteps().map((step) => last(step.statement)));
  assert.ok(lastUpsert < sent.indexOf(sweepSteps()[0]?.statement as string), "the sweep follows every upsert");
  assert.ok(lastMirrorSweep < sent.indexOf(READ_BEV_IDS), "the graph is read back only once it holds this generation alone");
  assert.ok(sent.indexOf(READ_BEV_IDS) < sent.indexOf(READ_SIMILAR_TO));
  assert.ok(sent.indexOf(READ_SIMILAR_TO) < sent.indexOf(READ_BEV_ATTRIBUTES));
  assert.ok(sent.indexOf(READ_BEV_ATTRIBUTES) < sent.indexOf(SET_BEV_GRAPH_STATS), "all three reads precede any computed write");
  assert.ok(sent.indexOf(SET_BEV_GRAPH_STATS) < sent.indexOf(UPSERT_COMMUNITIES));
  assert.ok(sent.indexOf(UPSERT_COMMUNITIES) < sent.indexOf(UPSERT_IN_COMMUNITY));
  // Last night's communities are swept only after tonight's are stamped ...
  const [sweepLinks, sweepNodes] = analyticsSweepSteps().map((step) => sent.indexOf(step.statement)) as [number, number];
  assert.ok(last(UPSERT_IN_COMMUNITY) < sweepLinks && sweepLinks < sweepNodes);
  // ... and all of it before anything is verified or stamped.
  assert.ok(sweepNodes < sent.indexOf(VERIFY_COUNTS));
  assert.ok(sent.indexOf(VERIFY_INVARIANTS) < sent.indexOf(STAMP_META));
  // Each of the three reads is sent once, with no parameter, inside the transaction.
  for (const read of [READ_BEV_IDS, READ_SIMILAR_TO, READ_BEV_ATTRIBUTES]) {
    const calls = f.statements.filter((s) => s.statement === read);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.where, "tx1");
    assert.deepEqual(calls[0]?.parameters, {});
  }
});

test("what the analytics phase writes is what the package computes from the graph as read back", async () => {
  const f = fake();
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f));
  const writes = graphStatsWrites(STATS);
  const sentRows = (statement: string): unknown[] =>
    inTx(f, 1).filter((s) => s.statement === statement).flatMap((s) => s.parameters.rows as unknown[]);

  assert.deepEqual(sentRows(SET_BEV_GRAPH_STATS), writes.bevs);
  assert.deepEqual(sentRows(UPSERT_COMMUNITIES), writes.communities);
  assert.deepEqual(sentRows(UPSERT_IN_COMMUNITY), writes.inCommunity);
  for (const statement of [SET_BEV_GRAPH_STATS, UPSERT_COMMUNITIES, UPSERT_IN_COMMUNITY]) {
    for (const s of inTx(f, 1).filter((x) => x.statement === statement)) assert.equal(s.parameters.syncId, SYNC_ID);
  }
  // One row per Bev, exactly one hub per community.
  assert.equal(writes.bevs.length, PLAN.counts.nodes.Bev);
  assert.equal(writes.inCommunity.filter((link) => link.hub).length, STATS.counts.communities);
  assert.match(
    f.logs.join("\n"),
    new RegExp(
      `read {3}${PLAN.counts.nodes.Bev} \\(:Bev\\), ${PLAN.counts.relationships.SIMILAR_TO} SIMILAR_TO and ${GRAPH_MEMBERSHIPS.length} flavour and note memberships back from the graph`,
    ),
  );
  assert.match(
    f.logs.join("\n"),
    new RegExp(`stats {2}${STATS.counts.communities} taste families \\(${STATS.counts.singletons} of one Bev\\) over ${STATS.counts.partitionEdges} projected pairs`),
  );
});

test("the taste families follow the MEMBERSHIPS read back; centrality does not move with them", async () => {
  // The graph hands back the same number of memberships, but every flavour
  // base is now one and the same: a different projection, so different families.
  const f = fake({
    readBack: (statement, rows) =>
      statement === READ_BEV_ATTRIBUTES
        ? rows.map((row) => (String(row.attribute).startsWith("flavor:") ? { ...row, attribute: "flavor:everything" } : row))
        : rows,
  });
  // The fake's verification rows are for the real families, so the run may end in a VerificationError; the writes are what is read.
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: true }, deps(f)).catch(() => undefined);
  const sentRows = <T>(statement: string): T[] => inTx(f, 1).filter((s) => s.statement === statement).flatMap((s) => s.parameters.rows as T[]);
  const planned = graphStatsWrites(STATS);

  const communities = sentRows<{ id: string; size: number }>(UPSERT_COMMUNITIES);
  assert.ok(communities.length > 0);
  assert.notDeepEqual(communities, planned.communities, "the families were computed from what was read, not from the plan");
  const bevs = sentRows<{ id: string; pagerank: number; strength: number; degree: number; community: string }>(SET_BEV_GRAPH_STATS);
  const plannedBev = new Map(planned.bevs.map((b) => [b.id, b]));
  assert.equal(bevs.length, PLAN.counts.nodes.Bev);
  for (const row of bevs) {
    const before = plannedBev.get(row.id);
    // PageRank, strength and degree are SIMILAR_TO's, which this read did not touch.
    assert.deepEqual([row.pagerank, row.strength, row.degree], [before?.pagerank, before?.strength, before?.degree]);
  }
  assert.ok(bevs.some((row) => row.community !== plannedBev.get(row.id)?.community));
});

test("a membership carrying the catch-all base, or of an unknown kind, stops the run before anything is written", async () => {
  for (const [attribute, pattern] of [
    ["flavor:other", /carries the catch-all base "other"/],
    ["brand:coca-cola", /is not "flavor:<base>" or "note:<token>"/],
  ] as const) {
    const f = fake({
      readBack: (statement, rows) => (statement === READ_BEV_ATTRIBUTES ? rows.map((row, i) => (i === 0 ? { ...row, attribute } : row)) : rows),
    });
    await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), pattern);
    assert.equal(f.commits, 0);
    assert.equal(f.rollbacks, 1);
    assert.equal(f.begins, 1, "never retried");
    assert.ok(!f.statements.some((s) => s.statement === SET_BEV_GRAPH_STATS));
    assert.equal(f.published.length, 0);
  }
});

test("the stats follow the GRAPH, not the plan: a different read gives different writes", async () => {
  // The graph hands back every edge at half its weight. Still a valid graph of
  // the right size, so it is computed and written as read.
  const f = fake({
    readBack: (statement, rows) => (statement === READ_SIMILAR_TO ? rows.map((row) => ({ ...row, w: (row.w as number) / 2 })) : rows),
    // The verification rows the fake returns are for the unhalved graph; only the writes matter here.
  });
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: true }, deps(f)).catch(() => undefined);
  const sent = inTx(f, 1).filter((s) => s.statement === SET_BEV_GRAPH_STATS).flatMap((s) => s.parameters.rows as Array<{ id: string; strength: number }>);
  const planned = new Map(graphStatsWrites(STATS).bevs.map((b) => [b.id, b.strength]));
  assert.equal(sent.length, PLAN.counts.nodes.Bev);
  const moved = sent.filter((row) => row.strength !== planned.get(row.id));
  assert.ok(moved.length > 300, `only ${moved.length} strengths followed the graph`);
  for (const row of moved.slice(0, 20)) assert.ok(Math.abs(row.strength - (planned.get(row.id) as number) / 2) < 1e-9);
});

test("a read-back that does not hold the plan's Bevs, edges or memberships rolls back before anything is computed", async () => {
  for (const [dropFrom, pattern] of [
    [READ_BEV_IDS, /the graph read back \d+ \(:Bev\), the plan has \d+/],
    [READ_SIMILAR_TO, /the graph read back \d+ SIMILAR_TO, the plan has \d+/],
    [READ_BEV_ATTRIBUTES, /the graph read back \d+ flavour and note memberships, the plan has \d+/],
  ] as const) {
    const f = fake({ readBack: (statement, rows) => (statement === dropFrom ? rows.slice(1) : rows) });
    await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), (error: Error) => {
      assert.ok(error instanceof VerificationError);
      assert.match(error.message, pattern);
      assert.match(error.message, /rolled back/);
      return true;
    });
    assert.equal(f.commits, 0);
    assert.equal(f.rollbacks, 1);
    assert.equal(f.begins, 1, "never retried");
    assert.ok(!f.statements.some((s) => s.statement === SET_BEV_GRAPH_STATS), "nothing computed was written");
    assert.equal(f.published.length, 0, "and Postgres was not touched");
  }
});

test("a weight read back as something that is not a number is refused", async () => {
  const f = fake({ readBack: (statement, rows) => (statement === READ_SIMILAR_TO ? rows.map((row, i) => (i === 0 ? { ...row, w: null } : row)) : rows) });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), /w as read back is not a finite number/);
  assert.equal(f.commits, 0);
  assert.equal(f.rollbacks, 1);
  assert.equal(f.published.length, 0);
});

// ---------------------------------------------------------------------------
// The Postgres write-back
// ---------------------------------------------------------------------------

test("bev_graph_stats is written ONCE, only AFTER the commit, with every row and RANKING_VERSION", async () => {
  const f = fake();
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f));
  assert.equal(f.published.length, 1);
  const [call] = f.published as [Published];
  assert.equal(call.commitsBefore, 1, "the graph had committed");
  assert.equal(call.version, RANKING_VERSION);
  assert.deepEqual(call.rows, graphStatsDbRows(STATS));
  assert.equal(call.rows.length, PLAN.counts.nodes.Bev);
  // After the confirmation that the commit is visible, before either report.
  const before = f.statements.slice(0, call.statementsBefore).map((s) => s.statement);
  assert.equal(before.at(-1), READ_META);
  assert.ok(!before.includes(REPORT_NEIGHBOURS));
  assert.match(f.logs.join("\n"), new RegExp(`bev_graph_stats: replaced with ${call.rows.length} rows \\(version ${RANKING_VERSION.replaceAll(".", "\\.")}\\) for generation ${SYNC_ID}`));
});

test("--dry-run never writes bev_graph_stats, and says so", async () => {
  // A publisher that would fail transiently for ever: a dry run must not call it even once.
  const f = fake({
    publish: () => {
      throw postgrest(503);
    },
  });
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: true }, deps(f));
  assert.equal(f.published.length, 0);
  assert.deepEqual(f.sleeps, []);
  assert.match(f.logs.join("\n"), /--dry-run: bev_graph_stats in Postgres was NOT written either/);
  // --fixture has no Postgres at all: a dry run needs no publisher.
  const g = fake();
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: true }, { ...deps(g), publishGraphStats: null });
  assert.equal(g.rollbacks, 1);
  assert.equal(g.commits, 0);
});

test("a run that commits refuses to start without a Postgres write-back", async () => {
  const f = fake();
  await assert.rejects(
    runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, { ...deps(f), publishGraphStats: null }),
    /needs a Postgres write-back for bev_graph_stats.*Nothing was sent to Neo4j/,
  );
  assert.equal(f.begins, 0);
  assert.equal(f.statements.length, 0);
});

test("nothing is written to Postgres when the transaction does not commit", async () => {
  for (const options of [
    { verify: (rows: Row[]) => rows.map((row) => (row.name === "nodes.Community" ? { ...row, n: 0 } : row)) },
    { fail: (s: Recorded) => (s.statement === UPSERT_IN_COMMUNITY ? permanent() : undefined) },
    { failCommit: () => permanent() },
  ] satisfies FakeOptions[]) {
    const f = fake(options);
    await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)));
    assert.equal(f.commits, 0);
    assert.equal(f.published.length, 0);
  }
});

/** The message every final write-back failure carries, whatever caused it. */
const assertPublishError = (error: Error, cause: RegExp): true => {
  assert.ok(error instanceof GraphStatsPublishError);
  assert.match(error.message, new RegExp(`the graph COMMITTED generation ${SYNC_ID}, but bev_graph_stats in Postgres was NOT updated`));
  assert.match(error.message, /still holds the previous night's values/);
  assert.match(error.message, /The next graph:sync run repairs it/);
  assert.match(error.message, cause);
  return true;
};

/** The graph is right and stays: one transaction, committed, not rolled back, not run again, and not marked failed. */
const assertGraphStands = (f: Fake): void => {
  assert.equal(f.begins, 1);
  assert.equal(f.commits, 1);
  assert.equal(f.rollbacks, 0);
  assert.equal(f.committedSyncId, SYNC_ID);
  assert.ok(!f.statements.some((s) => s.statement === STAMP_FAILED_ATTEMPT), "(:Meta).lastAttemptOk is not flipped to false");
};

test("a transient write-back failure is retried: the second call succeeds and so does the run", async () => {
  for (const first of [postgrest(503), postgrest(429), postgrest(null)]) {
    const f = fake({
      publish: (rows, _version, call) => {
        if (call === 1) throw first;
        return rows.length;
      },
    });
    await runSync(PLAN, { syncId: SYNC_ID, dryRun: false, backoffMs: 11 }, deps(f));
    assert.equal(f.published.length, 2, `two calls after ${String(first.status)}`);
    assert.deepEqual(f.sleeps, [11], "the sync's own backoff");
    // The same whole payload both times: the call is an idempotent replace.
    assert.deepEqual(f.published[1]?.rows, f.published[0]?.rows);
    assert.equal(f.published[1]?.version, RANKING_VERSION);
    assertGraphStands(f);
    const log = f.logs.join("\n");
    assert.match(log, /::warning::bev_graph_stats write-back attempt 1\/3 failed with a transient error \(the graph has already committed\); retrying in 11 ms/);
    assert.match(log, new RegExp(`bev_graph_stats: replaced with ${PLAN.counts.nodes.Bev} rows`));
    // The reports still follow a write-back that needed a second try.
    assert.match(log, /--- graph signals/);
  }
});

test("a 4xx write-back failure is NOT retried: one call, then the graph-committed message", async () => {
  for (const [status, body, cause] of [
    [400, '{"code":"22023","details":"rows: pagerank does not sum to 1","message":"BEVI_VALIDATION"}', /rows: pagerank does not sum to 1/],
    [404, '{"code":"PGRST202","message":"Could not find the function public.replace_bev_graph_stats"}', /Could not find the function/],
    [401, '{"message":"Invalid API key"}', /401 on \/rpc\/replace_bev_graph_stats/],
  ] as const) {
    const f = fake({
      publish: () => {
        throw postgrest(status, body);
      },
    });
    await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false, backoffMs: 11 }, deps(f)), (error: Error) => assertPublishError(error, cause));
    assert.equal(f.published.length, 1, `one call on ${status}`);
    assert.deepEqual(f.sleeps, []);
    assertGraphStands(f);
  }
});

test("three transient write-back failures give up: three calls, then the graph-committed message", async () => {
  const f = fake({
    publish: () => {
      throw postgrest(503, "upstream connect error");
    },
  });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false, backoffMs: 5 }, deps(f)), (error: Error) =>
    assertPublishError(error, /503 on \/rpc\/replace_bev_graph_stats/),
  );
  assert.equal(f.published.length, 3);
  assert.deepEqual(f.sleeps, [5, 10]);
  assertGraphStands(f);
  // maxAttempts bounds the write-back as it bounds the sync.
  const g = fake({
    publish: () => {
      throw postgrest(null);
    },
  });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false, backoffMs: 1, maxAttempts: 2 }, deps(g)), (error: Error) =>
    assertPublishError(error, /network failure \(ECONNRESET\)/),
  );
  assert.equal(g.published.length, 2);
});

test("an error that is not a PostgrestError is not transient: one call", async () => {
  const f = fake({
    publish: () => {
      throw new Error("503 Service Unavailable, said a plain Error");
    },
  });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), (error: Error) =>
    assertPublishError(error, /said a plain Error/),
  );
  assert.equal(f.published.length, 1, "one attempt");
  assert.deepEqual(f.sleeps, []);
  assertGraphStands(f);
});

test("a write-back that answers the wrong row count is the same failure, and is not retried", async () => {
  const f = fake({ publish: (rows) => rows.length - 1 });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), (error: Error) => {
    assert.ok(error instanceof GraphStatsPublishError);
    assert.match(error.message, new RegExp(`replace_bev_graph_stats answered ${PLAN.counts.nodes.Bev - 1} for ${PLAN.counts.nodes.Bev} rows sent`));
    assert.match(error.message, /NOT updated/);
    return true;
  });
  assert.equal(f.commits, 1);
  assert.equal(f.published.length, 1);
});

test("postgresPublisher calls replace_bev_graph_stats with p_rows and p_version, once", async () => {
  const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
  const publish = postgresPublisher({
    select: async () => [],
    rpcRows: async () => [],
    rpc: async <T>(name: string, body: Record<string, unknown>) => {
      calls.push({ name, body });
      return 3 as T;
    },
  });
  const rows = graphStatsDbRows(STATS).slice(0, 3);
  assert.equal(await publish(rows, "1.7.0"), 3);
  assert.deepEqual(calls, [{ name: "replace_bev_graph_stats", body: { p_rows: rows, p_version: "1.7.0" } }]);
});

test("the analytics report is printed after the read-back report, committed or not", async () => {
  for (const dryRun of [false, true]) {
    const f = fake();
    await runSync(PLAN, { syncId: SYNC_ID, dryRun }, deps(f));
    const log = f.logs.join("\n");
    const readBack = log.indexOf("--- read-back report");
    const signals = log.indexOf("--- graph signals (computed from the graph as read back");
    assert.ok(readBack > 0 && signals > readBack, `dryRun ${dryRun}`);
    assert.match(log, new RegExp(`modularity Q = ${STATS.modularity.toFixed(4)} over ${STATS.counts.communities} taste families`));
    assert.match(log, /taste families are Louvain communities of the flavour projection; centrality and bridge are measured on SIMILAR_TO/);
    assert.match(log, / {2}\| {2}bases: /);
    assert.match(log, /the 10 most central Bevs \(weighted PageRank\)/);
    assert.match(log, /category purity \d\.\d{4}: /);
    if (dryRun) assert.ok(signals < log.indexOf("--dry-run: the transaction was ROLLED BACK"), "printed before the rollback line");
  }
});

test("after the commit it confirms (:Meta).syncId and prints the read-back report from the committed graph", async () => {
  const f = fake();
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f));
  const after = f.statements.filter((s) => s.where === "implicit").map((s) => s.statement);
  assert.equal(after[0], READ_META);
  assert.ok(after.includes(REPORT_NEIGHBOURS) && after.includes(REPORT_VECTOR));
  const log = f.logs.join("\n");
  assert.match(log, new RegExp(`confirmed: \\(:Meta\\)\\.syncId = ${SYNC_ID}`));
  assert.match(log, /read-back report \(Cypher against the committed graph\)/);
  assert.match(log, /0\.9001 {2}Pepsi \(Pepsi\) \[soda\]/);
  assert.match(log, /users \(counts only\): 5 \(:User\), 14 RANKED, 5 LIKES, 4 DISLIKES/);
});

test("a commit the graph does not show is a failure", async () => {
  const f = fake();
  const client: Neo4jClient = {
    beginTransaction: () => f.client.beginTransaction(),
    query: async (statement, parameters) =>
      statement === READ_META ? [{ syncId: "someone-elses", lastSyncAt: "x" }] : f.client.query(statement, parameters),
  };
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, { ...deps(f), client }), /commit was acknowledged but \(:Meta\)\.syncId is "someone-elses"/);
});

test("an empty vector index after the commit is retried briefly, then a warning, not a failure", async () => {
  const f = fake({ vector: [] });
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false, vectorProbeAttempts: 3, vectorProbeDelayMs: 7 }, deps(f));
  assert.equal(f.statements.filter((s) => s.statement === REPORT_VECTOR).length, 3);
  assert.deepEqual(f.sleeps, [7, 7]);
  assert.match(f.logs.join("\n"), /::warning::the vector index returned nothing yet/);
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

test("a verification mismatch rolls back, does NOT commit, and names the check and both numbers", async () => {
  const f = fake({
    verify: (rows) => rows.map((row) => (row.name === "relationships.SIMILAR_TO" ? { ...row, n: (row.n as number) - 1 } : row)),
  });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), (error: Error) => {
    assert.ok(error instanceof VerificationError);
    const want = PLAN.counts.relationships.SIMILAR_TO;
    assert.match(error.message, new RegExp(`relationships\\.SIMILAR_TO: the graph has ${want - 1}, the plan has ${want}`));
    assert.match(error.message, /rolled back/);
    return true;
  });
  assert.equal(f.rollbacks, 1, "rollback was called");
  assert.equal(f.commits, 0, "commit was NOT called");
  assert.equal(f.committedSyncId, null);
  // Never retried: the same data would fail the same way.
  assert.equal(f.begins, 1);
  assert.deepEqual(f.sleeps, []);
  // The stamp is the step AFTER verification, so it was never sent.
  assert.ok(!inTx(f, 1).some((s) => s.statement === STAMP_META));
});

test("each invariant fails the run on its own", async () => {
  for (const name of [
    "SIMILAR_TO not oriented src.id < dst.id",
    "Bevs without isAlcoholic",
    "Bevs without exactly one IN_CATEGORY",
    "bevs with an embedding",
    "embeddings not stored as 384 floats",
    "Users with a property other than pseudonym and syncId",
    "SIMILAR_TO terms not stored as floats",
    "RANKED score, z or bucket stored with the wrong type",
    "Bevs without exactly one IN_COMMUNITY",
    "Communities without exactly one hub",
    "Communities whose size is not their member count",
    "Bevs whose community property is not their IN_COMMUNITY target",
    "Bev pagerank, strength, bridge, degree or community stored with the wrong type",
    "IN_COMMUNITY hub not stored as a boolean",
    "Bev pagerank not summing to 1 within 1e-6",
    "nodes.Bev",
    "nodes.User",
    "nodes.Community",
    "relationships.RANKED",
    "relationships.IN_COMMUNITY",
  ]) {
    const f = fake({ verify: (rows) => rows.map((row) => (row.name === name ? { ...row, n: (row.n as number) + 1 } : row)) });
    await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), (error: Error) => {
      assert.ok(error instanceof VerificationError, name);
      assert.equal(error.failures.length, 1, name);
      assert.ok(error.failures[0]?.startsWith(`${name}: `), name);
      return true;
    });
    assert.equal(f.commits, 0, name);
    assert.equal(f.rollbacks, 1, name);
    assert.equal(f.published.length, 0, name);
  }
});

// ---------------------------------------------------------------------------
// --dry-run
// ---------------------------------------------------------------------------

test("--dry-run does everything, then rolls back and does NOT commit", async () => {
  const f = fake();
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: true }, deps(f));
  assert.equal(f.begins, 1);
  assert.equal(f.rollbacks, 1, "rollback was called");
  assert.equal(f.commits, 0, "commit was NOT called");
  assert.equal(f.committedSyncId, null);

  // The same statements a real run sends, the stamp included ...
  const sent = inTx(f, 1).map((s) => s.statement);
  assert.ok(sent.includes(VERIFY_COUNTS) && sent.includes(VERIFY_INVARIANTS) && sent.includes(STAMP_META));
  assert.equal(sent.filter((s) => writeSteps(PLAN).some((step) => step.statement === s)).length > 15, true);
  // ... and the report, read through the transaction that can still see them.
  assert.ok(sent.indexOf(REPORT_NEIGHBOURS) > sent.indexOf(STAMP_META));

  const log = f.logs.join("\n");
  assert.match(log, /--dry-run: the transaction was ROLLED BACK\. Nothing was written to the graph\./);
  assert.match(log, /read-back report \(Cypher against the uncommitted graph\)/);
  // Outside the transaction: only the two reads that prove the rollback.
  assert.deepEqual(
    f.statements.filter((s) => s.where === "implicit").map((s) => s.statement),
    [READ_META, COUNT_STAMPED],
  );
  // The analytics phase ran in full inside it, all the same.
  for (const statement of [READ_BEV_IDS, READ_SIMILAR_TO, READ_BEV_ATTRIBUTES, SET_BEV_GRAPH_STATS, UPSERT_COMMUNITIES, UPSERT_IN_COMMUNITY]) {
    assert.ok(sent.includes(statement));
  }
});

test("a failing dry run stamps nothing: it promised to write nothing", async () => {
  const f = fake({ fail: (s) => (s.statement === VERIFY_COUNTS ? permanent() : undefined) });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: true }, deps(f)));
  assert.equal(f.commits, 0);
  assert.equal(f.rollbacks, 1);
  assert.equal(f.statements.filter((s) => s.where === "implicit").length, 0);
});

test("a dry run that left this run's syncId behind is a failure", async () => {
  const f = fake();
  const client: Neo4jClient = {
    beginTransaction: () => f.client.beginTransaction(),
    query: async (statement, parameters) => (statement === COUNT_STAMPED ? [{ n: 3 }] : f.client.query(statement, parameters)),
  };
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: true }, { ...deps(f), client }), /dry run left something behind/);
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

test("a transient failure rolls back and retries the WHOLE sync in a fresh transaction", async () => {
  let thrown = false;
  const f = fake({
    fail: (s) => {
      // The first SIMILAR_TO batch of the first transaction.
      if (!thrown && s.where === "tx1" && s.statement.includes("SIMILAR_TO") && s.statement.includes("UNWIND")) {
        thrown = true;
        return transient();
      }
      return undefined;
    },
  });
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false, backoffMs: 11 }, deps(f));
  assert.equal(f.begins, 2, "retried");
  assert.equal(f.rollbacks, 1, "the failed attempt was rolled back");
  assert.equal(f.commits, 1);
  assert.equal(f.committedSyncId, SYNC_ID);
  assert.deepEqual(f.sleeps, [11]);
  // The second attempt starts from the first statement again, with the same syncId.
  assert.equal(inTx(f, 2)[0]?.statement, writeSteps(PLAN)[0]?.statement);
  assert.equal(inTx(f, 2)[0]?.parameters.syncId, SYNC_ID);
  assert.ok(!f.statements.some((s) => s.statement === STAMP_FAILED_ATTEMPT));
  assert.match(f.logs.join("\n"), /::warning::attempt 1 failed with a transient error and was rolled back; retrying in 11 ms/);
});

test("a transient failure of the commit itself is retried too", async () => {
  const f = fake({ failCommit: (n) => (n === 1 ? transient() : undefined) });
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false, backoffMs: 1 }, deps(f));
  assert.equal(f.begins, 2);
  assert.equal(f.commits, 1);
});

test("a non-transient failure is NOT retried: rollback, a failed-attempt stamp, and the error", async () => {
  const f = fake({ fail: (s) => (s.where === "tx1" && s.statement.includes("MERGE (b:Bev") ? permanent() : undefined) });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), /SyntaxError/);
  assert.equal(f.begins, 1, "not retried");
  assert.equal(f.rollbacks, 1);
  assert.equal(f.commits, 0);
  assert.deepEqual(f.sleeps, []);
  // The stamp goes out in its own implicit transaction, after the rollback.
  assert.deepEqual(
    f.statements.filter((s) => s.where === "implicit").map((s) => s.statement),
    [STAMP_FAILED_ATTEMPT],
  );
  assert.match(f.logs.join("\n"), /stamped \(:Meta\)\.lastAttemptAt with lastAttemptOk = false/);
});

test("a plain Error is not transient", async () => {
  const f = fake({ fail: (s) => (s.where === "tx1" && s.statement === VERIFY_COUNTS ? new Error("boom") : undefined) });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), /boom/);
  assert.equal(f.begins, 1);
  assert.equal(f.commits, 0);
});

test("three transient failures give up: three transactions, none committed, then the stamp", async () => {
  const f = fake({ fail: (s) => (s.where.startsWith("tx") && s.statement === VERIFY_COUNTS ? transient() : undefined) });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false, backoffMs: 5 }, deps(f)), /HTTP 503/);
  assert.equal(f.begins, 3);
  assert.equal(f.rollbacks, 3);
  assert.equal(f.commits, 0);
  assert.deepEqual(f.sleeps, [5, 10]);
  assert.equal(f.statements.filter((s) => s.statement === STAMP_FAILED_ATTEMPT).length, 1);
});

test("a failed-attempt stamp that also fails does not mask the original error", async () => {
  const f = fake({
    fail: (s) => {
      if (s.statement === STAMP_FAILED_ATTEMPT) return transient();
      return s.where === "tx1" && s.statement === VERIFY_COUNTS ? permanent() : undefined;
    },
  });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), /SyntaxError/);
  assert.match(f.logs.join("\n"), /::warning::could not stamp \(:Meta\)\.lastAttemptAt either/);
});

test("a failure to open the transaction at all is handled like any other", async () => {
  const f = fake();
  let begins = 0;
  const client: Neo4jClient = {
    query: (statement, parameters) => f.client.query(statement, parameters),
    beginTransaction: async () => {
      if (++begins === 1) throw transient();
      return f.client.beginTransaction();
    },
  };
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false, backoffMs: 1 }, { ...deps(f), client });
  assert.equal(begins, 2);
  assert.equal(f.commits, 1);
});

// ---------------------------------------------------------------------------
// What reaches the log
// ---------------------------------------------------------------------------

test("no log line contains a pseudonym, a user id or a community id", async () => {
  for (const dryRun of [false, true]) {
    const f = fake();
    await runSync(PLAN, { syncId: SYNC_ID, dryRun }, deps(f));
    const log = f.logs.join("\n");
    assert.ok(log.length > 500);
    for (const user of PLAN.nodes.users) assert.ok(!log.includes(user.pseudonym), "a pseudonym reached the log");
    for (const id of Object.values(FIXTURE_USERS)) assert.ok(!log.includes(id), "a user id reached the log");
    assert.ok(!/[0-9a-f]{64}/.test(log));
    // A community id printed beside its hub's name would undo its opacity.
    for (const community of STATS.communities) assert.ok(!log.includes(community.id), "a community id reached the log");
    assert.ok(!/c_[0-9a-f]{16}/.test(log));
  }
});

test("the publish error carries no community id, user id or pseudonym either", async () => {
  const f = fake({
    publish: () => {
      throw new Error("400 Bad Request on /rpc/replace_bev_graph_stats\n  {\"code\":\"22023\",\"details\":\"rows: pagerank does not sum to 1\",\"message\":\"BEVI_VALIDATION\"}");
    },
  });
  await assert.rejects(runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f)), (error: Error) => {
    assert.match(error.message, /rows: pagerank does not sum to 1/);
    assert.ok(!/c_[0-9a-f]{16}/.test(error.message));
    assert.ok(!/[0-9a-f]{64}/.test(error.message));
    return true;
  });
});

// ---------------------------------------------------------------------------
// CLI and environment
// ---------------------------------------------------------------------------

test("parseOptions: --fixture forces --dry-run, and an unknown argument is an error", () => {
  assert.deepEqual(parseOptions([]), { dryRun: false, fixture: false });
  assert.deepEqual(parseOptions(["--dry-run"]), { dryRun: true, fixture: false });
  assert.deepEqual(parseOptions(["--fixture"]), { dryRun: true, fixture: true });
  assert.deepEqual(parseOptions(["--fixture", "--dry-run"]), { dryRun: true, fixture: true });
  assert.throws(() => parseOptions(["--dryrun"]), /unknown argument "--dryrun"/);
  assert.throws(() => parseOptions(["--strict"]), /unknown argument/);
  assert.throws(() => parseOptions(["commit"]), /unknown argument/);
});

const FULL_ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  NEO4J_URI: "neo4j+s://0a1b2c3d.databases.neo4j.io",
  NEO4J_USERNAME: "0a1b2c3d",
  NEO4J_PASSWORD: "password",
  NEO4J_DATABASE: "0a1b2c3d",
  BEVI_PSEUDONYM_SALT: "a-salt-of-sixteen-or-more",
};

test("a real run needs all seven values and ONE error names every missing one", () => {
  const real = { dryRun: false, fixture: false };
  assert.doesNotThrow(() => checkEnvironment(FULL_ENV, real));
  assert.throws(
    () => checkEnvironment({}, real),
    /missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE, BEVI_PSEUDONYM_SALT\./,
  );
  for (const name of Object.keys(FULL_ENV)) {
    assert.throws(() => checkEnvironment({ ...FULL_ENV, [name]: "" }, real), new RegExp(`missing ${name}\\.`), name);
  }
  // --dry-run is a real read of Postgres: it needs everything too.
  assert.throws(() => checkEnvironment({ ...FULL_ENV, SUPABASE_SERVICE_ROLE_KEY: undefined }, { dryRun: true, fixture: false }), /missing SUPABASE_SERVICE_ROLE_KEY/);
});

test("a pseudonym salt shorter than 16 characters is refused, without echoing it", () => {
  assert.equal(PSEUDONYM_SALT_MIN_LENGTH, 16);
  assert.throws(
    () => checkEnvironment({ ...FULL_ENV, BEVI_PSEUDONYM_SALT: "fifteen-chars-x" }, { dryRun: false, fixture: false }),
    (error: Error) => {
      assert.match(error.message, /BEVI_PSEUDONYM_SALT is shorter than 16 characters/);
      assert.ok(!error.message.includes("fifteen-chars-x"));
      return true;
    },
  );
  assert.doesNotThrow(() => checkEnvironment({ ...FULL_ENV, BEVI_PSEUDONYM_SALT: "sixteen-chars-xy" }, { dryRun: false, fixture: false }));
});

test("--fixture needs only the four NEO4J_* values", () => {
  const fixture = { dryRun: true, fixture: true };
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE } = FULL_ENV;
  assert.doesNotThrow(() => checkEnvironment({ NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE }, fixture));
  assert.throws(() => checkEnvironment({ NEO4J_URI, NEO4J_USERNAME }, fixture), /missing NEO4J_PASSWORD, NEO4J_DATABASE\./);
});

test("the pseudonym is hmac-sha256(salt, user id): stable, salted, 64 hex, and not the id", () => {
  const a = pseudonymiser("a-salt-of-sixteen-or-more");
  const b = pseudonymiser("another-salt-entirely-000");
  const id = FIXTURE_USERS.wide;
  assert.match(a(id), /^[0-9a-f]{64}$/);
  assert.equal(a(id), a(id));
  assert.notEqual(a(id), b(id));
  assert.notEqual(a(id), a(FIXTURE_USERS.mixed));
  assert.ok(!a(id).includes(id));
  // A known vector, so a change of algorithm cannot pass silently: it would
  // rename every (:User) in the graph.
  assert.equal(
    pseudonymiser("0123456789abcdef")("00000000-0000-4000-8000-000000000001"),
    "ce3b898ec32081af9b59bae626c047f6fc962f6b7e2afc8202aed4d391545cb4",
  );
});

test("newSyncId is a sortable timestamp plus random hex, unique per call", () => {
  const at = new Date("2026-11-10T05:50:07.123Z");
  const id = newSyncId(at);
  assert.match(id, /^20261110T055007123Z-[0-9a-f]{12}$/);
  assert.notEqual(newSyncId(at), newSyncId(at));
});

// ---------------------------------------------------------------------------
// The empty-read guard
// ---------------------------------------------------------------------------

test("zero active Bevs, categories or bev_edges rows is a broken read and is refused", () => {
  const logs: string[] = [];
  const log = (line: string) => void logs.push(line);
  const source = buildFixtureSource();
  assert.doesNotThrow(() => assertSourceNotEmpty(source, log));
  assert.deepEqual(logs, []);

  assert.throws(() => assertSourceNotEmpty({ ...source, bevs: [] }, log), /zero active Bevs\. That is a broken read/);
  assert.throws(
    () => assertSourceNotEmpty({ ...source, bevs: source.bevs.map((b) => ({ ...b, status: "hidden" })) }, log),
    /zero active Bevs/,
  );
  assert.throws(() => assertSourceNotEmpty({ ...source, categories: [] }, log), /zero categories/);
  assert.throws(() => assertSourceNotEmpty({ ...source, edges: [] }, log), /zero bev_edges rows/);
  assert.throws(
    () => assertSourceNotEmpty({ ...source, bevs: [], categories: [], edges: [] }, log),
    /zero active Bevs and zero categories and zero bev_edges rows.*Nothing was sent to Neo4j/,
  );
});

test("zero rankings is a real state: a warning, and a plan with no users", () => {
  const logs: string[] = [];
  const source = { ...buildFixtureSource(), rankings: [] };
  assert.doesNotThrow(() => assertSourceNotEmpty(source, (line) => void logs.push(line)));
  assert.match(logs.join("\n"), /::warning::zero rankings read/);
  const plan = buildGraphPlan(source, { pseudonymOf: pseudonymiser(FIXTURE_PSEUDONYM_SALT), rankingVersion: RANKING_VERSION });
  assert.equal(plan.counts.nodes.User, 0);
  assert.equal(plan.counts.relationships.RANKED, 0);
});
