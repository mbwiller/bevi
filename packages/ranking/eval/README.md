# `packages/ranking/eval/`: offline evaluation harness (graph Stage 1)

Measures the **current** prediction engine and its baselines on held-out data, so later
changes (Pearson, graph neighbours, `docs/graph_db_implementation.md` Stages 3–5) are judged
against numbers rather than intuition. No formula changes and nothing exported from
`src/index.ts`: `npm run bundle:smoke` fails if the bundle reaches `eval/`, `test/` or `scripts/`.
Everything here is pure except `cli.ts`, which reads the export file.

## Commands (from the repo root)

```
npm run eval -w packages/ranking -- <export.json>          # text report
npm run eval -w packages/ranking -- <export.json> --json   # the EvalReport as JSON
npm run eval -w packages/ranking -- --synthetic            # harness check, NOT an accuracy result
npm run eval -w packages/ranking -- --write-sample out.json   # a synthetic file in the export format
```

Options: `--split loo|temporal`, `--no-respace`, `--quantile 0.8`, `--bootstrap 1000`,
`--seed s`, `--users N --bevs N` (synthetic size). Synthetic output is wrapped in a banner:
`syntheticSnapshot()` plants tastes with the model's own assumptions, and within a bucket its
order is random, so it says nothing about accuracy.

## Export format (`formatVersion` 1)

One JSON object. Pseudonymise users; keep the file outside the repo.

```jsonc
{
  "format": "bevi-eval-export", "formatVersion": 1, "exportedAt": "2026-10-18T00:00:00Z",
  "bevs":        [{ "id", "name", "brand", "flavor", "categoryId", "priceTier", "isAlcoholic" }],
  "rankings":    [{ "userId", "bevId", "bucket": 3|2|1, "position", "score", "rankedAt" }],
  "comparisons": [{ "userId", "submissionId", "winnerBevId", "loserBevId", "tie", "createdAt" }],
  "edges":       [{ "a", "b", "w" }]   // optional: bev_edges as src_bev_id, dst_bev_id, weight
}
```

`bucket` uses the DB encoding (3 LOVED, 2 FINE, 1 DISLIKED); `score` may be a number or a numeric
string; timestamps are ISO 8601, truncated to the hour by the export; `submissionId` is an opaque
salted hash (used only for grouping). Rows on Bevs missing from `bevs` are dropped and counted. A
duplicated (user, Bev) ranking keeps the latest. `brand`/`flavor`/`name` are normalised by
`normaliseBrand` / `flavorTokens`, as `packages/api/src/snapshot.ts` does. `edges` is optional
(same `formatVersion`): each unordered pair once, `w` in [0, 1] (number or numeric string); edges
touching a Bev missing from `bevs` are dropped. Without it, the `-edges` arms fall back to the
computed content similarity and equal their twins. `export.sql` does not emit it yet; adding
`select src_bev_id as a, dst_bev_id as b, weight as w from bev_edges` is all it takes.

To produce the file, use the query shipped as `eval/export.sql`. Run it as a database role that
bypasses RLS (e.g. `postgres`). Pass the salt with `-v`, not `\set`, so it stays out of psql
history:

```
psql "$DATABASE_URL" -At -v salt="$SALT" -f packages/ranking/eval/export.sql > export.json
```

Re-identification guards: `userId` is a salted alias (`u<n>`), `submissionId` is
`md5(submission_id || salt)`, and `rankedAt` / `createdAt` are truncated to the hour (UTC), so
rows can't be joined to the visible `feed_events.created_at`. The harness only needs hour
precision. The temporal cutoff is an instant, and rows in the cutoff hour all fall on the test
side, together with the comparisons from the same submission (they share `now()`). Ties within an
hour are broken by array order, which the query fixes: rankings by exact `ranked_at` then `id`,
comparisons by `id`. So "latest answer per pair" means the last one in the array.

## How a fold is built (`folds.ts`)

A fold is a brand-new `PredictionSnapshot` built from the training rows only, so nothing about
a held-out row survives: user μ/σ/n and category stats, Bev `ratingCount`/`mean`/`stddev`, the
`rankings` that `globalScore()` and Layer 2 sum over, global mean/σ/category means, and the
`snapshotContext` WeakMap (new object every fold). By default, any user who lost a row also has
their buckets **re-spaced**, which recreates the scores the app would have stored without that
Bev (otherwise the spacing gap gives its position away). `test/eval-folds.test.ts` shows each
leak changing a prediction.

## Splits

