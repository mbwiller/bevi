# Neo4j recommendation implementation plan

Build reference for the graph-powered recommendation work. Companion to
`docs/graph.md` (which owns the operational half: secrets, Aura pause rules,
what lives where) and to `TASKS.md` A-15, A-16, A-17, M-24, M-21, S-14.

`docs/graph.md` describes the graph as originally scoped: a Bev-to-Bev
similarity graph whose output is `bev_edges`. This document narrows the first
increment to the part that cannot be done in Postgres at all, and defers the
rest. Where the two disagree, this document is the newer decision and
`docs/graph.md` should be updated when a stage lands.

> **Superseded for the ordering, 2026-10-19 (TASKS.md A-16).** Matt and Arjun
> reversed the narrowing: the **Bev graph is increment 1** — embeddings,
> `bev_embeddings`, `bev_edges` and the weighted `SIMILAR_TO` edges, with the
> Postgres tables, RLS and S-14 part 2's contract already merged
> (`20261019000500`) and the sync pipeline following in the next PR. **The
> user-neighbour MVP this document specifies (approach B, `user_neighbors`,
> Stages 2–5) is increment 2**, after M-28. Everything below still stands as the
> design for that increment; only "which comes first" changed, so read §5's
> integration plan and the decision bar as increment 2's, and ignore the
> "Deferred" entries for embeddings, pgvector and `bev_edges`.
>
> **Update, 2026-10-23.** `bev_edges` and `bev_embeddings` exist
> (`20261019000500`), and `bev_edges` now has a writer:
> `scripts/graph/build-edges.ts`, `.github/workflows/graph-edges.yml`,
> `20261023000200` (D-11 inference) and `20261023000300` (the service-role
> RPCs). It fills the table **from Postgres alone** — no Neo4j — and the
> §"Does not exist" inventory below is stale in exactly those respects.
> `docs/graph.md` is the current description of how edges are computed; where
> the two disagree about `bev_edges`, `docs/graph.md` wins.

## Objective

Predict how much an individual user will enjoy a specific drink. Not "find
drinks like this drink" — that is a different, easier problem we already solve
adequately with `contentSimilarity()`.

The graph exists to answer one question the current engine cannot: **two users
have compatible taste but have never ranked the same drink.** Someone who loves
Coca-Cola and Dr Pepper almost certainly shares taste with someone who loves
Pepsi and Coke Zero, and today we score that similarity at exactly zero.

We are not replacing the recommendation engine. We are adding signals to it and
measuring whether they help.

## The seven constraints

1. **Supabase Postgres stays the source of truth.** Rankings, Bevs, profiles
   and all application data live there. Nothing lives only in the graph
   (`docs/graph.md`).
2. **Neo4j AuraDB Free is the graph.** Reuse the existing schema and connection
   path in `scripts/graph/`.
3. **No separate service.** TypeScript, `packages/ranking`, Supabase, and
   scheduled GitHub Actions. No FastAPI, no microservice, no new cloud account.
4. **Neo4j is never on a request path.** Compute offline, write results into
   Postgres, read Postgres at request time. This is the one rule from
   `docs/graph.md` and it does not bend.
5. **The current algorithm keeps working.** Graph signals arrive behind a flag
   and can be switched off without a deploy of the app.
6. **Privacy holds.** HMAC pseudonyms in the graph, secrets server-side only,
   RLS on every personalised table, no other user's identity in any payload.
7. **Free tiers only.** No Graph Data Science (it is a paid product), no
   additional paid infrastructure.

## Lane ownership

Follow the existing split, so each stage has one owner:

| Paths | Lane |
|---|---|
| `packages/ranking/`, `app/`, `design/` | Matt |
| `supabase/`, `packages/api/`, `shared/`, `data/catalog/`, `scripts/` | Arjun |

Stage 1 and Stage 3's formula work are Matt's. Stage 2 and the migrations are
Arjun's. Stage 4 crosses both and needs the contract agreed first, the same way
S-14 part 1 was handled.

