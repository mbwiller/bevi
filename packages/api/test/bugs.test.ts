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

const CREATED = { ticketId: 'T-207', ticketUrl: 'https://board.example/?open=T-207', status: 'created' };
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
    expect(result).toEqual({ ticketId: 'T-207', ticketUrl: 'https://board.example/?open=T-207', status: 'created' });
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
      'evidenceCaptions',
      'evidencePaths',
      'expected',
      'idempotencyKey',
      'kind',
      'reproductionSteps',
      'severity',
      'stepsSource',
      'targets',
      'title',
    ]);
  });

  it('sends the targets, the steps source and one caption per uploaded path, with the defaults when absent', async () => {
    const calls = newCalls();
    const target = { component: 'TabBar', file: 'app/src/components/TabBar.tsx', label: 'Add Bev', mark: 1, evidenceIndex: 0 };
    await createBugsApi(fakeClient(calls, { invokeData: CREATED })).report({
      ...BASE,
      targets: [target],
      stepsSource: 'recorded',
      reproductionSteps: ['Opened Feed', 'Tapped Add Bev'],
      evidence: [{ ...jpeg(), caption: 'Feed, with 1 marked' }, jpeg()],
    });
    const body = calls.invokes[0]?.init?.body;
    expect(body?.targets).toEqual([target]);
    expect(body?.stepsSource).toBe('recorded');
    expect(body?.evidenceCaptions).toEqual(['Feed, with 1 marked', '']);
    expect((body?.evidencePaths as string[]).length).toBe(2);

    const plain = newCalls();
    await createBugsApi(fakeClient(plain, { invokeData: CREATED })).report(BASE);
    expect(plain.invokes[0]?.init?.body?.targets).toEqual([]);
    expect(plain.invokes[0]?.init?.body?.stepsSource).toBe('typed');
    expect(plain.invokes[0]?.init?.body?.evidenceCaptions).toEqual([]);
  });

  it('sends at most the first six targets, which is all the function keeps', async () => {
    const calls = newCalls();
    const targets = Array.from({ length: 8 }, (_, i) => ({ component: `C${i}` }));
    await createBugsApi(fakeClient(calls, { invokeData: CREATED })).report({ ...BASE, targets });
    expect(calls.invokes[0]?.init?.body?.targets).toEqual(targets.slice(0, 6));
  });

  it('sends a recording of thirty steps as it is', async () => {
    const calls = newCalls();
    const steps = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}`);
    await createBugsApi(fakeClient(calls, { invokeData: CREATED })).report({ ...BASE, reproductionSteps: steps, stepsSource: 'recorded' });
    expect(calls.invokes[0]?.init?.body?.reproductionSteps).toEqual(steps);
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
  ticketId: 'T-207',
  ticketUrl: 'https://board.example/?open=T-207',
  title: 'Ratings disappear after refresh',
  kind: 'bug',
  severity: 'bad',
  createdAt: '2026-11-09T10:00:00.000Z',
  state: 'in_review',
  stateLabel: 'In Review',
  priority: 2,
  updatedAt: '2026-11-09T11:00:00.000Z',
  rank: null,
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
        invokeData: { reports: [{ ...SUMMARY, state: 'teleported' }, { title: 'no identifier' }], trackerError: 'board_unreachable' },
      }),
    ).listMine();
    expect(rows.length).toBe(1);
    expect(rows[0]?.state).toBe('unknown');
  });

  it('still lists the ledger rows when the function says no tracker is configured', async () => {
    const unknown = { ...SUMMARY, state: 'unknown', stateLabel: null, priority: null, updatedAt: null };
    const rows = await createBugsApi(
      fakeClient(newCalls(), { invokeData: { reports: [unknown], trackerError: 'tracker_not_configured' } }),
    ).listMine();
    expect(rows).toEqual([unknown]);
  });

  it('carries a positive integer rank and turns anything else into null', async () => {
    const rows = await createBugsApi(
      fakeClient(newCalls(), {
        invokeData: {
          reports: [
            { ...SUMMARY, ticketId: 'BEV-1', state: 'todo', rank: 1 },
            { ...SUMMARY, ticketId: 'BEV-2', rank: 0 },
            { ...SUMMARY, ticketId: 'BEV-3', rank: 1.5 },
            { ...SUMMARY, ticketId: 'BEV-4', rank: '2' },
            { ...SUMMARY, ticketId: 'BEV-5' },
          ],
        },
      }),
    ).listMine();
    expect(rows.map((r) => r.rank)).toEqual([1, null, null, null, null]);
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
    const result = await createBugsApi(fakeClient(calls, { invokeData: { report: done } })).markVerified(' T-207 ');
    expect(calls.invokes[0]?.name).toBe('bug-report/verify');
    expect(calls.invokes[0]?.init?.body).toEqual({ ticketId: 'T-207' });
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

describe('bugs.place', () => {
  const OPEN = { ...SUMMARY, state: 'todo', stateLabel: 'Todo' };

  it('posts both identifiers to the place route and returns the re-ranked list', async () => {
    const calls = newCalls();
    const reports = [
      { ...OPEN, ticketId: 'BEV-2', rank: 1 },
      { ...OPEN, ticketId: 'BEV-7', rank: 2, priority: 3 },
    ];
    const rows = await createBugsApi(fakeClient(calls, { invokeData: { reports } })).place(' BEV-7 ', ' BEV-2 ');
    expect(calls.invokes[0]?.name).toBe('bug-report/place');
    expect(calls.invokes[0]?.init?.body).toEqual({ ticketId: 'BEV-7', afterTicketId: 'BEV-2' });
    expect(rows).toEqual(reports);
  });

  it('sends null to put a ticket at the top', async () => {
    const calls = newCalls();
    await createBugsApi(fakeClient(calls, { invokeData: { reports: [] } })).place('BEV-7', null);
    expect(calls.invokes[0]?.init?.body).toEqual({ ticketId: 'BEV-7', afterTicketId: null });
  });

  it('rejects a bad identifier on either side, or a ticket placed after itself, before calling anything', async () => {
    const calls = newCalls();
    const api = createBugsApi(fakeClient(calls));
    await expect(api.place('drop table', null)).rejects.toMatchObject({ code: 'validation', detail: { field: 'ticketId' } });
    await expect(api.place('BEV-7', 'nope')).rejects.toMatchObject({ code: 'validation', detail: { field: 'afterTicketId' } });
    await expect(api.place('BEV-7', 'BEV-7')).rejects.toMatchObject({ code: 'validation', detail: { field: 'afterTicketId' } });
    expect(calls.invokes).toEqual([]);
  });

  it('is unauthorized signed out, and maps the refusal for an ordinary account', async () => {
    await expect(createBugsApi(fakeClient(newCalls(), { user: null })).place('BEV-7', null)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      createBugsApi(fakeClient(newCalls(), { invokeError: functionError(403, { error: 'not_internal' }) })).place('BEV-7', null),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it("maps the place route's own not-found to not_found", async () => {
    const e = await createBugsApi(fakeClient(newCalls(), { invokeError: functionError(404, { error: 'not_found', route: 'place' }) }))
      .place('BEV-7', 'BEV-2')
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 'not_found', message: "That report isn't one of yours", detail: { reason: 'not_found' } });
  });

  it('maps a ticket that is the caller\'s but no longer open to conflict', async () => {
    const e = await createBugsApi(
      fakeClient(newCalls(), { invokeError: functionError(404, { error: 'not_found', route: 'place', reason: 'not_open' }) }),
    )
      .place('BEV-7', null)
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 'conflict', message: "That report isn't open any more", detail: { reason: 'not_open' } });
  });

  it('treats a bare 404 as a server that predates ranking', async () => {
    for (const body of [{ error: 'not_found' }, 'not json']) {
      await expect(
        createBugsApi(fakeClient(newCalls(), { invokeError: functionError(404, body) })).place('BEV-7', null),
      ).rejects.toMatchObject({ code: 'unknown', detail: { reason: 'place_unsupported' } });
    }
  });

  it('maps a tracker failure and a validation answer like the other routes', async () => {
    await expect(
      createBugsApi(fakeClient(newCalls(), { invokeError: functionError(502, { error: 'tracker_error', code: 'board_unreachable' }) })).place('BEV-7', null),
    ).rejects.toMatchObject({ code: 'unknown' });
    await expect(
      createBugsApi(fakeClient(newCalls(), { invokeError: functionError(502, { error: 'tracker_error', code: 'tracker_error' }) })).place('BEV-7', null),
    ).rejects.toMatchObject({ code: 'unknown' });
    await expect(
      createBugsApi(fakeClient(newCalls(), { invokeError: functionError(503, { error: 'tracker_not_configured' }) })).place('T-19', null),
    ).rejects.toMatchObject({ code: 'unknown', message: 'The issue tracker is not configured yet' });
    await expect(
      createBugsApi(fakeClient(newCalls(), { invokeError: functionError(400, { error: 'validation', field: 'afterTicketId' }) })).place('BEV-7', 'BEV-2'),
    ).rejects.toMatchObject({ code: 'validation', detail: { field: 'afterTicketId' } });
  });
});
