import {
  generateIcon,
  type GenerationInput,
  type GenerationResult,
  OUT_WIDTH,
  THUMB_WIDTH,
} from './generate.ts';
import { readBounded } from './http.ts';
import { iconUploadUrl } from './storage.ts';
import type { StyleRef } from './prompt.ts';

const BATCH = 1;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export interface WorkerDependencies {
  env: (name: string) => string | undefined;
  fetch?: typeof fetch;
  generate?: (input: GenerationInput, request: typeof fetch) => Promise<GenerationResult>;
  log?: (event: Record<string, unknown>) => void;
}

interface ClaimedJob {
  bev_id: string;
  source_photo_path: string;
  attempt_count: number;
  claim_token: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Constant-time comparison of SHA-256 digests rather than of the raw bytes.
 *
 * Comparing the bytes directly needs an early `a.length !== b.length` return,
 * which makes the response time reveal whether a guess was the right LENGTH.
 * Digests are always 32 bytes, so there is nothing to return early on and the
 * loop runs the same way every time.
 */
async function tokensMatch(presented: string, expected: string): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(presented), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * A storage object key we are willing to put in a URL.
 *
 * `create_bev` proves the object EXISTS and belongs to the caller, but it does
 * not constrain its shape -- `(storage.foldername(name))[1]` of
 * `<uid>/../../../auth/v1/admin/users` is still `<uid>`. WHATWG URL parsing
 * then resolves those `..` segments BEFORE the request is sent, so a raw
 * interpolation would turn a storage fetch into an arbitrary service-role GET
 * against any endpoint on the project, with the body forwarded to the image
 * provider. Verified: `../../../../auth/v1/admin/users` resolves to
 * `https://<ref>.supabase.co/auth/v1/admin/users`.
 *
 * So: a uid folder, one filename, no separators, no traversal -- which is
 * exactly the `<uid>/<random>.<ext>` shape `media.upload` builds.
 */
const SAFE_OBJECT_KEY = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,200}$/i;

export function safeObjectPath(key: string): string | null {
  if (!SAFE_OBJECT_KEY.test(key)) return null;
  const parts = key.split('/');
  if (parts.some((part) => part === '.' || part === '..')) return null;
  // Encode anyway, so a character the regex allows can never change the URL's
  // structure. Belt and braces: the regex is the gate, this is the seatbelt.
  return parts.map(encodeURIComponent).join('/');
}

function bearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** What went wrong, and whether it is worth trying again. */
type Outcome =
  | { kind: 'completed'; iconPath: string; labelBand: unknown }
  | { kind: 'failed'; error: string; retryable?: boolean }
  | { kind: 'release'; reason: string };

