// Which backend the app runs on: the single source of truth for EXPO_PUBLIC_BEVI_API.
// client.ts builds `api` from it; dev-only code (the session override) checks it too. Kept apart
// from client.ts so checking the backend never constructs (or fails to construct) the API.

export type ApiBackend = 'mock' | 'supabase';

export function resolveBackend(value: string | undefined): ApiBackend {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'mock') return 'mock'; // MOCK: the default until packages/api lands
  if (v === 'supabase') return 'supabase';
  throw new Error(`EXPO_PUBLIC_BEVI_API must be "mock" or "supabase", got "${value}"`);
}

/** The backend selected by EXPO_PUBLIC_BEVI_API, read at call time (read literally so Expo inlines it). */
export function apiBackend(): ApiBackend {
  return resolveBackend(process.env.EXPO_PUBLIC_BEVI_API);
}
