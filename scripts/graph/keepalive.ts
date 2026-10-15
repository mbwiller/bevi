/**
 * Keeps the Aura Free instance from auto-pausing (72 hours without activity,
 * no auto-resume, deleted after 30 days paused -- docs/graph.md).
 *
 *   npm run graph:keepalive
 *
 * One idempotent write: MERGE the (:Meta) singleton and stamp lastKeepAliveAt.
 * Run daily by .github/workflows/graph-keepalive.yml. This is the bridge until
 * A-16's nightly sync exists; that sync touches (:Meta).lastSyncAt as part of
 * real work, and when it lands this script and its workflow should be deleted.
 *
 * Credentials: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD (and optionally
 * NEO4J_DATABASE) from the environment. If NEO4J_URI is unset it exits 0 with a
 * warning, so the schedule stays green until the secrets are added.
 */

import { queryApiUrl, run } from "./apply-schema.ts";

const STATEMENT = "MERGE (m:Meta { key: 'singleton' }) SET m.lastKeepAliveAt = datetime()";

const uri = process.env.NEO4J_URI;
const username = process.env.NEO4J_USERNAME;
const password = process.env.NEO4J_PASSWORD;
const database = process.env.NEO4J_DATABASE || "neo4j";

if (!uri) {
  console.log("::warning::NEO4J_URI is not set; graph keep-alive skipped. See docs/graph.md.");
  process.exit(0);
}
if (!username || !password) {
  console.error("graph:keepalive failed: NEO4J_USERNAME and NEO4J_PASSWORD are required when NEO4J_URI is set.");
  process.exit(1);
}

try {
  await run(STATEMENT, queryApiUrl(uri, database), `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`);
  console.log("graph keep-alive ok: (:Meta).lastKeepAliveAt updated.");
} catch (error: unknown) {
  // Most likely already paused: resume it in the Aura console (docs/graph.md).
  console.error(`graph:keepalive failed\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