## Where we actually are today

Verified against the repository, not the plan documents:

**Exists and works.** `scripts/graph/schema.cypher` (6 constraints, 2 lookup
indexes, 1 empty 384-d vector index), `scripts/graph/apply-schema.ts`,
`scripts/graph/keepalive.ts`, `.github/workflows/graph-keepalive.yml`,
`supabase/functions/graph-query/index.ts` (JWT-verified, three fixed templates
`similar` / `bev` / `meta`, fails closed on `isAlcoholic`).

**The graph holds no data.** No sync job exists, so there are no `:Bev`,
`:Category`, `:Brand`, `:Flavor` or `:User` nodes. The only node any code
writes is `(:Meta {key:'singleton'})` from the keep-alive.

**The live recommendation engine is entirely client-side and Postgres-only.**
`get_prediction_snapshot()` (`supabase/migrations/20261012000600_prediction_snapshot.sql`)
returns one jsonb payload; `packages/api/src/snapshot.ts` maps it;
`packages/api/src/recs.ts` runs `recommend()` and
`packages/api/src/bevs.ts` runs `predictScore()` over it. Personalised 0–10
predictions are already shipping, via `layer1.ts` + `layer2.ts` + `blend.ts`.

**Does not exist.** `bev_edges` (no migration creates it). `bev_embeddings`,
the `vector` extension, any `embed` function. The M-24 formulas
(`treeSimilarity`, `profileSimilarity`, `embeddingSimilarity`, `edgeWeight`,
`topEdges`) landed after this was written, in #86 (`packages/ranking/src/edges.ts`,
`RANKING_VERSION` 1.2.0). `categories.parent_id`, so
no `CHILD_OF` and no meaningful tree term. `user_bev_predictions` exists with
no writer.

**Data on hand.** 15 flat categories, 378 Bevs (43 starters), 476 aliases, 378
hand-labelled rows in `bev_flavor_profiles` — all from
`supabase/migrations/20261014000500_catalog_seed.sql`. User and ranking counts
are unknown: there is no local database in this checkout and `supabase/seed.sql`
seeds no users or rankings. Getting a real count is a Stage 1 prerequisite.

## Why this work is worth doing

Three measured limitations of the current engine motivate the design. They are
recorded here so nobody re-derives them.

**Layer 2 is dormant for almost everyone.** `CF_MIN_COMMON = 2` means two users
need two co-rated Bevs before their similarity is anything but zero, and
`λ = Λ_MAX · support/(support+1) · min(1, n_u/15)` means Layer 2 is fully
discounted until a user has 15 rankings. With 378 Bevs and a user count in the
tens, most pairs never clear the first bar. Attribute bridging is a direct fix.

**Co-rating overlap is the wrong gate for compatibility.** Shared flavour base,
shared brand and shared category are evidence of shared taste, and the current
model only reaches them indirectly, through `contentSimilarity` on the items a
single user ranked.

**`cosineSimilarity` in `layer2.ts` is not re-centred on the common subset.**
z-scores are centred on each user's global mean, then cosine is taken over the
common items only, so two users whose shared items all sit above their own means
score near +1 regardless of relative order. Stage 3 replaces this with Pearson
over the common subset. This is a correctness fix that stands on its own merits,
independent of the graph.

## 1. The graph model

Every property has a Postgres source. Nothing is invented in the graph.

### Nodes

| Label | Properties | Origin |
|---|---|---|
| `:Bev` | `id`, `name`, `brand`, `flavor`, `categoryId`, `priceTier`, `isAlcoholic`, `carbonated`, `caffeine`, `sweetness`, `dairy`, `serve` | copied from `bevs` + `bev_flavor_profiles` |
| `:Category` | `id`, `name`, `isAlcoholic` | copied from `categories` |
| `:Brand` | `key` | derived: `normaliseBrand(bevs.brand)` — there is no brands table |
| `:Flavor` | `name` | copied from `bev_flavor_profiles.base` (24 values) |
| `:User` | `pseudonym` | derived: `hmac(user_id, BEVI_PSEUDONYM_SALT)` |
| `:Meta` | `key:'singleton'`, `lastSyncAt`, `lastKeepAliveAt` | sync bookkeeping |

