// Deno tests for bug-report. Run with:
//   deno test --allow-net --allow-env supabase/functions/bug-report/
//
// Everything here is pure: these files import ./redact.ts, ./issue.ts,
// ./linear.ts and ./ledger.ts, never ./index.ts, so nothing starts a server
// and no request leaves the process. The Linear client is driven through its injected
// `fetch`, which is how its error mapping, its two-step upload, its status
// lookup and its one write can be asserted without an API key.
//
// What is NOT covered here, and is listed honestly in docs/ticketing-system.md:
// the live round trip to Linear, and the Postgres half (claim_bug_report,
// finish_bug_report, set_profile_role, the storage policy), which is pgTAP's
// job in supabase/tests/28_bug_reports.test.sql.

import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";

import { BREADCRUMB_LIMITS, clean, cleanBreadcrumbs, cleanEnvironment, cleanSteps, LIMITS, redact, REDACTED } from "./redact.ts";
import { breadcrumbLine, buildDescription, parseReport, PRIORITY_BY_SEVERITY, ValidationError } from "./issue.ts";
import { finishBugReport, ledgerQuery } from "./ledger.ts";
import {
  authorizationHeader,
  createIssue,
  fetchIssueStatuses,
  fetchKindLabels,
  findDoneStateId,
  findIssueId,
  findTriageStateId,
  issueNumber,
  labelIdForKind,
  LinearError,
  mapStateType,
  readLinearConfig,
  updateIssueState,
  uploadFile,
  type LinearConfig,
} from "./linear.ts";

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
const UID = "4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11";

function report(overrides: Record<string, unknown> = {}) {
  return parseReport({ kind: "bug", severity: "bad", title: "Ratings disappear after refresh", idempotencyKey: KEY, ...overrides });
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

Deno.test("cleanEnvironment keeps the build, the theme and the connectivity, printing online as a word", () => {
  const env = cleanEnvironment({ build: "a1b2c3d", theme: "dark", online: false });
  assertEquals(env.build, "a1b2c3d");
  assertEquals(env.theme, "dark");
  assertEquals(env.online, "offline");
  assertEquals(cleanEnvironment({ online: true }).online, "online");
});

Deno.test("an environment value that is itself a secret is redacted, not just dropped", () => {
  const env = cleanEnvironment({ build: FAKE.bearer("fake-token-02") });
  assertEquals(env.build, REDACTED);
});

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

Deno.test("cleanBreadcrumbs keeps only the known shape and drops entries that say nothing", () => {
  const crumbs = cleanBreadcrumbs([
    { at: "2026-11-09T10:00:00Z", kind: "nav", route: "/bev/[id]", extra: "dropped" },
    { at: "2026-11-09T10:00:01Z", kind: "api", method: "rankings.submit", code: "conflict", status: 409, ms: 212 },
    { at: "2026-11-09T10:00:02Z", kind: "nav" }, // no route
    { at: "2026-11-09T10:00:03Z", kind: "api", method: "not a method name" }, // bad method
    { at: "", kind: "nav", route: "/feed" }, // no timestamp
    { at: "2026-11-09T10:00:04Z", kind: "console", route: "/feed" }, // unknown kind
    "not an object",
  ]);
  assertEquals(crumbs.length, 2);
  assertEquals(crumbs[0], { at: "2026-11-09T10:00:00Z", kind: "nav", route: "/bev/[id]" });
  assertEquals(crumbs[1], { at: "2026-11-09T10:00:01Z", kind: "api", method: "rankings.submit", code: "conflict", status: 409, ms: 212 });
});

Deno.test("cleanBreadcrumbs keeps the most recent 20 and drops out-of-range numbers", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ at: `t${i}`, kind: "nav", route: `/r${i}` }));
  const crumbs = cleanBreadcrumbs(many);
  assertEquals(crumbs.length, BREADCRUMB_LIMITS.count);
  assertEquals(crumbs[0]?.route, "/r10");
  assertEquals(crumbs[19]?.route, "/r29");

  const [odd] = cleanBreadcrumbs([{ at: "t", kind: "api", method: "feed.list", status: 42, ms: -1 }]);
  assertEquals(odd, { at: "t", kind: "api", method: "feed.list" });
});

