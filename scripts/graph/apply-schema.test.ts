/**
 * Unit tests for the pure halves of scripts/graph/apply-schema.ts. No network
 * and no credentials: importing the module only defines the helpers, because
 * main() runs behind the `process.argv[1]` guard.
 *
 *   npm run test:scripts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseStatements, queryApiUrl } from "./apply-schema.ts";

test("queryApiUrl strips an Aura Bolt scheme that contains a digit", () => {
  // Regression: a `[a-z+]+` scheme class does not match `neo4j+s`, so the host
  // survived as `neo4j+s:` and every call failed with `fetch failed`.
  assert.equal(
    queryApiUrl("neo4j+s://3f06998c.databases.neo4j.io", "3f06998c"),
    "https://3f06998c.databases.neo4j.io/db/3f06998c/query/v2"
  );
});

test("queryApiUrl accepts the other schemes Aura hands out", () => {
  for (const scheme of ["neo4j", "neo4j+s", "neo4j+ssc", "bolt", "bolt+s", "bolt+ssc"]) {
    assert.equal(
      queryApiUrl(`${scheme}://abc12345.databases.neo4j.io`, "neo4j"),
      "https://abc12345.databases.neo4j.io/db/neo4j/query/v2",
      scheme
    );
  }
});

test("queryApiUrl drops a port and a path", () => {
  assert.equal(
    queryApiUrl("neo4j+s://abc12345.databases.neo4j.io:7687/ignored", "neo4j"),
    "https://abc12345.databases.neo4j.io/db/neo4j/query/v2"
  );
});

test("parseStatements splits on a lone semicolon and drops comments", () => {
  const statements = parseStatements(
    ["// leading comment", "CREATE CONSTRAINT a", ";", "  // indented comment", "CREATE INDEX b", ";", ""].join("\n")
  );
  assert.deepEqual(statements, ["CREATE CONSTRAINT a", "CREATE INDEX b"]);
});

test("parseStatements keeps a semicolon that shares a line with Cypher", () => {
  assert.deepEqual(parseStatements("CREATE INDEX b;\n"), ["CREATE INDEX b;"]);
});