`caffeine` and `sweetness` stay as node properties because they are 0–3 bands,
not entities. `base` becomes a `:Flavor` node because taste-neighbourhood paths
have to traverse it — that traversal is the entire point of the graph.

`isAlcoholic` is mandatory on `:Bev`. `graph-query` treats a Bev without it as
alcoholic and never returns it, so a sync that forgets the property hides drinks
rather than leaking them.

### Relationships

| Type | Properties | Copied or derived |
|---|---|---|
| `(:Bev)-[:IN_CATEGORY]->(:Category)` | — | copied |
| `(:Category)-[:CHILD_OF]->(:Category)` | — | copied — **blocked on A-13**, every category is a root until then |
| `(:Bev)-[:BY_BRAND]->(:Brand)` | — | derived (brand normalisation) |
| `(:Bev)-[:TASTES_OF]->(:Flavor)` | — | copied |
| `(:User)-[:RANKED]->(:Bev)` | `score`, `z`, `bucket`, `rankedAt` | copied, pseudonymised |
| `(:User)-[:LIKES]->(:Bev)` | `w` = `z` | **derived**, written when `z ≥ +0.25` |
| `(:User)-[:DISLIKES]->(:Bev)` | `w` = `−z` | **derived**, written when `z ≤ −0.25` |
| `(:Bev)-[:SIMILAR_TO]-(:Bev)` | `w`, `tree`, `content`, `emb`, `profile`, `cop` | derived — **deferred**, not in the MVP |

### Positive and negative rankings

`RANKED` keeps the full record: the stored `score`, the `z`, and the
Loved/Fine/Disliked `bucket` (smallint 3/2/1 in Postgres, mapped by
`packages/api`). Preference *strength* comes from `z`, which already encodes
within-bucket position, because `respaceBucket`/`storedScore` derive the score
from position inside the band.

`LIKES` and `DISLIKES` are materialised projections of the same data, so
traversals and sign-aware aggregation do not need per-hop property filters. The
dead band `|z| < 0.25` gets neither edge: a drink a user felt nothing about
should not propagate taste in either direction.

`z` is computed in the sync job using the same formulas as
`packages/ranking/src/context.ts` (user-centred, population stddev,
`SIGMA_FLOOR = 1.0`, global fallback below `MIN_N_USER = 3`). It is never
computed in Cypher.

### Pseudonymisation

`:User` nodes carry **only** `pseudonym = hmac(user_id, BEVI_PSEUDONYM_SALT)`,
stable across runs so co-rating accumulates over time (decision 31). No handle,
display name, birth date or email reaches Neo4j. The pseudonym is deliberately
not the per-call alias `get_prediction_snapshot()` uses, because those rotate
and co-rating needs stability.

The pseudonym → uuid mapping exists only in the sync process's memory. The job
resolves it before writing results back to Postgres.

### Example: 3 users, 6 Bevs

```
b1 Coca-Cola     soda / coke / cola / sweetness 3
b2 Pepsi         soda / pepsi / cola / sweetness 3
b3 Coke Zero     diet_soda / coke / cola / sweetness 3
b4 Dr Pepper     soda / dr pepper / cola
b5 LaCroix Lime  sparkling_water / lacroix / lemon-lime / sweetness 0
b6 Red Bull      energy / red bull / herbal

U1: LIKES b1 (+1.2), LIKES b4 (+0.6), DISLIKES b5 (1.3)
U2: LIKES b2 (+1.1), LIKES b3 (+0.8), DISLIKES b5 (0.9)
U3: LIKES b4 (+1.0), LIKES b6 (+0.9)
```

Paths that produce a recommendation for U1:

