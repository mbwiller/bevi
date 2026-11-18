import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  type BugReportInput,
  type BugReportResult,
  type BugReportSummary,
  type BugsApi,
} from '@bevi/shared';
import { mapError } from './errors';
import { uploadByteLength } from './uploads';

// The internal bug reporter's client half (docs/bug-workflow.md).
//
// `report()` is two steps, in this order and only on submit:
//   1. the screenshots, if there are any (at most three), go into the PRIVATE
//      `bug-evidence` bucket under the caller's own folder, one after another.
//      Storage RLS (20261109000300_bug_reports.sql) accepts the insert only
//      from an internal reporter, so an ordinary account cannot even stage a
//      file.
//   2. the `bug-report` Edge Function is invoked with the caller's JWT. It
//      redacts, claims the idempotency slot, files the ticket on the board
//      (the tracker), and answers with the identifier the board assigned.
// `listMine()`, `markVerified()` and `place()` are the function's other routes
// (`bug-report/status`, `bug-report/verify`, `bug-report/place`), gated the
// same way server-side.
//
// The tracker credential lives in the function's environment. Nothing in this
// file, and nothing the app bundles, can reach it. The evidence objects are
// never given a public URL: the function reads them with the service role and
// hands the bytes to the board. An object uploaded by a submission that then
// fails before the function runs is the retention sweep's to remove
// (scripts/bugs/purge-evidence.ts): the bucket has no delete policy for the
// client, on purpose.

const EVIDENCE_BUCKET = 'bug-evidence';
const FUNCTION_NAME = 'bug-report';
const STATUS_ROUTE = 'bug-report/status';
const VERIFY_ROUTE = 'bug-report/verify';
const PLACE_ROUTE = 'bug-report/place';

// Matches the bucket's `allowed_mime_types`. Narrower than media.upload's list
// on purpose: `preparePhoto` in the app re-encodes everything to JPEG, and a
// HEIC that reached the board unconverted would be unviewable in the browser.
const EXT_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Matches the bucket's `file_size_limit`.
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
// Matches `cardinality(evidence_paths) <= 3` on the ledger.
const MAX_EVIDENCE = 3;
// The function keeps the first 6 (redact.ts `TARGET_LIMITS.count`); sending more is wasted bytes.
const MAX_TARGETS = 6;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_RE = /^[A-Z][A-Z0-9]*-\d{1,9}$/;

function randomId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

/**
 * The function's error codes, mapped to the contract's. A tracker failure
 * always arrives as `tracker_error` (its `code`, e.g. `board_unreachable`, is
 * for the log, not the app), and a code not listed here falls back to the
 * HTTP status and then to 'unknown'.
 */
const ERROR_CODES: Record<string, { code: ConstructorParameters<typeof ApiError>[0]; message: string }> = {
  unauthorized: { code: 'unauthorized', message: 'Sign in again to report a bug' },
  not_internal: { code: 'unauthorized', message: 'This account cannot file internal bug reports' },
  not_found: { code: 'not_found', message: "That ticket isn't one of yours" },
  rate_limited: { code: 'rate_limited', message: 'Too many reports in the last hour' },
  in_progress: { code: 'conflict', message: 'That report is already being sent' },
  payload_too_large: { code: 'validation', message: 'That report is too large to send' },
  invalid_json: { code: 'validation', message: 'That report could not be read' },
  invalid_request: { code: 'validation', message: 'That report could not be read' },
  method_not_allowed: { code: 'unknown', message: 'The reporting service refused the request' },
  tracker_not_configured: { code: 'unknown', message: 'The issue tracker is not configured yet' },
  tracker_error: { code: 'unknown', message: "The issue tracker didn't accept the request" },
  database_error: { code: 'unknown', message: "The report couldn't be recorded" },
  database_unreachable: { code: 'network', message: "The report couldn't be sent" },
  not_configured: { code: 'unknown', message: 'The reporting service is not configured' },
};

interface FunctionErrorBody {
  error?: string;
  field?: string;
  message?: string;
  /** Set by the place route on its own not-found; absent from a function that predates it. */
  route?: string;
  /** The place route's `not_open`: the ticket is the caller's, but no longer open. */
  reason?: string;
}

interface FunctionErrorResponse {
  status: number;
  body: FunctionErrorBody | null;
}

/**
 * supabase-js's `functions.invoke` rejects with a `FunctionsHttpError` whose
 * body has to be read off the attached `Response`, so the function's own error
 * code is only reachable asynchronously. Null when there is no response to read.
 */
