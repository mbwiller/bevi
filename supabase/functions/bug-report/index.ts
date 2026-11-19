// bug-report: the authenticated server side of the in-app bug reporter.
//
// Four routes, all from `api.bugs` (packages/api/src/bugs.ts), all carrying
// the caller's user JWT:
//   POST .../bug-report          file a report: validate and redact, claim an
//                                idempotency slot in `public.bug_reports`,
//                                file the ticket on the board, answer with the
//                                identifier the board assigned (`T-19`).
//   GET  .../bug-report/status   the caller's own tickets with their live
//                                state on the board, for My reports.
//   POST .../bug-report/verify   move one of the caller's tickets to Done,
//                                once they have checked the fix on the device.
//   POST .../bug-report/place    put one of the caller's open tickets in their
//                                ranked list: its place in the board's one
//                                shared order and the priority the position
//                                implies (rank.ts).
//
// THE TRACKER is the founders' board (board.ts), reached with two secrets,
// BOARD_INTAKE_URL and BOARD_INTAKE_TOKEN. Without them, or with values that
// cannot be used, no ticket is filed, read or changed, and every route says
// that no tracker is configured. A ticket filed before 2026-11-17 is named in
// the ledger by an earlier name like `BEV-7`; the board answers to that name
// too, so ledger identifiers go to the board unchanged.
//
// ---------------------------------------------------------------------------
// AUTHORISATION. `verify_jwt = true` in config.toml is the outer gate, and on
// its own it proves only that the caller holds a key this project issued --
// graph-query's header comment makes the same point, and the publishable key
// ships in every copy of the app. So the real check is a database one: the
// report route calls `claim_bug_report()` AS THE CALLER, and the status,
// verify and place routes call `can_report_bugs()` AS THE CALLER; both answer
// from `profiles.role` under auth.uid(). The ledger is read AS THE CALLER too and
// filtered to the caller's reporter_id (the select policy also admits an
// admin, and these routes are own-rows-only for admins as well). Hiding the
// Report a bug button in the client is cosmetic; this is the gate.
//
// The app calls this function from the browser, so cors.ts answers the
// preflight and every response carries Access-Control-Allow-Origin.
//
// The board's token is read from the environment and never leaves this
// function except to the configured board. The app never sees it, and no
// response or log line here contains it, the service-role key, or the
// reporter's evidence.
// ---------------------------------------------------------------------------
//
// Deno conventions follow graph-query and embed: no remote imports (deno.json
// has an empty import map) and plain `fetch` against PostgREST and the Storage
// API rather than @supabase/supabase-js, so CI's `deno check` type-checks this
// file without resolving a module off the network.

import { isPreflight, preflight, withCors } from "./cors.ts";
import { type Kind, parseReport, type Severity, ValidationError } from "./issue.ts";
import {
  addPicture,
  type BoardConfig,
  boardMisconfigured,
  BoardError,
  buildBoardBody,
  fetchBoardStatuses,
  fileTicket,
  MAX_PICTURE_BYTES,
  MAX_PICTURES,
  type PictureNote,
  placeBoardTicket,
  placeOf,
  priorityWord,
  readBoardConfig,
  verifyBoardTicket,
} from "./board.ts";
import { finishBugReport, ledgerQuery } from "./ledger.ts";
import { isOpen, type Ordered, positionFor, priorityForRank, ranksOf, sortedByRank } from "./rank.ts";
import { methodFor, parsePlace, routeOf } from "./routes.ts";
import { ticketNumber, type TicketStatus } from "./ticket.ts";

/** Bigger than any screenshot-free report; the evidence itself never comes through this body. */
const MAX_BODY_BYTES = 128 * 1024;
const EVIDENCE_BUCKET = "bug-evidence";
/** Matches the bucket's `file_size_limit` in 20261109000300_bug_reports.sql. */
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
/** How long one user's answer from the board is reused by the status route. */
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
  state: TicketStatus["state"];
  stateLabel: string | null;
  priority: number | null;
  updatedAt: string | null;
  /** 1-based among the caller's open tickets by the board's shared order; null otherwise. */
  rank: number | null;
}

/** The reporter's handle, which the board shows as who filed or verified the ticket. Falls back to the id's prefix. */
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

/** The status route's per-user cache of the board's answer. */
const statusCache = new Map<string, { at: number; statuses: TicketStatus[] }>();

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