export function createWorker(deps: WorkerDependencies): (req: Request) => Promise<Response> {
  const rawFetch = deps.fetch ?? fetch;
  const request: typeof fetch = (url, init) =>
    rawFetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });
  const log = deps.log ?? ((event) => console.log(JSON.stringify(event)));
  return async (req) => {
    try {
      return await handle(req);
    } catch {
      log({ fn: 'generate-bev-icon', event: 'request_failed' });
      return json({ error: 'worker_request_failed' }, 503);
    }
  };
  async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const supabaseUrl = deps.env('SUPABASE_URL');
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    const webhookSecret = deps.env('ICON_WEBHOOK_SECRET') || undefined;
    if (!supabaseUrl || !serviceKey) return json({ error: 'not_configured' }, 503);
    if (!webhookSecret) return json({ error: 'icon_secret_missing' }, 503);
    const presented = bearer(req);
    if (!presented || !(await tokensMatch(presented, webhookSecret))) {
      return json({ error: 'unauthorized' }, 401);
    }
    // A deployed function and populated secrets must never implicitly start metered work.
    const enabled = deps.env('ICON_GENERATION_ENABLED') === 'true';
    const mode = new URL(req.url).searchParams.get('mode');
    if (mode !== null && mode !== 'preflight') return json({ error: 'invalid_mode' }, 400);
    if (!enabled && mode !== 'preflight') return json({ claimed: 0, disabled: true }, 200);
    const accountId = deps.env('CF_ACCOUNT_ID');
    const apiToken = deps.env('CF_API_TOKEN');
    if (!accountId || !apiToken) return json({ error: 'provider_not_configured' }, 503);
    let references: StyleRef[];
    try {
      references = await loadReferences(supabaseUrl, serviceKey, request);
    } catch {
      log({ fn: 'generate-bev-icon', event: 'style_references_unavailable' });
      return json({ error: 'style_references_unavailable' }, 503);
    }
    if (mode === 'preflight') {
      return json({
        ready: true,
        generationEnabled: enabled,
        references: references.length,
        claimed: 0,
      }, 200);
    }

    // Everything past here speaks to PostgREST as the service role.
    const rpc = async (fn: string, body: unknown): Promise<Response> =>
      await request(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

    const claimRes = await rpc('claim_bev_icon_jobs_v2', { p_limit: BATCH });
    if (!claimRes.ok) {
      // The body is logged, NOT returned: PostgREST error text carries schema
      // names, constraint names and `raise ... detail`, and pg_net persists an
      // Edge Function's response body in `net._http_response`.
      await claimRes.body?.cancel();
      log({ fn: 'generate-bev-icon', event: 'claim_failed', status: claimRes.status });
      return json({ error: 'claim_failed', status: claimRes.status }, 500);
    }
    const jobs = JSON.parse(
      new TextDecoder().decode(await readBounded(claimRes, 64 * 1024)),
    ) as ClaimedJob[];
    if (
      !Array.isArray(jobs) || jobs.length > BATCH ||
      jobs.some((j) =>
        !/^[0-9a-f-]{36}$/i.test(j.bev_id) || typeof j.source_photo_path !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(j.claim_token)
      )
    ) return json({ error: 'invalid_claim_response' }, 503);
    if (jobs.length === 0) return json({ claimed: 0 }, 200);

    const results: Record<string, string>[] = [];

    for (const job of jobs) {
      let outcome: Outcome;
      const started = performance.now();
      try {
        outcome = await processOne(job, {
          supabaseUrl,
          serviceKey,
          accountId,
          apiToken,
          references,
          request,
          generate: deps.generate ?? generateIcon,
        });
      } catch {
        outcome = { kind: 'failed', error: 'worker_io_failed: retryable' };
      }
      // A reporting call that fails silently would leave the job 'processing'
      // while this function claims success, recoverable only by the stale
      // reaper a full interval later. Check it and say so.
      let reported: Response;
      try {
        if (outcome.kind === 'completed') {
          reported = await rpc('finish_bev_icon_job_v2', {
            p_bev_id: job.bev_id,
            p_claim_token: job.claim_token,
            p_status: 'completed',
            p_icon_path: outcome.iconPath,
            p_error: null,
            // The band rides through the definer function with the result, rather
            // than this worker PATCHing `bevs` -- content tables are written by
            // security-definer RPCs only (supabase/CLAUDE.md).
            p_label_band: outcome.labelBand,
          });
        } else if (outcome.kind === 'failed') {
          reported = await rpc('finish_bev_icon_job_v2', {
            p_bev_id: job.bev_id,
            p_claim_token: job.claim_token,
            p_status: 'failed',
            p_icon_path: null,
            p_error: outcome.error,
            p_retryable: outcome.retryable !== false,
          });
        } else {
          reported = await rpc('release_bev_icon_job_v2', {
            p_bev_id: job.bev_id,
            p_claim_token: job.claim_token,
            p_reason: outcome.reason,
          });
        }
      } catch {
        log({ fn: 'generate-bev-icon', event: 'report_failed', bevId: job.bev_id });
        results.push({ bevId: job.bev_id, outcome: outcome.kind, reported: 'failed' });
        continue;
      }
      if (!reported.ok) {
        await reported.body?.cancel();
        log({
          fn: 'generate-bev-icon',
          event: 'report_failed',
          bevId: job.bev_id,
          status: reported.status,
        });
      } else {
        let applied: unknown;
        try {
          applied = JSON.parse(new TextDecoder().decode(await readBounded(reported, 1024)));
        } catch {
          applied = null;
        }
        if (applied !== true) {
          const state = applied === false ? 'stale' : 'failed';
          log({ fn: 'generate-bev-icon', event: 'report_' + state, bevId: job.bev_id });
          results.push({ bevId: job.bev_id, outcome: outcome.kind, reported: state });
          continue;
        }
      }
      log({
        fn: 'generate-bev-icon',
        event: 'job_finished',
        bevId: job.bev_id,
        outcome: outcome.kind,
        ms: Math.round(performance.now() - started),
        reported: reported.ok,
      });
      results.push({
        bevId: job.bev_id,
        outcome: outcome.kind,
        reported: reported.ok ? 'ok' : 'failed',
      });
    }

    // One JSON line per invocation, as DEVELOPMENT-ARJUN.md §10 asks, because
    // the free plan keeps logs for a day and `bev_icon_jobs` is the real record.
    log({ fn: 'generate-bev-icon', event: 'invocation_finished', claimed: jobs.length, results });
    return json(
      { claimed: jobs.length, results },
      results.some((r) => r.reported === 'failed') ? 503 : 200,
    );
  }
}