async function readFunctionError(error: unknown): Promise<FunctionErrorResponse | null> {
  const response = (error as { context?: Response } | null)?.context;
  if (!response || typeof response.json !== 'function') return null;
  let body: FunctionErrorBody | null = null;
  try {
    body = (await response.json()) as FunctionErrorBody;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/** The function's error, as the contract's. Anything it cannot read becomes 'unknown' rather than a guess. */
async function mapFunctionError(error: unknown, read?: FunctionErrorResponse | null): Promise<ApiError> {
  const answer = read === undefined ? await readFunctionError(error) : read;
  if (answer) {
    const { body, status } = answer;
    if (body?.error === 'validation') {
      return new ApiError('validation', body.message ?? 'Check the report and try again', {
        field: body.field,
      });
    }
    const known = body?.error ? ERROR_CODES[body.error] : undefined;
    if (known) return new ApiError(known.code, known.message, body?.error);
    if (status === 401 || status === 403) {
      return new ApiError('unauthorized', 'This account cannot file internal bug reports');
    }
    if (status === 404) return new ApiError('not_found', "That ticket isn't one of yours");
    if (status === 429) return new ApiError('rate_limited', 'Too many reports in the last hour');
  }
  return mapError(error);
}

const STATES: readonly BugReportSummary['state'][] = ['triage', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'unknown'];

/** Accepts only the shape the contract promises; anything else is a tracker fault, not a phantom row. */
function toSummary(raw: unknown): BugReportSummary | null {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof r.ticketId !== 'string' || !r.ticketId || typeof r.ticketUrl !== 'string' || !r.ticketUrl) return null;
  const state = STATES.includes(r.state as BugReportSummary['state']) ? (r.state as BugReportSummary['state']) : 'unknown';
  return {
    ticketId: r.ticketId,
    ticketUrl: r.ticketUrl,
    title: typeof r.title === 'string' ? r.title : '',
    kind: (r.kind as BugReportSummary['kind']) ?? 'bug',
    severity: (r.severity as BugReportSummary['severity']) ?? 'annoying',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    state,
    stateLabel: typeof r.stateLabel === 'string' ? r.stateLabel : null,
    priority: typeof r.priority === 'number' ? r.priority : null,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
    rank: typeof r.rank === 'number' && Number.isInteger(r.rank) && r.rank > 0 ? r.rank : null,
  };
}

function toSummaries(raw: unknown): BugReportSummary[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.map(toSummary).filter((r): r is BugReportSummary => r !== null);
}

export function createBugsApi(client: SupabaseClient): BugsApi {
  return {
    async canReport(): Promise<boolean> {
      const { data, error } = await client.rpc('can_report_bugs');
      // Signed out, or the function is not there: not a reporter. This gate
      // only decides whether to show an entry point, so it never throws for a
      // signed-in ordinary user.
      if (error) return false;
      return data === true;
    },

    async report(input: BugReportInput): Promise<BugReportResult> {
      const uid = await requireUserId(client);

      const title = input.title?.trim() ?? '';
      if (!title) throw new ApiError('validation', 'Say what went wrong', { field: 'title' });
      if (!['bug', 'fix', 'idea', 'design'].includes(input.kind)) {
        throw new ApiError('validation', 'Say what kind of report this is', { field: 'kind' });
      }
      if (!['blocker', 'bad', 'annoying', 'polish'].includes(input.severity)) {
        throw new ApiError('validation', 'Say how bad it is', { field: 'severity' });
      }
      if (!UUID_RE.test(input.idempotencyKey ?? '')) {
        throw new ApiError('validation', 'Missing submission key', { field: 'idempotencyKey' });
      }

      // Every attachment is checked before any of them is uploaded, so a bad
      // third file does not leave the first two staged.
      const evidence = input.evidence ?? [];
      if (evidence.length > MAX_EVIDENCE) {
        throw new ApiError('validation', `Attach at most ${MAX_EVIDENCE} screenshots`, { field: 'evidence' });
      }
      const planned: { file: Blob; mimeType: string; ext: string; caption: string }[] = [];
      for (const item of evidence) {
        const ext = EXT_BY_MIME_TYPE[item.mimeType];
        if (!ext) throw new ApiError('validation', 'Attach a JPEG, PNG or WebP image', { field: 'evidence' });
        // `uploadByteLength` reads `.size` or `.byteLength`, whichever the
        // payload has, and 0 when it has neither -- same tolerance as the
        // `typeof ... === 'number'` guard it replaces, now that media uploads
        // may be raw bytes (uploads.ts).
        if (uploadByteLength(item.file) > MAX_EVIDENCE_BYTES) {
          throw new ApiError('validation', 'That screenshot is too large', { field: 'evidence' });
        }
        planned.push({ file: item.file, mimeType: item.mimeType, ext, caption: typeof item.caption === 'string' ? item.caption : '' });
      }

      const evidencePaths: string[] = [];
      for (const item of planned) {
        const path = `${uid}/${randomId()}.${item.ext}`;
        // WEB-ONLY until the bug reporter is ported to native (IM-10).
        //
        // Unlike `media.upload`, this hands the payload to Storage with no
        // `toUploadBody()`, and `BugReportInput.evidence[].file` is still
        // typed `Blob` -- so a React Native Blob would store 0 bytes here with
        // no error, exactly the trap `media.ts` now refuses. That is safe only
        // because nothing off the web calls this yet.
        //
        // When the reporter is ported: widen the evidence payload to
        // `UploadPayload` in the contract (its own bump), measure with
        // `uploadByteLength()` as the check above already does, and pass
        // `toUploadBody(item.file)` here so the RN guard applies.
        const { error } = await client.storage
          .from(EVIDENCE_BUCKET)
          .upload(path, item.file, { contentType: item.mimeType });
        if (error) throw mapError(error);
        evidencePaths.push(path);
      }

      const { data, error } = await client.functions.invoke<BugReportResult>(FUNCTION_NAME, {
        body: {
          kind: input.kind,
          severity: input.severity,
          title,
          description: input.description ?? '',
          reproductionSteps: input.reproductionSteps ?? [],
          expected: input.expected ?? '',
          actual: input.actual ?? '',
          environment: input.environment ?? {},
          breadcrumbs: input.breadcrumbs ?? [],
          targets: (input.targets ?? []).slice(0, MAX_TARGETS),
          stepsSource: input.stepsSource ?? 'typed',
          evidencePaths,
          // One per uploaded path, in the same order.
          evidenceCaptions: planned.map((item) => item.caption),
          idempotencyKey: input.idempotencyKey,
        },
      });
      if (error) throw await mapFunctionError(error);

      // Never show a ticket the provider did not confirm.
      if (!data?.ticketId || !data.ticketUrl) {
        throw new ApiError('unknown', "The issue tracker didn't return a ticket");
      }
      return { ticketId: data.ticketId, ticketUrl: data.ticketUrl, status: data.status === 'duplicate' ? 'duplicate' : 'created' };
    },

    async listMine(): Promise<BugReportSummary[]> {
      await requireUserId(client);
      const { data, error } = await client.functions.invoke<{ reports?: unknown[] }>(STATUS_ROUTE, { method: 'GET' });
      if (error) throw await mapFunctionError(error);
      return toSummaries(data?.reports);
    },

    async markVerified(ticketId: string): Promise<BugReportSummary> {
      await requireUserId(client);
      const id = ticketId?.trim() ?? '';
      if (!TICKET_RE.test(id)) throw new ApiError('validation', 'That is not a ticket identifier', { field: 'ticketId' });
      const { data, error } = await client.functions.invoke<{ report?: unknown }>(VERIFY_ROUTE, { body: { ticketId: id } });
      if (error) throw await mapFunctionError(error);
      const summary = toSummary(data?.report);
      if (!summary) throw new ApiError('unknown', "The issue tracker didn't confirm the change");
      return summary;
    },

    async place(ticketId: string, afterTicketId: string | null): Promise<BugReportSummary[]> {
      await requireUserId(client);
      const id = ticketId?.trim() ?? '';
      if (!TICKET_RE.test(id)) throw new ApiError('validation', 'That is not a ticket identifier', { field: 'ticketId' });
      const after = afterTicketId === null || afterTicketId === undefined ? null : afterTicketId.trim();
      if (after !== null && !TICKET_RE.test(after)) {
        throw new ApiError('validation', 'That is not a ticket identifier', { field: 'afterTicketId' });
      }
      if (after === id) throw new ApiError('validation', 'A ticket cannot be placed after itself', { field: 'afterTicketId' });

      const { data, error } = await client.functions.invoke<{ reports?: unknown[] }>(PLACE_ROUTE, {
        body: { ticketId: id, afterTicketId: after },
      });
      if (error) {
        const read = await readFunctionError(error);
        // The place route's own not-found carries `route: 'place'`. A bare 404
        // is a deployed function that does not know this route yet.
        if (read?.status === 404 && read.body?.route !== 'place') {
          throw new ApiError('unknown', 'Ranking is not available on the server yet', { reason: 'place_unsupported' });
        }
        if (read?.status === 404 && read.body?.reason === 'not_open') {
          throw new ApiError('conflict', "That report isn't open any more", { reason: 'not_open' });
        }
        if (read?.status === 404) throw new ApiError('not_found', "That report isn't one of yours", { reason: 'not_found' });
        throw await mapFunctionError(error, read);
      }
      return toSummaries(data?.reports);
    },
  };
}
