// generate-bev-icon: turns a user's beverage photograph into an illustrated
// Bevi icon, asynchronously, for a Bev that was created WITH a photo.
//
// It never decides eligibility. `create_bev` already did that, inside the
// transaction that created the Bev (20261114000100), and the only work this
// function can see is what `claim_bev_icon_jobs()` hands it. A Bev with no job
// row is a Bev this function cannot touch.
//
// Callers, and only these two:
//   1. `enqueue_bev_icon_job()` over pg_net, the moment an eligible Bev is
//      created -- a latency optimisation that may be lost;
//   2. `drain_bev_icon_jobs()` from pg_cron every minute, which is the actual
//      guarantee and is why none of this depends on anyone's browser.
//
// ---------------------------------------------------------------------------
// AUTHORISATION: verify_jwt is OFF (config.toml), and this function checks a
// shared secret itself -- the same reasoning the `embed` function spells out.
// `verify_jwt` only proves the request carries a key the project issued, and
// the publishable key ships in every copy of the app. This function writes as
// the service role and spends a metered daily allocation per call, so "anyone
// who installed the app" is precisely the wrong audience. Neither real caller
// holds a user JWT anyway: pg_net sends whatever header the SQL built.
//
// So the gate is ICON_WEBHOOK_SECRET and ONLY that. It does NOT fall back to
// the service-role key: that would quietly make an RLS-bypassing credential
// the webhook password, and because `enqueue_bev_icon_job` and
// `drain_bev_icon_jobs` send the token as a pg_net header, pg_net would then
// persist that key in `net.http_request_queue` on every eligible create and
// every minute of cron. With no secret configured this function refuses every
// request, which is a loud failure instead of a silent exposure.
// ---------------------------------------------------------------------------
//
// Deno conventions follow `embed`: no remote imports (`deno.json` has an empty
// import map), plain `fetch` against PostgREST, so `deno check` type-checks
// this file without resolving a single module off the network. The PNG and
// JPEG codecs are ours for the same reason -- see their headers.

import { decodeJpeg } from './jpeg.ts';
import { encodePng } from './png.ts';
import { compositeShadow, downscale, findLabelBand, matte, transparentFraction } from './image.ts';
import { buildPrompt, pickReferences, type StyleRef } from './prompt.ts';

const MODEL = '@cf/black-forest-labs/flux-2-klein-9b';
/** The model's own cap: at most four images, and the photo is one of them. */
const MAX_REFERENCES = 3;
const OUT_WIDTH = 768;
const OUT_HEIGHT = 1024;
/** The second stored size, same 3:4 proportion. */
const THUMB_WIDTH = 192;
const THUMB_HEIGHT = 256;
/** One claim per invocation: generation dominates, so batching buys nothing. */
const BATCH = 1;
/**
 * A matte that leaves almost nothing, or almost everything, means the render
 * was not a product on a flat field and the asset would look broken. Rejecting
 * it as a failed attempt is better than publishing it. The authored icons
 * measure 0.62-0.82.
 */
const MIN_TRANSPARENT = 0.25;
const MAX_TRANSPARENT = 0.97;
/**
 * Ceilings on everything that arrives from outside this function. The source
 * photo is already capped at 10 MB by the `bev-photos` bucket, but that is the
 * bucket's doing, not ours, and the provider response has no cap at all.
 */
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_PROVIDER_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_B64 = 8_000_000;
/** No JPEG frame larger than this is worth decoding; we asked for 768x1024. */
const MAX_DECODE_EDGE = 4096;
/**
 * Where generated icons go. A named constant because this string lived inline
 * in the upload and silently kept pointing at main's `bev-icons` through a
 * bucket rename that reached the migration and the reader but not the writer.
 *
 * NOT `bev-icons`. That is the AUTHORED catalogue art (20261112000200):
 * `image/svg+xml` only, 512 KiB. A ~450 KiB PNG posted there is refused on
 * mime type, the worker takes its upload_failed branch, and the job burns
 * every attempt -- while both test suites stay green, because pgTAP cannot see
 * TypeScript and nothing asserted this URL. `test.ts` now does.
 */
export const ICON_BUCKET = 'bev-generated-icons';

/**
 * The object URL a finished icon is uploaded to. Extracted so a test can
 * assert it, which is the gap that let the rename miss the writer: asserting
 * the CONSTANT would not have caught an upload that ignored it.
 */
export function iconUploadUrl(supabaseUrl: string, objectPath: string): string {
  return `${supabaseUrl}/storage/v1/object/${ICON_BUCKET}/${objectPath}`;
}
/** The `bev-generated-icons` bucket's own file_size_limit, checked before we upload. */
const MAX_ICON_BYTES = 2 * 1024 * 1024;

