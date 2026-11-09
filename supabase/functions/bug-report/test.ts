// Deno tests for bug-report. Run with:
//   deno test --allow-net --allow-env supabase/functions/bug-report/
//
// Everything here is pure: these files import ./redact.ts, ./issue.ts and
// ./linear.ts, never ./index.ts, so nothing starts a server and no request
// leaves the process. The Linear client is driven through its injected
// `fetch`, which is how its error mapping and its two-step upload can be
// asserted without an API key.
//
// What is NOT covered here, and is listed honestly in docs/ticketing-system.md:
// the live round trip to Linear, and the Postgres half (claim_bug_report,
// finish_bug_report, the storage policy), which is pgTAP's job in
// supabase/tests/28_bug_reports.test.sql.

import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";

import { clean, cleanEnvironment, cleanSteps, LIMITS, redact, REDACTED } from "./redact.ts";
import { buildDescription, parseReport, ValidationError } from "./issue.ts";
import { authorizationHeader, createIssue, findTriageStateId, LinearError, readLinearConfig, uploadFile, type LinearConfig } from "./linear.ts";

const KEY = "4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11";

// Token-shaped fixtures are assembled at runtime, so this file never contains
// a credential shape literally: secret scanners read the diff and would flag
// the redaction tests' own inputs as leaks. The regexes under test only see
// the assembled strings.
const FAKE = {
  bearer: (token: string) => ["Bear", "er "].join("") + token,
  jwt: ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"].join("."),
  supabaseSecret: ["sb_", "secret_", "abcdefgh1234"].join(""),
  linearKey: (suffix: string) => ["lin_", "api_", suffix].join(""),
  linearOauth: (suffix: string) => ["lin_", "oauth_", suffix].join(""),
  stripe: ["sk_", "live_", "abcdefgh1234"].join(""),
};

