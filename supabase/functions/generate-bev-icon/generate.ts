// Shared by the deployed worker and the offline/live quality evaluation runner.
// No server, environment reads, database calls or storage writes on import.
import { decodeJpeg } from './jpeg.ts';
import { encodePng } from './png.ts';
import { compositeShadow, downscale, findLabelBand, matte, transparentFraction } from './image.ts';
import { buildPrompt, pickReferences, type StyleRef } from './prompt.ts';

export const MODEL = '@cf/black-forest-labs/flux-2-klein-9b';
export const OUT_WIDTH = 768;
export const OUT_HEIGHT = 1024;
export const THUMB_WIDTH = 192;
const THUMB_HEIGHT = 256;
const MAX_REFERENCES = 3;
const MIN_TRANSPARENT = 0.25;
const MAX_TRANSPARENT = 0.97;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_PROVIDER_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_B64 = 8_000_000;
const MAX_DECODE_EDGE = 4096;
const MAX_ICON_BYTES = 2 * 1024 * 1024;

export type GenerationResult =
  | {
    kind: 'completed';
    fullPng: Uint8Array;
    thumbPng: Uint8Array;
    labelBand: ReturnType<typeof findLabelBand>;
    transparentFraction: number;
    providerJpeg?: Uint8Array;
  }
  | { kind: 'failed'; error: string; retryable?: boolean }
  | { kind: 'release'; reason: string };
type Outcome = Exclude<GenerationResult, { kind: 'completed' }>;
export interface GenerationInput {
  photo: Uint8Array;
  categoryId: string;
  references: StyleRef[];
  accountId: string;
  apiToken: string;
}

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
export function classifyProviderError(status: number, codes: number[], body: string): Outcome {
  if (codes.includes(3030)) {
    return {
      kind: 'failed',
      error: 'provider_output_flagged(3030): likely a brand mark; not retryable',
      retryable: false,
    };
  }
  if (status === 429 || /quota|rate limit|neurons/i.test(body)) {
    return { kind: 'release', reason: 'provider_quota_exhausted: resets at 00:00 UTC' };
  }
  if (codes.includes(3043) || status >= 500) {
    return {
      kind: 'failed',
      error: `provider_unavailable(${codes.join(',') || status}): transient`,
    };
  }
  return {
    kind: 'failed',
    error: `provider_error(${codes.join(',') || status}): ${body.slice(0, 200)}`,
  };
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
  if (magic(0xff, 0xd8, 0xff)) return true; // JPEG
  if (magic(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return true; // PNG
  const ascii = (at: number, text: string) =>
    [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return true; // WebP
  if (ascii(4, 'ftyp')) return true; // HEIC/HEIF
  return false;
}

/** One provider call, no hidden retries. The queue owns retry policy. */
export async function generateIcon(
  input: GenerationInput,
  request: typeof fetch = fetch,
): Promise<GenerationResult> {
  if (input.photo.length > MAX_PHOTO_BYTES) {
    return { kind: 'failed', error: 'source_photo_too_large', retryable: false };
  }
  if (!looksLikeImage(input.photo)) {
    return { kind: 'failed', error: 'source_photo_not_an_image', retryable: false };
  }
  try {
    const form = new FormData();
    form.append('prompt', buildPrompt(input.categoryId));
    form.append('input_image_0', new Blob([input.photo as unknown as BlobPart]), 'photo.jpg');
    const chosen = pickReferences(input.references, input.categoryId, MAX_REFERENCES);
    chosen.forEach((ref, i) => {
      form.append(
        `input_image_${i + 1}`,
        new Blob([ref.bytes as unknown as BlobPart]),
        `${ref.slug}.png`,
      );
    });
    form.append('width', String(OUT_WIDTH));
    form.append('height', String(OUT_HEIGHT));

    const genRes = await request(
      `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/ai/run/${MODEL}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiToken}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      },
    );
    // A hostile or broken provider response must not be able to OOM the isolate.
    // `atob` plus the mapped Uint8Array hold the string, the binary string and
    // the result at once -- roughly 3x peak -- so the cap is on the way in.
    const declared = Number(genRes.headers.get('Content-Length') ?? '0');
    if (declared > MAX_PROVIDER_BYTES) {
      await genRes.body?.cancel();
      return { kind: 'failed', error: `provider_response_too_large(${declared})` };
    }
    // Enforce the cap while reading, including chunked responses without Content-Length.
    const reader = genRes.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > MAX_PROVIDER_BYTES) {
            await reader.cancel();
            return { kind: 'failed', error: `provider_response_too_large(${received})` };
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const responseBytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      responseBytes.set(chunk, offset);
      offset += chunk.length;
    }
    const genBody = new TextDecoder().decode(responseBytes);
    if (!genRes.ok) {
      let codes: number[] = [];
      try {
        codes = (JSON.parse(genBody).errors ?? []).map((e: { code?: number }) => e.code).filter(
          Boolean,
        );
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

    const result = await finishRender(rendered);
    return result.kind === 'completed' ? { ...result, providerJpeg: rendered } : result;
  } catch {
    // Do not persist exception text: fetch implementations may include URLs or headers.
    return { kind: 'failed', error: 'provider_transport_failed' };
  }
}

/** Replays exactly the worker's postprocessing without spending a provider call. */
export async function finishRender(rendered: Uint8Array): Promise<GenerationResult> {
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
        error:
          `unexpected_render_size(${decoded.width}x${decoded.height}, wanted ${OUT_WIDTH}x${OUT_HEIGHT})`,
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
    return {
      kind: 'failed',
      error: `implausible_matte(${clear.toFixed(2)}): not a product on a flat field`,
    };
  }

  const fullPng = await encodePng(finished);
  const thumbPng = await encodePng(downscale(finished, THUMB_WIDTH, THUMB_HEIGHT));

  if (fullPng.length > MAX_ICON_BYTES || thumbPng.length > MAX_ICON_BYTES) {
    return { kind: 'failed', error: `icon_too_large(${fullPng.length}): exceeds the bucket limit` };
  }
  return { kind: 'completed', fullPng, thumbPng, labelBand: band, transparentFraction: clear };
}
