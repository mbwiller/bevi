// bug-report: the authenticated server side of the in-app bug reporter.
//
// Three routes, all from `api.bugs` (packages/api/src/bugs.ts), all carrying
// the caller's user JWT:
//   POST .../bug-report          file a report: validate and redact, claim an
//                                idempotency slot in `public.bug_reports`,
//                                create the Linear issue, answer with the
//                                identifier Linear assigned.
//   GET  .../bug-report/status   the caller's own tickets with their live
//                                Linear state, for My reports.
//   POST .../bug-report/verify   move one of the caller's tickets to Done,
//                                once they have checked the fix on the device.
//
// ---------------------------------------------------------------------------
// AUTHORISATION. `verify_jwt = true` in config.toml is the outer gate, and on
// its own it proves only that the caller holds a key this project issued --
// graph-query's header comment makes the same point, and the publishable key
// ships in every copy of the app. So the real check is a database one: the
// report route calls `claim_bug_report()` AS THE CALLER, and the two read
// routes call `can_report_bugs()` AS THE CALLER; both answer from
// `profiles.role` under auth.uid(). The ledger is read AS THE CALLER too and
// filtered to the caller's reporter_id (the select policy also admits an
// admin, and these routes are own-rows-only for admins as well). Hiding the
// Report a bug button in the client is cosmetic; this is the gate.
//
// The app calls this function from the browser, so cors.ts answers the
// preflight and every response carries Access-Control-Allow-Origin.
//
// The Linear API key is read from the environment and never leaves this
// function. The app never sees it, and no response or log line here contains
// it, the service-role key, or the reporter's evidence.
// ---------------------------------------------------------------------------
//
// Deno conventions follow graph-query and embed: no remote imports (deno.json
// has an empty import map) and plain `fetch` against PostgREST and the Storage
// API rather than @supabase/supabase-js, so CI's `deno check` type-checks this
// file without resolving a module off the network.

import { isPreflight, preflight, withCors } from "./cors.ts";
import {
  buildDescription,
  type EvidenceItem,
  type Kind,
  parseReport,
  PRIORITY_BY_SEVERITY,
  type Severity,
  ValidationError,
} from "./issue.ts";
import { finishBugReport, ledgerQuery } from "./ledger.ts";
import {
  createIssue,
  fetchIssueStatuses,
  fetchKindLabels,
  findDoneStateId,
  findIssueId,
  findTriageStateId,
  type IssueStatus,
  issueNumber,
  labelIdForKind,
  LinearError,
  type LinearConfig,
  readLinearConfig,
  updateIssueState,
  uploadFile,
} from "./linear.ts";

/** Bigger than any screenshot-free report; the evidence itself never comes through this body. */
const MAX_BODY_BYTES = 64 * 1024;
const EVIDENCE_BUCKET = "bug-evidence";
/** Matches the bucket's `file_size_limit` in 20261109000300_bug_reports.sql. */
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
/** How long one user's Linear answer is reused by the status route. */
const STATUS_CACHE_MS = 60_000;
/** My reports shows the newest this many tickets. */
const STATUS_LIMIT = 50;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    // Every response carries the CORS headers (cors.ts): the browser drops one that does not.
    headers: withCors({ "Content-Type": "application/json" }),
  });
}

/**
 * The `sub` claim of an already-verified JWT. The gateway verified the
 * signature before this code ran (verify_jwt = true), so this only needs to
 * read it; it is never used for an authorisation decision on its own -- those
 * all happen in Postgres under `auth.uid()`.
 */