/** The caller's open tickets that have a place in the board's order, as rank.ts takes them. */
function openOrdered(statuses: TicketStatus[]): Ordered[] {
  return statuses
    .filter((s) => isOpen(s.state) && s.sortOrder !== null)
    .map((s) => ({ identifier: s.identifier, sortOrder: s.sortOrder as number }));
}

/** Every ledger row as the contract's summary, ranked among the ones that are open. */
function summariseAll(rows: LedgerRow[], statuses: TicketStatus[]): Summary[] {
  const mine = new Set(rows.map((r) => r.ticket_identifier).filter(Boolean));
  const byIdentifier = new Map(statuses.filter((s) => mine.has(s.identifier)).map((s) => [s.identifier, s]));
  const ranks = ranksOf(openOrdered([...byIdentifier.values()]));
  return rows.map((r) => {
    const id = r.ticket_identifier ?? "";
    return summarise(r, byIdentifier.get(id), ranks.get(id) ?? null);
  });
}

function summarise(row: LedgerRow, status: (TicketStatus & { url?: string }) | undefined, rank: number | null = null): Summary {
  return {
    ticketId: row.ticket_identifier ?? "",
    // The board says where a ticket lives now, which for one filed before 2026-11-17 under an earlier name is no longer the ledger's URL.
    ticketUrl: status?.url || row.ticket_url || "",
    title: row.title,
    kind: row.kind,
    severity: row.severity,
    createdAt: row.created_at,
    state: status?.state ?? "unknown",
    stateLabel: status?.stateLabel ?? null,
    priority: status?.priority ?? null,
    updatedAt: status?.updatedAt ?? null,
    rank,
  };
}

// ---------------------------------------------------------------------------
// The board's configuration
// ---------------------------------------------------------------------------

let warnedAboutBoard = false;

/** The board's configuration, or null when its two secrets are missing or unusable. */
function boardConfig(): BoardConfig | null {
  const env = (key: string) => Deno.env.get(key);
  const board = readBoardConfig(env);
  if (board) return board;
  if (!warnedAboutBoard && boardMisconfigured(env)) {
    // Once per cold start, and never the values: a mistyped token must not stop reports without a trace.
    warnedAboutBoard = true;
    console.error("bug-report: BOARD_INTAKE_URL/BOARD_INTAKE_TOKEN are set but unusable (an https address and a bvb_ token are needed); no ticket can be filed until they are fixed");
  }
  return null;
}

/** A short, loggable code for whatever a board call threw. */
function trackerCode(e: unknown): string {
  return e instanceof BoardError ? e.code : "tracker_error";
}

// ---------------------------------------------------------------------------
// POST /bug-report
// ---------------------------------------------------------------------------

/**
 * Files the claimed report on the board. The pictures are read first, so the
 * ticket's write-up can say which ones came with it; the ticket is filed, and
 * then each picture is added to it. A picture that cannot be added costs the
 * reporter nothing but that picture: the ticket exists either way.
 */
