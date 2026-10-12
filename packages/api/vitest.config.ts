import { defineConfig } from 'vitest/config';

// The *.live tests make many sequential calls to a real Supabase project; against a hosted one
// (BEVI_INVITE_CODE smoke runs) vitest's 5 s default is too short.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});
