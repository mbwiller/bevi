// The one place the app builds its backend: `packages/api` (`@bevi/api`) on Supabase. Screens and
// hooks import `api` from here and never a backend package. The project comes from
// EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (app/.env.example; set in Vercel
// for deploys, in the EAS environment for iOS builds). Under jest this module is replaced by the
// in-memory FakeApi (jest.setup.js).
//
// The session lives where `createAuthStorage` puts it: `authStorage.web.ts` (localStorage) on the
// web, `authStorage.ts` (the iOS Keychain) on native. Metro picks the file by platform.

import { createBeviApi } from '@bevi/api';
import type { BeviApi } from '@bevi/shared';

import { createAuthStorage } from './authStorage';
import { readApiConfig, unconfiguredApi, type ApiConfig } from './config';
import { observed } from './observe';

/** Read literally so Expo inlines the values at build time. */
export const apiConfig: ApiConfig = readApiConfig(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

// `observed` lets the internal bug reporter's trail see which calls failed (observe.ts); until it
// subscribes, a call through it costs one null check.
export const api: BeviApi = apiConfig.ok
  ? observed(createBeviApi({ url: apiConfig.url, publishableKey: apiConfig.publishableKey, authStorage: createAuthStorage() }))
  : unconfiguredApi(apiConfig.problem);

// Not here yet: on native, supabase-js should refresh the token only while the app is active, so a
// session left backgrounded overnight refreshes on resume. That is an AppState listener here, calling
// the refresh control @bevi/api has not exported yet (DEVELOPMENT-ARJUN-IOS.md, IA-5).