async function reportToBoard(
  c: Caller,
  board: BoardConfig,
  report: ReturnType<typeof parseReport>,
  claim: ClaimRow,
  staged: string[],
  fingerprint: string,
): Promise<Response> {
  const captionByPath = new Map(report.evidencePaths.map((p, i) => [p, report.evidenceCaptions[i] ?? ""]));
  const notes: PictureNote[] = [];
  const pictures: { n: number; bytes: Uint8Array; contentType: string; caption: string }[] = [];
  for (const [i, path] of staged.entries()) {
    // A read that throws costs that picture, not the report: nothing has been filed yet and the claim must be finished either way.
    const file = i < MAX_PICTURES ? await readEvidence(c.env, path).catch(() => null) : null;
    if (!file) {
      notes.push({ kind: "left_out", reason: i < MAX_PICTURES ? "the stored object could not be read" : "more pictures than a ticket holds" });
    } else if (file.bytes.byteLength > MAX_PICTURE_BYTES) {
      notes.push({ kind: "left_out", reason: "larger than the board takes" });
    } else {
      const caption = captionByPath.get(path) ?? "";
      // Numbered by its place among the attached pictures, so it matches the "Screenshot N" a pointed-at component names.
      pictures.push({ n: i + 1, bytes: file.bytes, contentType: file.contentType, caption });
      notes.push({ kind: "sent", caption });
    }
  }

  const handle = await reporterHandle(c.env, c.jwt, c.userId);
  let filed;
  try {
    filed = await fileTicket(board, fetch, {
      key: report.idempotencyKey,
      title: report.title,
      kind: report.kind,
      said: report.description,
      body: buildBoardBody(report, notes),
      handle,
      place: placeOf(report),
    });
  } catch (e) {
    const code = trackerCode(e);
    await finish(c.env, claim.id, "failed", { errorCode: code });
    // The ticket does not exist, so the evidence has nothing to belong to.
    await deleteEvidence(c.env, staged);
    console.error(`bug-report: create failed key=${fingerprint} tracker=board code=${code}`);
    return json({ error: "tracker_error", code }, 502);
  }

  let added = 0;
  for (const picture of pictures) {
    try {
      await addPicture(board, fetch, { key: report.idempotencyKey, ...picture });
      added++;
    } catch (e) {
      console.error(`bug-report: picture not added key=${fingerprint} n=${picture.n} code=${trackerCode(e)}`);
    }
  }

  await finish(c.env, claim.id, "created", { identifier: filed.ref, url: filed.url });
  statusCache.delete(c.userId);
  console.log(
    `bug-report: created key=${fingerprint} tracker=board ticket=${filed.ref} kind=${report.kind} evidence=${added}/${staged.length} targets=${report.targets.length} steps=${report.stepsSource}`,
  );
  return json({ ticketId: filed.ref, ticketUrl: filed.url, status: filed.duplicate ? "duplicate" : "created" }, filed.duplicate ? 200 : 201);
}

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

  const board = boardConfig();
  if (!board) {
    await finish(c.env, claim.id, "failed", { errorCode: "tracker_not_configured" });
    await deleteEvidence(c.env, staged);
    console.error(`bug-report: no tracker configured (BOARD_INTAKE_URL/BOARD_INTAKE_TOKEN) key=${fingerprint}`);
    return json({ error: "tracker_not_configured" }, 503);
  }
  return await reportToBoard(c, board, report, claim, staged, fingerprint);
}

// ---------------------------------------------------------------------------
// GET /bug-report/status
// ---------------------------------------------------------------------------

