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
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { RANKING_VERSION } from "@bevi/ranking";

import { Neo4jError } from "./neo4j.ts";
import type { Neo4jClient, Parameters, Row } from "./neo4j.ts";
import {
  COUNT_STAMPED,
  READ_META,
  REPORT_NEIGHBOURS,
  REPORT_VECTOR,
  STAMP_FAILED_ATTEMPT,
  STAMP_META,
  VERIFY_COUNTS,
  VERIFY_INVARIANTS,
  buildGraphPlan,
  expectedVerification,
  sweepSteps,
  writeSteps,
} from "./sync-core.ts";
import type { GraphPlan } from "./sync-core.ts";
import { FIXTURE_PSEUDONYM_SALT, FIXTURE_USERS, buildFixtureSource } from "./sync-fixture.ts";
import {
  PSEUDONYM_SALT_MIN_LENGTH,
  VerificationError,
  assertSourceNotEmpty,
  checkEnvironment,
  newSyncId,
  parseOptions,
  pseudonymiser,
  runSync,
} from "./sync.ts";

const PLAN: GraphPlan = buildGraphPlan(buildFixtureSource(), {
  pseudonymOf: pseudonymiser(FIXTURE_PSEUDONYM_SALT),
  rankingVersion: RANKING_VERSION,
});
const SYNC_ID = "20261110T055000000Z-0123456789ab";

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
}

function fake(options: FakeOptions = {}): Fake {
  const expected = Object.entries(expectedVerification(PLAN)).map(([name, n]) => ({ name, n }));
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
    if (statement === READ_META) return [{ syncId: state.committedSyncId, lastSyncAt: "2026-11-10T05:50:07Z" }];
    if (statement === COUNT_STAMPED) return [{ n: 0 }];
    if (statement === REPORT_NEIGHBOURS) return [{ name: "Pepsi", brand: "Pepsi", categoryId: "soda", w: 0.9001 }];
    if (statement === REPORT_VECTOR) return options.vector ?? [{ name: "Coca-Cola Classic", brand: "Coca-Cola", score: 1 }];
    return [];
  }

  return state;
}

const deps = (f: Fake) => ({
  client: f.client,
  log: (line: string) => void f.logs.push(line),
  sleep: async (ms: number) => void f.sleeps.push(ms),
});

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

const inTx = (f: Fake, n: number): Recorded[] => f.statements.filter((s) => s.where === `tx${n}`);

// ---------------------------------------------------------------------------
// A real run
// ---------------------------------------------------------------------------

test("a real run: upserts, sweep, verification, stamp -- in that order, in ONE transaction -- then commit", async () => {
  const f = fake();
  await runSync(PLAN, { syncId: SYNC_ID, dryRun: false }, deps(f));

  assert.equal(f.begins, 1);
  assert.equal(f.commits, 1);
  assert.equal(f.rollbacks, 0);
  assert.equal(f.committedSyncId, SYNC_ID);

  const sent = inTx(f, 1).map((s) => s.statement);
  const expected = [
    ...writeSteps(PLAN).flatMap((step) => new Array<string>(Math.ceil(step.rows.length / step.batchSize)).fill(step.statement)),
    ...sweepSteps().map((s) => s.statement),
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
  const stamp = inTx(f, 1).find((s) => s.statement === STAMP_META);
  assert.equal(stamp?.parameters.syncId, SYNC_ID);
  assert.equal((stamp?.parameters.counts as Record<string, number>).Bev, PLAN.counts.nodes.Bev);
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
    "nodes.Bev",
    "nodes.User",
    "relationships.RANKED",
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

test("no log line contains a pseudonym or a user id", async () => {
  for (const dryRun of [false, true]) {
    const f = fake();
    await runSync(PLAN, { syncId: SYNC_ID, dryRun }, deps(f));
    const log = f.logs.join("\n");
    assert.ok(log.length > 500);
    for (const user of PLAN.nodes.users) assert.ok(!log.includes(user.pseudonym), "a pseudonym reached the log");
    for (const id of Object.values(FIXTURE_USERS)) assert.ok(!log.includes(id), "a user id reached the log");
    assert.ok(!/[0-9a-f]{64}/.test(log));
  }
});

test("the analytics seam is in place, between the sweep and the verification", () => {
  const source = readFileSync(fileURLToPath(new URL("./sync.ts", import.meta.url)), "utf8");
  const seam = source.indexOf("// --- analytics phase (be/graph-stats) goes here ---");
  assert.ok(seam > 0, "the marker comment is missing");
  assert.ok(source.indexOf("await analyticsPhase(tx, plan, syncId);") > seam);
  assert.ok(source.indexOf("for (const step of sweepSteps())") < seam);
  assert.ok(source.indexOf("tx.run(VERIFY_COUNTS)") > seam);
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
