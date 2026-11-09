import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBugsApi } from '../src/bugs.ts';

// bugs.* against a stand-in client. What matters here and needs no live
// stack: nothing is uploaded or invoked until the input validates, the private
// bucket is the one written to, the function is never told a tracker
// credential, the function's error codes become the contract's error codes,
// and a response without a confirmed ticket is refused rather than shown.
//
// The Postgres half (claim_bug_report's authorisation, the idempotency ledger,
// the storage policy) is pgTAP's: supabase/tests/28_bug_reports.test.sql.

const KEY = '4f1d6c0a-4f4c-4f0e-9e0b-9a4a8f2b7c11';

interface Calls {
  rpc?: string;
  uploads: { bucket: string; path: string }[];
  invokes: { name: string; init: { body?: Record<string, unknown>; method?: string } | undefined }[];
}

interface Options {
  rpcData?: unknown;
  rpcError?: unknown;
  /** Fails the nth upload (0-based). */
  uploadErrorAt?: number;
  uploadError?: unknown;
  invokeData?: unknown;
  invokeError?: unknown;
  user?: { id: string } | null;
}

function newCalls(): Calls {
  return { uploads: [], invokes: [] };
}

function fakeClient(calls: Calls = newCalls(), options: Options = {}): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({
        data: { user: options.user === undefined ? { id: '00000000-0000-4000-8000-00000000000a' } : options.user },
        error: options.user === null ? { message: 'no session' } : null,
      }),
    },
    rpc: (name: string) => {
      calls.rpc = name;
      return Promise.resolve({ data: options.rpcData ?? null, error: options.rpcError ?? null });
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          const index = calls.uploads.length;
          calls.uploads.push({ bucket, path });
          const fails = options.uploadError && (options.uploadErrorAt === undefined || options.uploadErrorAt === index);
          return Promise.resolve({ data: { path }, error: fails ? options.uploadError : null });
        },
      }),
    },
    functions: {
      invoke: (name: string, init?: { body?: Record<string, unknown>; method?: string }) => {
        calls.invokes.push({ name, init });
        return Promise.resolve({ data: options.invokeData ?? null, error: options.invokeError ?? null });
      },
    },
  } as unknown as SupabaseClient;
}

/** A `FunctionsHttpError` as supabase-js builds it: the body hangs off `context`. */
function functionError(status: number, body: unknown): unknown {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  };
}

const CREATED = { ticketId: 'BEV-207', ticketUrl: 'https://linear.app/bevi/issue/BEV-207', status: 'created' };
const BASE = { kind: 'bug', severity: 'bad', title: 'x', idempotencyKey: KEY } as const;
const jpeg = (size = 1000) => ({ file: { size } as unknown as Blob, mimeType: 'image/jpeg' });

describe('bugs.canReport', () => {
  it('asks the database, and answers false rather than throwing for an ordinary user', async () => {
    const calls = newCalls();
    expect(await createBugsApi(fakeClient(calls, { rpcData: false })).canReport()).toBe(false);
    expect(calls.rpc).toBe('can_report_bugs');

    expect(await createBugsApi(fakeClient(newCalls(), { rpcData: true })).canReport()).toBe(true);
    expect(await createBugsApi(fakeClient(newCalls(), { rpcError: { message: 'permission denied' } })).canReport()).toBe(false);
  });
});

describe('bugs.report validation', () => {
  it('rejects an empty title before uploading anything or invoking the function', async () => {
    const calls = newCalls();
    await expect(createBugsApi(fakeClient(calls)).report({ ...BASE, title: '   ' })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'title' },
    });
    expect(calls.uploads).toEqual([]);
    expect(calls.invokes).toEqual([]);
  });

  it('rejects an unknown kind or severity with the field name', async () => {
    const calls = newCalls();
    const api = createBugsApi(fakeClient(calls));
    await expect(api.report({ ...BASE, kind: 'rant' as never })).rejects.toMatchObject({ code: 'validation', detail: { field: 'kind' } });
    await expect(api.report({ ...BASE, severity: 'meh' as never })).rejects.toMatchObject({ code: 'validation', detail: { field: 'severity' } });
    expect(calls.invokes).toEqual([]);
  });

  it('rejects a missing or malformed idempotency key', async () => {
    const calls = newCalls();
    await expect(createBugsApi(fakeClient(calls)).report({ ...BASE, idempotencyKey: 'nope' })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'idempotencyKey' },
    });
    expect(calls.invokes).toEqual([]);
  });

  it('rejects an unsupported, oversized or fourth attachment before anything leaves the device', async () => {
    const calls = newCalls();
    const api = createBugsApi(fakeClient(calls));
    await expect(api.report({ ...BASE, evidence: [{ file: { size: 10 } as unknown as Blob, mimeType: 'image/gif' }] })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'evidence' },
    });
    await expect(api.report({ ...BASE, evidence: [jpeg(10 * 1024 * 1024 + 1)] })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'evidence' },
    });
    await expect(api.report({ ...BASE, evidence: [jpeg(), jpeg(), jpeg(), jpeg()] })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'evidence' },
    });
    // A bad third file does not leave the first two staged.
    await expect(api.report({ ...BASE, evidence: [jpeg(), jpeg(), { file: { size: 1 } as unknown as Blob, mimeType: 'text/plain' }] })).rejects.toMatchObject({
      code: 'validation',
    });
    expect(calls.uploads).toEqual([]);
    expect(calls.invokes).toEqual([]);
  });

  it('refuses when signed out, without touching storage', async () => {
    const calls = newCalls();
    await expect(createBugsApi(fakeClient(calls, { user: null })).report(BASE)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(calls.uploads).toEqual([]);
  });
});

