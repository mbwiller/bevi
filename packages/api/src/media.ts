import type { MediaApi } from '@bevi/shared';
import { ApiError } from '@bevi/shared';

// Not implemented: there's no asset-storage pipeline yet (no assets table,
// no raw-uploads policies wired here, no background-removal processing --
// that's milestone 1.6's `process-photo` Edge Function). Throwing instead
// of a silent fake success so callers see this as "not built", not a bug.
export function createMediaApi(): MediaApi {
  return {
    async upload() {
      throw new ApiError('unknown', 'media.upload is not implemented yet (pending the asset-storage pipeline, milestone 1.6)');
    },
  };
}
