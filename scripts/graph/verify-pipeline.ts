/**
 * Asserts that the A-16 embedding/edge pipeline is CONFIGURED AND WORKING,
 * rather than assuming it.
 *
 *   npm run graph:verify
 *
 * WHY THIS EXISTS. Every silent failure in this project so far has been
 * SUCCESS-SHAPED -- a green run, a zero exit, nothing in anyone's inbox:
 *
 *   * `graph-keepalive.yml` reported success every day from 2026-10-15 while
 *     doing nothing, because `scripts/graph/keepalive.ts` exits 0 with a
 *     warning when `NEO4J_URI` is unset and nobody ever set it.
 *   * `14_graph_edge_writer.test.sql` was green in CI while `replace_bev_edges`
 *     could not write a row on prod, because `pg_safeupdate` rejects its
 *     unqualified DELETE and is a property of the hosted project rather than of
 *     the schema (20261025000100).
 *   * `bevs_embed_after_insert` was a no-op from the day it shipped, because
 *     the `alter database postgres set bevi.embed_function_url = ...` its own
 *     documentation prescribed is not executable on Supabase -- `postgres` is
 *     not a superuser there. Every write took the "not configured" branch for
 *     days. Nothing failed (20261025000200).
 *
 * None of the three was a bug in a formula. Each was a CONFIGURATION fact that
 * was assumed where it could have been asserted. So this script asserts them,
 * prints a PASS/FAIL line per check, and EXITS NON-ZERO if any check fails --
 * which is the only part that makes it worth running from a schedule.
 *
 * READ-ONLY, POSTGRES ONLY. No Neo4j, no Edge Function invocation, no writes.
 * It makes exactly one call: `public.graph_pipeline_status()`, the service-role
 * diagnostic added in 20261025000400. Two of the four facts are not reachable
 * over PostgREST at any privilege level -- `vault.decrypted_secrets` is
 * readable by its owner only and `pg_trigger` is not in an exposed schema --
 * so a `security definer` owned by `postgres` is the only way to see them, and
 * one RPC is one consistent snapshot rather than four.
 *
 * SECRET VALUES ARE NEVER PRINTED AND NEVER LEAVE THE DATABASE. The RPC
 * returns each Vault secret's NAME and the character LENGTH of its value, and
 * `length > 0` is the whole test. That distinguishes "unset" from "set" and
 * from "set to the empty string" -- which matters, because the trigger treats
 * a blank token as absent (`nullif(s.decrypted_secret, '')`) -- while telling
 * nobody anything about the token.
 *
 * Conventions follow scripts/graph/build-edges.ts: Node 22, run with
 * `--experimental-strip-types`, NO DEPENDENCIES, PostgREST over `fetch` with a
 * service-role key from the environment.
 *
 *   SUPABASE_URL                 the project's REST origin (not a secret)
 *   SUPABASE_SERVICE_ROLE_KEY    the service-role key
 *
 * Neither has a default and neither is optional. A missing one is exit 1 with
 * the name in the message -- never a skip, for the reason in the first bullet
 * above.
 */

import { fileURLToPath } from "node:url";

import { RANKING_VERSION } from "@bevi/ranking";

// ---------------------------------------------------------------------------
// The shape public.graph_pipeline_status() returns
// ---------------------------------------------------------------------------

export interface VaultSecretStatus {
  name: string;
  present: boolean;
  /** Characters in the decrypted value. NEVER the value. */
  length: number;
}

export interface TriggerStatus {
  name: string;
  present: boolean;
  enabled: boolean;
}

export interface PipelineStatus {
  vaultAvailable: boolean;
  vault: VaultSecretStatus[];
  embeddings: { activeBevs: number; embedded: number; missing: number };
  edges: { total: number; misoriented: number; versions: string[] };
  triggers: TriggerStatus[];
}

/** The two Vault secrets the embed trigger reads (20261025000200). */
export const REQUIRED_SECRETS = ["embed_function_url", "embed_webhook_token"] as const;

/** The two triggers on `public.bevs` that queue an embedding (20261023000100). */
export const REQUIRED_TRIGGERS = ["bevs_embed_after_insert", "bevs_embed_after_update"] as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`graph_pipeline_status: ${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asInt(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`graph_pipeline_status: ${where} is not an integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function asBool(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`graph_pipeline_status: ${where} is not a boolean (got ${JSON.stringify(value)})`);
  }
  return value;
}

/**
 * Narrows the RPC's jsonb into `PipelineStatus`, raising on anything missing or
 * mistyped.
 *
 * This is deliberately strict: a renamed key or a null where a count belongs
 * would otherwise read as `undefined`, compare falsy, and produce a PASS or a
 * confidently wrong FAIL. The whole point of this script is that a check it
 * cannot actually perform must not look like a check that passed, so a
 * malformed payload is a thrown error and exit 1.
 */
