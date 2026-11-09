import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type BugReportInput, type BugReportResult, type BugsApi } from '@bevi/shared';
import { mapError } from './errors';

// The internal bug reporter's client half (docs/bug-workflow.md).
//
// Two steps, in this order and only on submit:
//   1. the screenshot, if there is one, goes into the PRIVATE `bug-evidence`
//      bucket under the caller's own folder. Storage RLS
//      (20261102000500_bug_reports.sql) accepts the insert only from an
//      internal reporter, so an ordinary account cannot even stage a file.
//   2. the `bug-report` Edge Function is invoked with the caller's JWT. It
//      redacts, claims the idempotency slot, talks to Linear, and answers with
//      the identifier Linear assigned.
//
// The tracker credential lives in the function's environment. Nothing in this
// file, and nothing the app bundles, can reach it. The evidence object is
// never given a public URL: the function reads it with the service role and
// hands the bytes to Linear.

const EVIDENCE_BUCKET = 'bug-evidence';
const FUNCTION_NAME = 'bug-report';

// Matches the bucket's `allowed_mime_types`. Narrower than media.upload's list
// on purpose: `preparePhoto` in the app re-encodes everything to JPEG, and a
// HEIC that reached Linear unconverted would be unviewable in the browser.
const EXT_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Matches the bucket's `file_size_limit`.
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** The function's error codes, mapped to the contract's. */
const ERROR_CODES: Record<string, { code: ConstructorParameters<typeof ApiError>[0]; message: string }> = {
  unauthorized: { code: 'unauthorized', message: 'Sign in again to report a bug' },
  not_internal: { code: 'unauthorized', message: 'This account cannot file internal bug reports' },
  rate_limited: { code: 'rate_limited', message: 'Too many reports in the last hour' },
  in_progress: { code: 'conflict', message: 'That report is already being sent' },
  payload_too_large: { code: 'validation', message: 'That report is too large to send' },
  invalid_json: { code: 'validation', message: 'That report could not be read' },
  invalid_request: { code: 'validation', message: 'That report could not be read' },
  tracker_not_configured: { code: 'unknown', message: 'The issue tracker is not configured yet' },
  tracker_error: { code: 'unknown', message: "The issue tracker didn't accept the report" },
  database_error: { code: 'unknown', message: "The report couldn't be recorded" },
  database_unreachable: { code: 'network', message: "The report couldn't be sent" },
  not_configured: { code: 'unknown', message: 'The reporting service is not configured' },
};

interface FunctionErrorBody {
  error?: string;
  field?: string;
  message?: string;
}

/**
 * supabase-js's `functions.invoke` rejects with a `FunctionsHttpError` whose
 * body has to be read off the attached `Response`, so the function's own error
 * code is only reachable asynchronously. Anything it cannot read becomes
 * 'unknown' rather than a guess.
 */
async function mapFunctionError(error: unknown): Promise<ApiError> {
  const response = (error as { context?: Response } | null)?.context;
  if (response && typeof response.json === 'function') {
    let body: FunctionErrorBody | null = null;
    try {
      body = (await response.json()) as FunctionErrorBody;
    } catch {
      body = null;
    }
    if (body?.error === 'validation') {
      return new ApiError('validation', body.message ?? 'Check the report and try again', {
        field: body.field,
      });
    }
    const known = body?.error ? ERROR_CODES[body.error] : undefined;
    if (known) return new ApiError(known.code, known.message, body?.error);
    if (response.status === 401 || response.status === 403) {
      return new ApiError('unauthorized', 'This account cannot file internal bug reports');
    }
    if (response.status === 429) return new ApiError('rate_limited', 'Too many reports in the last hour');
  }
  return mapError(error);
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
      if (!UUID_RE.test(input.idempotencyKey ?? '')) {
        throw new ApiError('validation', 'Missing submission key', { field: 'idempotencyKey' });
      }

      let evidencePath: string | null = null;
      if (input.evidence) {
        const ext = EXT_BY_MIME_TYPE[input.evidence.mimeType];
        if (!ext) {
          throw new ApiError('validation', 'Attach a JPEG, PNG or WebP image', { field: 'evidence' });
        }
        if (typeof input.evidence.file?.size === 'number' && input.evidence.file.size > MAX_EVIDENCE_BYTES) {
          throw new ApiError('validation', 'That screenshot is too large', { field: 'evidence' });
        }
        const path = `${uid}/${randomId()}.${ext}`;
        const { error } = await client.storage
          .from(EVIDENCE_BUCKET)
          .upload(path, input.evidence.file, { contentType: input.evidence.mimeType });
        if (error) throw mapError(error);
        evidencePath = path;
      }

      const { data, error } = await client.functions.invoke<BugReportResult>(FUNCTION_NAME, {
        body: {
          title,
          description: input.description ?? '',
          reproductionSteps: input.reproductionSteps ?? [],
          expected: input.expected ?? '',
          actual: input.actual ?? '',
          environment: input.environment ?? {},
          evidencePath,
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
  };
}