export async function loadReferences(
  supabaseUrl: string,
  serviceKey: string,
  request: typeof fetch,
): Promise<StyleRef[]> {
  const base = `${supabaseUrl}/storage/v1/object/bev-style-refs`;
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const indexRes = await request(`${base}/index.json`, { headers });
  if (!indexRes.ok) {
    await indexRes.body?.cancel();
    throw new Error('reference_index_unavailable');
  }
  const index = JSON.parse(new TextDecoder().decode(await readBounded(indexRes, 64 * 1024)));
  if (!Array.isArray(index.refs) || index.refs.length < 3 || index.refs.length > 20) {
    throw new Error('invalid_reference_count');
  }
  const out: StyleRef[] = [];
  const seen = new Set<string>();
  for (const ref of index.refs) {
    if (
      !ref || typeof ref.slug !== 'string' || !/^[a-z0-9-]{1,120}$/.test(ref.slug) ||
      seen.has(ref.slug) ||
      typeof ref.path !== 'string' || !/^[a-z0-9-]{1,120}\.png$/.test(ref.path) ||
      !['tall-glass', 'stemmed', 'rocks'].includes(ref.shape) ||
      typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)
    ) throw new Error('invalid_reference_record');
    seen.add(ref.slug);
    const res = await request(`${base}/${encodeURIComponent(ref.path)}`, { headers });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error('reference_unavailable');
    }
    const bytes = await readBounded(res, 1024 * 1024);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    if (digest !== ref.sha256) throw new Error('reference_hash_mismatch');
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length < 24 || !signature.every((b, i) => bytes[i] === b) ||
      new TextDecoder().decode(bytes.subarray(12, 16)) !== 'IHDR'
    ) throw new Error('reference_not_png');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (width < 1 || height < 1 || width > 512 || height > 512) {
      throw new Error('reference_dimensions');
    }
    out.push({ slug: ref.slug, shape: ref.shape, bytes });
  }
  return out;
}

interface Context {
  supabaseUrl: string;
  serviceKey: string;
  accountId: string;
  apiToken: string;
  references: StyleRef[];
  request: typeof fetch;
  generate: (input: GenerationInput, request: typeof fetch) => Promise<GenerationResult>;
}

async function processOne(job: ClaimedJob, ctx: Context): Promise<Outcome> {
  const headers = { Authorization: `Bearer ${ctx.serviceKey}`, apikey: ctx.serviceKey };

  // The Bev, for the prompt's category hint. `source_photo_path` is the path
  // the ORIGINAL creation request carried, not whatever the Bev's photo is now.
  const bevRes = await ctx.request(
    `${ctx.supabaseUrl}/rest/v1/bevs?id=eq.${job.bev_id}&select=category_id,name,brand`,
    { headers },
  );
  if (!bevRes.ok) {
    await bevRes.body?.cancel();
    return { kind: 'failed', error: `bev_lookup_failed(${bevRes.status})` };
  }
  const [bev] = JSON.parse(new TextDecoder().decode(await readBounded(bevRes, 64 * 1024))) as {
    category_id: string;
    name: string;
    brand: string | null;
  }[];
  if (!bev) return { kind: 'failed', error: 'bev_missing', retryable: false };

  const safePath = safeObjectPath(job.source_photo_path);
  if (!safePath) {
    // Nothing a retry can fix, and the shape is not one media.upload produces.
    return {
      kind: 'failed',
      error: 'source_photo_path_rejected: unexpected object key shape',
      retryable: false,
    };
  }
  const photoRes = await ctx.request(
    `${ctx.supabaseUrl}/storage/v1/object/bev-photos/${safePath}`,
    { headers },
  );
  if (!photoRes.ok) {
    await photoRes.body?.cancel();
    // The object is gone. No retry will bring it back.
    return {
      kind: 'failed',
      error: `source_photo_unreadable(${photoRes.status})`,
      retryable: photoRes.status >= 500 || photoRes.status === 429,
    };
  }
  const photo = await readBounded(photoRes, MAX_PHOTO_BYTES);
  const generated = await ctx.generate({
    photo,
    categoryId: bev.category_id,
    references: ctx.references,
    accountId: ctx.accountId,
    apiToken: ctx.apiToken,
  }, ctx.request);
  if (generated.kind !== 'completed') return generated;
  const { fullPng, thumbPng, labelBand: band } = generated;
  const fullPath = `${job.bev_id}/${job.claim_token}/icon-${OUT_WIDTH}.png`;
  const thumbPath = `${job.bev_id}/${job.claim_token}/icon-${THUMB_WIDTH}.png`;
  for (const [path, bytes] of [[fullPath, fullPng], [thumbPath, thumbPng]] as const) {
    const up = await ctx.request(iconUploadUrl(ctx.supabaseUrl, path), {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'image/png',
        'x-upsert': 'false',
        'Cache-Control': 'max-age=31536000',
      },
      body: bytes as unknown as BodyInit,
    });
    if (!up.ok) {
      // Storage is transient in a way the provider is not: retry.
      await up.body?.cancel();
      return { kind: 'failed', error: `upload_failed(${up.status}): retryable` };
    }
    await up.body?.cancel();
  }

  // The band goes back with the result so the app can letter the icon from
  // what the user typed. The model is never asked for lettering: it rejects
  // brand marks deterministically.
  return { kind: 'completed', iconPath: fullPath, labelBand: band };
}
