// Local-only evaluation. Never claims jobs, writes Supabase, or enables cron.
import { finishRender, generateIcon, MODEL } from '../generate.ts';
import { buildPrompt, pickReferences, type StyleRef } from '../prompt.ts';
import { decodePng } from '../png.ts';
import {
  assess,
  type CaseResult,
  gallery,
  parseSuite,
  type Report,
  type Review,
  reviewTemplate,
} from './core.ts';

const HELP = `Bevi icon evaluation (local photos and reports must stay private)
Preflight: deno run --allow-read cli.ts --suite /path/suite.json --refs /path/style-refs/index.json
Live:      add --run --max-calls 20 --out /path/new-run (CF_ACCOUNT_ID and CF_API_TOKEN required)
Replay:    add --replay --out /path/new-run (each case needs a captured provider JPEG in render)
Review:    deno run --allow-read cli.ts --check /path/new-run
Live needs --allow-env=CF_ACCOUNT_ID,CF_API_TOKEN --allow-net=api.cloudflare.com --allow-write
Replay needs --allow-write. Preflight spends nothing. No automatic retries.`;

function options(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const flags = new Set(['--run', '--replay', '--help']);
  const values = new Set(['--suite', '--refs', '--out', '--max-calls', '--check']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (out[key] !== undefined || (!flags.has(key) && !values.has(key))) {
      throw new Error(`Unknown or repeated option: ${key}`);
    }
    if (flags.has(key)) out[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      out[key] = value;
    }
  }
  return out;
}

async function sha(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
const textBytes = (s: string) => new TextEncoder().encode(s);
function localPath(path: string, base: URL): URL {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) throw new Error('Use a local filesystem path, not a URL');
  return new URL(path.split('/').map(encodeURIComponent).join('/'), base);
}
function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
function mime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF') return 'image/webp';
  throw new Error(
    'Evaluation photos must be JPEG, PNG or WebP (convert HEIC first for browser review)',
  );
}
async function readLimited(path: URL, limit: number): Promise<Uint8Array> {
  const info = await Deno.stat(path);
  if (!info.isFile || info.size > limit) {
    throw new Error('Input is not a file or exceeds its byte limit');
  }
  const bytes = await Deno.readFile(path);
  if (bytes.length > limit) throw new Error('Input exceeds its byte limit');
  return bytes;
}

