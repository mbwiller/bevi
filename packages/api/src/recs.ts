import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type RecsApi } from '@bevi/shared';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

// Not implemented: no recommendation-generation job exists yet
// (`recommendation_jobs` is a queue table with no worker, and
// `user_bev_predictions` has no writer) -- that's milestone 1.4 / Phase 2.
export function createRecsApi(client: SupabaseClient): RecsApi {
  return {
    async getRecommendations() {
      await requireUserId(client);
      throw new ApiError('unknown', 'recs.getRecommendations is not implemented yet (no recommendation job exists, milestone 1.4)');
    },
    async refresh() {
      await requireUserId(client);
      throw new ApiError('unknown', 'recs.refresh is not implemented yet (no recommendation job exists, milestone 1.4)');
    },
  };
}