function subjectOf(jwt: string): string | null {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const claims = JSON.parse(decoded) as { sub?: unknown };
    return typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

/** A stable, non-reversible handle for one submission, for the log line. */
async function keyFingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface Env {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

function readEnv(): Env | null {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

/** Calls a Postgres function through PostgREST as whoever `jwt` is. */
async function rpc(env: Env, jwt: string, name: string, args: unknown): Promise<Response> {
  return await fetch(`${env.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: env.anonKey,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
}

/** Reads a table through PostgREST as whoever `jwt` is; RLS does the scoping. */
async function select(env: Env, jwt: string, path: string): Promise<Response> {
  return await fetch(`${env.url}/rest/v1/${path}`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${jwt}` },
  });
}

interface PostgrestError {
  message?: string;
  code?: string;
  details?: string;
}

/** Maps a raised BEVI_* exception to the HTTP answer the client expects. */
function errorFromPostgrest(error: PostgrestError): { status: number; body: Record<string, unknown> } {
  const message = error.message ?? "";
  if (message.includes("BEVI_UNAUTHORIZED")) return { status: 403, body: { error: "not_internal" } };
  if (message.includes("BEVI_RATE_LIMITED")) return { status: 429, body: { error: "rate_limited" } };
  if (message.includes("BEVI_VALIDATION")) {
    return { status: 400, body: { error: "validation", field: error.details ?? undefined } };
  }
  return { status: 502, body: { error: "database_error" } };
}

interface ClaimRow {
  id: number;
  state: string;
  ticket_identifier: string | null;
  ticket_url: string | null;
  evidence_paths: string[] | null;
  claimed: boolean;
}

/** One row of the caller's ledger, as the status and verify routes read it. */
interface LedgerRow {
  id: number;
  ticket_identifier: string | null;
  ticket_url: string | null;
  title: string;
  kind: Kind;
  severity: Severity;
  created_at: string;
  updated_at: string;
}

/** What the contract calls `BugReportSummary`. */
interface Summary {
  ticketId: string;
  ticketUrl: string;
  title: string;
  kind: Kind;
  severity: Severity;
  createdAt: string;
  state: IssueStatus["state"];
  stateLabel: string | null;
  priority: number | null;
  updatedAt: string | null;
}

/** The reporter's handle, for the issue's Reporter line. Falls back to the id's prefix. */
async function reporterHandle(env: Env, jwt: string, userId: string): Promise<string> {
  try {
    const response = await select(env, jwt, `profiles?id=eq.${encodeURIComponent(userId)}&select=handle`);
    if (!response.ok) return userId.slice(0, 8);
    const rows = (await response.json()) as { handle?: string }[];
    return rows[0]?.handle ?? userId.slice(0, 8);
  } catch {
    return userId.slice(0, 8);
  }
}

/** Reads one private evidence object with the service role. The app never gets a URL for it. */
async function readEvidence(env: Env, path: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPE_BY_EXT[ext];
  if (!contentType) return null;
  const response = await fetch(`${env.url}/storage/v1/object/${EVIDENCE_BUCKET}/${path}`, {
    headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
  });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EVIDENCE_BYTES) return null;
  return { bytes, contentType };
}

/** Removes evidence objects whose report never became a ticket, so nothing is orphaned. */
async function deleteEvidence(env: Env, paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await fetch(`${env.url}/storage/v1/object/${EVIDENCE_BUCKET}/${path}`, {
        method: "DELETE",
        headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
      });
    } catch {
      // The retention sweep (scripts/bugs/purge-evidence.ts) is the backstop.
    }
  }
}

/**
 * Records the outcome against the ledger row as the service role
 * (ledger.ts: two attempts, status-only log line on failure). The created
 * ticket is returned to the reporter either way; the log line is what tells
 * an operator that a retry of this draft could now file a second ticket.
 */
async function finish(
  env: Env,
  id: number,
  state: "created" | "failed",
  extra: { identifier?: string; url?: string; errorCode?: string },
): Promise<void> {
  await finishBugReport(fetch, env, id, state, extra);
}

// ---------------------------------------------------------------------------
// Resolved once per cold start: each is a round trip we do not need per call.
// ---------------------------------------------------------------------------

let triageStateId: string | null | undefined;
let doneStateId: string | null | undefined;
let labelsByName: Record<string, string> | null | undefined;

async function triageState(config: LinearConfig): Promise<string | null> {
  if (triageStateId !== undefined) return triageStateId;
  try {
    triageStateId = await findTriageStateId(config, fetch);
  } catch {
    // A team without a reachable states list still gets its issue, in the
    // team's default state. Linear's own Triage view is the safety net.
    triageStateId = null;
  }
  return triageStateId;
}

