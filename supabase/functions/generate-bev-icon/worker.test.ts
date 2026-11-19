import { createWorker } from './worker.ts';
import { encodePng } from './png.ts';
import type { GenerationResult } from './generate.ts';
import { readBounded } from './http.ts';
import { checkWorker } from './check.ts';

function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const bevId = '00000000-0000-4000-8000-000000000001';
const claimToken = '00000000-0000-4000-8000-000000000003';
const photoPath = '00000000-0000-4000-8000-000000000002/photo.jpg';
const environment: Record<string, string> = {
  SUPABASE_URL: 'https://project.test',
  SUPABASE_SERVICE_ROLE_KEY: 'private-service-key',
  ICON_WEBHOOK_SECRET: 'private-webhook',
  ICON_GENERATION_ENABLED: 'true',
  CF_ACCOUNT_ID: 'account',
  CF_API_TOKEN: 'private-provider-token',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const trigger = (token = 'private-webhook', method = 'POST') =>
  new Request('https://worker.test', {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });

async function harness(options: {
  env?: Record<string, string | undefined>;
  refs?: 'missing' | 'few' | 'corrupt' | 'large';
  source?: 'throw' | 'oversized' | 'unsafe';
  upload?: 'throw' | 'fail';
  report?: 'throw' | 'fail' | 'stale';
  claim?: 'empty' | 'fail' | 'invalid';
  generate?: 'throw' | 'quota' | 'failure';
} = {}) {
  const ref = await encodePng({ width: 2, height: 2, data: new Uint8Array(16).fill(255) });
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', ref as BufferSource))].map(
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  const refs = ['a', 'b', 'c'].map((slug) => ({
    slug,
    path: `${slug}.png`,
    shape: 'tall-glass',
    sha256: hash,
  }));
  const calls: { url: string; body: unknown }[] = [], logs: Record<string, unknown>[] = [];
  let generated = 0;
  const request: typeof fetch = (url, init) => {
    const target = String(url);
    calls.push({
      url: target,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    assert(init?.signal instanceof AbortSignal, 'every worker I/O request must have a timeout');
    if (target.endsWith('/bev-style-refs/index.json')) {
      if (options.refs === 'missing') return Promise.resolve(json({}, 404));
      if (options.refs === 'few') return Promise.resolve(json({ refs: refs.slice(0, 2) }));
      if (options.refs === 'corrupt') refs[0].sha256 = '0'.repeat(64);
      return Promise.resolve(json({ refs }));
    }
    if (target.includes('/bev-style-refs/')) {
      return Promise.resolve(
        new Response(
          ref as BodyInit,
          options.refs === 'large' ? { headers: { 'Content-Length': '2000000' } } : {},
        ),
      );
    }
    if (target.endsWith('/claim_bev_icon_jobs_v2')) {
      if (options.claim === 'fail') {
        return Promise.resolve(json({ internal: 'private-service-key' }, 500));
      }
      if (options.claim === 'invalid') return Promise.resolve(json({ wrong: [] }));
      return Promise.resolve(
        json(
          options.claim === 'empty' ? [] : [{
            bev_id: bevId,
            source_photo_path: options.source === 'unsafe'
              ? '../../auth/v1/admin/users'
              : photoPath,
            attempt_count: 1,
            claim_token: claimToken,
          }],
        ),
      );
    }
    if (target.includes('/rest/v1/bevs?')) {
      return Promise.resolve(json([{ category_id: 'coffee', name: 'Latte', brand: 'Cafe' }]));
    }
    if (target.includes('/object/bev-photos/')) {
      if (options.source === 'throw') {
        return Promise.reject(new Error('private-service-key private-provider-token'));
      }
      return Promise.resolve(
        new Response(
          new Uint8Array([255, 216, 255, ...new Array(20).fill(0)]),
          options.source === 'oversized' ? { headers: { 'Content-Length': '99999999' } } : {},
        ),
      );
    }
    if (target.includes('/object/bev-generated-icons/')) {
      if (options.upload === 'throw') return Promise.reject(new Error('private-service-key'));
      return Promise.resolve(json({}, options.upload === 'fail' ? 503 : 200));
    }
    if (target.endsWith('/finish_bev_icon_job_v2') || target.endsWith('/release_bev_icon_job_v2')) {
      if (options.report === 'throw') return Promise.reject(new Error('private-service-key'));
      return Promise.resolve(json(options.report === 'stale' ? false : true, options.report === 'fail' ? 500 : 200));
    }
    throw new Error(`Unexpected test request ${target}`);
  };
  const worker = createWorker({
    env: (name) => ({ ...environment, ...options.env })[name],
    fetch: request,
    log: (event) => logs.push(event),
    generate: (_input, _fetch): Promise<GenerationResult> => {
      generated++;
      if (options.generate === 'throw') return Promise.reject(new Error('private-provider-token'));
      if (options.generate === 'quota') {
        return Promise.resolve({ kind: 'release', reason: 'provider_quota_exhausted' });
      }
      if (options.generate === 'failure') {
        return Promise.resolve({ kind: 'failed', error: 'provider_unavailable: transient' });
      }
      return Promise.resolve({
        kind: 'completed',
        fullPng: ref,
        thumbPng: ref,
        labelBand: null,
        transparentFraction: 0.7,
      });
    },
  });
  return { worker, calls, logs, generated: () => generated };
}

Deno.test('worker: disabled by default, explicit true required, no claims or metered calls', async () => {
  for (const enabled of [undefined, '', 'false', 'TRUE']) {
    const h = await harness({ env: { ICON_GENERATION_ENABLED: enabled } });
    const res = await h.worker(trigger());
    assert(res.status === 200 && (await res.json()).disabled);
    assert(h.calls.length === 0 && h.generated() === 0);
  }
});
Deno.test('worker: wrong method, wrong bearer and missing secret cannot touch the queue', async () => {
  const h = await harness();
  assert((await h.worker(trigger('', 'GET'))).status === 405);
  assert((await h.worker(trigger('wrong'))).status === 401);
  assert(h.calls.length === 0);
  const missing = await harness({ env: { ICON_WEBHOOK_SECRET: '' } });
  assert((await missing.worker(trigger())).status === 503 && missing.calls.length === 0);
});
Deno.test('worker: missing provider configuration does not claim and release a job', async () => {
  const h = await harness({ env: { CF_API_TOKEN: undefined } });
  assert((await h.worker(trigger())).status === 503);
  assert(h.calls.length === 0);
});
Deno.test('worker: authenticated preflight validates dependencies while disabled, never claims', async () => {
  const h = await harness({ env: { ICON_GENERATION_ENABLED: 'false' } });
  const req = new Request('https://worker.test?mode=preflight', {
    method: 'POST',
    headers: { Authorization: 'Bearer private-webhook' },
  });
  const res = await h.worker(req);
  const body = await res.json();
  assert(
    res.status === 200 && body.ready && !body.generationEnabled && body.references === 3 &&
      body.claimed === 0,
  );
  assert(!h.calls.some((c) => c.url.endsWith('/claim_bev_icon_jobs_v2')) && h.generated() === 0);
});
Deno.test('worker: preflight failures and unknown modes cannot accidentally start work', async () => {
  const h = await harness({ refs: 'corrupt' });
  const headers = { Authorization: 'Bearer private-webhook' };
  assert(
    (await h.worker(new Request('https://worker.test?mode=preflight', { method: 'POST', headers })))
      .status === 503,
  );
  assert(
    (await h.worker(new Request('https://worker.test?mode=typo', { method: 'POST', headers })))
      .status === 400,
  );
  assert(!h.calls.some((c) => c.url.endsWith('/claim_bev_icon_jobs_v2')));
});
Deno.test('worker: missing, incomplete, hash-mismatched or oversized references prevent claims', async () => {
  for (const refs of ['missing', 'few', 'corrupt', 'large'] as const) {
    const h = await harness({ refs });
    const res = await h.worker(trigger());
    assert(res.status === 503 && (await res.json()).error === 'style_references_unavailable', refs);
    assert(!h.calls.some((c) => c.url.endsWith('/claim_bev_icon_jobs_v2')) && h.generated() === 0);
  }
});
Deno.test('worker: empty queue does not invoke generation', async () => {
  const h = await harness({ claim: 'empty' });
  assert((await h.worker(trigger())).status === 200 && h.generated() === 0);
});
Deno.test('worker: broken claim responses fail without leaking internal details', async () => {
  for (const claim of ['fail', 'invalid'] as const) {
    const h = await harness({ claim });
    const res = await h.worker(trigger());
    assert(res.status >= 500 && !(await res.text()).includes('private-service-key'));
    assert(h.generated() === 0 && !JSON.stringify(h.logs).includes('private-service-key'));
  }
});
Deno.test('worker: success uploads both PNGs before publishing completion', async () => {
  const h = await harness();
  const res = await h.worker(trigger());
  assert(res.status === 200 && h.generated() === 1);
  const urls = h.calls.map((c) => c.url);
  assert(
    urls.some((u) => u.endsWith('/icon-768.png')) && urls.some((u) => u.endsWith('/icon-192.png')),
  );
  assert(urls[urls.length - 1].endsWith('/finish_bev_icon_job_v2'));
  const body = h.calls[h.calls.length - 1].body as Record<string, unknown>;
  assert(
    body.p_claim_token === claimToken && body.p_status === 'completed' &&
      body.p_icon_path === `${bevId}/${claimToken}/icon-768.png`,
  );
  assert(urls.filter((u) => u.includes('/object/bev-generated-icons/')).every((u) => u.includes(`/${claimToken}/`)));
});
Deno.test('worker: network, provider and upload exceptions report failure immediately', async () => {
  for (
    const options of [{ source: 'throw' }, { generate: 'throw' }, { upload: 'throw' }, {
      upload: 'fail',
    }] as const
  ) {
    const h = await harness(options);
    assert((await h.worker(trigger())).status === 200);
    const report = h.calls[h.calls.length - 1];
    assert(
      report.url.endsWith('/finish_bev_icon_job_v2') &&
        (report.body as Record<string, unknown>).p_status === 'failed',
    );
    assert(
      !JSON.stringify(h.logs).includes('private-service-key') &&
        !JSON.stringify(report.body).includes('private-provider-token'),
    );
  }
});
Deno.test('worker: traversal and oversized source never spend a provider call', async () => {
  for (const source of ['unsafe', 'oversized'] as const) {
    const h = await harness({ source });
    assert((await h.worker(trigger())).status === 200 && h.generated() === 0);
    assert(!h.calls.some((c) => c.url.includes('/auth/v1/')));
  }
});
Deno.test('worker: quota release uses release RPC rather than consuming a failed attempt', async () => {
  const h = await harness({ generate: 'quota' });
  assert((await h.worker(trigger())).status === 200);
  assert(h.calls[h.calls.length - 1].url.endsWith('/release_bev_icon_job_v2'));
});
Deno.test('worker: failed or thrown completion reporting returns 503, never false success', async () => {
  for (const report of ['throw', 'fail'] as const) {
    const h = await harness({ report });
    const res = await h.worker(trigger());
    assert(res.status === 503 && (await res.json()).results[0].reported === 'failed');
  }
});
Deno.test('worker: a fenced-out late completion is reported stale without pretending it published', async () => {
  const h = await harness({ report: 'stale' });
  const res = await h.worker(trigger());
  const body = await res.json();
  assert(res.status === 200 && body.results[0].reported === 'stale');
});
Deno.test('HTTP: source byte limit applies to chunked bodies, not only Content-Length', async () => {
  let cancelled = false;
  const res = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(11));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  let failed = false;
  try {
    await readBounded(res, 10);
  } catch {
    failed = true;
  }
  assert(failed && cancelled);
});

Deno.test('deployment check: signed preflight traverses the actual handler without queue work', async () => {
  const h = await harness({ env: { ICON_GENERATION_ENABLED: 'false' } });
  const request: typeof fetch = (url, init) => {
    assert(init?.redirect === 'error', 'never forward the webhook secret through a redirect');
    return h.worker(new Request(url, init));
  };
  const result = await checkWorker(
    'https://worker.test/functions/v1/generate-bev-icon',
    'private-webhook',
    request,
  );
  assert(result.ready && result.claimed === 0 && !result.generationEnabled);
  assert(h.generated() === 0 && !h.calls.some((c) => c.url.endsWith('/claim_bev_icon_jobs_v2')));
});
Deno.test('deployment check: old disabled responses and invalid targets do not falsely pass', async () => {
  let calls = 0;
  const request: typeof fetch = () => {
    calls++;
    return Promise.resolve(json({ claimed: 0, disabled: true }));
  };
  for (
    const url of [
      'http://remote.test',
      'https://user:password@worker.test',
      'https://worker.test?mode=generate',
    ]
  ) {
    let failed = false;
    try {
      await checkWorker(url, 'private-webhook', request);
    } catch {
      failed = true;
    }
    assert(failed);
  }
  assert(calls === 0);
  let failed = false;
  try {
    await checkWorker('https://worker.test', 'private-webhook', request);
  } catch {
    failed = true;
  }
  assert(failed);
});