1. **Attribute bridge to b3.**
   `(U1)-[:LIKES]->(b1)-[:TASTES_OF]->(:Flavor {name:'cola'})<-[:TASTES_OF]-(b2)<-[:LIKES]-(U2)`,
   reinforced by `(U1)-[:DISLIKES]->(b5)<-[:DISLIKES]-(U2)` — agreeing on a
   dislike is agreement. Then `(U2)-[:LIKES]->(b3)` recommends b3. **U1 and U2
   share exactly one ranked Bev**, so today `userSimilarity(U1, U2) = 0` and
   Layer 2 contributes nothing. This path is unreachable from the current
   snapshot at any cost. It is the reason for the graph.
2. **Brand bridge to b3.**
   `(U1)-[:LIKES]->(b1)-[:BY_BRAND]->(:Brand {key:'coke'})<-[:BY_BRAND]-(b3)`.
3. **Co-rating walk to b6.**
   `(U1)-[:LIKES]->(b4)<-[:LIKES]-(U3)-[:LIKES]->(b6)`. No content similarity
   exists between anything U1 ranked and b6 — `contentSimilarity(b1, b6)` is
   about 0.1. Only a walk finds it.
4. **Negative suppression.** If U3 also liked b5 (U1's strongest dislike),
   sign-aware similarity lowers U1↔U3 and demotes b6.

## 2. The three candidate algorithms, and which one we build

### A. Bev similarity propagation — build in Postgres, not Neo4j

`score(u, b) = Σ_{b' ∈ R(u)} w(b,b')^p · z_{u,b'} / (Σ w(b,b')^p + λ_c)`, over
the top-k neighbours with `w ≥ 0.3`, `p = 2`, `k = 20`.

Negatives flow through the sign of `z`. Popularity cannot leak in because `w` is
content-derived. Weak multi-hop is impossible because it is single-hop.

**This is just a fixed `layer1()` content term, and it is a Postgres join on
`bev_edges`.** Running it in Neo4j would be exactly the duplication we are
trying to avoid. Only the edge *construction* has any claim on the graph, and
even that is computable in SQL at 378 Bevs. Deferred.

### B. Attribute-bridged taste neighbourhoods — **this is the MVP**

Per-user taste vector over attribute nodes (`:Flavor`, `:Brand`, `:Category`):

```
t_u[a] = Σ_{b ∈ R(u), b—a} z_{u,b} / (n_{u,a} + K_T)        K_T = 2
```

Blended similarity:

```
sim(u,v) = α · pearson(z_u, z_v over common items) · min(1, |common|/5)
         + (1 − α) · cosine(t_u, t_v)

α = 0.5 when |common| ≥ 2, α = 0 otherwise
```

- **Negatives.** Signed `z` inside `t_u`, so co-dislike raises similarity and
  opposing signs push the cosine negative.
- **Popularity.** Attributes covering fewer than 2 catalog Bevs are excluded,
  and `t_u` is a shrunk *mean* rather than a sum, so prolific raters do not
  dominate. Consider an inverse-frequency weight per attribute if one base
  family turns out to cover most of the catalog.
- **Weak multi-hop.** Two hops only (`user → bev → attr → bev → user`), at
  least 2 shared attributes with `|t| ≥ 0.2`, similarity floor `0.1`, top
  `K = 25` neighbours.
- **Result.** Rows in `user_neighbors`, consumed by `layer2()`.
- **Aura Free without GDS.** Yes. One Cypher aggregation plus one candidate
  query; every float formula runs in TypeScript.

### C. Random walk with restart — deferred

`p = (1 − α)·M·p + α·e_u`, `α = 0.3`, 10–15 iterations, `M` column-normalised
over the typed edges.

Signed edges cannot share one walk (no stochastic matrix), so it needs two
walks — `p⁺` over `LIKES`, `p⁻` over `DISLIKES` — combined as
`s = p⁺ − β·p⁻` with `β ≈ 0.75`. Popularity needs **lift** against a background
walk from a uniform seed, `lift(u,b) = p_u(b) / p_global(b)`; degree
normalisation alone is not enough. Weak paths are controlled by a high restart
probability, pruning edges below `w = 0.3`, and requiring mass to arrive by at
least two distinct paths.

Feasible on Aura Free only in a split form: extract the adjacency with Cypher
(roughly 10k rows at our size) and run the power iteration in TypeScript.
Personalised PageRank lives in GDS, which is paid, and is not in APOC.

Deferred until Stage 3 has demonstrated that graph signals move the metrics at
all. It would become Layer 3, not part of Layer 2.

### Division of labour

Neo4j does pattern matching, candidate generation, aggregation and adjacency
extraction. TypeScript does every float formula, in `packages/ranking`, so the
formulas stay pure, vector-tested, and shareable with the client-side fallback
path. This mirrors the existing rule that `@bevi/ranking` does no I/O.

## 3. Postgres tables

```sql
-- Stage 3. The MVP's only new table.
user_neighbors(
  user_id      uuid    not null references profiles(id) on delete cascade,
  neighbor_id  uuid    not null references profiles(id) on delete cascade,
  sim          numeric(5,4) not null,
  common       smallint not null,       -- co-rated Bev count
  shared_attrs smallint not null,       -- bridging attributes
  method       text    not null,        -- 'pearson' | 'attr' | 'blend'
  version      text    not null,        -- RANKING_VERSION at compute time
  computed_at  timestamptz not null default now(),
  primary key (user_id, neighbor_id)
)

-- Deferred (full A-16).
bev_edges(src_bev_id, dst_bev_id, weight numeric(5,4), components jsonb,
          version text, computed_at timestamptz,
          primary key (src_bev_id, dst_bev_id))

-- Deferred (Layer 3 / approach C).
user_bev_affinity(user_id, bev_id, ppr numeric(8,6), lift numeric(6,3),
                  top_path jsonb, version text, computed_at timestamptz,
                  primary key (user_id, bev_id))
```

Row counts at 378 Bevs and 200 users: about 5k, 7.5k and 75.6k respectively.
All trivial.

**RLS.** `user_neighbors` and `user_bev_affinity` are owner-only select
(`user_id = auth.uid()`) with **no write policy** — the sync writes as the
service role, exactly as `bev_flavor_profiles` does. `bev_edges`, when it
lands, is `select to authenticated` like `bev_stats`, because it is catalog
data.

**Publication is atomic and versioned.** Write a full new generation and swap,
or write in one transaction. A failed sync must leave the previous generation
intact and readable. Never truncate before the replacement is computed.

## 4. Data flow and scheduling

`.github/workflows/graph-sync.yml` runs `scripts/graph/sync.ts` nightly:

1. Read active Bevs, categories, flavour profiles and rankings from Postgres
   with the service role.
2. Compute `z` per user in TypeScript, matching `context.ts`.
3. Pseudonymise user ids with `BEVI_PSEUDONYM_SALT`.
4. `MERGE` nodes and relationships in batched, parameterised `UNWIND`s. Rebuild
   `LIKES`/`DISLIKES` from the current `RANKED` set.
5. Delete relationships and nodes that dropped out — removed rankings, Bevs that
   became `hidden` or `merged`, deleted profiles.
6. Run the Cypher aggregation and candidate queries.
7. Compute similarities in TypeScript via `packages/ranking`.
8. Validate counts against the source, then publish `user_neighbors` atomically,
   resolving pseudonyms back to uuids in-process.
9. `SET (:Meta).lastSyncAt` — this write is also the Aura keep-alive.
10. Print the sanity report.

**Frequency: nightly, everything.** Nothing hourly, nothing on a request path.
`bev_edges`, when it exists, only changes when a Bev or a flavour profile
changes.

Keep `.github/workflows/graph-keepalive.yml` and `scripts/graph/keepalive.ts`
until `graph-sync.yml` has run green for a week. Only then delete them, as
`docs/graph.md` instructs.

### Cypher sketches

Taste vectors, one row per (user, attribute):

```cypher
MATCH (u:User)-[r:RANKED]->(b:Bev)
MATCH (b)-->(a)
WHERE a:Flavor OR a:Brand OR a:Category
WITH u.pseudonym AS pseudonym,
     labels(a)[0] AS kind,
     coalesce(a.name, a.key, a.id) AS attr,
     sum(r.z) AS zsum, count(*) AS n
RETURN pseudonym, kind, attr, zsum / (n + 2.0) AS t, n
```

Candidate neighbour pairs, including pairs with zero co-rating overlap:

```cypher
MATCH (u:User)-[:LIKES|DISLIKES]->(:Bev)-->(a)<--(:Bev)<-[:LIKES|DISLIKES]-(v:User)
WHERE u.pseudonym < v.pseudonym AND (a:Flavor OR a:Brand)
WITH u.pseudonym AS a1, v.pseudonym AS a2, count(DISTINCT a) AS sharedAttrs
WHERE sharedAttrs >= 2
RETURN a1, a2, sharedAttrs
```

Adjacency extraction, if and when approach C is attempted:

```cypher
MATCH (a)-[r:LIKES|DISLIKES|TASTES_OF|BY_BRAND|IN_CATEGORY]-(b)
RETURN coalesce(a.pseudonym, a.id, a.key, a.name) AS src,
       coalesce(b.pseudonym, b.id, b.key, b.name) AS dst,
       type(r) AS kind, coalesce(r.w, 1.0) AS w
```

## 5. Integration with the prediction engine

Graph signals enter **Layer 2 only**. Do not add a Layer 3 until the
graph-enhanced Layer 2 has been evaluated.

- `packages/ranking/src/types.ts` — `PredictionSnapshot` gains
  `userNeighbors?: Record<UserId, Array<[UserId, number, number]>>`
  (alias, sim, common).
- `packages/ranking/src/layer2.ts` — `computeSim`/`simsOf` read
  `snapshot.userNeighbors` when present and fall back to the current
  in-snapshot computation when absent. Replace the common-subset cosine with
  Pearson. Weight each neighbour by reliability `min(1, n_v / N₀)` so a
  neighbour with three rankings does not count like one with eighty.
- `packages/ranking/src/blend.ts` — unchanged in the MVP. `λ` still comes from
  `support`, which now reflects better neighbours rather than a new term.
- `packages/ranking/src/constants.ts` — new constants, and a
  **`RANKING_VERSION` bump**. Every bump means regenerating the golden vectors
  (`npm run vectors -w packages/ranking`) and a contract PR.
- `supabase/migrations/` — a new revision of `get_prediction_snapshot()` that
  joins `user_neighbors` to the alias CTE the function already builds, emitting
  `(alias, sim, common)`.
- `packages/api/src/snapshot.ts` — map the new field onto the snapshot.
- `packages/api/src/recs.ts` and `packages/api/src/bevs.ts` — **no change**.
  That is the design goal: every experiment is a snapshot-content change plus a
  pure-function change.

**Avoid double counting.** A pair with direct co-rating overlap must not have
its agreement counted once as Pearson and again as attribute cosine beyond the
`α` blend. The `α = 0` case for `|common| < 2` exists precisely so attribute
similarity is a substitute, not an addition, when direct evidence is thin.

**Feature flag.** Gate consumption on a flag (snapshot field absent, or an
explicit option through `RecsApi`) so graph signals can be disabled without
redeploying the app. A missing `userNeighbors` field must behave exactly like
today.

### New users before the nightly sync

Degradation is graceful by construction, and the tiers already exist:

- **0 rankings** — `selectStarterSet()` in `packages/ranking/src/starter.ts`
  (10 picks, 6 shared core, at most 2 per category, at least 5 categories,
  seeded by user id). Already implemented; it needs an onboarding caller.
- **Below `MIN_N_USER` (3)** — `recs.ts` already returns an empty list and
  `bevs.ts` returns a null prediction.
- **3 or more, not yet synced** — no `user_neighbors` rows, so `layer2()` falls
  back to the in-snapshot computation and nothing breaks. Layer 1 is
  user-independent and fully fresh immediately.

### Leakage and privacy

- `neighbor_id` **never reaches the client.** `get_prediction_snapshot()`
  already aliases every other user as `'u<n>'`; join `user_neighbors` to that
  same alias CTE. A scalar similarity attached to a rotating alias identifies
  nobody.
- No handle, display name, birth date or `can_see_alcohol` for any user but the
  caller, matching the existing function's guarantees.
- The age gate is unchanged: the snapshot RPC filters on `viewer_is_adult()`,
  and `graph-query`'s templates stay `coalesce(isAlcoholic, true) = false`.
- Evaluation must never read labels or statistics derived from a held-out
  observation. See Stage 1.

## Stage plan

### Stage 1 — Baseline evaluation harness

**No graph work. No production behaviour change. Start here.**

Build an offline harness for the *current* algorithm, in a new
`packages/ranking/eval/`, reusing `packages/ranking/test/snapshot-fixture.ts`
(`buildSnapshot()` already recomputes user stats correctly).

Requirements:

- Leakage-safe leave-one-out and temporal splits on `rankings.ranked_at`.
- **Recompute `users[u].stats` for every fold.** `snapshotContext` prefers
  `snapshot.users[u].stats` over deriving it, so dropping a row without
  recomputing μ, σ and n leaks the held-out score through
  `ŝ = μ_u + σ_u·ẑ`.
- **Clone the snapshot per fold.** `snapshotContext` caches in a `WeakMap`
  keyed on object identity; mutation in place reuses a stale context.
- **Strip the held-out item from the Bev's `ratingCount`/`mean`/`stddev` and
  from `raters`**, or `globalScore()` leaks it: the function counts the target
  user's own z when they ranked the Bev.
- Primary metric: **pairwise concordance on `comparisons`**. Those labels are
  immune to bucket re-spacing and give up to `ceil(log2(n+1))` pairs per
  submitted ranking, so they are both the cleanest and the densest labels we
  own.
- Secondary: macro Spearman, NDCG@10 (gain from bucket: Loved 3, Fine 1,
  Disliked 0), bucket accuracy with a 3-class confusion matrix, and
  **collaborative-filtering coverage** (the fraction of predictions where
  `support > 0`).
- Cohort breakdown by `n_u` ∈ {3–5, 6–14, 15+}. Layer 2 is λ-gated on
  `min(1, n_u/15)`, so a cohort-blind average hides its effect entirely.
- Baselines: constant μ_u, per-category mean, Bayesian Bev score
  (`bayesian.ts`), item mean z (`globalScore`), Layer 1 affinity-only, Layer 1
  content-only.
- Paired bootstrap over **users** for confidence intervals. Never report a point
  estimate alone.

Data required: a secure export of `user_id, bev_id, bucket, position, score,
ranked_at` from `rankings`, plus `user_id, submission_id, winner_bev_id,
loser_bev_id, tie, created_at` from `comparisons`. Neither is reachable from a
clean checkout today. If the export is not available, build the harness against
fixtures and state plainly which export is needed. `syntheticSnapshot()` is
valid for testing the harness and measuring metric sensitivity, but it is
generated from the same similarity assumptions the model uses, so it will
flatter every arm and must never be reported as an accuracy result.

Deliverable: reproducible commands, tests, and baseline numbers where data
allows.

### Stage 2 — Supabase to Neo4j sync

Implement the pipeline in section 4 for the MVP node and relationship set.
Idempotent, rerunnable, no duplicates, no stale relationships. Validate node and
relationship counts against the source. A partial failure must not publish
anything.

Deliverable: a validated sync script and its first green run.

### Stage 3 — Taste neighbourhoods

Implement approach B. Cypher for traversal and candidate generation; pure
TypeScript in `packages/ranking/src/graph.ts` for `tasteVector()`,
`attributeSimilarity()` and `blendUserSimilarity()`. Create `user_neighbors`
with RLS and indexes. Deterministic output, with tests.

Deliverable: a deterministic taste-neighbourhood pipeline.

### Stage 4 — Engine integration

Section 5. Behind the flag. `RANKING_VERSION` bump, vectors regenerated,
contract PR. No endpoint or predicted-score display changes.

Deliverable: graph-enhanced predictions in the existing engine.

### Stage 5 — Evaluation and operations

Run both arms on identical data and splits. Report pairwise concordance, macro
Spearman, NDCG@10, bucket accuracy, CF coverage, intra-list diversity
(1 − mean `contentSimilarity` over the top 10), results by ranking count, and
results for the **zero-co-rated-items subgroup** specifically — that subgroup is
where the mechanism is supposed to act.

**Run the ablation that decides Neo4j's fate.** Implement the same attribute
vectors directly in SQL over `bev_flavor_profiles`, `bevs.brand` and
`bevs.category_id`, with no graph involved, and compare. If plain SQL matches
the graph, the value was in the features, not the traversal, and Neo4j should
go. This is the honest test and it must not be skipped.

Operations: `workflow_dispatch` for manual runs, secret validation, safe
retries, sync status logging, atomic versioned publication, staleness
monitoring, graceful fallback when Aura is paused or unreachable, and no
destructive cleanup of a known-good dataset after a failed job.

Deliverable: a reliable nightly pipeline and a baseline-versus-graph report.

## Decision bar

Pre-register this before Stage 5 runs. Keep Neo4j only if **all three** hold:

1. CF coverage rises to at least 50% of predictions for users with `n_u ≥ 5`.
2. Macro pairwise concordance improves by at least 2 points absolute, with a
   paired-bootstrap 95% CI excluding zero.
3. Bucket accuracy does not regress.

Interpretation of partial results:

- **Coverage up, concordance flat** — neighbours are reachable but
  uninformative. Keep `user_neighbors`, compute it in SQL, drop the instance.
- **The SQL ablation matches the graph** — the features were the value. Drop the
  instance, keep the formulas.
- **Nothing moves** — delete the instance and keep this document and
  `docs/graph.md` as the record of why.

A null result at our current user count is evidence about the data, not about
the method. Re-run after growth before concluding that graph collaborative
filtering does not work for Bevi.

## Deferred

Not in the MVP. Revisit only on measured results.

- A separate service of any kind, including FastAPI.
- Neo4j Graph Data Science (paid), graph neural networks, Node2Vec, FastRP.
- Random walk with restart and a Layer 3 (approach C).
- Text embeddings, `bev_embeddings`, pgvector, the `embed` Edge Function.
- The full `SIMILAR_TO` graph and `bev_edges` (the rest of A-16), plus the M-24
  formulas it needs.
- `categories.parent_id` and `CHILD_OF` — blocked on A-13 and D-04. Worth
  noting: the hierarchy is likely to help predictions *more* than embeddings
  do, because it fixes the fact that `categoryAffinity` is near zero for a user
  who has only ranked one category, and it addresses the strongest piece of user
  research we have ("I'd always take mid Indian food over top-tier American
  food", TASKS.md §1c).
- The `cop` co-rating component of `edgeWeight` (weight 0 by design until there
  is volume).
- Real-time graph queries on any request path. This one is never revisited.

## Capacity

Aura Free allows 200,000 nodes, 400,000 relationships and 1 GB. The MVP graph
is 378 `:Bev` + 15 `:Category` + roughly 24 `:Flavor` + a few hundred `:Brand`
+ one node per user, with a few thousand relationships. Under 1% of every cap.
Capacity is not a design constraint; the 72-hour auto-pause is (`docs/graph.md`).

## Build order

Stage 1 only, then stop and report:

1. Files created or changed.
2. How the evaluation works.
3. Commands to run it.
4. Tests and their results.
5. Which production data is missing.
6. The baseline metrics that could be established.
7. Blockers to clear before Stage 2.

Do not start Stage 2 automatically.