async function doneState(config: LinearConfig): Promise<string | null> {
  if (doneStateId !== undefined) return doneStateId;
  try {
    doneStateId = await findDoneStateId(config, fetch);
  } catch {
    doneStateId = undefined;
    return null;
  }
  return doneStateId;
}

async function kindLabel(config: LinearConfig, kind: Kind, fingerprint: string): Promise<string | null> {
  if (labelsByName === undefined && !config.labelIdByKind?.[kind]) {
    try {
      labelsByName = await fetchKindLabels(config, fetch);
    } catch {
      labelsByName = null;
    }
  }
  const id = labelIdForKind(kind, config, labelsByName ?? null);
  if (!id) console.warn(`bug-report: no Linear label for kind=${kind} key=${fingerprint}; filed without it`);
  return id;
}

/** The status route's per-user cache of Linear's answer. */
const statusCache = new Map<string, { at: number; statuses: IssueStatus[] }>();

// ---------------------------------------------------------------------------
// Shared request plumbing
// ---------------------------------------------------------------------------

interface Caller {
  env: Env;
  jwt: string;
  userId: string;
}

/** The env and the verified caller, or the response that refuses the request. */
function caller(req: Request): Caller | Response {
  const env = readEnv();
  if (!env) return json({ error: "not_configured" }, 500);
  const authorization = req.headers.get("Authorization") ?? "";
  const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const userId = jwt ? subjectOf(jwt) : null;
  if (!jwt || !userId) return json({ error: "unauthorized" }, 401);
  return { env, jwt, userId };
}

/** `can_report_bugs()` as the caller: the gate for the two routes that do not claim a slot. */
async function isInternal(c: Caller): Promise<boolean | Response> {
  try {
    const response = await rpc(c.env, c.jwt, "can_report_bugs", {});
    if (!response.ok) return json({ error: "database_error" }, 502);
    return (await response.json()) === true;
  } catch {
    return json({ error: "database_unreachable" }, 503);
  }
}

async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
    const raw = JSON.parse(text);
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
}

/**
 * The caller's created tickets, newest first: read as the caller (RLS) and
 * filtered to the caller's `reporter_id` as well, since the select policy
 * also admits an admin and these routes are own-rows-only for everyone.
 */
async function ledgerRows(c: Caller, ticketId?: string): Promise<LedgerRow[] | Response> {
  try {
    const response = await select(c.env, c.jwt, ledgerQuery(c.userId, { ticketId, limit: STATUS_LIMIT }));
    if (!response.ok) return json({ error: "database_error" }, 502);
    return (await response.json()) as LedgerRow[];
  } catch {
    return json({ error: "database_unreachable" }, 503);
  }
}

