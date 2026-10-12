// The only module the app imports to reach the backend
// (DEVELOPMENT-ARJUN.md §6). Implements `BeviApi` from `@bevi/shared` on
// Supabase; the app never imports `@supabase/supabase-js` and never sees
// the client this creates.
import type { BeviApi } from '@bevi/shared';
import { createAuthApi } from './auth';
import { createBevsApi } from './bevs';
import { createCategoriesApi } from './categories';
import { type BeviApiConfig, createSupabaseClientFor } from './client';
import { createFeedApi } from './feed';
import { createFollowsApi } from './follows';
import { createLeaderboardApi } from './leaderboard';
import { createMediaApi } from './media';
import { createMetaApi } from './meta';
import { createProfileApi } from './profile';
import { createRankingsApi } from './rankings';
import { createRecsApi } from './recs';
import { createStatsApi } from './stats';
import { createWantToTryApi } from './wantToTry';

export type { AuthStorageAdapter, BeviApiConfig } from './client';

export function createBeviApi(config: BeviApiConfig): BeviApi {
  const client = createSupabaseClientFor(config);
  const auth = createAuthApi(client);

  return {
    ...auth,
    profile: createProfileApi(client),
    stats: createStatsApi(client),
    follows: createFollowsApi(client),
    categories: createCategoriesApi(client),
    bevs: createBevsApi(client),
    media: createMediaApi(client),
    rankings: createRankingsApi(client),
    wantToTry: createWantToTryApi(client),
    feed: createFeedApi(client),
    leaderboard: createLeaderboardApi(client),
    recs: createRecsApi(client),
    meta: createMetaApi(),
  };
}

export { ApiError, isApiError } from '@bevi/shared';