describe('bugs.report submission', () => {
  it('sends the report and returns the identifier the tracker assigned', async () => {
    const calls = newCalls();
    const result = await createBugsApi(fakeClient(calls, { invokeData: CREATED })).report({
      kind: 'fix',
      severity: 'polish',
      title: '  Ratings disappear after refresh  ',
      description: 'rated an iced matcha',
      reproductionSteps: ['open a Bev', 'rate it'],
      environment: { route: '/profile', platform: 'web', online: true },
      breadcrumbs: [{ at: '2026-11-09T10:00:00Z', kind: 'nav', route: '/bev/[id]' }],
      idempotencyKey: KEY,
    });
    expect(result).toEqual({ ticketId: 'BEV-207', ticketUrl: 'https://linear.app/bevi/issue/BEV-207', status: 'created' });
    const body = calls.invokes[0]?.init?.body;
    expect(calls.invokes[0]?.name).toBe('bug-report');
    expect(body?.title).toBe('Ratings disappear after refresh');
    expect(body?.kind).toBe('fix');
    expect(body?.severity).toBe('polish');
    expect(body?.idempotencyKey).toBe(KEY);
    expect(body?.evidencePaths).toEqual([]);
    expect(body?.breadcrumbs).toEqual([{ at: '2026-11-09T10:00:00Z', kind: 'nav', route: '/bev/[id]' }]);
  });

  it('puts every screenshot in the private bucket, under the caller, in order, and passes only their paths', async () => {
    const calls = newCalls();
    await createBugsApi(fakeClient(calls, { invokeData: CREATED })).report({
      ...BASE,
      evidence: [jpeg(), { file: { size: 10 } as unknown as Blob, mimeType: 'image/png' }],
    });
    expect(calls.uploads.map((u) => u.bucket)).toEqual(['bug-evidence', 'bug-evidence']);
    expect(calls.uploads[0]?.path).toMatch(/^00000000-0000-4000-8000-00000000000a\/.+\.jpg$/);
    expect(calls.uploads[1]?.path).toMatch(/^00000000-0000-4000-8000-00000000000a\/.+\.png$/);
    expect(calls.invokes[0]?.init?.body?.evidencePaths).toEqual(calls.uploads.map((u) => u.path));
  });

  it('never sends a tracker credential: the body carries only report fields', async () => {
    const calls = newCalls();
    await createBugsApi(fakeClient(calls, { invokeData: CREATED })).report(BASE);
    expect(Object.keys(calls.invokes[0]?.init?.body ?? {}).sort()).toEqual([
      'actual',
      'breadcrumbs',
      'description',
      'environment',
      'evidencePaths',
      'expected',
      'idempotencyKey',
      'kind',
      'reproductionSteps',
      'severity',
      'title',
    ]);
  });

  it('reports a failed evidence upload instead of filing a ticket with no screenshot', async () => {
    const calls = newCalls();
    const api = createBugsApi(
      fakeClient(calls, { uploadError: { name: 'StorageApiError', message: 'denied', statusCode: '403' }, invokeData: CREATED }),
    );
    await expect(api.report({ ...BASE, evidence: [{ file: { size: 10 } as unknown as Blob, mimeType: 'image/png' }] })).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(calls.invokes).toEqual([]);
  });

  it('stops at the first failed upload: a second screenshot is never staged once the first is refused', async () => {
    const calls = newCalls();
    const api = createBugsApi(
      fakeClient(calls, { uploadError: { name: 'StorageApiError', message: 'denied', statusCode: '403' }, uploadErrorAt: 0, invokeData: CREATED }),
    );
    await expect(api.report({ ...BASE, evidence: [jpeg(), jpeg()] })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(calls.uploads.length).toBe(1);
    expect(calls.invokes).toEqual([]);
  });

  it('maps the function error codes onto the contract error codes', async () => {
    const cases: [number, string, string][] = [
      [403, 'not_internal', 'unauthorized'],
      [429, 'rate_limited', 'rate_limited'],
      [409, 'in_progress', 'conflict'],
      [503, 'tracker_not_configured', 'unknown'],
      [502, 'tracker_error', 'unknown'],
      [401, 'unauthorized', 'unauthorized'],
      [404, 'not_found', 'not_found'],
    ];
    for (const [status, error, expected] of cases) {
      const api = createBugsApi(fakeClient(newCalls(), { invokeError: functionError(status, { error }) }));
      await expect(api.report(BASE)).rejects.toMatchObject({ code: expected });
    }
  });

  it("carries the server's field name through on a validation failure", async () => {
    const api = createBugsApi(
      fakeClient(newCalls(), { invokeError: functionError(400, { error: 'validation', field: 'title', message: 'A title is required' }) }),
    );
    await expect(api.report(BASE)).rejects.toMatchObject({ code: 'validation', detail: { field: 'title' } });
  });

  it('refuses a response that carries no confirmed ticket, rather than showing a phantom one', async () => {
    const api = createBugsApi(fakeClient(newCalls(), { invokeData: { status: 'created' } }));
    await expect(api.report(BASE)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('passes the duplicate status through, so a retry shows the ticket it already made', async () => {
    const api = createBugsApi(fakeClient(newCalls(), { invokeData: { ...CREATED, status: 'duplicate' } }));
    expect((await api.report(BASE)).status).toBe('duplicate');
  });
});

const SUMMARY = {
  ticketId: 'BEV-207',
  ticketUrl: 'https://linear.app/bevi/issue/BEV-207',
  title: 'Ratings disappear after refresh',
  kind: 'bug',
  severity: 'bad',
  createdAt: '2026-11-09T10:00:00.000Z',
  state: 'in_review',
  stateLabel: 'In Review',
  priority: 2,
  updatedAt: '2026-11-09T11:00:00.000Z',
};

describe('bugs.listMine', () => {
  it('reads the status route with GET and maps the rows', async () => {
    const calls = newCalls();
    const rows = await createBugsApi(fakeClient(calls, { invokeData: { reports: [SUMMARY] } })).listMine();
    expect(calls.invokes[0]?.name).toBe('bug-report/status');
    expect(calls.invokes[0]?.init?.method).toBe('GET');
    expect(rows).toEqual([SUMMARY]);
  });

  it('drops a row the tracker did not confirm and keeps unknown states as unknown', async () => {
    const rows = await createBugsApi(
      fakeClient(newCalls(), {
        invokeData: { reports: [{ ...SUMMARY, state: 'teleported' }, { title: 'no identifier' }], trackerError: 'linear_unreachable' },
      }),
    ).listMine();
    expect(rows.length).toBe(1);
    expect(rows[0]?.state).toBe('unknown');
  });

  it('is unauthorized signed out, and maps the function refusal for an ordinary account', async () => {
    await expect(createBugsApi(fakeClient(newCalls(), { user: null })).listMine()).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      createBugsApi(fakeClient(newCalls(), { invokeError: functionError(403, { error: 'not_internal' }) })).listMine(),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('bugs.markVerified', () => {
  it('posts the identifier to the verify route and returns the refreshed summary', async () => {
    const calls = newCalls();
    const done = { ...SUMMARY, state: 'done', stateLabel: 'Done' };
    const result = await createBugsApi(fakeClient(calls, { invokeData: { report: done } })).markVerified(' BEV-207 ');
    expect(calls.invokes[0]?.name).toBe('bug-report/verify');
    expect(calls.invokes[0]?.init?.body).toEqual({ ticketId: 'BEV-207' });
    expect(result).toEqual(done);
  });

  it('rejects something that is not a ticket identifier before calling anything', async () => {
    const calls = newCalls();
    await expect(createBugsApi(fakeClient(calls)).markVerified('drop table')).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'ticketId' },
    });
    expect(calls.invokes).toEqual([]);
  });

  it("maps not_found for a ticket that isn't the caller's, and refuses an unconfirmed change", async () => {
    await expect(
      createBugsApi(fakeClient(newCalls(), { invokeError: functionError(404, { error: 'not_found' }) })).markVerified('BEV-1'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(createBugsApi(fakeClient(newCalls(), { invokeData: {} })).markVerified('BEV-1')).rejects.toMatchObject({ code: 'unknown' });
  });
});