export function parseStatus(payload: unknown): PipelineStatus {
  const root = asRecord(payload, "payload");

  const vaultAvailable = asBool(root.vault_available, "vault_available");

  const rawVault = root.vault;
  if (!Array.isArray(rawVault)) throw new Error("graph_pipeline_status: vault is not an array");
  const vault = rawVault.map((entry, i) => {
    const row = asRecord(entry, `vault[${i}]`);
    if (typeof row.name !== "string") throw new Error(`graph_pipeline_status: vault[${i}].name is not a string`);
    return {
      name: row.name,
      present: asBool(row.present, `vault[${i}].present`),
      length: asInt(row.length, `vault[${i}].length`),
    };
  });

  const emb = asRecord(root.embeddings, "embeddings");
  const edges = asRecord(root.edges, "edges");

  const rawVersions = edges.versions;
  if (!Array.isArray(rawVersions)) throw new Error("graph_pipeline_status: edges.versions is not an array");
  const versions = rawVersions.map((v, i) => {
    if (typeof v !== "string") throw new Error(`graph_pipeline_status: edges.versions[${i}] is not a string`);
    return v;
  });

  const rawTriggers = root.triggers;
  if (!Array.isArray(rawTriggers)) throw new Error("graph_pipeline_status: triggers is not an array");
  const triggers = rawTriggers.map((entry, i) => {
    const row = asRecord(entry, `triggers[${i}]`);
    if (typeof row.name !== "string") throw new Error(`graph_pipeline_status: triggers[${i}].name is not a string`);
    return {
      name: row.name,
      present: asBool(row.present, `triggers[${i}].present`),
      enabled: asBool(row.enabled, `triggers[${i}].enabled`),
    };
  });

  return {
    vaultAvailable,
    vault,
    embeddings: {
      activeBevs: asInt(emb.active_bevs, "embeddings.active_bevs"),
      embedded: asInt(emb.embedded, "embeddings.embedded"),
      missing: asInt(emb.missing, "embeddings.missing"),
    },
    edges: {
      total: asInt(edges.total, "edges.total"),
      misoriented: asInt(edges.misoriented, "edges.misoriented"),
      versions,
    },
    triggers,
  };
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Turns one snapshot into eight verdicts. Pure, total, and the only place a
 * PASS is decided -- `main` does the printing and the exit code and nothing
 * else, which is what makes the judgement unit-testable without a database.
 *
 * `expectedVersion` is `RANKING_VERSION` from `@bevi/ranking`, passed in rather
 * than imported here so a test can pin both the matching and the stale case.
 * It is not duplicated in SQL for the same reason the weight terms are not: the
 * constant has one home (packages/ranking/src/constants.ts).
 */
export function evaluateStatus(status: PipelineStatus, expectedVersion: string): CheckResult[] {
  const results: CheckResult[] = [];

  // 1-2. The two Vault secrets the embed trigger reads. Name and length only.
  for (const name of REQUIRED_SECRETS) {
    const check = `vault: ${name}`;
    if (!status.vaultAvailable) {
      results.push({
        name: check,
        pass: false,
        detail: "vault.decrypted_secrets does not exist -- supabase_vault is not installed on this database",
      });
      continue;
    }
    const row = status.vault.find((s) => s.name === name);
    if (row === undefined) {
      results.push({ name: check, pass: false, detail: "not reported by graph_pipeline_status()" });
    } else if (!row.present) {
      results.push({
        name: check,
        pass: false,
        detail: "no such Vault secret -- the embed trigger takes its no-op branch on every write",
      });
    } else if (row.length === 0) {
      results.push({
        name: check,
        pass: false,
        detail: "present but EMPTY, which the trigger treats as absent (nullif(secret, ''))",
      });
    } else {
      results.push({ name: check, pass: true, detail: `set, ${plural(row.length, "character", "characters")}` });
    }
  }

  // 3. Every active Bev has an embedding. "No row in bev_embeddings" is the
  //    dirty flag the backfill works from (docs/graph.md), so a non-zero
  //    `missing` is exactly the backfill's work list.
  const emb = status.embeddings;
  if (emb.activeBevs === 0) {
    results.push({
      name: "bev_embeddings: covers every active Bev",
      pass: false,
      detail: "no active Bevs at all, so there is nothing to have embedded -- this is not a working catalog",
    });
  } else if (emb.missing === 0) {
    results.push({
      name: "bev_embeddings: covers every active Bev",
      pass: true,
      detail: `${emb.embedded}/${emb.activeBevs} active Bevs embedded`,
    });
  } else {
    results.push({
      name: "bev_embeddings: covers every active Bev",
      pass: false,
      detail:
        `${plural(emb.missing, "active Bev has", "active Bevs have")} no embedding ` +
        `(${emb.embedded}/${emb.activeBevs}). Run: npm run graph:backfill-embeddings`,
    });
  }

  // 4. bev_edges is non-empty. It was empty on prod for its first six days
  //    while every read RPC quietly returned zero rows and the app handled it.
  const edges = status.edges;
  results.push(
    edges.total > 0
      ? { name: "bev_edges: non-empty", pass: true, detail: `${plural(edges.total, "edge", "edges")}` }
      : {
          name: "bev_edges: non-empty",
          pass: false,
          detail: "empty -- every similarity read returns zero rows. Run: npm run graph:edges",
        }
  );

  // 5. Every row's version is RANKING_VERSION. A formula or constant change
  //    bumps it (packages/ranking/CLAUDE.md), so a mismatch means the stored
  //    generation was computed by a different formula than the app now uses.
  const versionCheck = `bev_edges: every version is ${expectedVersion}`;
  const stale = edges.versions.filter((v) => v !== expectedVersion);
  if (edges.total === 0) {
    results.push({ name: versionCheck, pass: false, detail: "no rows to carry a version" });
  } else if (stale.length === 0) {
    results.push({ name: versionCheck, pass: true, detail: `all rows at ${expectedVersion}` });
  } else {
    results.push({
      name: versionCheck,
      pass: false,
      detail: `stale generation(s) present: ${stale.join(", ")}. Run: npm run graph:edges`,
    });
  }

  // 6. The canonical orientation. A CHECK constraint enforces it, which is
  //    exactly why this is worth confirming rather than trusting: the
  //    constraint is unnamed and a future migration could drop it, and the
  //    orientation is what makes get_bev_similarities a primary-key probe.
  results.push(
    edges.misoriented === 0
      ? {
          name: "bev_edges: src_bev_id < dst_bev_id on every row",
          pass: true,
          detail: "canonical orientation holds",
        }
      : {
          name: "bev_edges: src_bev_id < dst_bev_id on every row",
          pass: false,
          detail: `${plural(edges.misoriented, "row", "rows")} violate it -- the CHECK constraint is missing or disabled`,
        }
  );

  // 7-8. The two triggers exist AND are enabled. `alter table ... disable
  //      trigger` leaves the trigger in place, so "it exists" is not the
  //      question.
  for (const name of REQUIRED_TRIGGERS) {
    const check = `trigger: ${name}`;
    const row = status.triggers.find((t) => t.name === name);
    if (row === undefined || !row.present) {
      results.push({ name: check, pass: false, detail: "does not exist on public.bevs" });
    } else if (!row.enabled) {
      results.push({ name: check, pass: false, detail: "exists but is DISABLED, so no write reaches it" });
    } else {
      results.push({ name: check, pass: true, detail: "exists and is enabled" });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** A fixed-width PASS/FAIL table. Pure, so its alignment is testable too. */
export function formatTable(results: readonly CheckResult[]): string {
  const nameWidth = Math.max(5, ...results.map((r) => r.name.length));
  const lines = [
    `${"CHECK".padEnd(nameWidth)}  RESULT  DETAIL`,
    `${"-".repeat(nameWidth)}  ------  ${"-".repeat(6)}`,
  ];
  for (const r of results) {
    lines.push(`${r.name.padEnd(nameWidth)}  ${r.pass ? "PASS  " : "FAIL  "}  ${r.detail}`);
  }
  return lines.join("\n");
}

/** The one-line verdict under the table. */
export function summarise(results: readonly CheckResult[]): string {
  const failed = results.filter((r) => !r.pass);
  if (failed.length === 0) return `${results.length} checks, all PASS: the pipeline is configured and has run.`;
  return (
    `${failed.length} of ${results.length} checks FAILED: ${failed.map((r) => r.name).join("; ")}.\n` +
    `This exits non-zero on purpose. A green run is the only thing that means "working".`
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function callStatus(url: string, key: string): Promise<unknown> {
  const base = `${url.replace(/\/+$/, "")}/rest/v1`;
  const response = await fetch(`${base}/rpc/graph_pipeline_status`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: "{}",
  });
  const text = await response.text();
  if (!response.ok) {
    // The key travels in a header, not the URL, so the path is safe to print.
    throw new Error(
      `${response.status} ${response.statusText} on /rpc/graph_pipeline_status\n  ${text.slice(0, 600)}\n` +
        `  If this is a 404, migration 20261025000400 has not been pushed to this project.`
    );
  }
  return text === "" ? null : (JSON.parse(text) as unknown);
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    ["SUPABASE_URL", url],
    ["SUPABASE_SERVICE_ROLE_KEY", key],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(", ")}. This check cannot run without them and will not pretend it did.\n` +
        `  Locally: put them in supabase/.env (gitignored).\n` +
        `  In CI: SUPABASE_SERVICE_ROLE_KEY is a repository secret and SUPABASE_URL a repository variable.\n` +
        `  See docs/graph.md.`
    );
  }

  const status = parseStatus(await callStatus(url as string, key as string));
  const results = evaluateStatus(status, RANKING_VERSION);

  console.log(formatTable(results));
  console.log("");
  console.log(summarise(results));

  if (results.some((r) => !r.pass)) {
    // `::error::` so a scheduled Actions run shows it on the run itself, the
    // same annotation build-edges.ts uses for a sanity-report breach.
    for (const r of results.filter((x) => !x.pass)) console.log(`::error::graph:verify ${r.name}: ${r.detail}`);
    process.exit(1);
  }
}

// Only when run directly, so the test file can import the pure helpers without
// reading the environment or opening a connection (the guard build-edges.ts and
// apply-schema.ts use).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`graph:verify failed\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
