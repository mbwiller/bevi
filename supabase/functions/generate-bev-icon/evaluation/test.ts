import { assess, gallery, parseSuite, type Report, REQUIRED_TAGS, reviewTemplate } from './core.ts';
import { classifyProviderError, finishRender, generateIcon } from '../generate.ts';
import { decodePng } from '../png.ts';
import synthetic from './synthetic-render.json' with { type: 'json' };

function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const photo = new Uint8Array([255, 216, 255, ...new Array(20).fill(0)]);
const input = {
  photo,
  categoryId: 'coffee',
  references: [],
  accountId: 'test',
  apiToken: 'never-log-me',
};
function fixtureReport(): Report {
  return {
    version: 1,
    runId: 'test-run',
    mode: 'live',
    model: 'test',
    createdAt: '2026-11-15',
    suiteSha256: 'suite',
    codeSha256: {},
    providerCalls: 20,
    cost: null,
    results: Array.from(
      { length: 20 },
      (_, i) => ({
        id: `case-${i}`,
        tags: [...REQUIRED_TAGS],
        expected: 'a drink',
        inputSha256: `input-${i}`,
        promptSha256: 'prompt',
        references: [],
        status: 'completed',
        elapsedMs: 100,
        outputSha256: `sha-${i}`,
      }),
    ),
  };
}
function approvedReview(report: Report) {
  const review = reviewTemplate(report);
  review.reviewer = 'Human reviewer';
  review.reviewedAt = '2026-11-15T12:00:00Z';
  for (const c of review.cases) c.scores = { fidelity: 4, style: 4, cutout: 4, smallSize: 4 };
  return review;
}

Deno.test('evaluation: technical success alone can never pass visual review', () => {
  const report = fixtureReport();
  assert(!assess(report, undefined).passed);
  assert(!assess(report, reviewTemplate(report)).passed);
  assert(assess(report, approvedReview(report)).passed);
});
Deno.test('evaluation: stale hashes, severe defects and missing scores block approval', () => {
  for (const change of ['hash', 'severe', 'score', 'duplicate']) {
    const report = fixtureReport(), review = approvedReview(report);
    if (change === 'hash') review.cases[0].outputSha256 = 'old-output';
    if (change === 'severe') review.cases[0].severeDefect = true;
    if (change === 'score') review.cases[0].scores.fidelity = null;
    if (change === 'duplicate') review.cases.push(review.cases[0]);
    assert(!assess(report, review).passed, change);
  }
});
Deno.test('evaluation: failed attempts count against the 90% usable threshold', () => {
  const report = fixtureReport();
  for (let i = 0; i < 3; i++) report.results[i].status = 'failed';
  assert(!assess(report, approvedReview(report)).passed);
  report.results[2].status = 'completed';
  assert(assess(report, approvedReview(report)).passed);
});
Deno.test('evaluation: a small, narrow or replay-only dataset cannot establish readiness', () => {
  for (const change of ['small', 'coverage', 'replay', 'mean', 'same-photo']) {
    const report = fixtureReport();
    if (change === 'small') report.results.pop();
    if (change === 'coverage') { for (const c of report.results) c.tags = ['cup']; }
    if (change === 'replay') report.mode = 'replay';
    if (change === 'same-photo') { for (const c of report.results) c.inputSha256 = 'one-photo'; }
    const review = approvedReview(report);
    if (change === 'mean') { for (const c of review.cases) c.scores.style = 3; }
    assert(!assess(report, review).passed, change);
  }
});
Deno.test('evaluation: reject duplicate/unsafe case ids and incomplete fixtures', () => {
  const c = {
    id: 'cup',
    categoryId: 'coffee',
    photo: 'cup.jpg',
    tags: ['cup'],
    expected: 'marbled paper cup',
  };
  assert(parseSuite({ version: 1, cases: [c] }).cases.length === 1);
  for (
    const cases of [[c, c], [{ ...c, id: '../escape' }], [{ ...c, expected: '' }], [{
      ...c,
      tags: [],
    }]]
  ) {
    let threw = false;
    try {
      parseSuite({ version: 1, cases });
    } catch {
      threw = true;
    }
    assert(threw);
  }
});
Deno.test('evaluation: report escapes source notes and uses all app tile sizes', () => {
  const report = fixtureReport();
  report.results = [report.results[0]];
  report.results[0].expected = '<script>alert(1)</script>';
  const html = gallery(report, {
    'case-0': { source: 'data:image/jpeg;base64,AA', output: 'data:image/png;base64,AA' },
  }, []);
  assert(!html.includes('<script>'));
  assert(html.includes('&lt;script&gt;'));
  for (const size of [40, 56, 96, 155]) assert(html.includes(`width:${size}px`));
});

