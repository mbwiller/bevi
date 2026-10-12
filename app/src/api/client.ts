// The one place the app builds its backend: `packages/api` (`@bevi/api`) on Supabase. Screens and
// hooks import `api` from here and never a backend package. The project comes from
// EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (app/.env.example; set in Vercel
// for deploys). Under jest this module is replaced by the in-memory FakeApi (jest.setup.js).

import { createBeviApi } from '@bevi/api';
import type { BeviApi } from '@bevi/shared';

import { webAuthStorage } from './authStorage';
import { readApiConfig, unconfiguredApi, type ApiConfig } from './config';

/** Read literally so Expo inlines the values at build time. */
export const apiConfig: ApiConfig = readApiConfig(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

export const api: BeviApi = apiConfig.ok
  ? createBeviApi({ url: apiConfig.url, publishableKey: apiConfig.publishableKey, authStorage: webAuthStorage() })
  : unconfiguredApi(apiConfig.problem);
