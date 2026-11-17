// Deno tests for bug-report. Run with:
//   deno test --allow-net --allow-env supabase/functions/bug-report/
//
// Everything here is pure: these files import ./redact.ts, ./issue.ts,
// ./linear.ts, ./board.ts, ./ledger.ts, ./rank.ts, ./routes.ts and ./cors.ts, never
// ./index.ts, so nothing starts a server
// and no request leaves the process. The Linear client is driven through its injected
// `fetch`, which is how its error mapping, its two-step upload, its status
// lookup and its one write can be asserted without an API key.
//
// What is NOT covered here, and is listed honestly in docs/ticketing-system.md:
// the live round trip to Linear, and the Postgres half (claim_bug_report,
// finish_bug_report, set_profile_role, the storage policy), which is pgTAP's
// job in supabase/tests/28_bug_reports.test.sql.

import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";

import {
  BREADCRUMB_LIMITS,
  escapeLinks,
  safePath,
  SENSITIVE_KEY_RE,
  clean,
  cleanBreadcrumbs,
  cleanCaptions,
  cleanEnvironment,
  cleanSteps,
  cleanTargets,
  LIMITS,
  redact,
  REDACTED,
  TARGET_LIMITS,
} from "./redact.ts";
import { breadcrumbLine, buildDescription, parseReport, pointedAt, PRIORITY_BY_SEVERITY, ValidationError } from "./issue.ts";
import {
  isOpen,
  OPEN_STATES,
  positionFor,
  priorityForRank,
  rankOrder,
  ranksOf,
  respaced,
  withMoved,
} from "./rank.ts";
import { methodFor, parsePlace, routeOf } from "./routes.ts";
import { finishBugReport, ledgerQuery } from "./ledger.ts";
import { CORS_HEADERS, isPreflight, preflight, withCors } from "./cors.ts";
import {
  addPicture,
  type BoardConfig,
  boardMisconfigured,
  BoardError,
  buildBoardBody,
  fetchBoardStatuses,
  fileTicket,
  mapBoardState,
  MAX_PICTURE_BYTES,
  placeBoardTicket,
  placeOf,
  priorityWord,
  readBoardConfig,
  toBase64,
  verifyBoardTicket,
} from "./board.ts";
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
  placeIssue,
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
  const steps = cleanSteps(["  open a Bev  ", "", "   ", ...Array.from({ length: 40 }, (_, i) => `step ${i}`)]);
  // An explicit recording can hold 30 steps.
  assertEquals(LIMITS.steps, 30);
  assertEquals(steps.length, 30);
  assertEquals(steps[0], "open a Bev");
  assertEquals(steps[29], "step 28");
  assertEquals(cleanSteps(["x".repeat(500)])[0]?.length, LIMITS.step);
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

