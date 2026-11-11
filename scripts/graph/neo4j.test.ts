/**
 * Unit tests for the Query API client (scripts/graph/neo4j.ts) and the paged
 * PostgREST client (scripts/graph/postgrest.ts), with a fake `fetch`. No
 * network, no credentials.
 *
 *   node --experimental-strip-types --test scripts/graph/neo4j.test.ts
 *   npm run test:scripts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Neo4jError, createNeo4jClient, isTransient, missingEnv, neo4jConfigFromEnv, redactor, statementHead } from "./neo4j.ts";
import type { Neo4jConfig } from "./neo4j.ts";
import { PAGE, createPostgrestClient } from "./postgrest.ts";

// Made-up values in the shape of the real ones: the instance id is the host's
// first label, the username AND the database.
const CONFIG: Neo4jConfig = {
  uri: "neo4j+s://0a1b2c3d.databases.neo4j.io",
  username: "0a1b2c3d",
  password: "hunter2-not-a-real-password",
  database: "0a1b2c3d",
};
const BASE = "https://0a1b2c3d.databases.neo4j.io/db/0a1b2c3d/query/v2";
const AUTH = `Basic ${Buffer.from(`${CONFIG.username}:${CONFIG.password}`).toString("base64")}`;
const AFFINITY = "member-7-affinity-token";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string>; text?: string } | Error;

/** A `fetch` that records every call and answers from a script (or a function of the call). */
function fakeFetch(script: Reply[] | ((call: Call, index: number) => Reply)): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const doFetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = typeof script === "function" ? script(call, calls.length - 1) : script[calls.length - 1];
    if (reply === undefined) throw new Error(`fakeFetch: no reply scripted for call ${calls.length}`);
    if (reply instanceof Error) throw reply;
    return new Response(reply.text ?? (reply.body === undefined ? "" : JSON.stringify(reply.body)), {
      status: reply.status,
      headers: reply.headers,
    });
  };
  return { fetch: doFetch as typeof fetch, calls };
}

const begun: Reply = {
  status: 202,
  body: { transaction: { id: "tx-42", expires: "2026-11-10T05:50:30Z" } },
  headers: { "neo4j-cluster-affinity": AFFINITY },
};
const ok = (fields: string[] = [], values: unknown[][] = []): Reply => ({ status: 202, body: { data: { fields, values }, bookmarks: ["b"] } });

