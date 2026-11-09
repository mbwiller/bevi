import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBugsApi } from '../src/bugs.ts';

// bugs.report() against a stand-in client. What matters here and needs no live
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
  uploadBucket?: string;
  uploadPath?: string;
  invokeBody?: Record<string, unknown>;
}

interface Options {
  rpcData?: unknown;
  rpcError?: unknown;
  uploadError?: unknown;
  invokeData?: unknown;
  invokeError?: unknown;
  user?: { id: string } | null;
}

function fakeClient(calls: Calls = {}, options: Options = {}): SupabaseClient {
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
          calls.uploadBucket = bucket;
          calls.uploadPath = path;
          return Promise.resolve({ data: { path }, error: options.uploadError ?? null });
        },
      }),
    },
    functions: {
      invoke: (_name: string, init: { body: Record<string, unknown> }) => {
        calls.invokeBody = init.body;
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

describe('bugs.canReport', () => {
  it('asks the database, and answers false rather than throwing for an ordinary user', async () => {
    const calls: Calls = {};
    expect(await createBugsApi(fakeClient(calls, { rpcData: false })).canReport()).toBe(false);
    expect(calls.rpc).toBe('can_report_bugs');

    expect(await createBugsApi(fakeClient({}, { rpcData: true })).canReport()).toBe(true);
    expect(await createBugsApi(fakeClient({}, { rpcError: { message: 'permission denied' } })).canReport()).toBe(false);
  });
});

describe('bugs.report validation', () => {
  it('rejects an empty title before uploading anything or invoking the function', async () => {
    const calls: Calls = {};
    await expect(createBugsApi(fakeClient(calls)).report({ title: '   ', idempotencyKey: KEY })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'title' },
    });
    expect(calls.uploadBucket).toBeUndefined();
    expect(calls.invokeBody).toBeUndefined();
  });

  it('rejects a missing or malformed idempotency key', async () => {
    const calls: Calls = {};
    await expect(createBugsApi(fakeClient(calls)).report({ title: 'x', idempotencyKey: 'nope' })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'idempotencyKey' },
    });
    expect(calls.invokeBody).toBeUndefined();
  });

  it('rejects an unsupported or oversized attachment before it leaves the device', async () => {
    const calls: Calls = {};
    const api = createBugsApi(fakeClient(calls));
    await expect(
      api.report({ title: 'x', idempotencyKey: KEY, evidence: { file: { size: 10 } as unknown as Blob, mimeType: 'image/gif' } })
    ).rejects.toMatchObject({ code: 'validation', detail: { field: 'evidence' } });
    await expect(
      api.report({
        title: 'x',
        idempotencyKey: KEY,
        evidence: { file: { size: 10 * 1024 * 1024 + 1 } as unknown as Blob, mimeType: 'image/jpeg' },
      })
    ).rejects.toMatchObject({ code: 'validation', detail: { field: 'evidence' } });
    expect(calls.uploadBucket).toBeUndefined();
    expect(calls.invokeBody).toBeUndefined();
  });

  it('refuses when signed out, without touching storage', async () => {
    const calls: Calls = {};
    await expect(createBugsApi(fakeClient(calls, { user: null })).report({ title: 'x', idempotencyKey: KEY })).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(calls.uploadBucket).toBeUndefined();
  });
});

describe('bugs.report submission', () => {
  it('sends the report and returns the identifier the tracker assigned', async () => {
    const calls: Calls = {};
    const result = await createBugsApi(fakeClient(calls, { invokeData: CREATED })).report({
      title: '  Ratings disappear after refresh  ',
      description: 'rated an iced matcha',
      reproductionSteps: ['open a Bev', 'rate it'],
      environment: { route: '/profile', platform: 'web' },
      idempotencyKey: KEY,
    });
    expect(result).toEqual({ ticketId: 'BEV-207', ticketUrl: 'https://linear.app/bevi/issue/BEV-207', status: 'created' });
    expect(calls.invokeBody?.title).toBe('Ratings disappear after refresh');
    expect(calls.invokeBody?.idempotencyKey).toBe(KEY);
    expect(calls.invokeBody?.evidencePath).toBeNull();
  });

  it('puts the screenshot in the private bucket, under the caller, and passes only its path', async () => {
    const calls: Calls = {};
    await createBugsApi(fakeClient(calls, { invokeData: CREATED })).report({
      title: 'x',
      idempotencyKey: KEY,
      evidence: { file: { size: 1000 } as unknown as Blob, mimeType: 'image/jpeg' },
    });
    expect(calls.uploadBucket).toBe('bug-evidence');
    expect(calls.uploadPath).toMatch(/^00000000-0000-4000-8000-00000000000a\/.+\.jpg$/);
    expect(calls.invokeBody?.evidencePath).toBe(calls.uploadPath);
  });

  it('never sends a tracker credential: the body carries only report fields', async () => {
    const calls: Calls = {};
    await createBugsApi(fakeClient(calls, { invokeData: CREATED })).report({ title: 'x', idempotencyKey: KEY });
    expect(Object.keys(calls.invokeBody ?? {}).sort()).toEqual([
      'actual',
      'description',
      'environment',
      'evidencePath',
      'expected',
      'idempotencyKey',
      'reproductionSteps',
      'title',
    ]);
  });

  it('reports a failed evidence upload instead of filing a ticket with no screenshot', async () => {
    const calls: Calls = {};
    const api = createBugsApi(
      fakeClient(calls, { uploadError: { name: 'StorageApiError', message: 'denied', statusCode: '403' }, invokeData: CREATED })
    );
    await expect(
      api.report({ title: 'x', idempotencyKey: KEY, evidence: { file: { size: 10 } as unknown as Blob, mimeType: 'image/png' } })
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(calls.invokeBody).toBeUndefined();
  });

  it('maps the function error codes onto the contract error codes', async () => {
    const cases: [number, string, string][] = [
      [403, 'not_internal', 'unauthorized'],
      [429, 'rate_limited', 'rate_limited'],
      [409, 'in_progress', 'conflict'],
      [503, 'tracker_not_configured', 'unknown'],
      [502, 'tracker_error', 'unknown'],
      [401, 'unauthorized', 'unauthorized'],
    ];
    for (const [status, error, expected] of cases) {
      const api = createBugsApi(fakeClient({}, { invokeError: functionError(status, { error }) }));
      await expect(api.report({ title: 'x', idempotencyKey: KEY })).rejects.toMatchObject({ code: expected });
    }
  });

  it("carries the server's field name through on a validation failure", async () => {
    const api = createBugsApi(fakeClient({}, { invokeError: functionError(400, { error: 'validation', field: 'title', message: 'A title is required' }) }));
    await expect(api.report({ title: 'x', idempotencyKey: KEY })).rejects.toMatchObject({
      code: 'validation',
      detail: { field: 'title' },
    });
  });

  it('refuses a response that carries no confirmed ticket, rather than showing a phantom one', async () => {
    const api = createBugsApi(fakeClient({}, { invokeData: { status: 'created' } }));
    await expect(api.report({ title: 'x', idempotencyKey: KEY })).rejects.toMatchObject({ code: 'unknown' });
  });

  it('passes the duplicate status through, so a retry shows the ticket it already made', async () => {
    const api = createBugsApi(fakeClient({}, { invokeData: { ...CREATED, status: 'duplicate' } }));
    expect((await api.report({ title: 'x', idempotencyKey: KEY })).status).toBe('duplicate');
  });
});