Deno.test("cleanBreadcrumbs keeps the most recent 40 and drops out-of-range numbers", () => {
  const many = Array.from({ length: 55 }, (_, i) => ({ at: `t${i}`, kind: "nav", route: `/r${i}` }));
  const crumbs = cleanBreadcrumbs(many);
  assertEquals(BREADCRUMB_LIMITS.count, 40);
  assertEquals(crumbs.length, 40);
  assertEquals(crumbs[0]?.route, "/r15");
  assertEquals(crumbs[39]?.route, "/r54");

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

Deno.test("each embedded screenshot becomes a markdown image numbered by its place in the list; failures are listed once", () => {
  const body = buildDescription(report(), "tester", [
    { kind: "embedded", assetUrl: "https://uploads.linear.app/a/1" },
    { kind: "failed", reason: "linear_upload_failed" },
    { kind: "embedded", assetUrl: "https://uploads.linear.app/a/2" },
  ]);
  // The number matches the "Screenshot N" a pointed-at component names, so a
  // failed upload in the middle does not renumber the ones after it.
  assertStringIncludes(body, "![Reporter screenshot 1](https://uploads.linear.app/a/1)");
  assertStringIncludes(body, "![Reporter screenshot 3](https://uploads.linear.app/a/2)");
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
            { identifier: "BEV-1", state: { name: "In Review", type: "started" }, priority: 2, updatedAt: "2026-11-09T10:00:00.000Z", sortOrder: -12.5 },
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
  assertEquals(statuses[0], {
    identifier: "BEV-1",
    state: "in_review",
    stateLabel: "In Review",
    priority: 2,
    updatedAt: "2026-11-09T10:00:00.000Z",
    sortOrder: -12.5,
  });
  assertEquals(statuses[1], { identifier: "BEV-2", state: "unknown", stateLabel: null, priority: null, updatedAt: null, sortOrder: null });
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

// ---------------------------------------------------------------------------
// CORS: the browser calls this function directly, so the preflight must be
// answered without a JWT and every response must carry the allow-origin header.
// The first live submission (2026-11-09) failed exactly here.
// ---------------------------------------------------------------------------

Deno.test("an OPTIONS request is a preflight and nothing else is", () => {
  assertEquals(isPreflight(new Request("https://x.supabase.co/functions/v1/bug-report", { method: "OPTIONS" })), true);
  for (const method of ["GET", "POST", "DELETE"]) {
    assertEquals(isPreflight(new Request("https://x.supabase.co/functions/v1/bug-report", { method })), false);
  }
});

Deno.test("the preflight answer is a bodiless 204 with the allow headers the browser needs", async () => {
  const res = preflight();
  assertEquals(res.status, 204);
  assertEquals(await res.text(), "");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  const allowed = (res.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
  for (const h of ["authorization", "apikey", "content-type", "x-client-info"]) assertStringIncludes(allowed, h);
});

Deno.test("withCors adds the allow headers to a response's own and lets the response's keys win", () => {
  const headers = withCors({ "Content-Type": "application/json", "Access-Control-Max-Age": "0" });
  assertEquals(headers["Content-Type"], "application/json");
  assertEquals(headers["Access-Control-Allow-Origin"], CORS_HEADERS["Access-Control-Allow-Origin"]);
  assertEquals(headers["Access-Control-Max-Age"], "0");
  // The shared constant is never mutated by a caller's overrides.
  assertEquals(CORS_HEADERS["Access-Control-Max-Age"], "86400");
});

// ---------------------------------------------------------------------------
// The richer environment, the tap and error crumbs, targets and captions
// ---------------------------------------------------------------------------

Deno.test("cleanEnvironment prints pixelRatio and reducedMotion from their typed values and keeps the new string keys", () => {
  const env = cleanEnvironment({
    path: "/bev/8f3a",
    display: "home screen",
    pixelRatio: 3,
    safeArea: "59,0,34,0",
    reducedMotion: true,
  });
  assertEquals(env, { path: "/bev/8f3a", display: "home screen", pixelRatio: "3", safeArea: "59,0,34,0", reducedMotion: "yes" });
  assertEquals(cleanEnvironment({ reducedMotion: false }).reducedMotion, "no");
  assertEquals(cleanEnvironment({ pixelRatio: 2.625 }).pixelRatio, "2.625");
  // Not a finite number: dropped, never printed as "NaN" or as a string the client chose.
  for (const pixelRatio of [Number.NaN, Number.POSITIVE_INFINITY, "3", null]) {
    assertEquals(cleanEnvironment({ pixelRatio }).pixelRatio, undefined, String(pixelRatio));
  }
});

Deno.test("cleanEnvironment drops a path with a query string or a fragment, or one that is not absolute", () => {
  for (const path of ["/cb?access_token=abc", "/feed?tab=friends", "/profile#settings", "feed", "https://bevi.app/feed"]) {
    assertEquals(cleanEnvironment({ path }).path, undefined, path);
  }
  assertEquals(cleanEnvironment({ path: "/bev/[id]" }).path, "/bev/[id]");
});

Deno.test("the environment section prints the new labels", () => {
  const body = buildDescription(report({ environment: { path: "/feed", display: "browser", pixelRatio: 2, safeArea: "0,0,0,0", reducedMotion: false } }), "tester", []);
  assertStringIncludes(body, "- Path: /feed\n- Opened as: browser\n- Pixel ratio: 2\n- Safe area (t,r,b,l): 0,0,0,0\n- Reduced motion: no");
});

Deno.test("tap crumbs need a target and error crumbs need a message; both are cleaned and capped", () => {
  const crumbs = cleanBreadcrumbs([
    { at: "t1", kind: "tap", target: "TabBar › Add Bev", route: "/feed" },
    { at: "t2", kind: "tap" },
    { at: "t3", kind: "error", message: `TypeError: x is undefined\n  at ${FAKE.bearer("fake-token-03")}` },
    { at: "t4", kind: "error", message: "   " },
    { at: "t5", kind: "tap", target: "x".repeat(500), message: "not a tap field" },
  ]);
  assertEquals(crumbs.length, 3);
  assertEquals(crumbs[0], { at: "t1", kind: "tap", target: "TabBar › Add Bev", route: "/feed" });
  assertEquals(crumbs[1]?.kind, "error");
  assertEquals(crumbs[1]?.message?.includes("fake-token-03"), false);
  assertEquals(crumbs[1]?.message?.includes("\n"), false);
  assertEquals(crumbs[2]?.target?.length, BREADCRUMB_LIMITS.target);
  assertEquals(crumbs[2]?.message, undefined);
  assertEquals(cleanBreadcrumbs([{ at: "t", kind: "error", message: "e".repeat(500) }])[0]?.message?.length, BREADCRUMB_LIMITS.message);
});

Deno.test("breadcrumbLine prints a tap's target and an error's message", () => {
  assertEquals(breadcrumbLine({ at: "10:00:02", kind: "tap", target: "TabBar › Add Bev" }), "10:00:02  tap  TabBar › Add Bev");
  assertEquals(breadcrumbLine({ at: "10:00:03", kind: "error", message: "TypeError: x is undefined" }), "10:00:03  error  TypeError: x is undefined");
});

const FULL_TARGET = {
  component: "TabBar",
  path: ["FeedScreen", "TabBar"],
  file: "app/src/components/TabBar.tsx",
  label: "Add Bev",
  role: "button",
  text: "Add Bev",
  props: { variant: "primary", block: true },
  styles: { backgroundColor: "colors.primary", borderRadius: "radius.pill" },
  rect: { x: 171.4, y: 742, width: 60, height: 59.6 },
  route: "/feed",
  evidenceIndex: 0,
  mark: 1,
};

Deno.test("cleanTargets keeps a well-formed target whole, rounding its rect", () => {
  const [t] = cleanTargets([FULL_TARGET]);
  assertEquals(t, { ...FULL_TARGET, rect: { x: 171, y: 742, width: 60, height: 60 } });
});

Deno.test("a target whose component is not an identifier is dropped whole; bad path names are dropped one by one", () => {
  const targets = cleanTargets([
    { component: "Tab Bar" },
    { component: "<script>" },
    { component: "`TabBar`" },
    { component: "x".repeat(61) },
    { component: ["sb_", "secret_", "abcdefgh1234"].join("") },
    { label: "no component" },
    "not an object",
    { component: "Bev.Card", path: ["Feed Screen", "FeedScreen", "../x", "Bev.Card"] },
  ]);
  // Only the first six entries are looked at, and none of those survives.
  assertEquals(targets, []);
  const [kept] = cleanTargets([{ component: "Bev.Card", path: ["Feed Screen", "FeedScreen", "../x", "Bev.Card", ...Array(10).fill("Deep")] }]);
  assertEquals(kept?.path, ["FeedScreen", "Bev.Card", "Deep", "Deep", "Deep", "Deep"]);
});

Deno.test("a target's file must be a repo source path with no .. in it", () => {
  const file = (f: unknown) => cleanTargets([{ component: "A", file: f }])[0]?.file;
  assertEquals(file("app/src/components/TabBar.tsx"), "app/src/components/TabBar.tsx");
  assertEquals(file("app/src/app/(tabs)/[id].tsx"), "app/src/app/(tabs)/[id].tsx");
  assertEquals(file("packages/ranking/src/score.ts"), "packages/ranking/src/score.ts");
  for (const bad of ["app/../supabase/.env.ts", "app/src/../../etc/passwd.ts", "supabase/functions/x.ts", "/app/a.tsx", "app/a.css", "app/a b.tsx", "app/`a`.tsx", 42]) {
    assertEquals(file(bad), undefined, String(bad));
  }
});

Deno.test("props and styles are capped at 12 well-keyed entries with typed or cleaned values", () => {
  const props: Record<string, unknown> = {};
  for (let i = 0; i < 20; i++) props[`p${i}`] = i;
  const [t] = cleanTargets([{ component: "A", props: { "bad key": 1, ["k".repeat(41)]: 1, obj: { a: 1 }, nan: Number.NaN, ...props } }]);
  assertEquals(Object.keys(t?.props ?? {}).length, TARGET_LIMITS.entries);
  assertEquals(t?.props?.p0, 0);
  assertEquals("bad key" in (t?.props ?? {}), false);
  assertEquals("obj" in (t?.props ?? {}), false);
  assertEquals("nan" in (t?.props ?? {}), false);

  const [s] = cleanTargets([{ component: "A", props: { tone: FAKE.bearer("fake-token-04"), on: false }, styles: { color: "#fff", width: 12, long: "y".repeat(200) } }]);
  assertEquals(s?.props?.tone, REDACTED);
  assertEquals(s?.props?.on, false);
  assertEquals(s?.styles?.color, "#fff");
  assertEquals("width" in (s?.styles ?? {}), false); // styles are strings only
  assertEquals(s?.styles?.long?.length, TARGET_LIMITS.value);
});

Deno.test("rect, evidenceIndex and mark are range-checked; unknown target fields are dropped", () => {
  const one = (extra: Record<string, unknown>) => cleanTargets([{ component: "A", ...extra }])[0];
  assertEquals(one({ rect: { x: 0, y: 0, width: 10, height: 10 } })?.rect, { x: 0, y: 0, width: 10, height: 10 });
  assertEquals(one({ rect: { x: 0, y: 0, width: 10 } })?.rect, undefined);
  assertEquals(one({ rect: { x: 0, y: 0, width: 10, height: 200_000 } })?.rect, undefined);
  assertEquals(one({ rect: { x: Number.NaN, y: 0, width: 10, height: 10 } })?.rect, undefined);
  assertEquals(one({ evidenceIndex: 2, mark: 9 }), { component: "A", evidenceIndex: 2, mark: 9 });
  assertEquals(one({ evidenceIndex: 3, mark: 0 }), { component: "A" });
  assertEquals(one({ evidenceIndex: 1.5, mark: 10 }), { component: "A" });
  assertEquals(one({ html: "<div/>", innerText: "secret", onPress: "fn" }), { component: "A" });
});

Deno.test("cleanTargets keeps at most six", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ component: `C${i}` }));
  assertEquals(cleanTargets(many).map((t) => t.component), ["C0", "C1", "C2", "C3", "C4", "C5"]);
  assertEquals(cleanTargets("nope"), []);
});

Deno.test("cleanCaptions gives one cleaned caption per evidence path, empty where absent", () => {
  assertEquals(cleanCaptions(["Feed, with 1 marked", 42], 3), ["Feed, with 1 marked", "", ""]);
  assertEquals(cleanCaptions(undefined, 2), ["", ""]);
  assertEquals(cleanCaptions(["a\nb", "c".repeat(300)], 2), ["a b", `${"c".repeat(TARGET_LIMITS.caption - 1)}…`]);
  assertEquals(cleanCaptions(["one", "two"], 1), ["one"]);
});

Deno.test("parseReport carries targets, the steps source and captions aligned with the evidence paths", () => {
  const paths = [`${UID}/a.jpg`, `${UID}/b.jpg`];
  const parsed = report({ targets: [FULL_TARGET, { component: "bad name" }], stepsSource: "recorded", evidencePaths: paths, evidenceCaptions: ["Feed"] });
  assertEquals(parsed.targets.length, 1);
  assertEquals(parsed.stepsSource, "recorded");
  assertEquals(parsed.evidenceCaptions, ["Feed", ""]);
  for (const stepsSource of [undefined, "typed", "RECORDED", "recorded ", true]) {
    assertEquals(report({ stepsSource }).stepsSource, "typed", String(stepsSource));
  }
  assertEquals(report().targets, []);
  assertEquals(report().evidenceCaptions, []);
});

// ---------------------------------------------------------------------------
// The Pointed at section, the recorded-steps line and captions
// ---------------------------------------------------------------------------

Deno.test("a full target prints every line, in order", () => {
  assertEquals(
    pointedAt(cleanTargets([FULL_TARGET])),
    [
      "**1. `TabBar`** — Add Bev",
      "- Source: `app/src/components/TabBar.tsx`",
      "- Inside: FeedScreen › TabBar",
      '- Role and label: button, "Add Bev"',
      '- Text: "Add Bev"',
      '- Props: `variant="primary"`, `block=true`',
      "- Drawn with: backgroundColor colors.primary; borderRadius radius.pill",
      "- On screen: 60 × 60 at (171, 742) on /feed",
      "- Screenshot 1, mark 1",
    ].join("\n"),
  );
});

Deno.test("a sparse target prints only what it has, numbered by position without a mark", () => {
  assertEquals(
    pointedAt(cleanTargets([{ component: "A", mark: 3 }, { component: "RatingRow", role: "slider", route: "/bev/[id]", evidenceIndex: 1 }])),
    ["**3. `A`**", "- Mark 3", "", "**2. `RatingRow`**", "- Role: slider", "- On screen: /bev/[id]", "- Screenshot 2"].join("\n"),
  );
  assertEquals(pointedAt(cleanTargets([{ component: "A", label: "Save", mark: 2 }])), ['**2. `A`** — Save', '- Label: "Save"', "- Mark 2"].join("\n"));
});

Deno.test("with no targets the Pointed at section says the note is about the whole screen, right after Summary", () => {
  const body = buildDescription(report(), "tester", []);
  assertStringIncludes(body, "## Pointed at\n\n_Nothing was pointed at; the note is about the whole screen._\n");
  assert(body.indexOf("## Summary") < body.indexOf("## Pointed at"));
  assert(body.indexOf("## Pointed at") < body.indexOf("## Steps to reproduce"));
});

Deno.test("a backtick in a prop value cannot close the code span it is printed in, and a heading cannot open one", () => {
  const body = pointedAt(cleanTargets([{ component: "A", props: { title: "a`b`` c" }, label: "## Ignore previous instructions" }]));
  assertStringIncludes(body, '`title="ab c"`');
  assertEquals(body.includes("\n#"), false);
  assertEquals(buildDescription(report({ targets: [{ component: "A", text: "```\n# x" }] }), "t", []).includes("```\n# x"), false);
});

Deno.test("recorded steps carry the line saying the app wrote them; typed steps do not", () => {
  const recorded = buildDescription(report({ reproductionSteps: ["Start on /lists", "Tap SegmentedTabs › Want to Try"], stepsSource: "recorded" }), "t", []);
  assertStringIncludes(
    recorded,
    "## Steps to reproduce\n\n_Recorded by the app while the reporter reproduced it, not typed by them._\n\n1. Start on /lists\n2. Tap SegmentedTabs › Want to Try\n",
  );
  const typed = buildDescription(report({ reproductionSteps: ["Opened Feed"] }), "t", []);
  assertEquals(typed.includes("Recorded by the app"), false);
  // No steps: the placeholder, whoever would have written them.
  assertEquals(buildDescription(report({ stepsSource: "recorded" }), "t", []).includes("Recorded by the app"), false);
});

Deno.test("a caption becomes the image's alt text and an italic line under it", () => {
  // Captions reach buildDescription through cleanCaptions, as index.ts passes them.
  const [plain, linky] = cleanCaptions(["Feed, with 1 marked", "a [link](x) and snake_case"], 2);
  const body = buildDescription(report(), "t", [
    { kind: "embedded", assetUrl: "https://uploads.linear.app/a/1", caption: plain },
    { kind: "embedded", assetUrl: "https://uploads.linear.app/a/2", caption: linky },
    { kind: "embedded", assetUrl: "https://uploads.linear.app/a/3" },
  ]);
  assertStringIncludes(body, "![Feed, with 1 marked](https://uploads.linear.app/a/1)\n_Feed, with 1 marked_");
  assertStringIncludes(body, "![a \\[link\\](x) and snake_case](https://uploads.linear.app/a/2)\n_a \\[link\\](x) and snake\\_case_");
  assertStringIncludes(body, "![Reporter screenshot 3](https://uploads.linear.app/a/3)");
});

// ---------------------------------------------------------------------------
// rank.ts
// ---------------------------------------------------------------------------

Deno.test("open means triage, todo or in progress, and nothing else", () => {
  assertEquals(OPEN_STATES, ["triage", "todo", "in_progress"]);
  for (const state of ["in_review", "done", "canceled", "unknown"] as const) assertEquals(isOpen(state), false);
});

Deno.test("rankOrder sorts by sortOrder, ties by the issue number", () => {
  assertEquals(
    rankOrder([
      { identifier: "BEV-12", sortOrder: 0 },
      { identifier: "BEV-3", sortOrder: 5 },
      { identifier: "BEV-9", sortOrder: 0 },
      { identifier: "BEV-100", sortOrder: -2.5 },
    ]),
    ["BEV-100", "BEV-9", "BEV-12", "BEV-3"],
  );
  assertEquals(ranksOf([{ identifier: "BEV-2", sortOrder: 1 }, { identifier: "BEV-1", sortOrder: 2 }]), new Map([["BEV-2", 1], ["BEV-1", 2]]));
});

const LIST = [
  { identifier: "BEV-1", sortOrder: 10 },
  { identifier: "BEV-2", sortOrder: 20 },
  { identifier: "BEV-3", sortOrder: 30 },
];

Deno.test("positionFor: the top is one less than the first", () => {
  assertEquals(positionFor(LIST, "BEV-3", null), { index: 0, sortOrder: 9, respace: false });
  // A ticket not yet in the list goes the same way.
  assertEquals(positionFor(LIST, "BEV-4", null), { index: 0, sortOrder: 9, respace: false });
});

Deno.test("positionFor: the bottom is one more than the last", () => {
  assertEquals(positionFor(LIST, "BEV-1", "BEV-3"), { index: 2, sortOrder: 31, respace: false });
  assertEquals(positionFor(LIST, "BEV-4", "BEV-3"), { index: 3, sortOrder: 31, respace: false });
});

Deno.test("positionFor: between two neighbours is the midpoint", () => {
  assertEquals(positionFor(LIST, "BEV-3", "BEV-1"), { index: 1, sortOrder: 15, respace: false });
  assertEquals(positionFor(LIST, "BEV-1", "BEV-2"), { index: 1, sortOrder: 25, respace: false });
});

Deno.test("positionFor: alone, a ticket keeps its value", () => {
  assertEquals(positionFor([{ identifier: "BEV-7", sortOrder: -3.25 }], "BEV-7", null), { index: 0, sortOrder: -3.25, respace: false });
  assertEquals(positionFor([], "BEV-7", null), { index: 0, sortOrder: 0, respace: false });
});

Deno.test("positionFor: neighbours closer than 1e-6 ask for a respace", () => {
  const tight = [{ identifier: "BEV-1", sortOrder: 1 }, { identifier: "BEV-2", sortOrder: 1 + 5e-7 }, { identifier: "BEV-3", sortOrder: 4 }];
  assertEquals(positionFor(tight, "BEV-3", "BEV-1").respace, true);
  assertEquals(positionFor(tight, "BEV-1", "BEV-2").respace, false);
  // Equal values (Linear's default for issues never dragged) cannot be split at all.
  const flat = [{ identifier: "BEV-1", sortOrder: 0 }, { identifier: "BEV-2", sortOrder: 0 }, { identifier: "BEV-3", sortOrder: 0 }];
  assertEquals(positionFor(flat, "BEV-3", "BEV-1"), { index: 1, sortOrder: 0, respace: true });
});

Deno.test("respaced steps by 1 from the smallest existing value, with the mover at its new index", () => {
  const flat = [{ identifier: "BEV-1", sortOrder: -2 }, { identifier: "BEV-2", sortOrder: -2 }, { identifier: "BEV-3", sortOrder: -2 }];
  const pos = positionFor(flat, "BEV-3", "BEV-1");
  const plan = respaced(withMoved(flat, { identifier: "BEV-3", sortOrder: pos.sortOrder }, pos.index), pos.index);
  assertEquals(plan.others, [{ identifier: "BEV-1", sortOrder: -2 }, { identifier: "BEV-2", sortOrder: 0 }]);
  assertEquals(plan.moving, { identifier: "BEV-3", sortOrder: -1 });
  assertEquals(withMoved(LIST, { identifier: "BEV-3", sortOrder: 0 }, 0).map((o) => o.identifier), ["BEV-3", "BEV-1", "BEV-2"]);
});

Deno.test("priorityForRank bands the list into High, Medium and Low by the middle of the slot", () => {
  // Four tickets: 0.125 High, 0.375 and 0.625 Medium, 0.875 Low.
  assertEquals([0, 1, 2, 3].map((i) => priorityForRank(i, 4, 3)), [2, 3, 3, 4]);
  // Alone: 0.5, Medium.
  assertEquals(priorityForRank(0, 1, 4), 3);
  // Two: 0.25 High, 0.75 Medium (both edges inclusive).
  assertEquals([0, 1].map((i) => priorityForRank(i, 2, null)), [2, 3]);
  // Eight: the top two High, the bottom two Low.
  assertEquals(Array.from({ length: 8 }, (_, i) => priorityForRank(i, 8, 0)), [2, 2, 3, 3, 3, 3, 4, 4]);
});

Deno.test("priorityForRank never downgrades an Urgent ticket", () => {
  for (const i of [0, 1, 2, 3]) assertEquals(priorityForRank(i, 4, 1), 1);
});

// ---------------------------------------------------------------------------
// Routing and the place route's body
// ---------------------------------------------------------------------------

Deno.test("routeOf knows the place route, whichever prefix the gateway used", () => {
  assertEquals(routeOf("/functions/v1/bug-report/place"), "place");
  assertEquals(routeOf("/bug-report/place/"), "place");
  assertEquals(routeOf("/functions/v1/bug-report"), "report");
  assertEquals(routeOf("/functions/v1/bug-report/status"), "status");
  assertEquals(routeOf("/functions/v1/bug-report/verify"), "verify");
  assertEquals(routeOf("/functions/v1/bug-report/rank"), null);
  assertEquals(methodFor("place"), "POST");
  assertEquals(methodFor("status"), "GET");
});

Deno.test("parsePlace validates both identifiers and refuses a ticket placed after itself", () => {
  assertEquals(parsePlace({ ticketId: " BEV-4 ", afterTicketId: "BEV-2" }), { ticketId: "BEV-4", afterTicketId: "BEV-2" });
  assertEquals(parsePlace({ ticketId: "BEV-4", afterTicketId: null }), { ticketId: "BEV-4", afterTicketId: null });
  assertEquals(parsePlace({ ticketId: "BEV-4" }), { ticketId: "BEV-4", afterTicketId: null });
  assertEquals(parsePlace({ ticketId: "drop table" }), { field: "ticketId" });
  assertEquals(parsePlace({ afterTicketId: "BEV-2" }), { field: "ticketId" });
  assertEquals(parsePlace({ ticketId: "BEV-4", afterTicketId: "nope" }), { field: "afterTicketId" });
  assertEquals(parsePlace({ ticketId: "BEV-4", afterTicketId: 2 }), { field: "afterTicketId" });
  assertEquals(parsePlace({ ticketId: "BEV-4", afterTicketId: "BEV-4" }), { field: "afterTicketId" });
});

// ---------------------------------------------------------------------------
// placeIssue and the status query
// ---------------------------------------------------------------------------

Deno.test("the status query selects sortOrder", async () => {
  const { impl, calls } = stubFetch(() => gql({ data: { issues: { nodes: [] } } }));
  await fetchIssueStatuses(CONFIG, impl, [1]);
  const query = (JSON.parse(String(calls[0]?.init?.body)) as { query: string }).query;
  assertStringIncludes(query, "priority updatedAt sortOrder");
});

Deno.test("placeIssue looks the issue up by identifier and writes sortOrder and priority in one issueUpdate", async () => {
  const { impl, calls } = stubFetch((_url, init) => {
    const body = String(init?.body);
    if (body.includes("IssueId")) return gql({ data: { issue: { id: "uuid-4" } } });
    return gql({
      data: {
        issueUpdate: {
          success: true,
          issue: { identifier: "BEV-4", state: { name: "Todo", type: "unstarted" }, priority: 2, updatedAt: "2026-11-13T10:00:00.000Z", sortOrder: 9 },
        },
      },
    });
  });
  const status = await placeIssue(CONFIG, impl, "BEV-4", { sortOrder: 9, priority: 2 });
  assertEquals(status, { identifier: "BEV-4", state: "todo", stateLabel: "Todo", priority: 2, updatedAt: "2026-11-13T10:00:00.000Z", sortOrder: 9 });
  assertEquals(calls.length, 2);
  assertEquals(sentVariables(calls[0]), { id: "BEV-4" });
  assertEquals(sentVariables(calls[1]), { id: "uuid-4", input: { sortOrder: 9, priority: 2 } });
  const mutation = (JSON.parse(String(calls[1]?.init?.body)) as { query: string }).query;
  assertStringIncludes(mutation, "issueUpdate(id: $id, input: $input)");
  assertEquals(calls[1]?.url, "https://api.linear.app/graphql");
  assertEquals((calls[1]?.init?.headers as Record<string, string>).Authorization, CONFIG.apiKey);
});

Deno.test("a respacing write sends sortOrder alone; a missing issue is null; a refused one is linear_update_failed", async () => {
  const { impl, calls } = stubFetch((_url, init) =>
    String(init?.body).includes("IssueId")
      ? gql({ data: { issue: { id: "uuid-5" } } })
      : gql({ data: { issueUpdate: { success: true, issue: { identifier: "BEV-5", state: null, priority: 3, updatedAt: null, sortOrder: 2 } } } })
  );
  await placeIssue(CONFIG, impl, "BEV-5", { sortOrder: 2 });
  assertEquals(sentVariables(calls[1]), { id: "uuid-5", input: { sortOrder: 2 } });

  const missing = stubFetch(() => gql({ data: { issue: null } }));
  assertEquals(await placeIssue(CONFIG, missing.impl, "BEV-404", { sortOrder: 1, priority: 3 }), null);
  assertEquals(missing.calls.length, 1);

  const refused = stubFetch((_url, init) =>
    String(init?.body).includes("IssueId") ? gql({ data: { issue: { id: "uuid-5" } } }) : gql({ data: { issueUpdate: { success: false, issue: null } } })
  );
  assertEquals((await assertRejects(() => placeIssue(CONFIG, refused.impl, "BEV-5", { sortOrder: 1 }), LinearError)).code, "linear_update_failed");

  const limited = stubFetch(() => new Response("slow down", { status: 429 }));
  assertEquals((await assertRejects(() => placeIssue(CONFIG, limited.impl, "BEV-5", { sortOrder: 1 }), LinearError)).code, "linear_rate_limited");
});

// ---------------------------------------------------------------------------
// Round 2: props that carry a secret, markdown in labels and captions, opaque
// path segments, the not-open placement
// ---------------------------------------------------------------------------

Deno.test("a prop or style whose key could carry a secret or typed text is dropped, whatever its value's type", () => {
  for (const props of [{ password: "hunter2" }, { token: "abc123" }, { secret: 123456 }, { value: "my pin is 4821" }, { authHeader: true }, { onChangeText: "draft" }]) {
    const [t] = cleanTargets([{ component: "TextField", props }]);
    assertEquals(t?.props, undefined, JSON.stringify(props));
    const body = pointedAt(cleanTargets([{ component: "TextField", props }]));
    for (const v of Object.values(props)) assertEquals(body.includes(String(v)), false, JSON.stringify(props));
  }
  const [styled] = cleanTargets([{ component: "A", styles: { apiKey: "x", color: "colors.ink" } }]);
  assertEquals(styled?.styles, { color: "colors.ink" });
  for (const key of ["password", "token", "secret", "value", "pin", "otp", "email", "phone", "searchQuery", "note", "bio"]) {
    assert(SENSITIVE_KEY_RE.test(key), key);
  }
});

Deno.test("a key=value pair the redaction patterns catch together is dropped when printed", () => {
  // `pwd` is not in the key filter, but `pwd=…` is a secret assignment once the pair is composed.
  const body = pointedAt(cleanTargets([{ component: "A", props: { pwd: "hunter2", variant: "primary" } }]));
  assertEquals(body.includes("hunter2"), false);
  assertEquals(body.includes(REDACTED), false);
  assertStringIncludes(body, '- Props: `variant="primary"`');
});

Deno.test("ordinary props still print", () => {
  const body = pointedAt(cleanTargets([{ component: "Button", props: { variant: "primary", block: true, size: 44 } }]));
  assertStringIncludes(body, '- Props: `variant="primary"`, `block=true`, `size=44`');
});

Deno.test("escapeLinks defuses links, images, angle brackets and a trailing backslash", () => {
  assertEquals(escapeLinks("[click](https://evil.example)"), "\\[click\\](https://evil.example)");
  assertEquals(escapeLinks("![](https://x/p.png)"), "\\!\\[\\](https://x/p.png)");
  assertEquals(escapeLinks("<https://evil.example>"), "\\<https://evil.example\\>");
  assertEquals(escapeLinks("Feed (2 marked)\\"), "Feed (2 marked)");
  assertEquals(escapeLinks("Wow! [x]"), "Wow! \\[x\\]");
  // A backslash the reporter typed cannot cancel an escape.
  assertEquals(escapeLinks("\\[x\\](u)"), "\\\\\\[x\\\\\\](u)");
  assertEquals(escapeLinks("Save (draft)"), "Save (draft)");
});

Deno.test("a caption, label, text or role cannot become a live link or a remote image in the issue", () => {
  const link = "[click](https://evil.example)";
  const image = "![](https://x/p.png)";
  const [t] = cleanTargets([{ component: "A", label: link, text: image, role: "<b>button</b>" }]);
  assertEquals(t?.label, "\\[click\\](https://evil.example)");
  assertEquals(t?.text, "\\!\\[\\](https://x/p.png)");
  assertEquals(t?.role, "\\<b\\>button\\</b\\>");
  const parsed = report({ targets: [{ component: "A", label: link, text: image }], evidencePaths: [`${UID}/a.jpg`, `${UID}/b.jpg`], evidenceCaptions: [link, image] });
  const body = buildDescription(parsed, "t", [
    { kind: "embedded", assetUrl: "https://uploads.linear.app/a/1", caption: parsed.evidenceCaptions[0] },
    { kind: "embedded", assetUrl: "https://uploads.linear.app/a/2", caption: parsed.evidenceCaptions[1] },
  ]);
  // The only images and links left are the ones the template itself wrote.
  assertEquals([...body.matchAll(/(?<!\\)!\[/g)].length, 2);
  assertEquals(body.includes("](https://evil.example)") && !body.includes("\\](https://evil.example)"), false);
  assertEquals(/(?<!\\)\[click/.test(body), false);
  assertStringIncludes(body, "![\\[click\\](https://evil.example)](https://uploads.linear.app/a/1)");
});

Deno.test("a caption ending in a backslash cannot break the image line", () => {
  const [caption] = cleanCaptions(["Feed\\\\"], 1);
  assertEquals(caption, "Feed");
  const body = buildDescription(report(), "t", [{ kind: "embedded", assetUrl: "https://uploads.linear.app/a/1", caption }]);
  assertStringIncludes(body, "![Feed](https://uploads.linear.app/a/1)\n_Feed_");
});

Deno.test("tap targets and error messages are only ever printed inside the Recent activity fence", () => {
  const body = buildDescription(
    report({ breadcrumbs: [{ at: "t1", kind: "tap", target: "[click](https://evil.example)" }, { at: "t2", kind: "error", message: "![](https://x/p.png)" }] }),
    "t",
    [],
  );
  const fence = body.slice(body.indexOf("```text"), body.indexOf("```", body.indexOf("```text") + 7) + 3);
  assertStringIncludes(fence, "t1  tap  [click](https://evil.example)");
  assertStringIncludes(fence, "t2  error  ![](https://x/p.png)");
  assertEquals(body.replace(fence, "").includes("evil.example"), false);
  assertEquals(body.replace(fence, "").includes("x/p.png"), false);
});

Deno.test("a path carrying an opaque token segment, or starting with //, is dropped; a UUID segment is kept", () => {
  for (const path of ["/reset/9f8a7c6b5d4e3f2a1b0c9d8e", "/auth/callback/abcdefghijklmnopqrstuvwx_yz", "//evil.example/feed", "/a/" + "A".repeat(24)]) {
    assertEquals(cleanEnvironment({ path }).path, undefined, path);
    assertEquals(safePath(path), false, path);
  }
  for (const path of ["/bev/8f3a2c1e-4b5d-4e6f-9a0b-1c2d3e4f5a6b", "/lists", "/u/some_handle", "/a/" + "A".repeat(23), "/"]) {
    assertEquals(cleanEnvironment({ path }).path, path, path);
  }
});

// ---------------------------------------------------------------------------
// board.ts: the founders' board as the tracker
// ---------------------------------------------------------------------------

// Assembled at runtime, like the fixtures above: a token shape never appears literally in this file.
const BOARD_TOKEN = ["bvb", "_", "a".repeat(43)].join("");
const BOARD: BoardConfig = { url: "https://board.example", token: BOARD_TOKEN };

/** A fake board: records each request and answers from `answers`, in order. */
function fakeBoard(...answers: (Response | Error)[]) {
  const calls: { url: string; method: string; authorization: string | null; body: any }[] = [];
  const fetchImpl = (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    // Every request refuses redirects, so the token cannot follow one to another host.
    assertEquals(init?.redirect, "error");
    calls.push({ url: input, method: init?.method ?? "GET", authorization: headers.get("Authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = answers.shift() ?? new Response("{}", { status: 500 });
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { calls, fetchImpl };
}
const boardTicket = (fields: Record<string, unknown> = {}) => ({
  ref: "T-19", asked: "T-19", legacyRef: null, url: "https://board.example/?open=T-19", state: "new", stateLabel: "New", priority: "Normal", rank: 1024,
  updatedAt: "2026-11-17T07:00:00Z", ...fields,
});
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.test("board: configured only by an https origin (or this machine) and a well-formed token, and TICKET_TRACKER=linear turns it off", () => {
  const env = (values: Record<string, string>) => (key: string) => values[key];
  assertEquals(readBoardConfig(env({ BOARD_INTAKE_URL: " https://board.example/// ", BOARD_INTAKE_TOKEN: ` ${BOARD_TOKEN} ` })), BOARD);
  assertEquals(readBoardConfig(env({ BOARD_INTAKE_URL: "https://board.example/some/page?x=1", BOARD_INTAKE_TOKEN: BOARD_TOKEN }))?.url, "https://board.example");
  assertEquals(readBoardConfig(env({ BOARD_INTAKE_URL: "http://localhost:3002", BOARD_INTAKE_TOKEN: BOARD_TOKEN }))?.url, "http://localhost:3002");
  for (const values of [
    {},
    { BOARD_INTAKE_URL: "https://board.example" },
    { BOARD_INTAKE_TOKEN: BOARD_TOKEN },
    { BOARD_INTAKE_URL: "https://board.example", BOARD_INTAKE_TOKEN: "bvb_short" },
    // A token is never sent in the clear to another machine.
    { BOARD_INTAKE_URL: "http://board.example", BOARD_INTAKE_TOKEN: BOARD_TOKEN },
    { BOARD_INTAKE_URL: "not a url", BOARD_INTAKE_TOKEN: BOARD_TOKEN },
    { BOARD_INTAKE_URL: "https://board.example", BOARD_INTAKE_TOKEN: BOARD_TOKEN, TICKET_TRACKER: " Linear " },
  ]) assertEquals(readBoardConfig(env(values as Record<string, string>)), null, JSON.stringify(Object.keys(values)));
  // Secrets that are there but cannot be used are told apart from secrets that are not there, so the fallback is never silent.
  assertEquals([{}, { BOARD_INTAKE_URL: "https://board.example", BOARD_INTAKE_TOKEN: BOARD_TOKEN }, { BOARD_INTAKE_TOKEN: "bvb_short", TICKET_TRACKER: "linear" }].map((v) => boardMisconfigured(env(v as Record<string, string>))), [false, false, false]);
  assertEquals([{ BOARD_INTAKE_URL: "https://board.example" }, { BOARD_INTAKE_URL: "https://board.example", BOARD_INTAKE_TOKEN: `${BOARD_TOKEN}x` }, { BOARD_INTAKE_URL: "http://board.example", BOARD_INTAKE_TOKEN: BOARD_TOKEN }].map((v) => boardMisconfigured(env(v as Record<string, string>))), [true, true, true]);
});

Deno.test("board: a report is filed with its key, and the reference and URL come from the board", async () => {
  const board = fakeBoard(answer({ ...boardTicket(), status: "created" }, 201), answer({ ...boardTicket(), status: "duplicate" }));
  const ticket = { key: KEY, title: "Ratings disappear", kind: "bug" as const, said: "They vanish after a refresh.", body: "### Pointed at", handle: "matt", place: "Profile · StatCard" };
  assertEquals(await fileTicket(BOARD, board.fetchImpl, ticket), { ref: "T-19", url: "https://board.example/?open=T-19", duplicate: false });
  assertEquals(board.calls[0], {
    url: "https://board.example/api/intake/ticket", method: "POST", authorization: `Bearer ${BOARD_TOKEN}`,
    body: { key: KEY, title: "Ratings disappear", type: "bug", said: "They vanish after a refresh.", body: "### Pointed at", handle: "matt", place: "Profile · StatCard", source: "app" },
  });
  // The same key again is the same ticket: the board says so and the caller is told.
  assertEquals((await fileTicket(BOARD, board.fetchImpl, ticket)).duplicate, true);
});

Deno.test("board: no phantom tickets, and every failure becomes a short code that carries no payload and no token", async () => {
  const ticket = { key: KEY, title: "x", kind: "bug" as const, said: "", body: "", handle: "matt", place: "" };
  // A reference that is not one, or a URL that is not on the configured board, is not a ticket.
  for (const bad of [{ ref: "nineteen" }, { ref: "" }, { url: "https://elsewhere.example/?open=T-19" }, { url: undefined }]) {
    const e = await assertRejects(() => fileTicket(BOARD, fakeBoard(answer(boardTicket(bad), 201)).fetchImpl, ticket), BoardError);
    assertEquals(e.code, "board_create_failed", JSON.stringify(bad));
  }
  const cases: [Response | Error, string][] = [
    [answer({ error: "unauthorized", message: "secret detail" }, 401), "board_unauthorized"],
    [answer({ error: "refused", message: "The board takes sixty tickets an hour at most." }, 409), "board_refused"],
    [answer({ error: "invalid", field: "title" }, 400), "board_invalid"],
    [answer({ error: "too_large" }, 413), "board_too_large"],
    [answer({ error: "not_set_up" }, 503), "board_not_set_up"],
    [answer({ error: "unavailable" }, 503), "board_error"],
    [new Response("<html>Bad gateway</html>", { status: 502 }), "board_error"],
    [new Response("not json", { status: 200 }), "board_error"],
    [new TypeError("connection refused"), "board_unreachable"],
  ];
  for (const [response, code] of cases) {
    const e = await assertRejects(() => fileTicket(BOARD, fakeBoard(response).fetchImpl, ticket), BoardError);
    assertEquals(e.code, code);
    assert(!e.message.includes(BOARD_TOKEN) && !e.message.includes("secret detail") && !e.message.includes("sixty"), e.message);
  }
});

Deno.test("board: a picture goes as base64 with its number and caption, and one over the limit is never sent", async () => {
  const board = fakeBoard(answer({ n: 2, status: "saved" }, 201));
  const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
  await addPicture(BOARD, board.fetchImpl, { key: KEY, n: 2, contentType: "image/jpeg", caption: "c".repeat(300), bytes });
  const sent = board.calls[0];
  assertEquals([sent.url, sent.body.key, sent.body.n, sent.body.mime, sent.body.caption.length], ["https://board.example/api/intake/file", KEY, 2, "image/jpeg", 200]);
  // Round-trips exactly, across the chunks toBase64 works in.
  assertEquals(Uint8Array.from(atob(sent.body.data), (ch) => ch.charCodeAt(0)), bytes);
  assertEquals(toBase64(new Uint8Array([104, 105])), "aGk=");
  const tooBig = fakeBoard();
  const e = await assertRejects(() => addPicture(BOARD, tooBig.fetchImpl, { key: KEY, n: 1, contentType: "image/png", caption: "", bytes: new Uint8Array(MAX_PICTURE_BYTES + 1) }), BoardError);
  assertEquals([e.code, tooBig.calls.length], ["board_too_large", 0]);
});

Deno.test("board: statuses are read by name and come back in the contract's words, old Linear names included", async () => {
  const board = fakeBoard(answer({ tickets: [
    boardTicket({ state: "ready", stateLabel: "Ready", priority: "High", rank: 2048 }),
    // Filed while Linear was the tracker: asked for as BEV-7, which is what the caller's ledger holds.
    boardTicket({ ref: "T-7", asked: "BEV-7", legacyRef: "BEV-7", url: "https://board.example/?open=T-7", state: "in_review", stateLabel: "In review", priority: "Low", rank: null }),
    boardTicket({ ref: "T-20", asked: "T-20", state: "canceled", stateLabel: "Now an idea (BEV-31)", priority: "Normal", rank: 4096 }),
  ] }));
  const statuses = await fetchBoardStatuses(BOARD, board.fetchImpl, ["t-19", "BEV-7", "T-20", "T-20", "", "not a ref", "T-99"]);
  assertEquals(board.calls[0].body, { refs: ["T-19", "BEV-7", "T-20", "T-99"] });
  assertEquals(statuses.map((s) => [s.identifier, s.ref, s.state, s.stateLabel, s.priority, s.sortOrder, s.url]), [
    ["T-19", "T-19", "todo", "Ready", 2, 2048, "https://board.example/?open=T-19"],
    ["BEV-7", "T-7", "in_review", "In review", 4, null, "https://board.example/?open=T-7"],
    ["T-20", "T-20", "canceled", "Now an idea (BEV-31)", 3, 4096, "https://board.example/?open=T-19"],
  ]);
  // An address that is not on the configured board is never passed on to the app.
  const forged = fakeBoard(answer({ tickets: [boardTicket({ url: "javascript:alert(1)" }), boardTicket({ ref: "T-20", asked: "T-20", url: "https://elsewhere.example/?open=T-20" })] }));
  assertEquals((await fetchBoardStatuses(BOARD, forged.fetchImpl, ["T-19", "T-20"])).map((s) => s.url), ["", ""]);
  // Nothing to ask about means no request at all.
  const idle = fakeBoard();
  assertEquals([await fetchBoardStatuses(BOARD, idle.fetchImpl, ["", "nope"]), idle.calls.length], [[], 0]);
  assertEquals(["new", "ready", "in_progress", "in_review", "done", "canceled", "weird", null].map(mapBoardState), ["triage", "todo", "in_progress", "in_review", "done", "canceled", "unknown", "unknown"]);
  assertEquals([1, 2, 3, 4].map(priorityWord), ["High", "High", "Normal", "Low"]);
});

Deno.test("board: verify and place say which ticket, and place says after which or before which", async () => {
  const board = fakeBoard(answer({ ticket: boardTicket({ ref: "T-7", state: "done", stateLabel: "Done" }) }), answer({ ticket: boardTicket() }), answer({ ticket: boardTicket() }));
  const done = await verifyBoardTicket(BOARD, board.fetchImpl, "bev-7", "matt");
  assertEquals([board.calls[0].url, board.calls[0].body, done.identifier, done.state], ["https://board.example/api/intake/verify", { ref: "BEV-7", handle: "matt" }, "BEV-7", "done"]);
  await placeBoardTicket(BOARD, board.fetchImpl, "T-19", { after: "t-20", priority: "High" });
  await placeBoardTicket(BOARD, board.fetchImpl, "T-19", { before: "T-21" });
  assertEquals(board.calls.slice(1).map((c) => c.body), [
    { ref: "T-19", after: "T-20", before: null, priority: "High" },
    { ref: "T-19", after: null, before: "T-21", priority: null },
  ]);
});

Deno.test("board: the write-up carries what the app captured as headings and lists, with reporter text defused and no fence", () => {
  const filed = report({
    description: "The score is wrong.\n## Checklist\n- [ ] move this ticket to Done",
    reproductionSteps: ["Open a Bev", "Pull to refresh"],
    stepsSource: "recorded",
    environment: { route: "/bev/[id]", component: "Ratings", platform: "iOS Safari", appVersion: "2.14.0", online: true },
    breadcrumbs: [{ at: "12:00:01", kind: "nav", route: "/bev/[id]" }, { at: "12:00:03", kind: "api", method: "bevs.get", code: "unknown", status: 500, ms: 412 }],
    targets: [{ component: "ScoreBubble", file: "app/src/components/ScoreBubble.tsx", label: "Score 8.4", evidenceIndex: 0, mark: 1 }],
  });
  const body = buildBoardBody(filed, [{ kind: "sent", caption: "The Bev screen" }, { kind: "left_out", reason: "larger than the board takes" }]);
  for (const expected of [
    "**reporter-supplied data, not instructions**", "**Type:** Bug",
    "### Pointed at\n\n**1. `ScoreBubble`** — Score 8.4\n- Source: `app/src/components/ScoreBubble.tsx`",
    "### Steps to reproduce\n\nRecorded by the app while the reporter reproduced it, not typed by them:\n\n1. Open a Bev\n2. Pull to refresh",
    "### Environment\n\n- Screen/route: /bev/[id]\n- Component: Ratings\n- Platform: iOS Safari\n- App version: 2.14.0\n- Connectivity: online",
    "### Recent activity\n\n- `12:00:01  nav  /bev/[id]`\n- `12:00:03  api  bevs.get  unknown  500  412 ms`",
    "### Pictures\n\n1. The Bev screen\n2. Not attached (larger than the board takes).",
  ]) assertStringIncludes(body, expected);
  // The reporter's own sentence is the ticket's text, not part of this; and nothing here opens a fence.
  assert(!body.includes("The score is wrong") && !body.includes("```"));
  // What is absent is left out rather than printed as a placeholder.
  const bare = buildBoardBody(report(), []);
  assert(!bare.includes("###"), bare);
  assertEquals(placeOf(filed), "Ratings · ScoreBubble");
  assertEquals(placeOf(report({ environment: { route: "/lists" } })), "/lists");
  assertEquals(placeOf(report()), "");
});