interface ClaimedJob {
  bev_id: string;
  source_photo_path: string;
  attempt_count: number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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

function safeObjectPath(key: string): string | null {
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
  | { kind: 'failed'; error: string }
  | { kind: 'release'; reason: string };

/**
 * The provider's error codes, from real traffic on 2026-11-11:
 *
 *   3030  the output was flagged. In practice: a recognisable BRAND MARK.
 *         DETERMINISTIC -- three identical retries of a branded input failed
 *         three times -- so it is terminal. Retrying spends the daily
 *         allocation to reach the same answer, and the Bev falls through to
 *         borrowed catalog art, which is the right outcome anyway.
 *   3043  internal server error. Genuinely transient and COMMON on this model
 *         (two failures before each success, repeatedly), so it must retry.
 *   quota exhausted. Nothing is wrong with the job; the free allocation resets
 *         at 00:00 UTC. Hand the claim back without consuming an attempt.
 */
function classifyProviderError(status: number, codes: number[], body: string): Outcome {
  if (codes.includes(3030)) {
    return { kind: 'failed', error: 'provider_output_flagged(3030): likely a brand mark; not retryable' };
  }
  if (status === 429 || /quota|rate limit|neurons/i.test(body)) {
    return { kind: 'release', reason: 'provider_quota_exhausted: resets at 00:00 UTC' };
  }
  if (codes.includes(3043) || status >= 500) {
    return { kind: 'failed', error: `provider_unavailable(${codes.join(',') || status}): transient` };
  }
  return { kind: 'failed', error: `provider_error(${codes.join(',') || status}): ${body.slice(0, 200)}` };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookSecret = Deno.env.get('ICON_WEBHOOK_SECRET') || undefined;
  const accountId = Deno.env.get('CF_ACCOUNT_ID');
  const apiToken = Deno.env.get('CF_API_TOKEN');

  if (!supabaseUrl || !serviceKey) return json({ error: 'not_configured' }, 500);

  // `|| undefined` and not `??`, so a blank value counts as absent rather than
  // becoming an empty password -- the same reading `embed` uses.
  if (!webhookSecret) return json({ error: 'icon_secret_missing' }, 500);
  const presented = bearer(req);
  if (!presented || !(await tokensMatch(presented, webhookSecret))) {
    return json({ error: 'unauthorized' }, 401);
  }

  // Everything past here speaks to PostgREST as the service role.
  const rpc = async (fn: string, body: unknown): Promise<Response> =>
    await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  const claimRes = await rpc('claim_bev_icon_jobs', { p_limit: BATCH });
  if (!claimRes.ok) {
    // The body is logged, NOT returned: PostgREST error text carries schema
    // names, constraint names and `raise ... detail`, and pg_net persists an
    // Edge Function's response body in `net._http_response`.
    console.error('generate-bev-icon claim_failed', claimRes.status, (await claimRes.text()).slice(0, 300));
    return json({ error: 'claim_failed', status: claimRes.status }, 500);
  }
  const jobs = (await claimRes.json()) as ClaimedJob[];
  if (jobs.length === 0) return json({ claimed: 0 }, 200);

  if (!accountId || !apiToken) {
    // Configured for everything but the provider. Hand the claims back rather
    // than failing them: nothing is wrong with the jobs.
    for (const job of jobs) {
      await rpc('release_bev_icon_job', { p_bev_id: job.bev_id, p_reason: 'provider_not_configured' });
    }
    return json({ claimed: jobs.length, released: jobs.length, error: 'provider_not_configured' }, 500);
  }

  const references = await loadReferences(supabaseUrl, serviceKey);
  const results: Record<string, string>[] = [];

  for (const job of jobs) {
    const outcome = await processOne(job, { supabaseUrl, serviceKey, accountId, apiToken, references });
    // A reporting call that fails silently would leave the job 'processing'
    // while this function claims success, recoverable only by the stale
    // reaper a full interval later. Check it and say so.
    let reported: Response;
    if (outcome.kind === 'completed') {
      reported = await rpc('finish_bev_icon_job', {
        p_bev_id: job.bev_id,
        p_status: 'completed',
        p_icon_path: outcome.iconPath,
        p_error: null,
        // The band rides through the definer function with the result, rather
        // than this worker PATCHing `bevs` -- content tables are written by
        // security-definer RPCs only (supabase/CLAUDE.md).
        p_label_band: outcome.labelBand,
      });
    } else if (outcome.kind === 'failed') {
      reported = await rpc('finish_bev_icon_job', {
        p_bev_id: job.bev_id,
        p_status: 'failed',
        p_icon_path: null,
        p_error: outcome.error,
      });
    } else {
      reported = await rpc('release_bev_icon_job', { p_bev_id: job.bev_id, p_reason: outcome.reason });
    }
    if (!reported.ok) {
      console.error('generate-bev-icon report_failed', job.bev_id, reported.status,
        (await reported.text()).slice(0, 200));
    }
    results.push({ bevId: job.bev_id, outcome: outcome.kind, reported: reported.ok ? 'ok' : 'failed' });
  }

  // One JSON line per invocation, as DEVELOPMENT-ARJUN.md §10 asks, because
  // the free plan keeps logs for a day and `bev_icon_jobs` is the real record.
  console.log(JSON.stringify({ fn: 'generate-bev-icon', claimed: jobs.length, results }));
  return json({ claimed: jobs.length, results }, 200);
});

async function loadReferences(supabaseUrl: string, serviceKey: string): Promise<StyleRef[]> {
  const base = `${supabaseUrl}/storage/v1/object/bev-style-refs`;
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const indexRes = await fetch(`${base}/index.json`, { headers });
  if (!indexRes.ok) return [];
  const index = (await indexRes.json()) as { refs?: { slug: string; shape: string; path: string }[] };
  const out: StyleRef[] = [];
  for (const ref of index.refs ?? []) {
    // Same reasoning as the photo path. This bucket is service-role-only, so
    // it is trust propagation rather than a live hole -- but it is one line.
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(ref.path)) continue;
    const res = await fetch(`${base}/${encodeURIComponent(ref.path)}`, { headers });
    if (!res.ok) continue;
    out.push({ slug: ref.slug, shape: ref.shape, bytes: new Uint8Array(await res.arrayBuffer()) });
  }
  return out;
}

