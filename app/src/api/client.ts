// The one place the app picks its backend. Screens and hooks import `api` from here and never
// from ./mock or a backend package.
//
//   EXPO_PUBLIC_BEVI_API=mock      in-memory MockApi persisted to localStorage (default for now)
//   EXPO_PUBLIC_BEVI_API=supabase  packages/api (not available yet: throws at startup)
//
// Removing the mock later: delete app/src/api/mock/ (and app/scripts/build-mock-seed.mjs), delete
// everything marked MOCK below (the import, the 'mock' case, `mockControls`), and set
// EXPO_PUBLIC_BEVI_API=supabase (or make 'supabase' the default in resolveBackend).

import type { BeviApi } from '@bevi/shared';

import { getMockApi, mockControls as mockControlsImpl, type MockControls } from './mock'; // MOCK

export type ApiBackend = 'mock' | 'supabase';

function resolveBackend(value: string | undefined): ApiBackend {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'mock') return 'mock';
  if (v === 'supabase') return 'supabase';
  throw new Error(`EXPO_PUBLIC_BEVI_API must be "mock" or "supabase", got "${value}"`);
}

// Read literally so Expo inlines it at build time.
export const API_BACKEND: ApiBackend = resolveBackend(process.env.EXPO_PUBLIC_BEVI_API);

function createApi(backend: ApiBackend): BeviApi {
  switch (backend) {
    case 'mock': // MOCK
      return getMockApi(); // MOCK
    case 'supabase':
      // When packages/api lands: `return createBeviApi({ url, publishableKey, authStorage })`.
      throw new Error(
        'EXPO_PUBLIC_BEVI_API=supabase, but packages/api is not available yet. Use EXPO_PUBLIC_BEVI_API=mock (the default).',
      );
  }
}

export const api: BeviApi = createApi(API_BACKEND);

/** Dev controls (failNext, setLatency, resetToFixtures, emptyUser, signInAs); null on the real API. */
export const mockControls: MockControls | null = API_BACKEND === 'mock' ? mockControlsImpl : null; // MOCK
