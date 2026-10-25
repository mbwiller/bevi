/**
 * Applies scripts/graph/schema.cypher to the Neo4j AuraDB Free instance.
 *
 *   npm run graph:schema            # apply
 *   npm run graph:schema -- --dry-run   # print the statements, connect to nothing
 *
 * Node 22, no build step and no dependencies (same convention as
 * scripts/catalog/*): the official driver is not installed, so this talks to
 * Aura's Query API over HTTPS on 443 -- the only port Aura exposes, and the
 * same transport the graph-query Edge Function uses.
 *
 * Credentials come from the environment (supabase/.env locally, GitHub Actions
 * secrets in CI): NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, and optionally
 * NEO4J_DATABASE (the database name from Aura's credentials file, which on a
 * current Free instance is the instance id, not `neo4j`). Never hardcode
 * them; see docs/graph.md.
 *
 * Every statement in the file is idempotent, so re-running is a no-op.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "schema.cypher");

/** Statements are separated by a line containing only `;`. */
export function parseStatements(raw: string): string[] {
  return raw
    .split(/^\s*;\s*$/m)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n")
        .trim()
    )
    .filter((statement) => statement.length > 0);
}

/**
 * Aura's Bolt URI (`neo4j+s://<id>.databases.neo4j.io`) and its Query API
 * endpoint share a host, so the HTTPS URL is derived rather than configured
 * twice.
 */
export function queryApiUrl(uri: string, database: string): string {
  const host = uri.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  return `https://${host}/db/${database}/query/v2`;
}

export async function run(statement: string, url: string, auth: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ statement }),
  });

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}\n  statement: ${statement.split("\n")[0]}\n  body: ${await response.text()}`
    );
  }
  const body = (await response.json()) as { errors?: Array<{ message?: string }> };
  if (body.errors?.length) {
    throw new Error(`${body.errors.map((e) => e.message ?? JSON.stringify(e)).join("; ")}\n  statement: ${statement.split("\n")[0]}`);
  }
}

async function main(): Promise<void> {
  const statements = parseStatements(readFileSync(SCHEMA_PATH, "utf8"));
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    for (const [i, statement] of statements.entries()) {
      console.log(`--- ${i + 1}/${statements.length}\n${statement}`);
    }
    console.log(`\n${statements.length} statement(s); nothing applied (--dry-run).`);
    return;
  }

  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;
  const database = process.env.NEO4J_DATABASE || "neo4j";

  const missing = [
    ["NEO4J_URI", uri],
    ["NEO4J_USERNAME", username],
    ["NEO4J_PASSWORD", password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(", ")}. Put them in supabase/.env (gitignored) or the environment; see docs/graph.md.`
    );
  }

  const url = queryApiUrl(uri!, database);
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  console.log(`applying ${statements.length} statement(s) to ${url}`);
  for (const [i, statement] of statements.entries()) {
    const label = statement.split("\n")[0]!.slice(0, 72);
    await run(statement, url, auth);
    console.log(`  ${i + 1}/${statements.length} ok  ${label}`);
  }
  console.log("schema applied. Re-running is a no-op.");
}

// Only when run directly, so scripts/graph/keepalive.ts can import the helpers.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // A paused instance fails here with a connection error. Resuming is a manual
    // console action (docs/graph.md); nothing in the app degrades meanwhile.
    console.error(`graph:schema failed\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
