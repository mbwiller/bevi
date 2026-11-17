// The only module the app imports to reach the backend
// (DEVELOPMENT-ARJUN.md §6). Implements `BeviApi` from `@bevi/shared` on
// Supabase; the app never imports `@supabase/supabase-js` and never sees
// the client this creates.
import type { BeviApi } from '@bevi/shared';
import { createNutritionApi } from './nutrition';
import { createAuthApi } from './auth';
import { createBevsApi } from './bevs';
import { createBugsApi } from './bugs';
import { createCategoriesApi } from './categories';
import { type BeviApiConfig, createSupabaseClientFor } from './client';
import { createCommentsApi } from './comments';
import { createFeedApi } from './feed';
import { createFollowsApi } from './follows';
import { withGeneratedIcons } from './generatedIcons';
import { createLeaderboardApi } from './leaderboard';
import { createMediaApi } from './media';
import { createMetaApi } from './meta';
import { createProfileApi } from './profile';
import { createRankingsApi } from './rankings';
import { createRecsApi } from './recs';
import { createVenuesApi } from './venues';
import { createSnapshotCache } from './snapshot';
import { createStatsApi } from './stats';
import { createWantToTryApi } from './wantToTry';

export type { AuthStorageAdapter, BeviApiConfig } from './client';

export function createBeviApi(config: BeviApiConfig): BeviApi {
  const client = createSupabaseClientFor(config);
  const auth = createAuthApi(client);
  // The caller's PredictionSnapshot for recommendations and predicted scores.
  // Dropped on ranking and Bev writes (rankings.ts, bevs.ts), on any change of
  // signed-in user, and when the birthdate or timezone changes (which change
  // what the snapshot may contain and the recommendation seed).
  const snapshots = createSnapshotCache(client);
  client.auth.onAuthStateChange((event) => {
    if (event !== 'TOKEN_REFRESHED' && event !== 'INITIAL_SESSION') snapshots.invalidate();
  });
  const profile = createProfileApi(client);

  // Every method that answers with a Bev has its `iconUrl` filled with the
  // Bev's own generated icon first, so a created icon draws exactly where an
  // authored one does. See generatedIcons.ts for why it wraps the whole API.
  return withGeneratedIcons(client, {
    ...auth,
    nutrition: createNutritionApi(),
    profile: {
      ...profile,
      async setBirthDate(date) {
        const me = await profile.setBirthDate(date);
        snapshots.invalidate();
        return me;
      },
      async updateMe(patch) {
        const me = await profile.updateMe(patch);
        if (patch.timezone !== undefined) snapshots.invalidate();
        return me;
      },
    },
    stats: createStatsApi(client),
    follows: createFollowsApi(client),
    categories: createCategoriesApi(client),
    bevs: createBevsApi(client, snapshots),
    media: createMediaApi(client),
    rankings: createRankingsApi(client, snapshots),
    wantToTry: createWantToTryApi(client),
    feed: createFeedApi(client),
    comments: createCommentsApi(client),
    leaderboard: createLeaderboardApi(client),
    recs: createRecsApi(client, snapshots),
    venues: createVenuesApi(client),
    bugs: createBugsApi(client),
    meta: createMetaApi(),
  });
}

export { ApiError, isApiError } from '@bevi/shared';