function summarise(row: LedgerRow, status: IssueStatus | undefined): Summary {
  return {
    ticketId: row.ticket_identifier ?? "",
    ticketUrl: row.ticket_url ?? "",
    title: row.title,
    kind: row.kind,
    severity: row.severity,
    createdAt: row.created_at,
    state: status?.state ?? "unknown",
    stateLabel: status?.stateLabel ?? null,
    priority: status?.priority ?? null,
    updatedAt: status?.updatedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// POST /bug-report
// ---------------------------------------------------------------------------

async function handleReport(req: Request, c: Caller): Promise<Response> {
  const raw = await readBody(req);
  if (raw instanceof Response) return raw;

  let report;
  try {
    report = parseReport(raw);
  } catch (e) {
    if (e instanceof ValidationError) return json({ error: "validation", field: e.field, message: e.message }, 400);
    return json({ error: "invalid_request" }, 400);
  }

  // Authorisation, rate limit and the idempotency slot, all under auth.uid().
  let claim: ClaimRow;
  try {
    const response = await rpc(c.env, c.jwt, "claim_bug_report", {
      p_idempotency_key: report.idempotencyKey,
      p_kind: report.kind,
      p_severity: report.severity,
      p_title: report.title,
      p_evidence_paths: report.evidencePaths,
    });
    if (!response.ok) {
      const { status, body } = errorFromPostgrest((await response.json().catch(() => ({}))) as PostgrestError);
      return json(body, status);
    }
    const rows = (await response.json()) as ClaimRow[];
    const row = rows[0];
    if (!row) return json({ error: "database_error" }, 502);
    claim = row;
  } catch {
    return json({ error: "database_unreachable" }, 503);
  }

  const fingerprint = await keyFingerprint(report.idempotencyKey);
  const staged = claim.evidence_paths ?? [];

  if (!claim.claimed) {
    if (claim.state === "created" && claim.ticket_identifier && claim.ticket_url) {
      console.log(`bug-report: replay key=${fingerprint} ticket=${claim.ticket_identifier}`);
      return json({ ticketId: claim.ticket_identifier, ticketUrl: claim.ticket_url, status: "duplicate" }, 200);
    }
    console.log(`bug-report: in flight key=${fingerprint}`);
    return json({ error: "in_progress" }, 409);
  }

  const linear = readLinearConfig((key) => Deno.env.get(key));
  if (!linear) {
    await finish(c.env, claim.id, "failed", { errorCode: "linear_not_configured" });
    await deleteEvidence(c.env, staged);
    console.error(`bug-report: LINEAR_API_KEY/LINEAR_TEAM_ID missing key=${fingerprint}`);
    return json({ error: "tracker_not_configured" }, 503);
  }

  // Evidence first: the issue body embeds the asset URLs, and a screenshot
  // that cannot be uploaded must not cost the reporter their ticket.
  const evidence: EvidenceItem[] = [];
  for (const [i, path] of staged.entries()) {
    const file = await readEvidence(c.env, path);
    if (!file) {
      evidence.push({ kind: "failed", reason: "the stored object could not be read" });
      continue;
    }
    try {
      const assetUrl = await uploadFile(linear, fetch, {
        bytes: file.bytes,
        contentType: file.contentType,
        filename: `bug-${report.idempotencyKey}-${i + 1}.${path.split(".").pop()}`,
      });
      evidence.push({ kind: "embedded", assetUrl });
    } catch (e) {
      const code = e instanceof LinearError ? e.code : "upload_failed";
      console.error(`bug-report: evidence upload failed key=${fingerprint} index=${i} code=${code}`);
      evidence.push({ kind: "failed", reason: code });
    }
  }

  const handle = await reporterHandle(c.env, c.jwt, c.userId);
  const description = buildDescription(report, handle, evidence);
  const labelId = await kindLabel(linear, report.kind, fingerprint);

  try {
    const issue = await createIssue(linear, fetch, {
      title: report.title,
      description,
      stateId: await triageState(linear),
      priority: PRIORITY_BY_SEVERITY[report.severity],
      labelIds: labelId ? [labelId] : undefined,
    });
    await finish(c.env, claim.id, "created", { identifier: issue.identifier, url: issue.url });
    statusCache.delete(c.userId);
    console.log(
      `bug-report: created key=${fingerprint} ticket=${issue.identifier} kind=${report.kind} severity=${report.severity} evidence=${
        evidence.filter((e) => e.kind === "embedded").length
      }/${staged.length}`,
    );
    return json({ ticketId: issue.identifier, ticketUrl: issue.url, status: "created" }, 201);
  } catch (e) {
    const code = e instanceof LinearError ? e.code : "linear_error";
    await finish(c.env, claim.id, "failed", { errorCode: code });
    // The issue does not exist, so the evidence has nothing to belong to.
    await deleteEvidence(c.env, staged);
    console.error(`bug-report: create failed key=${fingerprint} code=${code}`);
    const status = code === "linear_rate_limited" ? 429 : 502;
    return json({ error: "tracker_error", code }, status);
  }
}

// ---------------------------------------------------------------------------
// GET /bug-report/status
// ---------------------------------------------------------------------------

async function statusesFor(c: Caller, linear: LinearConfig, rows: LedgerRow[]): Promise<{ statuses: IssueStatus[]; error?: string }> {
  const cached = statusCache.get(c.userId);
  if (cached && Date.now() - cached.at < STATUS_CACHE_MS) return { statuses: cached.statuses };
  const numbers = rows.map((r) => (r.ticket_identifier ? issueNumber(r.ticket_identifier) : null)).filter((n): n is number => n !== null);
  try {
    const statuses = await fetchIssueStatuses(linear, fetch, numbers);
    statusCache.set(c.userId, { at: Date.now(), statuses });
    return { statuses };
  } catch (e) {
    const code = e instanceof LinearError ? e.code : "linear_error";
    console.error(`bug-report: status lookup failed code=${code}`);
    return { statuses: [], error: code };
  }
}

async function handleStatus(c: Caller): Promise<Response> {
  const internal = await isInternal(c);
  if (internal instanceof Response) return internal;
  if (!internal) return json({ error: "not_internal" }, 403);

  const rows = await ledgerRows(c);
  if (rows instanceof Response) return rows;

  const linear = readLinearConfig((key) => Deno.env.get(key));
  if (!linear) {
    return json({ reports: rows.map((r) => summarise(r, undefined)), trackerError: "linear_not_configured" }, 200);
  }

  const { statuses, error } = await statusesFor(c, linear, rows);
  const byIdentifier = new Map(statuses.map((s) => [s.identifier, s]));
  const reports = rows.map((r) => summarise(r, r.ticket_identifier ? byIdentifier.get(r.ticket_identifier) : undefined));
  return json(error ? { reports, trackerError: error } : { reports }, 200);
}

// ---------------------------------------------------------------------------
// POST /bug-report/verify
// ---------------------------------------------------------------------------

async function handleVerify(req: Request, c: Caller): Promise<Response> {
  const raw = await readBody(req);
  if (raw instanceof Response) return raw;
  const ticketId = typeof raw.ticketId === "string" ? raw.ticketId.trim() : "";
  if (!ticketId || issueNumber(ticketId) === null) return json({ error: "validation", field: "ticketId" }, 400);

  const internal = await isInternal(c);
  if (internal instanceof Response) return internal;
  if (!internal) return json({ error: "not_internal" }, 403);

  // Only a ticket the caller's own ledger holds can be verified from here:
  // the read is the caller's rows only (RLS plus the reporter filter), so
  // another reporter's identifier simply is not found.
  const rows = await ledgerRows(c, ticketId);
  if (rows instanceof Response) return rows;
  const row = rows[0];
  if (!row) return json({ error: "not_found" }, 404);

  const linear = readLinearConfig((key) => Deno.env.get(key));
  if (!linear) return json({ error: "tracker_not_configured" }, 503);

  const stateId = await doneState(linear);
  if (!stateId) return json({ error: "tracker_error", code: "no_done_state" }, 502);

  try {
    const issueId = await findIssueId(linear, fetch, ticketId);
    if (!issueId) return json({ error: "not_found" }, 404);
    const status = await updateIssueState(linear, fetch, issueId, stateId);
    statusCache.delete(c.userId);
    console.log(`bug-report: verified ticket=${ticketId}`);
    return json({ report: summarise(row, status) }, 200);
  } catch (e) {
    const code = e instanceof LinearError ? e.code : "linear_error";
    console.error(`bug-report: verify failed ticket=${ticketId} code=${code}`);
    return json({ error: "tracker_error", code }, code === "linear_rate_limited" ? 429 : 502);
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** 'report' | 'status' | 'verify' from the request path, whichever host prefix the gateway used. */
export function routeOf(pathname: string): "report" | "status" | "verify" | null {
  const path = pathname.replace(/\/+$/, "");
  if (path.endsWith("/bug-report")) return "report";
  if (path.endsWith("/bug-report/status")) return "status";
  if (path.endsWith("/bug-report/verify")) return "verify";
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // The preflight comes first and carries no JWT, so it is answered before
  // routing and before `caller()` would reject it as unauthenticated.
  if (isPreflight(req)) return preflight();
  const route = routeOf(new URL(req.url).pathname);
  if (!route) return json({ error: "not_found" }, 404);
  const expected = route === "status" ? "GET" : "POST";
  if (req.method !== expected) return json({ error: "method_not_allowed" }, 405);

  const c = caller(req);
  if (c instanceof Response) return c;

  if (route === "status") return await handleStatus(c);
  if (route === "verify") return await handleVerify(req, c);
  return await handleReport(req, c);
});