async function failure(promise: Promise<unknown>): Promise<Neo4jError> {
  try {
    await promise;
  } catch (error: unknown) {
    assert.ok(error instanceof Neo4jError, `expected a Neo4jError, got ${String(error)}`);
    return error;
  }
  assert.fail("expected the call to throw");
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test("neo4jConfigFromEnv requires all four and names every missing one in ONE error", () => {
  assert.throws(() => neo4jConfigFromEnv({}), /missing NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE\./);
  assert.throws(
    () => neo4jConfigFromEnv({ NEO4J_URI: "neo4j+s://x.databases.neo4j.io", NEO4J_USERNAME: "u", NEO4J_PASSWORD: "  " }),
    /missing NEO4J_PASSWORD, NEO4J_DATABASE\./,
  );
  // No default for the database: `neo4j` is wrong for this instance.
  assert.throws(
    () => neo4jConfigFromEnv({ NEO4J_URI: "neo4j+s://x.databases.neo4j.io", NEO4J_USERNAME: "u", NEO4J_PASSWORD: "p" }),
    /missing NEO4J_DATABASE\./,
  );
  assert.deepEqual(
    neo4jConfigFromEnv({ NEO4J_URI: CONFIG.uri, NEO4J_USERNAME: CONFIG.username, NEO4J_PASSWORD: CONFIG.password, NEO4J_DATABASE: CONFIG.database }),
    CONFIG,
  );
  assert.deepEqual(missingEnv({ A: "1", B: "" }, ["A", "B", "C"]), ["B", "C"]);
});

// ---------------------------------------------------------------------------
// The implicit transaction
// ---------------------------------------------------------------------------

test("query posts the statement and parameters and returns rows as objects", async () => {
  const { fetch, calls } = fakeFetch([ok(["name", "n"], [["a", 1], ["b", 2]])]);
  const rows = await createNeo4jClient(CONFIG, { fetch }).query("MATCH (n) RETURN n.name AS name, 1 AS n", { limit: 5 });
  assert.deepEqual(rows, [
    { name: "a", n: 1 },
    { name: "b", n: 2 },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, BASE);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.headers.Authorization, AUTH);
  assert.deepEqual(calls[0]?.body, { statement: "MATCH (n) RETURN n.name AS name, 1 AS n", parameters: { limit: 5 } });
  assert.equal(calls[0]?.headers["neo4j-cluster-affinity"], undefined);
});

test("a statement with no result rows is an empty array", async () => {
  const { fetch } = fakeFetch([{ status: 202, body: { data: { fields: [], values: [] } } }]);
  assert.deepEqual(await createNeo4jClient(CONFIG, { fetch }).query("MERGE (m:Meta)"), []);
});

// ---------------------------------------------------------------------------
// The explicit transaction
// ---------------------------------------------------------------------------

test("begin, run, run, commit: the happy path", async () => {
  const { fetch, calls } = fakeFetch([begun, ok(["n"], [[1]]), ok(), { status: 202, body: { bookmarks: ["b2"] } }]);
  const tx = await createNeo4jClient(CONFIG, { fetch }).beginTransaction();
  assert.deepEqual(await tx.run("RETURN 1 AS n"), [{ n: 1 }]);
  assert.deepEqual(await tx.run("UNWIND $rows AS row RETURN row", { rows: [1] }), []);
  await tx.commit();

  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url.slice(BASE.length)}`),
    ["POST /tx", "POST /tx/tx-42", "POST /tx/tx-42", "POST /tx/tx-42/commit"],
  );
  assert.deepEqual(calls[2]?.body, { statement: "UNWIND $rows AS row RETURN row", parameters: { rows: [1] } });
});

test("the cluster-affinity header from BEGIN is echoed on every later request", async () => {
  const { fetch, calls } = fakeFetch([begun, ok(), ok(), { status: 202, body: {} }]);
  const tx = await createNeo4jClient(CONFIG, { fetch }).beginTransaction();
  await tx.run("RETURN 1");
  await tx.run("RETURN 2");
  await tx.commit();
  assert.equal(calls[0]?.headers["neo4j-cluster-affinity"], undefined, "BEGIN has nothing to echo yet");
  for (const call of calls.slice(1)) assert.equal(call.headers["neo4j-cluster-affinity"], AFFINITY, call.url);
});

test("rollback issues the DELETE, with the affinity header, and only once", async () => {
  const { fetch, calls } = fakeFetch([begun, ok(), { status: 200, body: {} }]);
  const tx = await createNeo4jClient(CONFIG, { fetch }).beginTransaction();
  await tx.run("RETURN 1");
  await tx.rollback();
  await tx.rollback(); // already closed: no second request
  assert.equal(calls.length, 3);
  assert.equal(calls[2]?.method, "DELETE");
  assert.equal(calls[2]?.url, `${BASE}/tx/tx-42`);
  assert.equal(calls[2]?.headers["neo4j-cluster-affinity"], AFFINITY);
  assert.equal(calls[2]?.body, undefined);
});

test("rollback after a commit sends nothing", async () => {
  const { fetch, calls } = fakeFetch([begun, { status: 202, body: {} }]);
  const tx = await createNeo4jClient(CONFIG, { fetch }).beginTransaction();
  await tx.commit();
  await tx.rollback();
  assert.equal(calls.length, 2);
});

test("a BEGIN that returns no transaction id is an error", async () => {
  const { fetch } = fakeFetch([{ status: 202, body: {} }]);
  const error = await failure(createNeo4jClient(CONFIG, { fetch }).beginTransaction());
  assert.match(error.message, /opened no transaction/);
  assert.equal(error.transient, false);
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

test("an errors array under a 202 throws, with the Neo4j code and the statement's first line", async () => {
  const { fetch } = fakeFetch([
    begun,
    { status: 202, body: { errors: [{ code: "Neo.ClientError.Statement.SyntaxError", message: "Invalid input 'MERG'" }] } },
  ]);
  const tx = await createNeo4jClient(CONFIG, { fetch }).beginTransaction();
  const error = await failure(tx.run("\nUNWIND $rows AS row\nMERG (b:Bev { id: row.id })", { rows: [] }));
  assert.equal(error.code, "Neo.ClientError.Statement.SyntaxError");
  assert.equal(error.status, 202);
  assert.equal(error.statement, "UNWIND $rows AS row");
  assert.equal(error.transient, false);
  assert.match(error.message, /Neo\.ClientError\.Statement\.SyntaxError/);
  assert.match(error.message, /statement: UNWIND \$rows AS row/);
  assert.match(error.message, /Invalid input 'MERG'/);
  assert.equal(isTransient(error), false);
});

test("5xx and 429 are transient; 4xx is not", async () => {
  for (const [status, transient] of [
    [500, true],
    [502, true],
    [503, true],
    [504, true],
    [429, true],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
  ] as const) {
    const { fetch } = fakeFetch([{ status, text: "upstream said no" }]);
    const error = await failure(createNeo4jClient(CONFIG, { fetch }).query("RETURN 1"));
    assert.equal(error.transient, transient, `HTTP ${status}`);
    assert.equal(error.status, status);
    assert.equal(error.code, null);
  }
});

test("a Neo.TransientError code is transient whatever the status; a ClientError is not", async () => {
  for (const [code, transient] of [
    ["Neo.TransientError.Transaction.DeadlockDetected", true],
    ["Neo.TransientError.General.OutOfMemoryError", true],
    ["Neo.ClientError.Transaction.TransactionNotFound", true],
    ["Neo.ClientError.Transaction.TransactionTimedOut", true],
    ["Neo.ClientError.Schema.ConstraintValidationFailed", false],
    ["Neo.ClientError.Statement.TypeError", false],
    ["Neo.ClientError.Security.Unauthorized", false],
  ] as const) {
    const { fetch } = fakeFetch([{ status: 400, body: { errors: [{ code, message: "m" }] } }]);
    const error = await failure(createNeo4jClient(CONFIG, { fetch }).query("RETURN 1"));
    assert.equal(error.transient, transient, code);
    assert.equal(error.code, code);
  }
});

test("an unknown transaction (404 on a transaction path) is transient", async () => {
  const { fetch } = fakeFetch([begun, { status: 404, text: "" }]);
  const tx = await createNeo4jClient(CONFIG, { fetch }).beginTransaction();
  const error = await failure(tx.run("RETURN 1"));
  assert.equal(error.transient, true);
  assert.equal(error.status, 404);
});

test("a network failure is transient and says nothing about where it was going", async () => {
  const refused = new TypeError("fetch failed", {
    cause: Object.assign(new Error(`getaddrinfo ENOTFOUND 0a1b2c3d.databases.neo4j.io`), { code: "ENOTFOUND" }),
  });
  const { fetch } = fakeFetch([refused]);
  const error = await failure(createNeo4jClient(CONFIG, { fetch }).query("RETURN 1 AS probe"));
  assert.equal(error.transient, true);
  assert.equal(error.status, null);
  assert.match(error.message, /network failure \(ENOTFOUND\)/);
  assert.match(error.message, /statement: RETURN 1 AS probe/);
  assert.ok(!error.message.includes("0a1b2c3d"));
});

test("a timeout is transient", async () => {
  const { fetch } = fakeFetch([Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })]);
  const error = await failure(createNeo4jClient(CONFIG, { fetch, timeoutMs: 1234 }).query("RETURN 1"));
  assert.equal(error.transient, true);
  assert.match(error.message, /no response within 1234 ms/);
});

test("every request carries an abort signal", async () => {
  const signals: unknown[] = [];
  const doFetch = (async (_input: unknown, init?: RequestInit) => {
    signals.push(init?.signal);
    return new Response(JSON.stringify({ data: { fields: [], values: [] } }), { status: 202 });
  }) as typeof fetch;
  await createNeo4jClient(CONFIG, { fetch: doFetch }).query("RETURN 1");
  assert.ok(signals[0] instanceof AbortSignal);
});

test("no error message contains the password, the username, the database, the host or the auth header", async () => {
  const echo =
    `Database '${CONFIG.database}' on ${CONFIG.uri} refused user ${CONFIG.username} with password ${CONFIG.password}; ` +
    `Authorization: ${AUTH}; see https://0a1b2c3d.databases.neo4j.io/db/0a1b2c3d/query/v2`;
  const replies: Reply[] = [
    { status: 401, body: { errors: [{ code: "Neo.ClientError.Security.Unauthorized", message: echo }] } },
    { status: 202, body: { errors: [{ code: "Neo.ClientError.Statement.SyntaxError", message: echo }] } },
    { status: 503, text: echo },
    new TypeError("fetch failed", { cause: Object.assign(new Error(echo), { code: "ECONNRESET" }) }),
    Object.assign(new Error(echo), { name: "TimeoutError" }),
  ];
  for (const reply of replies) {
    const { fetch } = fakeFetch([reply]);
    const error = await failure(createNeo4jClient(CONFIG, { fetch }).query("MATCH (n) RETURN n"));
    const text = `${error.message}\n${error.stack ?? ""}\n${JSON.stringify(error)}\n${error.statement}`;
    for (const secret of [CONFIG.password, CONFIG.username, CONFIG.database, "databases.neo4j.io", AUTH, AUTH.slice(6), "query/v2"]) {
      assert.ok(!text.includes(secret), `the error leaks ${secret.slice(0, 6)}...`);
    }
  }
});