/**
 * Magic-byte sniff for the formats `media.upload` accepts (jpeg, png, webp,
 * heic). Deliberately a header check, not a decode: the point is to refuse
 * obvious non-images before paying the provider, and anything that gets past
 * this is still bounded by the size caps and by the decoder's own guards.
 */
function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const magic = (...want: number[]) => want.every((b, i) => bytes[i] === b);
  if (magic(0xff, 0xd8, 0xff)) return true;                               // JPEG
  if (magic(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return true; // PNG
  const ascii = (at: number, text: string) =>
    [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return true;                  // WebP
  if (ascii(4, 'ftyp')) return true;                                      // HEIC/HEIF
  return false;
}

interface Context {
  supabaseUrl: string;
  serviceKey: string;
  accountId: string;
  apiToken: string;
  references: StyleRef[];
}

async function processOne(job: ClaimedJob, ctx: Context): Promise<Outcome> {
  const headers = { Authorization: `Bearer ${ctx.serviceKey}`, apikey: ctx.serviceKey };

  // The Bev, for the prompt's category hint. `source_photo_path` is the path
  // the ORIGINAL creation request carried, not whatever the Bev's photo is now.
  const bevRes = await fetch(
    `${ctx.supabaseUrl}/rest/v1/bevs?id=eq.${job.bev_id}&select=category_id,name,brand`,
    { headers },
  );
  if (!bevRes.ok) return { kind: 'failed', error: `bev_lookup_failed(${bevRes.status})` };
  const [bev] = (await bevRes.json()) as { category_id: string; name: string; brand: string | null }[];
  if (!bev) return { kind: 'failed', error: 'bev_missing' };

  const safePath = safeObjectPath(job.source_photo_path);
  if (!safePath) {
    // Nothing a retry can fix, and the shape is not one media.upload produces.
    return { kind: 'failed', error: 'source_photo_path_rejected: unexpected object key shape' };
  }
  const photoRes = await fetch(
    `${ctx.supabaseUrl}/storage/v1/object/bev-photos/${safePath}`,
    { headers },
  );
  if (!photoRes.ok) {
    // The object is gone. No retry will bring it back.
    return { kind: 'failed', error: `source_photo_unreadable(${photoRes.status}): not retryable` };
  }
  const photoDeclared = Number(photoRes.headers.get('Content-Length') ?? '0');
  if (photoDeclared > MAX_PHOTO_BYTES) {
    return { kind: 'failed', error: `source_photo_too_large(${photoDeclared})` };
  }
  const photo = new Uint8Array(await photoRes.arrayBuffer());
  if (photo.length > MAX_PHOTO_BYTES) {
    return { kind: 'failed', error: `source_photo_too_large(${photo.length})` };
  }
  // `create_bev` proves the object is in the right bucket, in the caller's
  // folder, and owned by them -- all METADATA. It never looks at the bytes,
  // and the bucket's allowed_mime_types trusts the client's declared
  // Content-Type, so `printf 'NOT A PHOTO!' > fake.jpg` uploaded as
  // image/jpeg is a "verified photograph" by that standard. Checking here
  // costs nothing and means garbage fails the job instead of spending a
  // metered generation on twelve bytes of ASCII.
  if (!looksLikeImage(photo)) {
    return { kind: 'failed', error: 'source_photo_not_an_image: no recognised image header' };
  }

  const form = new FormData();
  form.append('prompt', buildPrompt(bev.category_id));
  form.append('input_image_0', new Blob([photo as unknown as BlobPart]), 'photo.jpg');
  const chosen = pickReferences(ctx.references, bev.category_id, MAX_REFERENCES);
  chosen.forEach((ref, i) => {
    form.append(`input_image_${i + 1}`, new Blob([ref.bytes as unknown as BlobPart]), `${ref.slug}.png`);
  });
  form.append('width', String(OUT_WIDTH));
  form.append('height', String(OUT_HEIGHT));

  const genRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ctx.accountId}/ai/run/${MODEL}`,
    { method: 'POST', headers: { Authorization: `Bearer ${ctx.apiToken}` }, body: form },
  );
  // A hostile or broken provider response must not be able to OOM the isolate.
  // `atob` plus the mapped Uint8Array hold the string, the binary string and
  // the result at once -- roughly 3x peak -- so the cap is on the way in.
  const declared = Number(genRes.headers.get('Content-Length') ?? '0');
  if (declared > MAX_PROVIDER_BYTES) {
    return { kind: 'failed', error: `provider_response_too_large(${declared})` };
  }
  const genBody = await genRes.text();
  if (genBody.length > MAX_PROVIDER_BYTES) {
    return { kind: 'failed', error: `provider_response_too_large(${genBody.length})` };
  }
  if (!genRes.ok) {
    let codes: number[] = [];
    try {
      codes = (JSON.parse(genBody).errors ?? []).map((e: { code?: number }) => e.code).filter(Boolean);
    } catch { /* a non-JSON body is covered by the status */ }
    return classifyProviderError(genRes.status, codes, genBody);
  }

  let rendered: Uint8Array;
  try {
    const payload = JSON.parse(genBody) as { result?: { image?: string } };
    const b64 = payload.result?.image;
    if (!b64) return { kind: 'failed', error: 'provider_returned_no_image' };
    if (b64.length > MAX_IMAGE_B64) {
      return { kind: 'failed', error: `provider_image_too_large(${b64.length})` };
    }
    rendered = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return { kind: 'failed', error: 'provider_response_unparseable' };
  }

  // The model returns JPEG, always -- no format parameter changes it, which is
  // why `jpeg.ts` exists.
  let finished;
  let band;
  try {
    const decoded = decodeJpeg(rendered, MAX_DECODE_EDGE);
    // Assert we got back what we ordered. This is both a sanity check on the
    // provider and a second guard on the decoder: a forged SOF declaring a
    // huge frame is rejected here even if it survived the decoder's own cap.
    if (decoded.width !== OUT_WIDTH || decoded.height !== OUT_HEIGHT) {
      return {
        kind: 'failed',
        error: `unexpected_render_size(${decoded.width}x${decoded.height}, wanted ${OUT_WIDTH}x${OUT_HEIGHT})`,
      };
    }
    const cut = matte(decoded);
    band = findLabelBand(cut);
    finished = compositeShadow(cut);
  } catch (error) {
    return { kind: 'failed', error: `decode_failed: ${String(error).slice(0, 160)}` };
  }

  const clear = transparentFraction(finished);
  if (clear < MIN_TRANSPARENT || clear > MAX_TRANSPARENT) {
    // Not a product on a flat field. Publishing it would put a visibly broken
    // asset on someone's Bev; failing is recoverable and the fallback covers it.
    return { kind: 'failed', error: `implausible_matte(${clear.toFixed(2)}): not a product on a flat field` };
  }

  const fullPng = await encodePng(finished);
  const thumbPng = await encodePng(downscale(finished, THUMB_WIDTH, THUMB_HEIGHT));

  const fullPath = `${job.bev_id}/icon-${OUT_WIDTH}.png`;
  const thumbPath = `${job.bev_id}/icon-${THUMB_WIDTH}.png`;
  if (fullPng.length > MAX_ICON_BYTES || thumbPng.length > MAX_ICON_BYTES) {
    // The bucket would reject it, and retrying re-renders the same bytes.
    return { kind: 'failed', error: `icon_too_large(${fullPng.length}): exceeds the bucket limit` };
  }
  for (const [path, bytes] of [[fullPath, fullPng], [thumbPath, thumbPng]] as const) {
    const up = await fetch(iconUploadUrl(ctx.supabaseUrl, path), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'image/png', 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
      body: bytes as unknown as BodyInit,
    });
    if (!up.ok) {
      // Storage is transient in a way the provider is not: retry.
      return { kind: 'failed', error: `upload_failed(${up.status}): ${(await up.text()).slice(0, 120)}` };
    }
  }

  // The band goes back with the result so the app can letter the icon from
  // what the user typed. The model is never asked for lettering: it rejects
  // brand marks deterministically.
  return { kind: 'completed', iconPath: fullPath, labelBand: band };
}