export async function main(args = Deno.args): Promise<void> {
  const opts = options(args);
  if (opts['--help']) {
    console.log(HELP);
    return;
  }
  const cwd = new URL(`file://${Deno.cwd().split('/').map(encodeURIComponent).join('/')}/`);
  if (opts['--check']) {
    if (Object.keys(opts).length !== 1) throw new Error('--check is a standalone operation');
    const dir = localPath(`${opts['--check']}/`, cwd);
    const report = JSON.parse(await Deno.readTextFile(new URL('report.json', dir))) as Report;
    // Bind scores to the actual current PNGs, not only to report metadata.
    for (const c of report.results) {
      if (
        c.status === 'completed' &&
        await sha(await Deno.readFile(new URL(`${c.id}/icon-768.png`, dir))) !== c.outputSha256
      ) {
        throw new Error(`${c.id}: saved output changed; rerun evaluation and review`);
      }
    }
    const review = JSON.parse(await Deno.readTextFile(new URL('review.json', dir))) as Review;
    const gate = assess(report, review);
    console.log(JSON.stringify(gate, null, 2));
    if (!gate.passed) Deno.exitCode = 1;
    return;
  }
  if (opts['--run'] && opts['--replay']) throw new Error('Choose live or replay');
  if (!opts['--suite'] || !opts['--refs']) throw new Error(HELP);
  const suitePath = localPath(String(opts['--suite']), cwd);
  const suiteBytes = await readLimited(suitePath, 1024 * 1024);
  const suite = parseSuite(JSON.parse(new TextDecoder().decode(suiteBytes)));
  const refsPath = localPath(String(opts['--refs']), cwd);
  const index = JSON.parse(new TextDecoder().decode(await readLimited(refsPath, 1024 * 1024)));
  if (!Array.isArray(index.refs) || index.refs.length < 3 || index.refs.length > 50) {
    throw new Error('Provide at least three exported unbranded style references');
  }
  const references: StyleRef[] = [];
  const refHashes: Record<string, string> = {};
  for (const ref of index.refs) {
    if (
      !/^[a-z0-9-]+$/.test(ref.slug) || !/^[a-z0-9-]+\.png$/.test(ref.path) ||
      refHashes[ref.slug] ||
      typeof ref.shape !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)
    ) throw new Error('Invalid reference index');
    const bytes = await readLimited(localPath(ref.path, refsPath), 1024 * 1024);
    if (await sha(bytes) !== ref.sha256) {
      throw new Error(`${ref.slug}: reference hash mismatch; re-export`);
    }
    const raster = await decodePng(bytes);
    if (raster.width > 512 || raster.height > 512) {
      throw new Error(`${ref.slug}: reference exceeds 512px`);
    }
    references.push({ slug: ref.slug, shape: ref.shape, bytes });
    refHashes[ref.slug] = ref.sha256;
  }
  // Preload every file before the first metered call so bad paths never waste a partial run.
  const inputs = [];
  for (const fixture of suite.cases) {
    const photo = await readLimited(localPath(fixture.photo, suitePath), 12 * 1024 * 1024);
    const photoMime = mime(photo);
    if (opts['--replay'] && !fixture.render) {
      throw new Error(`${fixture.id}: replay requires render`);
    }
    const render = opts['--replay']
      ? await readLimited(localPath(fixture.render!, suitePath), 8 * 1024 * 1024)
      : undefined;
    inputs.push({ fixture, photo, photoMime, render });
  }
  if (!opts['--run'] && !opts['--replay']) {
    console.log(
      JSON.stringify(
        {
          mode: 'preflight',
          cases: inputs.length,
          references: references.length,
          providerCalls: 0,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!opts['--out']) throw new Error('--out must name a new directory');
  const maxCalls = Number(opts['--max-calls']);
  if (
    opts['--run'] && (!Number.isInteger(maxCalls) || maxCalls < inputs.length || maxCalls > 100)
  ) {
    throw new Error(
      '--max-calls must cover this suite and be at most 100; there are no automatic retries',
    );
  }
  const accountId = opts['--run'] ? Deno.env.get('CF_ACCOUNT_ID') : '';
  const apiToken = opts['--run'] ? Deno.env.get('CF_API_TOKEN') : '';
  if (opts['--run'] && (!accountId || !apiToken)) {
    throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN required');
  }
  const out = localPath(`${opts['--out']}/`, cwd);
  // Never overwrite a previous run, its evidence, or its human review.
  await Deno.mkdir(out);
  const report: Report = {
    version: 1,
    runId: crypto.randomUUID(),
    mode: opts['--run'] ? 'live' : 'replay',
    model: MODEL,
    createdAt: new Date().toISOString(),
    suiteSha256: await sha(suiteBytes),
    codeSha256: {},
    providerCalls: 0,
    cost: null,
    results: [],
  };
  for (
    const file of [
      'generate.ts',
      'prompt.ts',
      'image.ts',
      'jpeg.ts',
      'png.ts',
      'evaluation/cli.ts',
      'evaluation/core.ts',
    ]
  ) {
    report.codeSha256[file] = await sha(
      await Deno.readFile(new URL(`../${file}`, import.meta.url)),
    );
  }
  const media: Record<string, { source: string; output?: string }> = {};
  const refMedia = references.map((r) => ({ slug: r.slug, image: dataUrl(r.bytes, 'image/png') }));
  async function checkpoint() {
    await Deno.writeTextFile(new URL('report.json', out), JSON.stringify(report, null, 2) + '\n');
    await Deno.writeTextFile(
      new URL('review.json', out),
      JSON.stringify(reviewTemplate(report), null, 2) + '\n',
    );
    await Deno.writeTextFile(new URL('index.html', out), gallery(report, media, refMedia));
  }
  for (const { fixture, photo, photoMime, render } of inputs) {
    const start = performance.now();
    const chosen = pickReferences(references, fixture.categoryId, 3);
    const result: CaseResult = {
      id: fixture.id,
      tags: fixture.tags,
      expected: fixture.expected,
      inputSha256: await sha(photo),
      promptSha256: await sha(textBytes(buildPrompt(fixture.categoryId))),
      ...(render ? { renderSha256: await sha(render) } : {}),
      references: chosen.map((r) => ({ slug: r.slug, sha256: refHashes[r.slug] })),
      status: 'failed',
      elapsedMs: 0,
    };
    media[fixture.id] = { source: dataUrl(photo, photoMime) };
    const generated = render ? await finishRender(render) : await generateIcon({
      photo,
      categoryId: fixture.categoryId,
      references,
      accountId: accountId!,
      apiToken: apiToken!,
    }, (url, init) => {
      if (report.providerCalls >= maxCalls) {
        return Promise.reject(new Error('evaluation_call_limit'));
      }
      report.providerCalls++;
      return fetch(url, init);
    });
    result.status = generated.kind;
    result.elapsedMs = Math.round(performance.now() - start);
    if (generated.kind === 'completed') {
      const dir = new URL(`${fixture.id}/`, out);
      await Deno.mkdir(dir);
      await Deno.writeFile(new URL('icon-768.png', dir), generated.fullPng);
      await Deno.writeFile(new URL('icon-192.png', dir), generated.thumbPng);
      if (generated.providerJpeg) {
        await Deno.writeFile(new URL('provider.jpg', dir), generated.providerJpeg);
        result.renderSha256 = await sha(generated.providerJpeg);
      }
      result.outputSha256 = await sha(generated.fullPng);
      result.transparentFraction = generated.transparentFraction;
      result.labelBand = generated.labelBand;
      media[fixture.id].output = dataUrl(generated.fullPng, 'image/png');
    } else result.error = generated.kind === 'failed' ? generated.error : generated.reason;
    report.results.push(result);
    await checkpoint();
    console.log(`${fixture.id}: ${result.status} (${result.elapsedMs}ms)`);
    if (generated.kind === 'release') break; // Do not spend the rest of the suite into a quota rejection.
  }
  // A stopped run must not silently omit unattempted fixtures from the denominator.
  for (const { fixture, photo } of inputs.slice(report.results.length)) {
    report.results.push({
      id: fixture.id,
      tags: fixture.tags,
      expected: fixture.expected,
      inputSha256: await sha(photo),
      promptSha256: '',
      references: [],
      status: 'failed',
      elapsedMs: 0,
      error: 'not_attempted_after_quota',
    });
    media[fixture.id] = { source: dataUrl(photo, mime(photo)) };
  }
  await checkpoint();
  console.log(
    `Saved local report: ${
      opts['--out']
    }/index.html; ${report.providerCalls} provider call(s). Cost not supplied by provider.`,
  );
  if (report.results.some((c) => c.status !== 'completed')) Deno.exitCode = 1;
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    // Our own validation messages contain no credentials; provider exceptions are sanitized in generate.ts.
    console.error(error instanceof Error ? error.message : 'Evaluation failed');
    Deno.exitCode = 1;
  }
}