test("a server message quoting a pseudonym is blanked", async () => {
  const pseudonym = "ab".repeat(32);
  const { fetch } = fakeFetch([
    {
      status: 400,
      body: {
        errors: [
          {
            code: "Neo.ClientError.Schema.ConstraintValidationFailed",
            message: `Node(12) already exists with label \`User\` and property \`pseudonym\` = '${pseudonym}'`,
          },
        ],
      },
    },
  ]);
  const error = await failure(createNeo4jClient(CONFIG, { fetch }).query("MERGE (u:User)"));
  assert.ok(!error.message.includes(pseudonym));
  assert.match(error.message, /`pseudonym` = '\[redacted\]'/);
});

test("redactor blanks every secret and leaves the rest readable", () => {
  const redact = redactor(CONFIG);
  assert.equal(redact("Invalid input 'MERG': expected MERGE"), "Invalid input 'MERG': expected MERGE");
  assert.equal(redact(`db ${CONFIG.database} at ${CONFIG.uri}`), "db [redacted] at [redacted]");
  assert.ok(!redact(`pw=${CONFIG.password}`).includes(CONFIG.password));
});

test("statementHead is the first non-blank line, trimmed and bounded", () => {
  assert.equal(statementHead("\n  UNWIND $rows AS row\n  MERGE (b:Bev)"), "UNWIND $rows AS row");
  assert.equal(statementHead("RETURN 1"), "RETURN 1");
  assert.equal(statementHead(`MATCH ${"x".repeat(500)}`).length, 120);
});

