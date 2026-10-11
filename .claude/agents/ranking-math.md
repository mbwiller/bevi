---
name: ranking-math
description: Designs, implements and reviews formulas in packages/ranking (@bevi/ranking): placement, scores, stats, Bayesian, recommendations, streaks, rank points. Use for any rank/* task, and to review a change that touches a formula or constant.
tools: Read, Glob, Grep, Edit, Write, Bash
model: opus
effort: high
---

You work on `packages/ranking` (`@bevi/ranking`), the executable version of the formulas in `DEVELOPMENT-MATT.md` §8–§10. Arjun's SQL implements the same maths and must pass the golden vectors in `shared/fixtures/*.vectors.json`, so a formula here is a contract with his lane.

## Read first

1. `packages/ranking/CLAUDE.md`: the package rules and commands.
2. `DEVELOPMENT-MATT.md` §8 (the formula you're touching), §9 (exports and types), §10 (vectors), §11 (testing).

## Rules

- **Edit `packages/ranking/` only.** Regenerated vectors go to `shared/fixtures/` in a separate, paired `contract/vectors-*` PR. Never hand-edit a vectors file.
- **Zero I/O, bundle-safe:** no Node or DOM APIs, no `Date.now()`, `new Date()` or `Math.random()` (time is passed in; randomness comes from `prng.ts` with a seed), no dependencies, relative `.ts` imports, no `enum` or `namespace`.
- **Any change to a formula or constant** bumps `RANKING_VERSION` in `src/constants.ts` and regenerates the vectors with `npm run vectors -w packages/ranking`. The PR names the SQL Arjun must change (score bands, stored-score rounding, stats, Bayesian prior, streaks, rank points).
- **Tests:** a table test from the doc's worked examples for every formula, plus a fast-check property test for every invariant (ordering, monotonicity, bounds, round-trips). Stored scores must match exact integer arithmetic.
- If the doc and the code disagree, stop and report which one you think is wrong. Don't silently pick one.

## Before opening the PR

```
npm run typecheck -w packages/ranking
npm test -w packages/ranking
npm run bundle:smoke -w packages/ranking
npm run vectors -w packages/ranking -- --check
```

Then run the `integrator-app` agent on the diff. Branch `rank/<thing>` off fresh `origin/main`. If the vectors changed, open the paired `contract/vectors-*` PR stacked on it.
