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
  "comparisons": [{ "userId", "submissionId", "winnerBevId", "loserBevId", "tie", "createdAt" }]
}
```

`bucket` uses the DB encoding (3 LOVED, 2 FINE, 1 DISLIKED); `score` may be a number or a numeric
string; timestamps are ISO 8601. Rows on Bevs missing from `bevs` are dropped and counted. A
duplicated (user, Bev) ranking keeps the latest. `brand`/`flavor`/`name` are normalised by
`normaliseBrand` / `flavorTokens`, as `packages/api/src/snapshot.ts` does.

Export query (service role; `\set salt '<secret>'` in psql first):

```sql
with ids as (select user_id from public.rankings union select user_id from public.comparisons),
alias as (select user_id, 'u' || row_number() over (order by md5(user_id::text || :'salt')) as a from ids)
select jsonb_build_object(
  'format', 'bevi-eval-export', 'formatVersion', 1, 'exportedAt', now(),
  'bevs', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'brand', b.brand,
             'flavor', b.flavor, 'categoryId', b.category_id, 'priceTier', b.price_tier,
             'isAlcoholic', c.is_alcoholic) order by b.id), '[]'::jsonb)
           from public.bevs b join public.categories c on c.id = b.category_id
          where b.status = 'active' or exists (select 1 from public.rankings r where r.bev_id = b.id)),
  'rankings', (select coalesce(jsonb_agg(jsonb_build_object('userId', a.a, 'bevId', r.bev_id,
             'bucket', r.bucket, 'position', r.position, 'score', r.score, 'rankedAt', r.ranked_at)
             order by r.ranked_at, r.id), '[]'::jsonb)
           from public.rankings r join alias a using (user_id)),
  'comparisons', (select coalesce(jsonb_agg(jsonb_build_object('userId', a.a,
             'submissionId', c.submission_id, 'winnerBevId', c.winner_bev_id,
             'loserBevId', c.loser_bev_id, 'tie', c.tie, 'createdAt', c.created_at)
             order by c.id), '[]'::jsonb)
           from public.comparisons c join alias a using (user_id)));
```

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
with Layer 2 support > 0). Every number gets a 95% paired percentile bootstrap over users
(`createPrng(seed)`), and every arm gets a Δ against `engine` computed on the same resamples.

Arms: `global-mean`, `user-mean` (constant μ*_u), `category-mean`, `user-category-mean`,
`bayes-bev`, `item-mean-z` (`globalScore`), `l1-affinity`, `l1-content`, `layer1`, `layer2`,
`engine` (`predictScore`), and `engine-pearson`. That last arm is **experimental**: the engine with
Pearson over the common subset in place of `cosineSimilarity`, to measure the re-centring issue
in `layer2.ts` without changing it. `makeEngine(cosineSimilarity)` reproduces `predictScore()`
exactly. The report also prints cosine-vs-Pearson disagreement over every user pair, and the
median number of co-raters per item pair (§8.9).

## Caveats

- Comparisons are only ever made **within a bucket**, so concordance measures fine ordering only.
  Cross-bucket ordering shows up in NDCG and bucket accuracy.
- The export is the current state. A re-rank moves a Bev's bucket and position but keeps
  `ranked_at`, and older comparisons with it may now disagree with its position. The latest answer
  per pair is kept as-is.
