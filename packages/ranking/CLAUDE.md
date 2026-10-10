# packages/ranking (`@bevi/ranking`)

Matt's lane. Pure TypeScript for Bevi's maths: the placement state machine, score-from-position, stats and z-scores, the Bayesian leaderboard average. Recommendations, streaks and "Rank on Bevi" come in Phase 2. The formulas are specified in `DEVELOPMENT-MATT.md` §8–§10; this package is the executable version of them.

## Rules

- **Zero I/O, bundle-safe.** Arjun's Edge Functions bundle `src/index.ts` with esbuild (`--format=esm --platform=neutral`). So:
  - no Node or DOM APIs (`fs`, `process`, `Buffer`, `fetch`, `window`);
  - no `Date.now()`, `new Date()` or `Math.random()`: time is passed in, and randomness comes from `prng.ts` with a seed;
  - no dependencies;
  - ESM only, relative imports with `.ts` extensions, no tsconfig path aliases;
  - TS syntax that strips cleanly (`erasableSyntaxOnly`), so no `enum` and no `namespace`.

  `npm run bundle:smoke` enforces this. `tsconfig.json` checks `src/` with no Node types.
- **Formulas are a contract.** Arjun's SQL implements the same maths and must pass the vectors in `shared/fixtures/*.vectors.json`. Changing a formula or constant means: bump `RANKING_VERSION` in `src/constants.ts`, run `npm run vectors`, and open a `contract/vectors-*` PR with the regenerated files. Never edit vectors by hand.
- **Score bands are 7 / 4** (decided 2026-10-09): DISLIKED [0, 4), FINE [4, 7), LOVED [7, 10]. Stored scores use exact integer arithmetic (`storedScoreCents`), so JS and Postgres agree on every half cent.
- **Population stddev** everywhere (`stddev_pop`), floored at `SIGMA_FLOOR` before z-scores.
- Every formula gets a table test from the doc's worked examples and, where it has an invariant, a fast-check property test (`test/*.property.test.ts`).

## Commands (run from the repo root)

```
npm run typecheck -w packages/ranking
npm test -w packages/ranking
npm run bundle:smoke -w packages/ranking
npm run vectors -w packages/ranking            # writes shared/fixtures/*.vectors.json
npm run vectors -w packages/ranking -- --check  # CI: fails if the committed vectors are stale
```

Model guidance (vision §10): formula design and review on Opus/High; test tables and generator boilerplate on Haiku.