- **Leave-one-out.** One fold per (user, Bev) gives MAE, bucket accuracy and CF coverage. One
  fold per comparison, with **both** Bevs held out, gives concordance. Spearman and NDCG are not
  reported here: every Bev comes from a different fold, and the leave-one-out μ_u (the mean of the
  other scores) is anti-correlated with the held-out score, so even a constant-μ_u arm gets
  ρ ≈ −0.9.
- **Temporal.** Train on every ranking with `ranked_at` before the cutoff (the 0.8 quantile). Test
  on rankings at or after it (one shared fold, so list metrics are valid) and on comparisons made
  at or after it (with both Bevs removed from the user's training rows).

Users need `MIN_N_USER` (3) training rankings. Cohorts use that n_u: {3–5, 6–14, 15+}.

## Metrics

Primary: **pairwise concordance** on decisive comparisons. A comparison scores 1 if the winner is
predicted higher, 0.5 on a predicted tie, 0 otherwise; we take the mean per user, then over users.
For each (user, pair) only the latest answer counts, and "too close to call" answers are excluded.
Secondary: macro Spearman, tie-aware NDCG@10 (gain Loved 3, Fine 1, Disliked 0), bucket accuracy
via `bucketForScore` with a 3×3 confusion matrix, MAE, and CF coverage (the share of predictions
with Layer 2 support > 0). NDCG@10 ranks the user's held-out temporal items, not the whole catalog.
Every number gets a 95% paired percentile bootstrap over users (`createPrng(seed)`), and every
arm gets a Δ against `engine` computed on the same resamples. If some resamples give an
undefined statistic (for example, a small cohort where no drawn user has a comparison), the report
shows how many draws were valid, e.g. `(812/1000 draws)`, and the JSON carries it as `draws`.

Arms: `global-mean`, `user-mean` (constant μ*_u), `category-mean`, `user-category-mean`,
`bayes-bev`, `item-mean-z` (`globalScore`), `l1-affinity`, `l1-content`, `layer1`, `layer2`,
`layer2-pearson`, `engine` (`predictScore`), `engine-pearson`, the `-edges` arms and the `-stored`
arms. The two `-pearson` arms are **experimental**: they call the real `layer2` / `predictScore` with `{ userSimilarity: 'pearson' }`
(M-28, `RANKING_VERSION` 1.3.0), which swaps §8.9's cosine for Pearson over the common subset
(`pearsonSimilarity` in `src/graph.ts`) and changes nothing else. Production still runs the
default, `'cosine'`. The report also prints cosine-vs-Pearson disagreement over every user pair,
and the median number of co-raters per item pair (§8.9).

The three `-edges` arms (`l1-content-edges`, `layer1-edges`, `engine-edges`) are **experimental**
too: they call the real `layer1` / `predictScore` with `{ bevSimilarity: 'edges' }` (M-27 (a),
`RANKING_VERSION` 1.4.0), which replaces the content term's computed similarity by the stored edge
weight w, with 0 for a pair without an edge. Edge weights read no rankings (γ = 0), so attaching
the same edges to every fold leaks nothing. `--synthetic` builds stand-in edges with
`syntheticEdges` (`edgeWeight` with emb = profile = 0, so only same-category pairs clear 0.3);
they exercise the plumbing and say nothing about the real graph.

The two `-stored` arms (`layer2-stored`, `engine-stored`) are **experimental** as well: they call
the real `layer2` / `predictScore` with `{ userSimilarity: 'stored' }` (graph Stage 4,
`RANKING_VERSION` 1.6.0), which weights only the user's stored taste neighbours, each by
sim_B · min(1, n_v / 15), and gives everyone else 0. Unlike edges, neighbours are computed from
rankings, so they must never come from the full data or from a dump of `user_neighbors`: the
harness rebuilds them in **every fold from that fold's training rows** (`syntheticNeighbours`,
which mirrors `scripts/graph/neighbours-core.ts` with the package's exports; `folds.ts` leak 6),
and only when a stored arm is in the run, since it scores every user pair per fold. A snapshot
carries no flavour bases, so in the harness brand is the only bridging attribute and the attribute
term understates the real graph's. A user with no neighbour above the 0.1 floor falls back to the
cosine, exactly as in the app.

## Caveats

- Comparisons are only ever made **within a bucket**, so concordance measures fine ordering only.
  Cross-bucket ordering shows up in NDCG and bucket accuracy.
- The export is the current state. A re-rank moves a Bev's bucket and position but keeps
  `ranked_at`, and older comparisons with it may now disagree with its position. The latest answer
  per pair is kept as-is.
