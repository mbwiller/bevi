// bug-report: the authenticated server side of the in-app bug reporter.
//
// One POST, from the app's `api.bugs.report()` (packages/api/src/bugs.ts),
// carrying the caller's user JWT. The function validates and redacts the
// report, claims an idempotency slot in `public.bug_reports`, creates the
// Linear issue, and answers with the identifier Linear assigned.
//
// ---------------------------------------------------------------------------
// AUTHORISATION. `verify_jwt = true` in config.toml is the outer gate, and on
// its own it proves only that the caller holds a key this project issued --
// graph-query's header comment makes the same point, and the publishable key
// ships in every copy of the app. So the real check is a database one: every
// request calls `claim_bug_report()` AS THE CALLER, and that function raises
// BEVI_UNAUTHORIZED unless `profiles.role` is 'admin' or 'tester'. Hiding the
// Report a bug button in the client is cosmetic; this is the gate.
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

import { parseReport, buildDescription, ValidationError, type EvidenceOutcome } from "./issue.ts";
import { createIssue, findTriageStateId, LinearError, readLinearConfig, uploadFile, type LinearConfig } from "./linear.ts";

/** Bigger than any screenshot-free report; the evidence itself never comes through this body. */
const MAX_BODY_BYTES = 64 * 1024;
const EVIDENCE_BUCKET = "bug-evidence";
/** Matches the bucket's `file_size_limit` in 20261102000500_bug_reports.sql. */
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
  evidence_path: string | null;
  claimed: boolean;
}

/** The reporter's handle, for the issue's Reporter line. Falls back to the id's prefix. */
async function reporterHandle(env: Env, jwt: string, userId: string): Promise<string> {
  try {
    const response = await fetch(`${env.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=handle`, {
      headers: { apikey: env.anonKey, Authorization: `Bearer ${jwt}` },
    });
    if (!response.ok) return userId.slice(0, 8);
    const rows = (await response.json()) as { handle?: string }[];
    return rows[0]?.handle ?? userId.slice(0, 8);
  } catch {
    return userId.slice(0, 8);
  }
}

/** Reads the private evidence object with the service role. The app never gets a URL for it. */
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

/** Removes an evidence object whose report never became a ticket, so nothing is orphaned. */
async function deleteEvidence(env: Env, path: string): Promise<void> {
  try {
    await fetch(`${env.url}/storage/v1/object/${EVIDENCE_BUCKET}/${path}`, {
      method: "DELETE",
      headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
    });
  } catch {
    // The retention sweep (scripts/bugs/purge-evidence.ts) is the backstop.
  }
}

/** Records the outcome against the ledger row as the service role. */
async function finish(
  env: Env,
  id: number,
  state: "created" | "failed",
  extra: { identifier?: string; url?: string; errorCode?: string },
): Promise<void> {
  try {
    await fetch(`${env.url}/rest/v1/rpc/finish_bug_report`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_id: id,
        p_state: state,
        p_ticket_identifier: extra.identifier ?? null,
        p_ticket_url: extra.url ?? null,
        p_error_code: extra.errorCode ?? null,
      }),
    });
  } catch {
    // The ledger row stays 'pending' and goes stale, which claim_bug_report()
    // already treats as retryable. Losing this write must not lose the ticket.
  }
}

/** Resolved once per cold start: the lookup is a round trip we do not need per report. */
let triageStateId: string | null | undefined;

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const env = readEnv();
  if (!env) return json({ error: "not_configured" }, 500);

  const authorization = req.headers.get("Authorization") ?? "";
  const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const userId = jwt ? subjectOf(jwt) : null;
  if (!jwt || !userId) return json({ error: "unauthorized" }, 401);

  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
    raw = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  let report;
  try {
    report = parseReport((raw ?? {}) as Record<string, unknown>);
  } catch (e) {
    if (e instanceof ValidationError) return json({ error: "validation", field: e.field, message: e.message }, 400);
    return json({ error: "invalid_request" }, 400);
  }

  // Authorisation, rate limit and the idempotency slot, all under auth.uid().
  let claim: ClaimRow;
  try {
    const response = await rpc(env, jwt, "claim_bug_report", {
      p_idempotency_key: report.idempotencyKey,
      p_evidence_path: report.evidencePath,
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
    await finish(env, claim.id, "failed", { errorCode: "linear_not_configured" });
    if (claim.evidence_path) await deleteEvidence(env, claim.evidence_path);
    console.error(`bug-report: LINEAR_API_KEY/LINEAR_TEAM_ID missing key=${fingerprint}`);
    return json({ error: "tracker_not_configured" }, 503);
  }

  // Evidence first: the issue body embeds the asset URL, and a screenshot that
  // cannot be uploaded must not cost the reporter their ticket.
  let evidence: EvidenceOutcome = { kind: "none" };
  if (claim.evidence_path) {
    const file = await readEvidence(env, claim.evidence_path);
    if (!file) {
      evidence = { kind: "failed", reason: "the stored object could not be read" };
    } else {
      try {
        const assetUrl = await uploadFile(linear, fetch, {
          bytes: file.bytes,
          contentType: file.contentType,
          filename: `bug-${report.idempotencyKey}.${claim.evidence_path.split(".").pop()}`,
        });
        evidence = { kind: "embedded", assetUrl };
      } catch (e) {
        const code = e instanceof LinearError ? e.code : "upload_failed";
        console.error(`bug-report: evidence upload failed key=${fingerprint} code=${code}`);
        evidence = { kind: "failed", reason: code };
      }
    }
  }

  const handle = await reporterHandle(env, jwt, userId);
  const description = buildDescription(report, handle, evidence);

  try {
    const issue = await createIssue(linear, fetch, {
      title: report.title,
      description,
      stateId: await triageState(linear),
    });
    await finish(env, claim.id, "created", { identifier: issue.identifier, url: issue.url });
    console.log(`bug-report: created key=${fingerprint} ticket=${issue.identifier} evidence=${evidence.kind}`);
    return json({ ticketId: issue.identifier, ticketUrl: issue.url, status: "created" }, 201);
  } catch (e) {
    const code = e instanceof LinearError ? e.code : "linear_error";
    await finish(env, claim.id, "failed", { errorCode: code });
    // The issue does not exist, so the evidence has nothing to belong to.
    if (claim.evidence_path) await deleteEvidence(env, claim.evidence_path);
    console.error(`bug-report: create failed key=${fingerprint} code=${code}`);
    const status = code === "linear_rate_limited" ? 429 : code === "linear_unauthorized" ? 502 : 502;
    return json({ error: "tracker_error", code }, status);
  }
});