async function statusesFor(
  c: Caller,
  board: BoardConfig,
  rows: LedgerRow[],
  { fresh = false }: { fresh?: boolean } = {},
): Promise<{ statuses: TicketStatus[]; error?: string }> {
  const cached = fresh ? undefined : statusCache.get(c.userId);
  if (cached && Date.now() - cached.at < STATUS_CACHE_MS) return { statuses: cached.statuses };
  try {
    // The board is asked by the ledger's names, so a ticket filed before 2026-11-17 is found under its earlier name.
    const statuses = await fetchBoardStatuses(board, fetch, rows.map((r) => r.ticket_identifier ?? "").filter(Boolean));
    statusCache.set(c.userId, { at: Date.now(), statuses });
    return { statuses };
  } catch (e) {
    const code = trackerCode(e);
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

  const board = boardConfig();
  if (!board) {
    return json({ reports: rows.map((r) => summarise(r, undefined)), trackerError: "tracker_not_configured" }, 200);
  }

  const { statuses, error } = await statusesFor(c, board, rows);
  const reports = summariseAll(rows, statuses);
  return json(error ? { reports, trackerError: error } : { reports }, 200);
}

// ---------------------------------------------------------------------------
// POST /bug-report/verify
// ---------------------------------------------------------------------------

async function handleVerify(req: Request, c: Caller): Promise<Response> {
  const raw = await readBody(req);
  if (raw instanceof Response) return raw;
  const ticketId = typeof raw.ticketId === "string" ? raw.ticketId.trim() : "";
  if (!ticketId || ticketNumber(ticketId) === null) return json({ error: "validation", field: "ticketId" }, 400);

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

  const board = boardConfig();
  if (!board) return json({ error: "tracker_not_configured" }, 503);
  try {
    const status = await verifyBoardTicket(board, fetch, ticketId, await reporterHandle(c.env, c.jwt, c.userId));
    statusCache.delete(c.userId);
    console.log(`bug-report: verified ticket=${ticketId} tracker=board`);
    return json({ report: summarise(row, status) }, 200);
  } catch (e) {
    const code = trackerCode(e);
    console.error(`bug-report: verify failed ticket=${ticketId} tracker=board code=${code}`);
    return json({ error: "tracker_error", code }, 502);
  }
}

// ---------------------------------------------------------------------------
// POST /bug-report/place
// ---------------------------------------------------------------------------

/**
 * The place route's not-found. The `route` key is how the client tells it
 * from a deployed function that predates this route, which answers a bare
 * `{ error: "not_found" }` for any path it does not know.
 *
 * `reason: "not_open"` is added only once both tickets have passed the
 * ledger check, i.e. both are the caller's own: it says one of them is in
 * review, closed, of unknown state or has no place in the board's order, and
 * reveals nothing about anyone else's tickets.
 */
function placeNotFound(reason?: "not_open"): Response {
  return json(reason ? { error: "not_found", route: "place", reason } : { error: "not_found", route: "place" }, 404);
}

function trackerFailure(e: unknown, ticketId: string): Response {
  const code = trackerCode(e);
  console.error(`bug-report: place failed ticket=${ticketId} code=${code}`);
  return json({ error: "tracker_error", code }, 502);
}

async function handlePlace(req: Request, c: Caller): Promise<Response> {
  const raw = await readBody(req);
  if (raw instanceof Response) return raw;
  const parsed = parsePlace(raw);
  if ("field" in parsed) return json({ error: "validation", field: parsed.field }, 400);
  const { ticketId, afterTicketId } = parsed;

  const internal = await isInternal(c);
  if (internal instanceof Response) return internal;
  if (!internal) return json({ error: "not_internal" }, 403);

  // The caller's rows only (RLS plus the reporter filter), so another
  // reporter's identifier is simply not in this list.
  const rows = await ledgerRows(c);
  if (rows instanceof Response) return rows;
  const mine = new Set(rows.map((r) => r.ticket_identifier).filter(Boolean));
  if (!mine.has(ticketId) || (afterTicketId !== null && !mine.has(afterTicketId))) return placeNotFound();

  const board = boardConfig();
  if (!board) return json({ error: "tracker_not_configured" }, 503);

  // Fresh, never the cache: a placement computed against a minute-old order
  // could land a ticket somewhere the reporter did not put it.
  let statuses: TicketStatus[];
  try {
    statuses = (await fetchBoardStatuses(board, fetch, [...mine] as string[])).filter((s) => mine.has(s.identifier));
  } catch (e) {
    return trackerFailure(e, ticketId);
  }

  const order = sortedByRank(openOrdered(statuses));
  const movingStatus = statuses.find((s) => s.identifier === ticketId);
  const isListed = (id: string) => order.some((o) => o.identifier === id);
  if (!movingStatus || !isListed(ticketId) || (afterTicketId !== null && !isListed(afterTicketId))) return placeNotFound("not_open");

  const position = positionFor(order, ticketId, afterTicketId);
  const priority = priorityForRank(position.index, order.length, movingStatus.priority);

  // The board keeps one order for everyone and rewrites it itself: say only
  // which of the caller's tickets this one follows, or, for the top of their
  // list, which one it now comes before. With no other open ticket of theirs
  // there is nothing to be placed against, and nothing is moved.
  const top = order.find((o) => o.identifier !== ticketId)?.identifier ?? null;
  try {
    if (afterTicketId !== null || top !== null) {
      await placeBoardTicket(board, fetch, ticketId, afterTicketId !== null ? { after: afterTicketId, priority: priorityWord(priority) } : { before: top, priority: priorityWord(priority) });
    }
    console.log(`bug-report: placed ticket=${ticketId} tracker=board index=${position.index} priority=${priority}`);
  } catch (e) {
    // The board refuses a ticket that stopped being open between the read and the write.
    if (e instanceof BoardError && e.code === "board_refused") return placeNotFound("not_open");
    return trackerFailure(e, ticketId);
  } finally {
    statusCache.delete(c.userId);
  }

  // Read back, as the status route would.
  const { statuses: after, error } = await statusesFor(c, board, rows, { fresh: true });
  const reports = summariseAll(rows, after);
  return json(error ? { reports, trackerError: error } : { reports }, 200);
}

// ---------------------------------------------------------------------------
// Dispatch (routeOf lives in routes.ts so test.ts can import it)
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // The preflight comes first and carries no JWT, so it is answered before
  // routing and before `caller()` would reject it as unauthenticated.
  if (isPreflight(req)) return preflight();
  const route = routeOf(new URL(req.url).pathname);
  if (!route) return json({ error: "not_found" }, 404);
  if (req.method !== methodFor(route)) return json({ error: "method_not_allowed" }, 405);

  const c = caller(req);
  if (c instanceof Response) return c;

  if (route === "status") return await handleStatus(c);
  if (route === "verify") return await handleVerify(req, c);
  if (route === "place") return await handlePlace(req, c);
  return await handleReport(req, c);
});