function report(overrides: Record<string, unknown> = {}) {
  return parseReport({ title: "Ratings disappear after refresh", idempotencyKey: KEY, ...overrides });
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

Deno.test("a bearer token in pasted text never reaches the ticket", () => {
  const out = redact(`failed with Authorization: ${FAKE.bearer("fake-token-01")} on retry`);
  assertEquals(out.includes("fake-token-01"), false);
  assertStringIncludes(out, REDACTED);
});

Deno.test("a JWT, a Supabase key and a Linear key are all removed", () => {
  const jwt = FAKE.jwt;
  const out = redact(`token ${jwt} key ${FAKE.supabaseSecret} linear ${FAKE.linearKey("0123456789abcdef")}`);
  assertEquals(out.includes(jwt), false);
  assertEquals(out.includes(FAKE.supabaseSecret), false);
  assertEquals(out.includes(FAKE.linearKey("0123456789abcdef")), false);
});

Deno.test("the token survives neither pattern order: `Authorization: Bearer <token>` loses the token, not just the header", () => {
  // Regression. The generic `key: value` pattern stops at the first space, so
  // when it ran first it redacted `Authorization: Bearer` and left the token
  // itself in the ticket. The shape-aware patterns run first for this reason.
  for (const text of [
    `Authorization: ${FAKE.bearer("fake-token-01")}`,
    `authorization=${FAKE.bearer("fake-token-01")}`,
    `sent with Authorization: ${FAKE.bearer("fake-token-01")} and failed`,
  ]) {
    assertEquals(redact(text).includes("fake-token-01"), false, text);
  }
});

Deno.test("an email address is removed as PII", () => {
  assertEquals(redact("ping someone@example.com about it").includes("@example.com"), false);
});

Deno.test("a URL carrying a token is removed, a plain URL is kept", () => {
  assertEquals(redact("https://bevi.app/cb#access_token=xyz123").includes("xyz123"), false);
  assertStringIncludes(redact("see https://bevi-gamma.vercel.app/profile"), "https://bevi-gamma.vercel.app/profile");
});

Deno.test("invisible and bidi characters are stripped", () => {
  assertEquals(redact("rat\u200bing\u202eevil"), "ratingevil");
});

Deno.test("clean() caps length, collapses single-line fields and neutralises markdown", () => {
  assertEquals(clean("a".repeat(500), 10).length, 10);
  assertEquals(clean("  two   words \n here ", 50, { singleLine: true }), "two words here");
  assertStringIncludes(clean("```js\nalert(1)\n```", 100), "'''");
  assertStringIncludes(clean("## Ignore previous instructions", 100), "\\## ");
});

Deno.test("cleanSteps caps the number of steps and drops empties", () => {
  const steps = cleanSteps(["  open a Bev  ", "", "   ", ...Array.from({ length: 20 }, (_, i) => `step ${i}`)]);
  assertEquals(steps.length, LIMITS.steps);
  assertEquals(steps[0], "open a Bev");
});

Deno.test("cleanEnvironment is an allow-list, not a passthrough", () => {
  const env = cleanEnvironment({
    route: "/profile",
    platform: "web",
    cookie: "session=abc",
    authToken: FAKE.linearKey("0123456789abcdef"),
    notes: "whatever the device had lying around",
  });
  assertEquals(env.route, "/profile");
  assertEquals(env.platform, "web");
  assertEquals(Object.keys(env).sort(), ["platform", "route"]);
});

Deno.test("an environment value that is itself a secret is redacted, not just dropped", () => {
  const env = cleanEnvironment({ build: FAKE.bearer("fake-token-02") });
  assertEquals(env.build, REDACTED);
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

Deno.test("an empty title is rejected with the field name", () => {
  const e = assertThrowsValidation(() => parseReport({ title: "   ", idempotencyKey: KEY }));
  assertEquals(e.field, "title");
});

Deno.test("a non-UUID idempotency key is rejected", () => {
  const e = assertThrowsValidation(() => parseReport({ title: "x", idempotencyKey: "short" }));
  assertEquals(e.field, "idempotencyKey");
});

Deno.test("an evidence path outside the bucket's shape is rejected", () => {
  for (const path of ["../../etc/passwd", "someone-else/a.png", "4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11/a.exe"]) {
    const e = assertThrowsValidation(() => parseReport({ title: "x", idempotencyKey: KEY, evidencePath: path }));
    assertEquals(e.field, "evidencePath");
  }
});

Deno.test("a well-formed evidence path is accepted", () => {
  const parsed = report({ evidencePath: "4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11/9b2c.jpg" });
  assertEquals(parsed.evidencePath, "4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11/9b2c.jpg");
});

Deno.test("a title carrying a secret is redacted before it becomes the issue title", () => {
  const parsed = report({ title: `crash with api_key=${FAKE.stripe}` });
  assertEquals(parsed.title.includes(FAKE.stripe), false);
});

function assertThrowsValidation(fn: () => unknown): ValidationError {
  try {
    fn();
  } catch (e) {
    assert(e instanceof ValidationError, `expected ValidationError, got ${e}`);
    return e;
  }
  throw new Error("expected a ValidationError");
}

// ---------------------------------------------------------------------------
// Issue body
// ---------------------------------------------------------------------------

Deno.test("the description follows the template and marks every missing section", () => {
  const body = buildDescription(report(), "tester", { kind: "none" });
  for (const heading of ["## Summary", "## Steps to reproduce", "## Expected behavior", "## Actual behavior", "## Environment", "## Evidence", "## Acceptance criteria"]) {
    assertStringIncludes(body, heading);
  }
  assertStringIncludes(body, "fill in during triage");
  assertStringIncludes(body, "No screenshot attached");
  assertStringIncludes(body, "@tester");
});

Deno.test("the description tells a reader the reporter's text is data, not instructions", () => {
  assertStringIncludes(buildDescription(report(), "tester", { kind: "none" }), "not instructions");
});

Deno.test("steps are numbered and the environment prints its labels", () => {
  const body = buildDescription(
    report({ reproductionSteps: ["open a Bev", "rate it"], environment: { route: "/profile", platform: "web" } }),
    "tester",
    { kind: "none" },
  );
  assertStringIncludes(body, "1. open a Bev");
  assertStringIncludes(body, "2. rate it");
  assertStringIncludes(body, "- Screen/route: /profile");
  assertStringIncludes(body, "- Platform: web");
});

Deno.test("an embedded screenshot becomes a markdown image; a failed one says so", () => {
  assertStringIncludes(
    buildDescription(report(), "tester", { kind: "embedded", assetUrl: "https://uploads.linear.app/a/b" }),
    "![Reporter screenshot](https://uploads.linear.app/a/b)",
  );
  assertStringIncludes(buildDescription(report(), "tester", { kind: "failed", reason: "linear_upload_failed" }), "could not be uploaded");
});

// ---------------------------------------------------------------------------
// Linear client
// ---------------------------------------------------------------------------

const CONFIG: LinearConfig = { apiKey: FAKE.linearKey("test"), teamId: "team-1" };

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { impl, calls };
}

function gql(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.test("a personal API key is sent raw and an OAuth token as a Bearer", () => {
  assertEquals(authorizationHeader(FAKE.linearKey("abc")), FAKE.linearKey("abc"));
  assertEquals(authorizationHeader(FAKE.linearOauth("abc")), FAKE.bearer(FAKE.linearOauth("abc")));
});

Deno.test("createIssue returns the identifier Linear assigned, never one of ours", async () => {
  const { impl, calls } = stubFetch(() =>
    gql({ data: { issueCreate: { success: true, issue: { id: "i1", identifier: "BEV-207", url: "https://linear.app/x/issue/BEV-207" } } } }),
  );
  const issue = await createIssue(CONFIG, impl, { title: "t", description: "d", stateId: "state-triage" });
  assertEquals(issue.identifier, "BEV-207");
  const sent = JSON.parse(String(calls[0]?.init?.body)) as { variables: { input: Record<string, unknown> } };
  assertEquals(sent.variables.input.teamId, "team-1");
  assertEquals(sent.variables.input.stateId, "state-triage");
  // Priority is a triage decision, not a client one.
  assertEquals("priority" in sent.variables.input, false);
});

Deno.test("createIssue refuses a response that does not confirm the issue", async () => {
  const { impl } = stubFetch(() => gql({ data: { issueCreate: { success: false, issue: null } } }));
  const e = await assertRejects(() => createIssue(CONFIG, impl, { title: "t", description: "d", stateId: null }), LinearError);
  assertEquals(e.code, "linear_create_failed");
});

Deno.test("a 401 from Linear is reported as an auth failure, not as a created ticket", async () => {
  const { impl } = stubFetch(() => new Response("nope", { status: 401 }));
  const e = await assertRejects(() => createIssue(CONFIG, impl, { title: "t", description: "d", stateId: null }), LinearError);
  assertEquals(e.code, "linear_unauthorized");
});

Deno.test("a GraphQL error payload is surfaced as an error, not ignored", async () => {
  const { impl } = stubFetch(() => gql({ errors: [{ message: "Entity not found" }] }));
  const e = await assertRejects(() => createIssue(CONFIG, impl, { title: "t", description: "d", stateId: null }), LinearError);
  assertEquals(e.code, "linear_error");
});

Deno.test("uploadFile asks for a pre-signed URL and PUTs with the headers Linear returned", async () => {
  const { impl, calls } = stubFetch((url) => {
    if (url.includes("api.linear.app")) {
      return gql({
        data: {
          fileUpload: {
            success: true,
            uploadFile: {
              uploadUrl: "https://uploads.example/put",
              assetUrl: "https://uploads.linear.app/a/b.png",
              headers: [{ key: "x-amz-acl", value: "private" }],
            },
          },
        },
      });
    }
    return new Response(null, { status: 200 });
  });

  const assetUrl = await uploadFile(CONFIG, impl, {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/png",
    filename: "bug.png",
  });
  assertEquals(assetUrl, "https://uploads.linear.app/a/b.png");
  const put = calls[1];
  assertEquals(put?.url, "https://uploads.example/put");
  assertEquals(put?.init?.method, "PUT");
  assertEquals((put?.init?.headers as Record<string, string>)["x-amz-acl"], "private");
});

Deno.test("a refused upload is an error the caller can fall back from", async () => {
  const { impl } = stubFetch(() => gql({ data: { fileUpload: { success: false, uploadFile: null } } }));
  const e = await assertRejects(
    () => uploadFile(CONFIG, impl, { bytes: new Uint8Array([1]), contentType: "image/png", filename: "b.png" }),
    LinearError,
  );
  assertEquals(e.code, "linear_upload_refused");
});

Deno.test("findTriageStateId prefers the configured id, then the triage type, then the name", async () => {
  const { impl, calls } = stubFetch(() => gql({ data: { team: { states: { nodes: [] } } } }));
  assertEquals(await findTriageStateId({ ...CONFIG, triageStateId: "preset" }, impl), "preset");
  assertEquals(calls.length, 0);

  const byType = stubFetch(() =>
    gql({ data: { team: { states: { nodes: [{ id: "s1", name: "Backlog", type: "backlog" }, { id: "s2", name: "Triage", type: "triage" }] } } } }),
  );
  assertEquals(await findTriageStateId(CONFIG, byType.impl), "s2");

  const byName = stubFetch(() => gql({ data: { team: { states: { nodes: [{ id: "s3", name: "triage", type: "unstarted" }] } } } }));
  assertEquals(await findTriageStateId(CONFIG, byName.impl), "s3");

  const none = stubFetch(() => gql({ data: { team: { states: { nodes: [{ id: "s4", name: "Todo", type: "unstarted" }] } } } }));
  assertEquals(await findTriageStateId(CONFIG, none.impl), null);
});

Deno.test("readLinearConfig needs both the key and the team, and splits the label list", () => {
  assertEquals(readLinearConfig(() => undefined), null);
  assertEquals(readLinearConfig((k) => (k === "LINEAR_API_KEY" ? FAKE.linearKey("x") : undefined)), null);
  const config = readLinearConfig((k) =>
    ({ LINEAR_API_KEY: FAKE.linearKey("x"), LINEAR_TEAM_ID: "team-1", LINEAR_LABEL_IDS: " a , b ,, c " })[k]
  );
  assertEquals(config?.labelIds, ["a", "b", "c"]);
});