// ---------------------------------------------------------------------------
// PostgREST paging
// ---------------------------------------------------------------------------

test("select pages at 1000 with limit and offset until a short page", async () => {
  const total = 2 * PAGE + 17;
  const { fetch, calls } = fakeFetch((call) => {
    const url = new URL(call.url);
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const rows = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ n: offset + i }));
    return { status: 200, body: rows };
  });
  const db = createPostgrestClient("https://project.supabase.co/", "service-key", fetch);
  const rows = await db.select<{ n: number }>("/bev_edges?select=src_bev_id&order=src_bev_id,dst_bev_id");
  assert.equal(rows.length, total);
  assert.deepEqual(rows.map((r) => r.n), Array.from({ length: total }, (_, i) => i));
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.url, "https://project.supabase.co/rest/v1/bev_edges?select=src_bev_id&order=src_bev_id,dst_bev_id&limit=1000&offset=0");
  assert.ok(calls[2]?.url.endsWith("&limit=1000&offset=2000"));
  assert.equal(calls[0]?.headers.apikey, "service-key");
  assert.equal(calls[0]?.headers.Authorization, "Bearer service-key");
});

test("a table of exactly one page costs a second, empty request rather than a guess", async () => {
  const { fetch, calls } = fakeFetch((call) => {
    const offset = Number(new URL(call.url).searchParams.get("offset"));
    return { status: 200, body: offset === 0 ? Array.from({ length: PAGE }, (_, i) => i) : [] };
  });
  const rows = await createPostgrestClient("https://p.supabase.co", "k", fetch).select<number>("/bevs?order=id");
  assert.equal(rows.length, PAGE);
  assert.equal(calls.length, 2);
});

test("a PostgREST error names the path and never the key", async () => {
  const { fetch } = fakeFetch([{ status: 401, text: '{"message":"Invalid API key"}' }]);
  await assert.rejects(createPostgrestClient("https://p.supabase.co", "super-secret-key", fetch).select("/rankings?order=user_id"), (error: Error) => {
    assert.match(error.message, /^401 .* on \/rankings\?order=user_id&limit=1000&offset=0/);
    assert.ok(!error.message.includes("super-secret-key"));
    return true;
  });
});

test("a PostgREST error body that quotes a user id or a pseudonym is blanked before it can reach a public log", async () => {
  const userId = "5b2f6a1e-9c3d-4e7f-8a1b-2c3d4e5f6a7b";
  const pseudonym = "ab".repeat(32);
  const body = JSON.stringify({ code: "23505", message: "duplicate key", details: `Key (user_id)=(${userId}) already exists; ${pseudonym}` });
  const { fetch } = fakeFetch([{ status: 409, text: body }]);
  await assert.rejects(createPostgrestClient("https://p.supabase.co", "k", fetch).select("/rankings?order=user_id"), (error: Error) => {
    assert.ok(!error.message.includes(userId));
    assert.ok(!error.message.includes(pseudonym));
    assert.match(error.message, /Key \(user_id\)=\(<uuid>\) already exists; <hex>/);
    return true;
  });
});

test("rpc posts a body; rpcRows pages it", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 200, body: 7 },
    { status: 200, body: [{ a: 1 }] },
  ]);
  const db = createPostgrestClient("https://p.supabase.co", "k", fetch);
  assert.equal(await db.rpc<number>("replace_bev_edges", { p_rows: [] }), 7);
  assert.deepEqual(await db.rpcRows("ranking_z_inputs", {}), [{ a: 1 }]);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "https://p.supabase.co/rest/v1/rpc/replace_bev_edges");
  assert.equal(calls[1]?.url, "https://p.supabase.co/rest/v1/rpc/ranking_z_inputs?limit=1000&offset=0");
});