Deno.test('generation: invalid source bytes never spend a provider call', async () => {
  let calls = 0;
  const request = (() => {
    calls++;
    throw new Error('should not reach');
  }) as typeof fetch;
  assert((await generateIcon({ ...input, photo: new Uint8Array(20) }, request)).kind === 'failed');
  assert(calls === 0);
});
Deno.test('generation: sends production prompt, dimensions and selected references without retries', async () => {
  let calls = 0;
  const request = ((_url: unknown, init?: RequestInit) => {
    calls++;
    const form = init!.body as FormData;
    assert(String(form.get('prompt')).includes('No lettering'));
    assert(form.get('width') === '768' && form.get('height') === '1024');
    assert(form.has('input_image_0') && form.has('input_image_3') && !form.has('input_image_4'));
    assert(init!.signal instanceof AbortSignal);
    return Promise.resolve(
      new Response(JSON.stringify({ errors: [{ code: 3043 }] }), { status: 503 }),
    );
  }) as typeof fetch;
  const result = await generateIcon({
    ...input,
    references: ['z', 'b', 'a', 'c'].map((slug) => ({ slug, shape: 'tall-glass', bytes: photo })),
  }, request);
  assert(result.kind === 'failed' && result.error.includes('transient'));
  assert(calls === 1);
});
Deno.test('generation: quota, flagged, malformed and transport responses are distinguishable', async () => {
  assert(classifyProviderError(429, [], '').kind === 'release');
  assert(classifyProviderError(400, [3030], '').kind === 'failed');
  const bad = await generateIcon(
    input,
    (() => Promise.resolve(new Response('{bad json'))) as typeof fetch,
  );
  assert(bad.kind === 'failed' && bad.error === 'provider_response_unparseable');
  const transport = await generateIcon(
    input,
    (() => Promise.reject(new Error('never-log-me'))) as typeof fetch,
  );
  assert(transport.kind === 'failed' && !transport.error.includes('never-log-me'));
});
Deno.test('generation: bounds chunked provider responses before buffering them all', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(24 * 1024 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await generateIcon(
    input,
    (() => Promise.resolve(new Response(stream))) as typeof fetch,
  );
  assert(result.kind === 'failed' && result.error.startsWith('provider_response_too_large'));
  assert(cancelled);
});
Deno.test('generation: unusable provider renders fail instead of becoming reviewed assets', async () => {
  const result = await finishRender(new Uint8Array([1, 2, 3]));
  assert(result.kind === 'failed' && result.error.startsWith('decode_failed'));
});

Deno.test('generation: successful provider JPEG becomes transparent full and thumbnail PNGs', async () => {
  const result = await generateIcon(
    input,
    (() =>
      Promise.resolve(
        new Response(JSON.stringify({ result: { image: synthetic.base64 } })),
      )) as typeof fetch,
  );
  assert(result.kind === 'completed');
  assert(result.providerJpeg?.length, 'keep the original provider JPEG for future offline replay');
  const full = await decodePng(result.fullPng), thumb = await decodePng(result.thumbPng);
  assert(full.width === 768 && full.height === 1024);
  assert(thumb.width === 192 && thumb.height === 256);
  assert(full.data[3] === 0 && thumb.data[3] === 0, 'background must be transparent');
  assert(full.data[(500 * 768 + 384) * 4 + 3] === 255, 'subject must survive matting');
  assert(result.transparentFraction > 0.25 && result.transparentFraction < 0.97);
});