Deno.test("a breadcrumb carrying a secret is redacted like everything else", () => {
  const [crumb] = cleanBreadcrumbs([{ at: "t", kind: "nav", route: "/cb?access_token=abc", code: FAKE.bearer("fake-token-02") }]);
  assertEquals(crumb?.route?.includes("access_token=abc"), false);
  assertEquals(crumb?.code, REDACTED);
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

Deno.test("an empty title is rejected with the field name", () => {
  const e = assertThrowsValidation(() => parseReport({ kind: "bug", severity: "bad", title: "   ", idempotencyKey: KEY }));
  assertEquals(e.field, "title");
});

Deno.test("an unknown kind or severity is rejected with the field name", () => {
  assertEquals(assertThrowsValidation(() => parseReport({ kind: "rant", severity: "bad", title: "x", idempotencyKey: KEY })).field, "kind");
  assertEquals(assertThrowsValidation(() => parseReport({ severity: "bad", title: "x", idempotencyKey: KEY })).field, "kind");
  assertEquals(assertThrowsValidation(() => parseReport({ kind: "bug", severity: "meh", title: "x", idempotencyKey: KEY })).field, "severity");
  for (const kind of ["bug", "fix", "idea", "design"]) assertEquals(report({ kind }).kind, kind);
  for (const severity of ["blocker", "bad", "annoying", "polish"]) assertEquals(report({ severity }).severity, severity);
});

Deno.test("a non-UUID idempotency key is rejected", () => {
  const e = assertThrowsValidation(() => parseReport({ kind: "bug", severity: "bad", title: "x", idempotencyKey: "short" }));
  assertEquals(e.field, "idempotencyKey");
});

Deno.test("an evidence path outside the bucket's shape is rejected", () => {
  for (const path of ["../../etc/passwd", "someone-else/a.png", `${UID}/a.exe`]) {
    const e = assertThrowsValidation(() => report({ evidencePaths: [path] }));
    assertEquals(e.field, "evidencePaths");
  }
  assertEquals(assertThrowsValidation(() => report({ evidencePaths: `${UID}/a.png` })).field, "evidencePaths");
});

Deno.test("more than three evidence paths is rejected; three well-formed ones are accepted", () => {
  const paths = ["a", "b", "c", "d"].map((n) => `${UID}/${n}.jpg`);
  assertEquals(assertThrowsValidation(() => report({ evidencePaths: paths })).field, "evidencePaths");
  assertEquals(report({ evidencePaths: paths.slice(0, 3) }).evidencePaths, paths.slice(0, 3));
  assertEquals(report().evidencePaths, []);
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
  const body = buildDescription(report(), "tester", []);
  for (
    const heading of [
      "## Summary",
      "## Steps to reproduce",
      "## Expected behavior",
      "## Actual behavior",
      "## Environment",
      "## Recent activity",
      "## Evidence",
      "## Acceptance criteria",
    ]
  ) {
    assertStringIncludes(body, heading);
  }
  assertStringIncludes(body, "fill in during triage");
  assertStringIncludes(body, "No screenshot attached");
  assertStringIncludes(body, "No activity recorded");
  assertStringIncludes(body, "@tester");
});

Deno.test("the description names the type and the severity under the opening line", () => {
  assertStringIncludes(buildDescription(report(), "tester", []), "**Type:** Bug · **Severity:** Bad");
  assertStringIncludes(buildDescription(report({ kind: "design", severity: "polish" }), "tester", []), "**Type:** Design nit · **Severity:** Polish");
});

Deno.test("the description tells a reader the reporter's text is data, not instructions", () => {
  assertStringIncludes(buildDescription(report(), "tester", []), "not instructions");
});

Deno.test("steps are numbered and the environment prints its labels", () => {
  const body = buildDescription(
    report({ reproductionSteps: ["open a Bev", "rate it"], environment: { route: "/profile", platform: "web", online: true } }),
    "tester",
    [],
  );
  assertStringIncludes(body, "1. open a Bev");
  assertStringIncludes(body, "2. rate it");
  assertStringIncludes(body, "- Screen/route: /profile");
  assertStringIncludes(body, "- Platform: web");
  assertStringIncludes(body, "- Connectivity: online");
});

Deno.test("recent activity is a fenced block, one cleaned line per crumb", () => {
  const body = buildDescription(
    report({
      breadcrumbs: [
        { at: "10:00:00", kind: "nav", route: "/bev/[id]" },
        { at: "10:00:01", kind: "api", method: "rankings.submit", code: "conflict", status: 409, ms: 212 },
      ],
    }),
    "tester",
    [],
  );
  assertStringIncludes(body, "```text\n10:00:00  nav  /bev/[id]\n10:00:01  api  rankings.submit  conflict  409  212 ms\n```");
  assertEquals(breadcrumbLine({ at: "t", kind: "api", method: "feed.list" }), "t  api  feed.list");
});

Deno.test("each embedded screenshot becomes a numbered markdown image; failures are listed once", () => {
  const body = buildDescription(report(), "tester", [
    { kind: "embedded", assetUrl: "https://uploads.linear.app/a/1" },
    { kind: "failed", reason: "linear_upload_failed" },
    { kind: "embedded", assetUrl: "https://uploads.linear.app/a/2" },
  ]);
  assertStringIncludes(body, "![Reporter screenshot 1](https://uploads.linear.app/a/1)");
  assertStringIncludes(body, "![Reporter screenshot 2](https://uploads.linear.app/a/2)");
  assertStringIncludes(body, "A screenshot was attached but could not be uploaded to Linear (linear_upload_failed)");
});

Deno.test("severity maps onto Linear's priority scale, blocker first", () => {
  assertEquals(PRIORITY_BY_SEVERITY, { blocker: 1, bad: 2, annoying: 3, polish: 4 });
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

function sentVariables(call: { init?: RequestInit } | undefined): Record<string, unknown> {
  return (JSON.parse(String(call?.init?.body)) as { variables: Record<string, unknown> }).variables;
}

Deno.test("a personal API key is sent raw and an OAuth token as a Bearer", () => {
  assertEquals(authorizationHeader(FAKE.linearKey("abc")), FAKE.linearKey("abc"));
  assertEquals(authorizationHeader(FAKE.linearOauth("abc")), FAKE.bearer(FAKE.linearOauth("abc")));
});

Deno.test("createIssue returns the identifier Linear assigned, never one of ours, and sets priority and labels", async () => {
  const { impl, calls } = stubFetch(() =>
    gql({ data: { issueCreate: { success: true, issue: { id: "i1", identifier: "BEV-207", url: "https://linear.app/x/issue/BEV-207" } } } })
  );
  const issue = await createIssue({ ...CONFIG, labelIds: ["from-app"] }, impl, {
    title: "t",
    description: "d",
    stateId: "state-triage",
    priority: 2,
    labelIds: ["label-bug", "from-app"],
  });
  assertEquals(issue.identifier, "BEV-207");
  const input = sentVariables(calls[0]).input as Record<string, unknown>;
  assertEquals(input.teamId, "team-1");
  assertEquals(input.stateId, "state-triage");
  assertEquals(input.priority, 2);
  assertEquals(input.labelIds, ["from-app", "label-bug"]);
});

Deno.test("createIssue leaves priority and labels out when none are given", async () => {
  const { impl, calls } = stubFetch(() =>
    gql({ data: { issueCreate: { success: true, issue: { id: "i1", identifier: "BEV-1", url: "https://linear.app/x/issue/BEV-1" } } } })
  );
  await createIssue(CONFIG, impl, { title: "t", description: "d", stateId: null });
  const input = sentVariables(calls[0]).input as Record<string, unknown>;
  assertEquals("priority" in input, false);
  assertEquals("labelIds" in input, false);
  assertEquals("stateId" in input, false);
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
    gql({ data: { team: { states: { nodes: [{ id: "s1", name: "Backlog", type: "backlog" }, { id: "s2", name: "Triage", type: "triage" }] } } } })
  );
  assertEquals(await findTriageStateId(CONFIG, byType.impl), "s2");

  const byName = stubFetch(() => gql({ data: { team: { states: { nodes: [{ id: "s3", name: "triage", type: "unstarted" }] } } } }));
  assertEquals(await findTriageStateId(CONFIG, byName.impl), "s3");

  const none = stubFetch(() => gql({ data: { team: { states: { nodes: [{ id: "s4", name: "Todo", type: "unstarted" }] } } } }));
  assertEquals(await findTriageStateId(CONFIG, none.impl), null);
});

Deno.test("findDoneStateId prefers the configured id, then the completed state named Done, then any completed state", async () => {
  assertEquals(await findDoneStateId({ ...CONFIG, doneStateId: "preset" }, stubFetch(() => gql({})).impl), "preset");
  const named = stubFetch(() =>
    gql({
      data: {
        team: {
          states: {
            nodes: [{ id: "c1", name: "Shipped", type: "completed" }, { id: "c2", name: "Done", type: "completed" }, { id: "x", name: "Canceled", type: "canceled" }],
          },
        },
      },
    })
  );
  assertEquals(await findDoneStateId(CONFIG, named.impl), "c2");
  const first = stubFetch(() => gql({ data: { team: { states: { nodes: [{ id: "c1", name: "Shipped", type: "completed" }] } } } }));
  assertEquals(await findDoneStateId(CONFIG, first.impl), "c1");
  const none = stubFetch(() => gql({ data: { team: { states: { nodes: [{ id: "x", name: "Canceled", type: "canceled" }] } } } }));
  assertEquals(await findDoneStateId(CONFIG, none.impl), null);
});

Deno.test("labels are resolved by name across the workspace, with the environment override winning", async () => {
  const { impl, calls } = stubFetch(() =>
    gql({
      data: {
        issueLabels: {
          nodes: [
            // Linear's default Bug label is workspace-wide: `team` is null.
            { id: "l-bug-ws", name: "Bug", team: null },
            { id: "l-fix", name: "Fix Suggestion", team: { id: "team-1" } },
            // Another team's Idea label is not ours.
            { id: "l-idea-other", name: "Idea", team: { id: "team-2" } },
          ],
        },
      },
    })
  );
  const labels = await fetchKindLabels(CONFIG, impl);
  const variables = sentVariables(calls[0]);
  assertEquals(variables.names, ["Bug", "Fix suggestion", "Idea", "Design nit"]);
  assertEquals(labelIdForKind("bug", CONFIG, labels), "l-bug-ws");
  assertEquals(labelIdForKind("fix", CONFIG, labels), "l-fix");
  assertEquals(labelIdForKind("idea", CONFIG, labels), null);
  assertEquals(labelIdForKind("idea", { ...CONFIG, labelIdByKind: { idea: "l-idea" } }, labels), "l-idea");
  assertEquals(labelIdForKind("design", CONFIG, null), null);
});

Deno.test("a team-scoped label wins over a workspace label of the same name, whichever order Linear lists them", async () => {
  const teamFirst = stubFetch(() =>
    gql({ data: { issueLabels: { nodes: [{ id: "l-bug-team", name: "Bug", team: { id: "team-1" } }, { id: "l-bug-ws", name: "Bug", team: null }] } } })
  );
  assertEquals((await fetchKindLabels(CONFIG, teamFirst.impl)).bug, "l-bug-team");
  const workspaceFirst = stubFetch(() =>
    gql({ data: { issueLabels: { nodes: [{ id: "l-bug-ws", name: "Bug", team: null }, { id: "l-bug-team", name: "Bug", team: { id: "team-1" } }] } } })
  );
  assertEquals((await fetchKindLabels(CONFIG, workspaceFirst.impl)).bug, "l-bug-team");
});

Deno.test("Linear's state types map onto the contract's states, with the name deciding review", () => {
  assertEquals(mapStateType("triage", "Triage"), "triage");
  assertEquals(mapStateType("backlog", "Backlog"), "todo");
  assertEquals(mapStateType("unstarted", "Todo"), "todo");
  assertEquals(mapStateType("started", "In Progress"), "in_progress");
  assertEquals(mapStateType("started", "In Review"), "in_review");
  assertEquals(mapStateType("completed", "Done"), "done");
  assertEquals(mapStateType("canceled", "Canceled"), "canceled");
  assertEquals(mapStateType("something-new", "x"), "unknown");
  assertEquals(mapStateType(undefined, undefined), "unknown");
});

Deno.test("issueNumber reads the number out of an identifier and nothing else", () => {
  assertEquals(issueNumber("BEV-104"), 104);
  assertEquals(issueNumber(" bev-104 "), null);
  assertEquals(issueNumber("104"), null);
  assertEquals(issueNumber("BEV-"), null);
});

Deno.test("fetchIssueStatuses filters by team and number and maps every node", async () => {
  const { impl, calls } = stubFetch(() =>
    gql({
      data: {
        issues: {
          nodes: [
            { identifier: "BEV-1", state: { name: "In Review", type: "started" }, priority: 2, updatedAt: "2026-11-09T10:00:00.000Z" },
            { identifier: "BEV-2", state: null, priority: null, updatedAt: null },
          ],
        },
      },
    })
  );
  const statuses = await fetchIssueStatuses(CONFIG, impl, [1, 2]);
  const variables = sentVariables(calls[0]);
  assertEquals(variables.teamId, "team-1");
  assertEquals(variables.numbers, [1, 2]);
  assertEquals(statuses[0], { identifier: "BEV-1", state: "in_review", stateLabel: "In Review", priority: 2, updatedAt: "2026-11-09T10:00:00.000Z" });
  assertEquals(statuses[1], { identifier: "BEV-2", state: "unknown", stateLabel: null, priority: null, updatedAt: null });
  assertEquals(await fetchIssueStatuses(CONFIG, impl, []), []);
  assertEquals(calls.length, 1);
});

Deno.test("verify looks the issue up by identifier and moves it; an unconfirmed update is an error", async () => {
  const { impl, calls } = stubFetch((_url, init) => {
    const body = String(init?.body);
    if (body.includes("IssueId")) return gql({ data: { issue: { id: "uuid-1" } } });
    return gql({
      data: {
        issueUpdate: {
          success: true,
          issue: { identifier: "BEV-9", state: { name: "Done", type: "completed" }, priority: 3, updatedAt: "2026-11-09T11:00:00.000Z" },
        },
      },
    });
  });
  assertEquals(await findIssueId(CONFIG, impl, "BEV-9"), "uuid-1");
  const status = await updateIssueState(CONFIG, impl, "uuid-1", "state-done");
  assertEquals(status.state, "done");
  assertEquals(sentVariables(calls[1]), { id: "uuid-1", input: { stateId: "state-done" } });

  const missing = stubFetch(() => gql({ data: { issue: null } }));
  assertEquals(await findIssueId(CONFIG, missing.impl, "BEV-404"), null);

  const refused = stubFetch(() => gql({ data: { issueUpdate: { success: false, issue: null } } }));
  const e = await assertRejects(() => updateIssueState(CONFIG, refused.impl, "uuid-1", "state-done"), LinearError);
  assertEquals(e.code, "linear_update_failed");
});

Deno.test("readLinearConfig needs both the key and the team, splits the label list and reads the per-kind labels", () => {
  assertEquals(readLinearConfig(() => undefined), null);
  assertEquals(readLinearConfig((k) => (k === "LINEAR_API_KEY" ? FAKE.linearKey("x") : undefined)), null);
  const config = readLinearConfig((k) =>
    ({
      LINEAR_API_KEY: FAKE.linearKey("x"),
      LINEAR_TEAM_ID: "team-1",
      LINEAR_LABEL_IDS: " a , b ,, c ",
      LINEAR_LABEL_BUG: "l-bug",
      LINEAR_DONE_STATE_ID: "s-done",
    })[k]
  );
  assertEquals(config?.labelIds, ["a", "b", "c"]);
  assertEquals(config?.labelIdByKind, { bug: "l-bug" });
  assertEquals(config?.doneStateId, "s-done");
  const plain = readLinearConfig((k) => ({ LINEAR_API_KEY: FAKE.linearKey("x"), LINEAR_TEAM_ID: "team-1" })[k]);
  assertEquals(plain?.labelIdByKind, undefined);
});

// ---------------------------------------------------------------------------
// The ledger: the caller's rows only, and the write that must not be lost
// ---------------------------------------------------------------------------

Deno.test("the status and verify reads name the caller's reporter_id as well as reading through RLS", () => {
  const query = ledgerQuery(UID, { limit: 50 });
  assertStringIncludes(query, `reporter_id=eq.${UID}`);
  assertStringIncludes(query, "state=eq.created");
  assertStringIncludes(query, "order=created_at.desc&limit=50");
  assertEquals(query.includes("ticket_identifier"), true); // in the select list
  const one = ledgerQuery(UID, { ticketId: "BEV-9", limit: 50 });
  assertStringIncludes(one, `reporter_id=eq.${UID}`);
  assertStringIncludes(one, "ticket_identifier=eq.BEV-9");
});

const LEDGER_ENV = { url: "https://project.supabase.co", serviceRoleKey: "service-role" };

Deno.test("finishBugReport retries a non-2xx answer once and confirms when the retry succeeds", async () => {
  const statuses = [500, 200];
  const { impl, calls } = stubFetch(() => new Response("", { status: statuses.shift() ?? 200 }));
  const logged: string[] = [];
  const ok = await finishBugReport(impl, LEDGER_ENV, 7, "created", { identifier: "BEV-9", url: "https://l/BEV-9" }, (l) => logged.push(l));
  assertEquals(ok, true);
  assertEquals(calls.length, 2);
  assertEquals(logged, []);
  const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assertEquals(body.p_id, 7);
  assertEquals(body.p_state, "created");
  assertEquals(body.p_ticket_identifier, "BEV-9");
  assertEquals((calls[0]?.init?.headers as Record<string, string>).Authorization, FAKE.bearer("service-role"));
});

Deno.test("finishBugReport gives up after two failures, logs the status code only, and does not throw", async () => {
  const { impl, calls } = stubFetch(() => new Response('{"message":"the body would quote the request"}', { status: 500 }));
  const logged: string[] = [];
  const ok = await finishBugReport(impl, LEDGER_ENV, 7, "created", { identifier: "BEV-9", url: "https://l/BEV-9" }, (l) => logged.push(l));
  assertEquals(ok, false);
  assertEquals(calls.length, 2);
  assertEquals(logged.length, 1);
  assertStringIncludes(logged[0] ?? "", "status=500");
  assertEquals((logged[0] ?? "").includes("quote the request"), false);
});

Deno.test("finishBugReport treats an unreachable database like a failed write", async () => {
  let attempts = 0;
  const impl = (_url: string, _init?: RequestInit) => {
    attempts++;
    return Promise.reject(new Error("connection reset"));
  };
  const logged: string[] = [];
  assertEquals(await finishBugReport(impl, LEDGER_ENV, 7, "failed", { errorCode: "linear_error" }, (l) => logged.push(l)), false);
  assertEquals(attempts, 2);
  assertStringIncludes(logged[0] ?? "", "status=unreachable");
});
