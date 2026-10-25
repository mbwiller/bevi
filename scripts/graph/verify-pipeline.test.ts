/**
 * Unit tests for the pure half of scripts/graph/verify-pipeline.ts.
 *
 *   npm run test:scripts
 *
 * node:test and node:assert under `--experimental-strip-types`, because
 * scripts/ is not an npm workspace and has no test dependency of its own
 * (edges-core.test.ts and apply-schema.test.ts are written the same way).
 *
 * What is under test is the JUDGEMENT, not the plumbing: `parseStatus` narrows
 * the RPC's jsonb and `evaluateStatus` turns one snapshot into eight verdicts.
 * Those two functions are where a success-shaped failure would hide -- a check
 * that silently passes because a key was renamed, or a FAIL that never reaches
 * the exit code -- and they are the half a database cannot be borrowed to
 * check. `main`, the `fetch` call and the exit code are deliberately not
 * imported here; the module guards its own `main()` on `process.argv[1]`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { RANKING_VERSION } from "@bevi/ranking";

import {
  REQUIRED_SECRETS,
  REQUIRED_TRIGGERS,
  evaluateStatus,
  formatTable,
  parseStatus,
  summarise,
} from "./verify-pipeline.ts";
import type { CheckResult, PipelineStatus } from "./verify-pipeline.ts";

/** A snapshot in which every check passes. Each test spoils exactly one thing. */
function healthyPayload(): Record<string, unknown> {
  return {
    vault_available: true,
    vault: [
      { name: "embed_function_url", present: true, length: 57 },
      { name: "embed_webhook_token", present: true, length: 43 },
    ],
    embeddings: { active_bevs: 383, embedded: 383, missing: 0 },
    edges: { total: 4669, misoriented: 0, versions: [RANKING_VERSION] },
    triggers: [
      { name: "bevs_embed_after_insert", present: true, enabled: true },
      { name: "bevs_embed_after_update", present: true, enabled: true },
    ],
  };
}

const healthy = (): PipelineStatus => parseStatus(healthyPayload());

function find(results: readonly CheckResult[], needle: string): CheckResult {
  const hit = results.find((r) => r.name.includes(needle));
  assert.ok(hit !== undefined, `no check matching ${needle} in ${results.map((r) => r.name).join(" | ")}`);
  return hit;
}

const failedNames = (results: readonly CheckResult[]) => results.filter((r) => !r.pass).map((r) => r.name);

// ---------------------------------------------------------------------------
// parseStatus
// ---------------------------------------------------------------------------

test("parseStatus maps the RPC payload onto PipelineStatus", () => {
  const status = healthy();
  assert.equal(status.vaultAvailable, true);
  assert.deepEqual(
    status.vault.map((s) => s.name),
    [...REQUIRED_SECRETS]
  );
  assert.equal(status.embeddings.activeBevs, 383);
  assert.equal(status.embeddings.missing, 0);
  assert.equal(status.edges.total, 4669);
  assert.deepEqual(status.edges.versions, [RANKING_VERSION]);
  assert.deepEqual(
    status.triggers.map((t) => t.name),
    [...REQUIRED_TRIGGERS]
  );
});

test("parseStatus throws rather than letting a renamed or null field read as undefined", () => {
  // The whole point of the script is that a check it could not perform must
  // not look like a check that passed, so each of these is an exit 1.
  const cases: Array<[string, (p: Record<string, unknown>) => void]> = [
    ["embeddings.missing null", (p) => void ((p.embeddings as Record<string, unknown>).missing = null)],
    ["embeddings renamed", (p) => void (p.embeddings = { active: 1, embedded: 1, missing: 0 })],
    ["edges.total a string", (p) => void ((p.edges as Record<string, unknown>).total = "4669")],
    ["edges.versions a scalar", (p) => void ((p.edges as Record<string, unknown>).versions = RANKING_VERSION)],
    ["vault not an array", (p) => void (p.vault = {})],
    ["vault_available missing", (p) => void delete p.vault_available],
    ["triggers missing", (p) => void delete p.triggers],
    ["a trigger row without a name", (p) => void (p.triggers = [{ present: true, enabled: true }])],
  ];
  for (const [label, spoil] of cases) {
    const payload = healthyPayload();
    spoil(payload);
    assert.throws(() => parseStatus(payload), /graph_pipeline_status/, label);
  }
  assert.throws(() => parseStatus(null), /not an object/);
  assert.throws(() => parseStatus([]), /not an object/);
});

// ---------------------------------------------------------------------------
// evaluateStatus: the happy path
// ---------------------------------------------------------------------------

test("evaluateStatus passes all eight checks on a healthy pipeline", () => {
  const results = evaluateStatus(healthy(), RANKING_VERSION);
  assert.equal(results.length, 8);
  assert.deepEqual(failedNames(results), []);
});

