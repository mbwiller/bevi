import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type MediaApi, type UploadMediaInput, type UploadMediaResult } from '@bevi/shared';
import { mapError } from './errors';
import { publicUrl } from './mappers';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

// Interim simplification (no `process-photo` Edge Function / background-
// removal pipeline yet -- that's milestone 1.6, a separate ticket):
// uploads go straight into the bucket the Bev is actually served from
// instead of `raw-uploads` as a staging area, since there's no worker to
// ever move an object out of staging. Revisit this once 1.6 lands --
// at that point `kind` should probably route through `raw-uploads` and a
// job queue instead.
const BUCKET_BY_KIND: Record<UploadMediaInput['kind'], string> = {
  'bev-photo': 'bev-photos',
  label: 'nutrition-labels',
};

// Matches the allow-list enforced server-side (20261011000800_media_upload.sql
// sets `allowed_mime_types` on both buckets) and DEVELOPMENT-ARJUN.md's
// `raw-uploads object insert` row, reused here for lack of a better list.
const EXT_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

// Matches `raw-uploads object insert: 10 MB max` in DEVELOPMENT-ARJUN.md's
// rate-limit table -- reused here since there's no better number yet.
// Also set server-side as a backstop (`file_size_limit` on both buckets,
// same migration) in case a caller other than this function ever reaches
// the Storage API directly.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function randomId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  // Fallback for runtimes without a global `crypto.randomUUID` (some
  // Hermes/React Native setups without a polyfill). Collision risk is
  // negligible -- it only has to be unique within one user's own prefix.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMediaApi(client: SupabaseClient): MediaApi {
  return {
    async upload(input: UploadMediaInput): Promise<UploadMediaResult> {
      const uid = await requireUserId(client);

      const ext = EXT_BY_MIME_TYPE[input.mimeType];
      if (!ext) {
        throw new ApiError('validation', `Unsupported mimeType: ${input.mimeType}`, { field: 'mimeType' });
      }
      if (input.file.size > MAX_UPLOAD_BYTES) {
        throw new ApiError('validation', `File exceeds the ${MAX_UPLOAD_BYTES} byte limit`, { field: 'file' });
      }

      // `assert_rate()` is security-definer SQL, only callable from
      // inside another SQL/plpgsql function -- the Storage API has no
      // hook to run it, so this RPC call stands in for a pre-check the
      // storage upload itself can't perform. Must happen before the
      // actual upload below.
      const { error: rateError } = await client.rpc('assert_upload_rate');
      if (rateError) throw mapError(rateError);

      const bucket = BUCKET_BY_KIND[input.kind];
      const path = `${uid}/${randomId()}.${ext}`;

      const { error: uploadError } = await client.storage.from(bucket).upload(path, input.file, { contentType: input.mimeType });
      if (uploadError) throw mapError(uploadError);

      return {
        // The storage path -- `create_bev`'s `p_photo_asset_id`/
        // `p_label_asset_id` already treat `assetId` this way (see
        // `bevs.ts`'s `create()`).
        assetId: path,
        url: publicUrl(client, bucket, path) ?? '',
        // Always 'ready': there's no async background-removal pipeline
        // yet (process-photo, milestone 1.6) that could ever leave this
        // 'processing'. Revisit once that pipeline exists.
        status: 'ready',
      };
    },
  };
}
