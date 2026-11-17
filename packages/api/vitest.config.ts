import { defineConfig } from 'vitest/config';

// The *.live tests make many sequential calls to a real Supabase project; against a hosted one
// (BEVI_INVITE_CODE smoke runs) vitest's 5 s default is too short.
// `fileParallelism: false` because these files share one database. S-07's
// test in recs-and-stats.live.test.ts reads `categories.list().bevCount` and
// `getCategoryProgress().total` in two round trips and expects them equal,
// while catalog-and-media.live.test.ts creates an active soda in parallel:
// the two counts then straddle the insert (65 vs 64). Serialising the files
// is the smaller fix -- the alternative is making every create test clean up
// before any other file's comparison, which no test boundary enforces.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