test("a passing Vault check prints the length and never the value", () => {
  const results = evaluateStatus(healthy(), RANKING_VERSION);
  for (const name of REQUIRED_SECRETS) {
    const check = find(results, name);
    assert.ok(check.pass);
    // The name and a character count are all that may appear.
    assert.match(check.detail, /^set, \d+ characters$/);
  }
});

// ---------------------------------------------------------------------------
// evaluateStatus: each failure mode, one at a time
// ---------------------------------------------------------------------------

test("a missing Vault secret fails, and says the trigger is a no-op", () => {
  const status = healthy();
  status.vault = [
    { name: "embed_function_url", present: false, length: 0 },
    { name: "embed_webhook_token", present: true, length: 43 },
  ];
  const results = evaluateStatus(status, RANKING_VERSION);
  const check = find(results, "embed_function_url");
  assert.equal(check.pass, false);
  assert.match(check.detail, /no-op/);
  assert.ok(find(results, "embed_webhook_token").pass);
});

test("a Vault secret set to the empty string fails: the trigger treats blank as absent", () => {
  // 20261025000200 reads `nullif(s.decrypted_secret, '')`, so a half-configured
  // pair cannot start sending unauthenticated requests -- it just does nothing,
  // which is precisely the state this script exists to surface.
  const status = healthy();
  status.vault = [
    { name: "embed_function_url", present: true, length: 57 },
    { name: "embed_webhook_token", present: true, length: 0 },
  ];
  const results = evaluateStatus(status, RANKING_VERSION);
  const check = find(results, "embed_webhook_token");
  assert.equal(check.pass, false);
  assert.match(check.detail, /EMPTY/);
});

test("no vault at all fails both secret checks without pretending to have looked", () => {
  const status = healthy();
  status.vaultAvailable = false;
  status.vault = [];
  const results = evaluateStatus(status, RANKING_VERSION);
  for (const name of REQUIRED_SECRETS) {
    const check = find(results, name);
    assert.equal(check.pass, false);
    assert.match(check.detail, /supabase_vault is not installed/);
  }
});

test("a secret the RPC does not report is a failure, not a silent pass", () => {
  const status = healthy();
  status.vault = [{ name: "embed_function_url", present: true, length: 57 }];
  const results = evaluateStatus(status, RANKING_VERSION);
  assert.deepEqual(failedNames(results), ["vault: embed_webhook_token"]);
  assert.match(find(results, "embed_webhook_token").detail, /not reported/);
});

test("missing embeddings fail and the detail names the count and the fix", () => {
  const status = healthy();
  status.embeddings = { activeBevs: 383, embedded: 380, missing: 3 };
  const results = evaluateStatus(status, RANKING_VERSION);
  const check = find(results, "bev_embeddings");
  assert.equal(check.pass, false);
  assert.match(check.detail, /3 active Bevs have no embedding/);
  assert.match(check.detail, /380\/383/);
  assert.match(check.detail, /graph:backfill-embeddings/);
});

test("exactly one missing embedding reads as singular", () => {
  const status = healthy();
  status.embeddings = { activeBevs: 383, embedded: 382, missing: 1 };
  const check = find(evaluateStatus(status, RANKING_VERSION), "bev_embeddings");
  assert.match(check.detail, /1 active Bev has no embedding/);
});

test("zero active Bevs fails rather than passing vacuously", () => {
  // 0/0 embedded is "nothing missing" arithmetically, and would otherwise be
  // the single most success-shaped answer this script could give.
  const status = healthy();
  status.embeddings = { activeBevs: 0, embedded: 0, missing: 0 };
  const check = find(evaluateStatus(status, RANKING_VERSION), "bev_embeddings");
  assert.equal(check.pass, false);
  assert.match(check.detail, /no active Bevs/);
});

test("an empty bev_edges fails both the non-empty check and the version check", () => {
  // Prod's actual state for the first six days after 20261019000500: the table
  // was empty and every read RPC returned zero rows without an error.
  const status = healthy();
  status.edges = { total: 0, misoriented: 0, versions: [] };
  const results = evaluateStatus(status, RANKING_VERSION);
  assert.deepEqual(failedNames(results), [
    "bev_edges: non-empty",
    `bev_edges: every version is ${RANKING_VERSION}`,
  ]);
  assert.match(find(results, "non-empty").detail, /graph:edges/);
});

test("a stale version fails and names the generation found", () => {
  const status = healthy();
  status.edges = { total: 4669, misoriented: 0, versions: ["1.1.0"] };
  const results = evaluateStatus(status, RANKING_VERSION);
  const check = find(results, "every version is");
  assert.equal(check.pass, false);
  assert.match(check.detail, /1\.1\.0/);
  assert.ok(find(results, "non-empty").pass);
});

test("a mixed-version table fails even though the current version is present", () => {
  const status = healthy();
  status.edges = { total: 4669, misoriented: 0, versions: [RANKING_VERSION, "1.1.0"] };
  const check = find(evaluateStatus(status, RANKING_VERSION), "every version is");
  assert.equal(check.pass, false);
  assert.match(check.detail, /1\.1\.0/);
});

test("the expected version is the caller's, so a bumped RANKING_VERSION invalidates the table", () => {
  // The constant lives in packages/ranking/src/constants.ts and nowhere else;
  // this pins that the script compares against whatever the bundle says.
  const status = healthy();
  const check = find(evaluateStatus(status, "9.9.9"), "every version is");
  assert.equal(check.pass, false);
  assert.match(check.name, /9\.9\.9/);
  assert.match(check.detail, new RegExp(RANKING_VERSION.replace(/\./g, "\\.")));
});

test("a misoriented row fails the orientation check", () => {
  const status = healthy();
  status.edges = { total: 4669, misoriented: 2, versions: [RANKING_VERSION] };
  const results = evaluateStatus(status, RANKING_VERSION);
  const check = find(results, "src_bev_id < dst_bev_id");
  assert.equal(check.pass, false);
  assert.match(check.detail, /2 rows violate it/);
  assert.deepEqual(failedNames(results), ["bev_edges: src_bev_id < dst_bev_id on every row"]);
});

test("a missing trigger and a disabled trigger are different failures", () => {
  const status = healthy();
  status.triggers = [
    { name: "bevs_embed_after_insert", present: false, enabled: false },
    { name: "bevs_embed_after_update", present: true, enabled: false },
  ];
  const results = evaluateStatus(status, RANKING_VERSION);
  assert.match(find(results, "bevs_embed_after_insert").detail, /does not exist/);
  assert.match(find(results, "bevs_embed_after_update").detail, /DISABLED/);
  assert.equal(failedNames(results).length, 2);
});

test("every check is independent: a wholly unconfigured project fails seven of eight", () => {
  // The eighth is the orientation check, which an EMPTY bev_edges satisfies
  // vacuously -- `no row violates src < dst` is true of no rows. That is the
  // honest verdict for that one property, and the run still exits non-zero
  // because the other seven do not pass. Pinned so a future edit cannot make
  // the orientation check "helpfully" fail on an empty table and double-count
  // the same problem the non-empty check already reports.
  const results = evaluateStatus(
    {
      vaultAvailable: false,
      vault: [],
      embeddings: { activeBevs: 383, embedded: 0, missing: 383 },
      edges: { total: 0, misoriented: 0, versions: [] },
      triggers: [],
    },
    RANKING_VERSION
  );
  assert.equal(results.length, 8);
  assert.equal(failedNames(results).length, 7);
  assert.ok(find(results, "src_bev_id < dst_bev_id").pass);
});

test("and a populated-but-wrong project can fail the other seven", () => {
  // The complement of the case above: bev_edges has rows, so the non-empty
  // check is the only one that passes.
  const results = evaluateStatus(
    {
      vaultAvailable: true,
      vault: [
        { name: "embed_function_url", present: true, length: 0 },
        { name: "embed_webhook_token", present: false, length: 0 },
      ],
      embeddings: { activeBevs: 383, embedded: 1, missing: 382 },
      edges: { total: 12, misoriented: 12, versions: ["0.9.0"] },
      triggers: [
        { name: "bevs_embed_after_insert", present: true, enabled: false },
        { name: "bevs_embed_after_update", present: false, enabled: false },
      ],
    },
    RANKING_VERSION
  );
  assert.equal(failedNames(results).length, 7);
  assert.ok(find(results, "non-empty").pass);
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

test("formatTable aligns the RESULT column and marks each row PASS or FAIL", () => {
  const results: CheckResult[] = [
    { name: "short", pass: true, detail: "fine" },
    { name: "a considerably longer check name", pass: false, detail: "broken" },
  ];
  const lines = formatTable(results).split("\n");
  assert.equal(lines.length, 4); // header, rule, two rows
  assert.ok(lines[0].startsWith("CHECK"));
  const column = lines.map((l) => l.indexOf("  ") >= 0);
  assert.ok(column.every(Boolean));
  // Every data row starts its verdict at the same offset as the header's.
  const offset = lines[0].indexOf("RESULT");
  assert.equal(lines[2].indexOf("PASS"), offset);
  assert.equal(lines[3].indexOf("FAIL"), offset);
  assert.match(lines[3], /broken$/);
});

test("summarise distinguishes all-pass from a named list of failures", () => {
  const ok = summarise(evaluateStatus(healthy(), RANKING_VERSION));
  assert.match(ok, /8 checks, all PASS/);

  const status = healthy();
  status.edges = { total: 0, misoriented: 0, versions: [] };
  const bad = summarise(evaluateStatus(status, RANKING_VERSION));
  assert.match(bad, /2 of 8 checks FAILED/);
  assert.match(bad, /bev_edges: non-empty/);
  assert.match(bad, /exits non-zero/);
});
