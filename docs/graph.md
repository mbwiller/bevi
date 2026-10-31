# The Bev graph

S-17. Companion to `docs/bevi-ranking-math.tex` §10.1, which has the formulas.
This document is the operational half: what lives where, what the sync
promises, which secrets exist, and what to do when the instance is asleep.

Decided in TASKS.md revision 2, items 28–31.

## The one rule

**Neo4j is never on a request path.**

Nothing a user taps waits on a cross-cloud call. The ranking flow,
recommendations, Bev detail and "similar Bevs" rows all read `bev_edges` in
Postgres, which the nightly job writes. If the Aura instance is paused,
deleted or simply down, the app behaves exactly as it did the day before — it
reads slightly staler edges, and nothing else changes.

The one exception is the `graph-query` Edge Function, which queries the graph
directly for on-demand exploration. It is not wired into any screen, and it
returns a 503 rather than a fallback when the instance is unreachable.

## What lives where

Postgres is the system of record. The graph holds the relationships.

| Owned by Postgres | Owned by the graph |
|---|---|
| the `bevs` row: name, brand, flavor, category, photo, price, status, UPC | `(:Bev)` nodes and their relationships |
| `bev_stats`, `global_stats`, `category_stats` | `(:Category)` with `[:CHILD_OF]` |
| `rankings`, `comparisons`, `want_to_try`, `follows` | `(:Brand)` with `[:BY_BRAND]` |
| `profiles`, auth, birth dates, handles, the age gate | `(:Flavor)` with `[:TASTES_OF]` |
| trigram search, dedupe, the prediction snapshot | `(:User {pseudonym})-[:RANKED]->(:Bev)`, anonymised |
| `bev_flavor_profiles` (A-17), `bev_embeddings` (A-16) | `(:Bev)-[:SIMILAR_TO]-(:Bev)` and its weight components |
| **`bev_edges`** — the graph's output, written back nightly | `(:Meta {key: 'singleton', lastSyncAt})` |

```
Supabase (Postgres)                   nightly job (A-16)            Neo4j AuraDB Free (A-15)
bevs, categories, brands  ─────────── sync nodes ──────────────────▶ (:Bev)-[:IN_CATEGORY]->(:Category)-[:CHILD_OF]->(:Category)
bev_flavor_profiles (A-17) ────────── sync props ──────────────────▶ (:Bev)-[:BY_BRAND]->(:Brand), (:Bev)-[:TASTES_OF]->(:Flavor)
bev_embeddings (pgvector, gte-small)  sync vectors ────────────────▶ Bev.embedding + vector index
rankings (pseudonymised) ──────────── sync edges ──────────────────▶ (:User {pseudonym})-[:RANKED {score, z, bucket}]->(:Bev)
bev_edges  ◀───────────────────────── write back top-20 per Bev ◀─── (:Bev)-[:SIMILAR_TO {w, tree, content, emb, profile, cop}]-(:Bev)
   ▲
   └── read by the app's hot path. Neo4j is not in this picture at request time.
```

## Nothing lives only in the graph

Every node and property is derived from Postgres. The graph can be dropped and
rebuilt from a single sync run, which is what makes the Aura Free constraints
below tolerable. Do not add a property that has no Postgres source.

`User` nodes carry **only** a pseudonym — `hmac(user_id, BEVI_PSEUDONYM_SALT)`,
stable across runs so co-rating can accumulate over time. No handle, no display
name, no birth date, no email leaves Postgres (decision 31). The pseudonym is
deliberately *not* the per-call alias the prediction snapshot uses, because
those rotate and co-rating needs stability.

## AuraDB Free: the three rules that bite

1. **It auto-pauses after 72 hours without activity, and does not auto-resume.**
   The nightly sync's write to `(:Meta)` is what keeps it awake — the
   keep-alive is a side effect of doing real work, not a separate ping.
   **Until A-16 exists**, `.github/workflows/graph-keepalive.yml` bridges the
   gap: once a day it runs `npm run graph:keepalive`, which stamps
   `(:Meta).lastKeepAliveAt`. Delete that workflow and
   `scripts/graph/keepalive.ts` when `graph-sync.yml` runs nightly. Without
   the `NEO4J_*` Actions secrets it logs a warning and does nothing.
2. **A paused instance is deleted after 30 days.** Because nothing lives only
   in the graph, that is a rebuild, not data loss. Still worth not doing.
3. **Resuming is a manual console action.** There is no API for it on the free
   tier. If the sync has been failing for three days, someone has to open the
   Aura console and press resume, then re-run the workflow.

Capacity: 200,000 nodes, 400,000 relationships, 1 GB. 378 Bevs with 20 edges
each is roughly 0.2% of the node cap and under 2% of the relationship cap.

Graph Data Science is a separate paid product. We compute similarity ourselves
(`@bevi/ranking`, M-24) and the graph only stores the result.

## Schema

`scripts/graph/schema.cypher`, applied with:

```bash
npm run graph:schema              # apply (needs NEO4J_* in the environment)
npm run graph:schema -- --dry-run # print the statements, connect to nothing
```

Every statement is `IF NOT EXISTS`, so re-running is a no-op. That is the
idempotency guarantee A-15's definition of done asks for — run it twice and the
second run changes nothing.

`(:Bev)` properties the sync writes: `id`, `name`, `brand`, `flavor`,
`categoryId`, `priceTier` and **`isAlcoholic`** (from the category, walking up
the tree once A-13 lands). `isAlcoholic` is mandatory: `graph-query` treats a
Bev without it as alcoholic and never returns it.

Neo4j cannot express "at most one `SIMILAR_TO` per unordered pair", so the sync
enforces it by convention: it only ever writes the direction where
`src.id < dst.id`, and every read traverses undirected. The vector index on
`Bev.embedding` (384 dimensions, cosine) is created now and stays empty until
A-16 populates embeddings; an empty vector index is valid and costs nothing.

## The Postgres half, which exists now

`supabase/migrations/20261019000500_graph_tables.sql` (A-16 increment 1, first
PR) creates the mirror and the read path. **Both tables are filled on prod**
as of #121: 383 Bevs embedded, `bev_edges` holding 4669 edges, and
`graph-edges` running green nightly since 2026-10-25. A-16 (2) adds a third
table, `user_neighbors` — see "Taste neighbours" below.

```sql
bev_embeddings(bev_id uuid primary key references bevs(id) on delete cascade,
               embedding extensions.vector(384) not null,   -- gte-small
               model text not null default 'gte-small',
               computed_at timestamptz not null default now())
  -- HNSW index, cosine. pgvector is enabled in the `extensions` schema.

bev_edges(src_bev_id uuid, dst_bev_id uuid,           -- both -> bevs(id), cascade
          weight numeric not null check (weight between 0 and 1),
          components jsonb not null,                  -- EdgeComponents: tree, content, emb, profile, cop
          version text not null,                      -- RANKING_VERSION at compute time
          computed_at timestamptz not null default now(),
          primary key (src_bev_id, dst_bev_id),
          check (src_bev_id < dst_bev_id))
  -- weight-ordered index on each endpoint column.
```

`bev_edges` keeps **one row per unordered pair**, oriented `src < dst`, the same
convention the Cypher uses (above), so the mirror is row-for-row the graph's
edge set and the sync needs no transformation between them. The CHECK makes that
a constraint rather than a convention, and forbids self-edges. A Bev's
neighbours therefore live in both columns, which is why there are two indexes
and why the read RPCs look both ways.

RLS on both: `select` for `authenticated`, **no** insert/update/delete policy —
the sync writes as the service role. The select policies reproduce **both**
halves of `bevs_select`, the status one and the alcohol one, because an edge is
a statement about two Bevs: a readable row would otherwise tell a viewer that a
Bev they may not see exists and what it resembles. The status half matters most
after a takedown — `bevs_select` stops serving a hidden Bev's row at once, while
its edge and embedding survive until the next nightly sync, so without it a
plain `GET /rest/v1/bev_edges` is a moderation bypass that also yields the
Bev's `gte-small` vector. Only `status = 'active'` passes, not `bevs_select`'s
`pending_photo` branch.

Both policies are written as a **positive** `exists` per Bev the row references,
mirroring `rankings_select`. That shape is load-bearing: a policy's own table
references are subject to those tables' RLS, so a negative `not exists` over
`bevs` is fail-**open** — `bevs_select` has already hidden the alcoholic Bev
from an under-21 caller, the inner select finds nothing, and the row is served.
The reasoning is written out in the migration.

Three `security definer` read RPCs, each age-gating exactly as `search_bevs`
does, each returning **zero rows rather than an error** while the mirror is
empty (contract `2.7.0`, S-14 part 2):

| RPC | Contract method | Returns |
|---|---|---|
| `get_bev_similarities(p_bev_id, p_other_ids[])` | `bevs.similarities` | `(bev_id, weight)` for the pairs that have an edge; a single primary-key probe per pair, because the orientation is canonical |
| `get_similar_bevs(p_bev_id, p_limit)` | `bevs.similar` | `search_bevs`' BevSummary columns, heaviest first, `status = 'active'` only, limit clamped to 50 |
| `list_bucket_bevs(p_bucket)` | `rankings.listBucketBevs` | `(id, category_id, brand_key)` for the caller's own bucket, `brand_key` matching `normaliseBrand()` |

## How embeddings are produced (A-16 (1), the Postgres-only half)

**This half needs no Neo4j.** It is Postgres → an Edge Function → Postgres, so
it can be deployed, run and judged while the Aura instance is paused, deleted
or never created. Copying the vector onto `(:Bev).embedding` is the sync job's
step, not this one's.

### The text

One string per Bev, in the order decision 30 writes it — **"brand name flavour
category"**:

```
`${brand} ${name} ${flavor} ${category}`
```

- a missing or blank `brand` or `flavor` is **omitted**, not left as a blank
  slot (both columns are nullable in `bevs`);
- `category` is `bevs.category_id` — the slug the column actually holds — with
  `_` and `-` turned into spaces, so `sparkling_water` embeds as the two words
  `sparkling water` rather than one token the model has never seen;
- runs of whitespace collapse to one space, and the whole string is trimmed.

So Coca-Cola Cherry Coke is `Coca-Cola Coke Cherry soda`, and an unbranded
seltzer is `Seltzer Lime sparkling water`.

`embeddingText()` in `supabase/functions/embed/text.ts` is the single
definition of that template, and `supabase/functions/embed/test.ts` pins it.
Changing it makes every stored vector stale — re-run the backfill with
`--all`.

### The model

`Supabase.ai.Session('gte-small')`, run with `{ mean_pool: true, normalize:
true }`: **384 dimensions, unit-norm, compared with cosine**. That is the model
decision 30 fixes, it is free inside Edge Functions, and `bev_embeddings.model`
records the name so a future model change is visible in the data rather than
silently mixed in. `Supabase.ai` exists **only in the deployed Edge Runtime**,
so `embed` declares the one method it uses and returns a 503 (`ai_unavailable`)
anywhere else — that is what keeps CI's `deno check` green without a live
runtime.

### What the first real run measured (2026-10-24)

All 378 seeded Bevs are embedded on prod. Two things that only a deployed
function could settle:

- **`gte-small` returns exactly 384 values** for this template, PostgREST
  accepts pgvector's `[0.1,...]` text form on upsert, and the bearer gate
  passes with the real token. The function must be deployed with
  `--no-verify-jwt`, or the gateway rejects the trigger's non-JWT bearer and
  embeddings silently never appear.
- **The batch bound is 4, not 16.** At 16 per request, 21 of 24 batches failed
  with `546 WORKER_RESOURCE_LIMIT` -- gte-small inference for 16 Bevs does not
  fit one invocation's CPU budget. At 4, all 378 embedded across 95 requests
  with zero failures. `MAX_BATCH` and the backfill's default are both 4;
  raising either needs the experiment re-run, not an argument.

### The two writers

| Path | Trigger | Batch |
|---|---|---|
| **on write** | `bevs_embed_after_insert` / `bevs_embed_after_update` on `public.bevs` (migration `20261023000100_embed_webhook.sql`) → `net.http_post` → `embed` | 1 Bev |
| **backfill** | `npm run graph:backfill-embeddings`, by hand | up to 4 per call, 4 by default |

The trigger fires on insert, and on update **only when `name`, `brand`,
`flavor` or `category_id` actually changed** — an `updated_at` touch, a
moderation `status` change or a `photo_path` landing after upload do not reach
it. It uses **pg_net directly** (`20261009000100_extensions.sql` enables it)
rather than `supabase_functions.http_request`, because that function only
exists once database webhooks have been enabled in the hosted dashboard and
nothing in this repo creates it; a `create trigger` against it on a project
that never enabled the feature fails at migration time.

`net.http_post` queues a row and returns; a background worker does the HTTP.
So `create_bev` adds one insert, never a network round trip, and the function's
cold start, its 2 s CPU budget and its failures are all invisible to the
transaction. The queue row is written inside the caller's transaction, so a
rolled-back `create_bev` never leaves a request behind. The body of the
function is wrapped in an exception block, so even a failure to queue degrades
to a `WARNING`.

A dropped request is therefore possible by design, and that is fine: the
backfill finds every active Bev with no row, so **"has no row in
`bev_embeddings`" is the dirty flag** and no queue table or `dirty` column is
needed. Nothing in the app reads `bev_embeddings` on a request path, so a Bev
whose vector arrives hours late costs a slightly worse "Bevs like this" row and
nothing else.

### Authorisation: `embed` has `verify_jwt = false`, on purpose

It is not the weaker setting here. `verify_jwt` only proves a request carries a
key the project issued, and the publishable key ships in every copy of the app
— fine for `graph-query`, which is read-only, but not for a function that
writes as the service role and runs inference per call. Neither real caller
holds a user JWT anyway. So the gate is a shared secret checked inside
`index.ts`, in constant time: a request must present `EMBED_WEBHOOK_SECRET` —
or the service-role key when that is unset — as `Authorization: Bearer
<token>`, and anything else is 401 before a row is read or the model is
loaded. With no secret configured at all the function refuses everything (500)
rather than falling open.

`bev_embeddings` itself gains no write path: the Edge Function writes as the
service role, which bypasses RLS, and the table keeps the policies
`20261019000500` gave it (`select` for `authenticated`, no write policy).

### Secrets and settings a deployer must provide

Names only; values never go in the repo. These are in addition to the table
above, and **none of them is a `NEO4J_*`**.

| Name | Where | Used by |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | injected into every Edge Function; set explicitly for the backfill | `embed` (to read `bevs`, to upsert `bev_embeddings`), `backfill-embeddings.ts` |
| `EMBED_WEBHOOK_SECRET` | `supabase secrets set` (hosted), `supabase/.env` (local); **required** | The bearer token `embed` checks; the backfill and the trigger both send it. It must NOT be the service-role key: pg_net persists the trigger's headers in `net.http_request_queue`, so the token is at rest in a table, and `embed` refuses to start rather than accept the key as its password |
| `EMBED_FUNCTION_URL` | the backfill's environment; optional | defaults to `<SUPABASE_URL>/functions/v1/embed` |
| `embed_function_url` | a **Vault secret**, set once per environment | the trigger, as the URL to POST to |
| `embed_webhook_token` | a **Vault secret**, set once per environment | the trigger, as the bearer token |

The two values live in **Supabase Vault**, set by a human outside the repo so no
value is ever committed:

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/embed',
                           'embed_function_url',
                           'A-16: the embed Edge Function endpoint');
select vault.create_secret('<EMBED_WEBHOOK_SECRET>',
                           'embed_webhook_token',
                           'A-16: the bearer token the embed function checks');
```

They were originally specified as `bevi.*` database settings, by analogy with
`bevi.rpc_bypass`, and that **cannot work on Supabase**: the `postgres` role is
not a superuser here, and setting a custom parameter on a database requires one,
so `alter database postgres set bevi.embed_function_url = ...` fails with
`42501: permission denied to set parameter`. The instruction was never
executable, which is why the trigger was a silent no-op from the day it
shipped — every write took the "not configured" branch. `20261025000200`
switches it to Vault, which is what Supabase's own database-webhook
documentation uses for this, and which keeps the token encrypted at rest
instead of sitting in `pg_db_role_setting` in the clear.

Verified on prod by firing the trigger inside a transaction that rolls back:
`net.http_request_queue` went from 0 rows to 1 and the rollback discarded both
the edit and the queued request, so no HTTP was sent.

**Either one missing or blank is a no-op, not an error.** That is load-bearing:
no local stack, `supabase db reset` or CI run has them, and `create_bev` has to
keep working there. A blank token counts as absent too, so half-configuring the
pair cannot start sending unauthenticated requests. `supabase/tests/12_embed_webhook.test.sql`
is what holds that property down.

### Re-running the backfill

```bash
npm run graph:backfill-embeddings                  # embed every active Bev that has no row
npm run graph:backfill-embeddings -- --dry-run     # print the plan and the first ten texts, write nothing
npm run graph:backfill-embeddings -- --stale       # also re-embed rows older than the Bev's updated_at, or from another model
npm run graph:backfill-embeddings -- --all         # re-embed everything (after a template change)
npm run graph:backfill-embeddings -- --batch 4 --limit 50   # 4 is the maximum
```

It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, optionally
`EMBED_FUNCTION_URL` and `EMBED_WEBHOOK_SECRET`, and **nothing else — no
Neo4j**. It is idempotent and resumable because it writes nothing itself:
`embed` upserts on `bev_id`, and the work list is re-derived from the database
on every run, so an interrupted run is resumed by running it again. There is no
cursor file and no partial state to clean up. A batch that fails is retried
once, then named in the summary, and the run exits non-zero without abandoning
the rest.

## The sync contract (A-16, not yet built)
## How edges are computed — and `bev_edges` is filled without Neo4j

**`bev_edges` is filled from Postgres alone.** `scripts/graph/build-edges.ts`
(`npm run graph:edges`) reads Postgres, weighs pairs with `@bevi/ranking` and
writes Postgres. It never opens a connection to Aura and reads no `NEO4J_*`
variable. The graph's `(:Bev)-[:SIMILAR_TO]-(:Bev)` is a **mirror of this
table**, written later by A-16's steps 6, 8 and 9 (the Cypher `MERGE`, the
`RANKED` edges and the `(:Meta)` keep-alive), which are their own PR. So a
paused, deleted or never-reachable instance costs the app nothing: the
similarity data is rebuilt regardless. That is "the one rule" above, taken to
its conclusion.

The job runs A-16's steps 1, 3, 4, 5, 7 and 10:

| Step | What it does |
|---|---|
| 1 | Reads active `bevs`, `categories`, `bev_flavor_profiles` and `bev_embeddings` as the service role, and calls D-11 inference (below) for any active Bev with no profile. |
| 3 | **Candidate pairs** = same category ∪ same brand ∪ the 50 nearest by embedding cosine. |
| 4 | Weighs each candidate with `edgeWeight()`. |
| 5 | Keeps the top 20 per Bev with `w ≥ 0.3`, via `topEdges`. |
| 7 | Replaces `bev_edges` in **one transaction**. |
| 10 | Prints the **sanity report**. |

Step 2 (embedding new or changed Bevs) is the `embed` Edge Function and its
`bevs` webhook — a separate PR in the same increment. Until it has run, Bevs
without a row in `bev_embeddings` get `emb = 0`, every weight they are in is
understated, and the job says so with a warning rather than failing.

### The candidate rule

Three arms, deduplicated into one set of unordered pairs:

- **same category** — all pairs within a category. "Same category *subtree*" in
  TASKS.md is the same thing today, because `categories` has no `parent_id`
  until A-13.
- **same brand** — all pairs sharing a `normaliseBrand()` key. A null or
  whitespace-only brand is not a brand and groups with nothing.
- **the 50 nearest by embedding cosine** — `public.nearest_bev_embeddings(50)`
  (migration `20261023000300`), pgvector `<=>` against the HNSW index, both
  ends filtered to `status = 'active'`.

The KNN arm is **selection only**. The `emb` term of the weight is always
recomputed with `embeddingSimilarity` from the vectors themselves, never
derived from the index's distance, so an approximate index can change which
pairs are considered but never what a pair weighs.

### The weight terms

`w = 0.25·tree + 0.15·content + 0.30·emb + 0.30·profile + 0·cop`
(`EDGE_WEIGHTS`, eq. 18). Every term comes from `@bevi/ranking`; nothing is
reimplemented in the job or in SQL.

| Term | From | Today |
|---|---|---|
| `tree` | `treeSimilarity(nodeA, nodeB, taxonomy)` | The `Taxonomy` is built from the `categories` rows as child → parent. Since A-13 it is **two levels**: `parent_id` is null on the 15 roots and the root's id on D-04's 60 leaves. Each Bev is measured at its **leaf** (`leaf_category_id`, or its root when it has none — `treeNodeOf`), so Wu–Palmer gives 1 for the same leaf, 0.5 for sibling leaves (cola vs root beer), 0.667 for a leaf against a Bev on its own root, and 0 across roots. A taxonomy with every parent null would degenerate the term to the `[same category]` indicator, and the job's log says so (`taxonomyIsFlat`). |
| `content` | `contentSimilarity` | Category, `normaliseBrand()` brand key, `flavorTokens(name, flavor)` Jaccard and price tier, from the `bevs` row. |
| `emb` | `embeddingSimilarity` | Cosine of the two `gte-small` vectors. **0 when either Bev has no embedding** — the honest value for "no evidence". |
| `profile` | `profileSimilarity` | `bev_flavor_profiles`. 0 when either is missing, including when D-11 declined below its floor. |
| `cop` | `copSimilarity` (`edges-core.ts`) | **Computed and stored in `components.cop`, with `EDGE_WEIGHTS.cop = 0`**, so it moves no weight yet. The **cosine** (`cosineSimilarity`, Layer 2's) of the two Bevs' z-score vectors over their common raters — z is already centred per user, so this is the paper's adjusted cosine, not a Pearson correlation. **Clamped at 0** (max(0, cos), as eq. (w) does for `emb`) and **0 below 3 common raters**. z comes from every ranking; only active Bevs are co-rated. |

Each term is rounded to 6 decimals and the weight is then computed **from the
rounded terms**, so `edgeWeight(components) == weight` holds exactly for every
stored row and the breakdown in `components` is a derivation a reviewer can
check rather than a decoration. The cost is more exact ties, which is why
`topEdges`' tie-break on `bevId` matters: it is code-unit order, and SQL
tie-breaks must match it (`collate "C"`, or a lowercase-hex `uuid` column,
which is byte-identical — M-24).

A pair is kept when **either** endpoint wants it in its top 20. An
intersection would drop a small Bev's single best neighbour because a popular
Bev has twenty better ones, and it is why `get_similar_bevs` clamps at 50
rather than 20.

### The write-back transaction

`public.replace_bev_edges(p_rows jsonb, p_version text)` (`20261023000300`,
service role only) replaces the whole table inside one call, which is one
transaction, and returns the row count. `p_version` is `RANKING_VERSION`.

- Rows must already be in the canonical orientation `src_bev_id < dst_bev_id`;
  the function rejects a reversed row rather than fixing it, because
  `orientPair` in the job is the single place that decides orientation.
- It validates the entire payload — nulls, orientation, weight range,
  `components` shape, duplicate pairs, unknown Bev ids, and an empty array —
  **before** it deletes anything, so a bad payload leaves yesterday's edges in
  place.
- It uses `delete` + `insert`, not `truncate`, although TASKS.md sanctions
  truncate-and-insert at this size: `truncate` takes an `ACCESS EXCLUSIVE` lock
  that blocks every reader, including `get_similar_bevs` on a user's screen,
  while `delete` lets readers keep seeing the previous generation under MVCC
  until the commit. The table is never observably empty and nothing on a
  request path waits.

The job is therefore **idempotent and resumable** in the strongest sense
available: two runs produce the same table, and a crash anywhere before that
one call leaves the previous generation untouched. There is no partial state to
resume from.

### D-11: a flavour profile for a user-created Bev

`public.infer_bev_flavor_profile(p_bev_id uuid)` (`20261023000200`, service
role only) returns one row — `(bev_id, outcome, inferred_from, similarity)` —
and is called by the builder for every active Bev with no profile, before
weights are computed. It copies the profile of the nearest **seeded,
hand-labelled** Bev **in the same category** by embedding cosine, with brand
match as the tie-break, and writes `source = 'inferred'`, `inferred_from` and
`inferred_similarity`. **Below a cosine of 0.6 it writes nothing**: the Bev
keeps no profile, its `profile` term stays 0, and it falls back to the category
and brand terms. A wrong `base` would cost more than a missing one, because
`profileSimilarity` weights `base` at 0.40.

`outcome` is one of `inferred`, `below_floor`, `has_profile`, `no_embedding`,
`no_candidate`, which is what the run's log reports per Bev. `inferred` on the
table is a generated column over `source`, so a relabelling pass cannot leave
the two disagreeing.

### The sanity report

Every run prints it, with **every component term**, not just the total:

- Coca-Cola ↔ Pepsi ≥ 0.8
- Coca-Cola ↔ a sparkling water < 0.4

Both pairs are weighed directly rather than looked up among the kept edges, so
the report says what the formula gives even for the pair that is *expected* to
fall below the threshold and therefore not to be stored.

**A breach is printed loudly and does not fail the job by default.** M-24 (#86)
derived what the second bound depends on: with today's flat categories that
pair is `w = 0.135 + 0.30·emb`, so `< 0.4` holds only while the `gte-small`
cosine stays `≤ 0.88` — a number no run has ever measured, because
`bev_embeddings` is empty and the instance these thresholds were to be judged
against has never answered. The first real run is a **measurement**, not a
gate; failing on it would leave `bev_edges` empty to protect a threshold that
is itself under review. `--strict` turns a breach into an exit 1, and belongs
in the nightly workflow once the bounds have been re-derived against real
vectors.

Everything else is loud and safe the old way: the job fails, Actions emails,
`bev_edges` keeps yesterday's values, and the app does not notice.

### The nightly workflow

`.github/workflows/graph-edges.yml` — `cron: "50 4 * * *"` (after the 04:20 UTC
`refresh-user-category-stats` job; there is no function literally called
`refresh_all_stats`) plus `workflow_dispatch` with `dry_run` and `strict`
inputs. It needs:

| Name | Where | Why |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | repository **secret** — **does not exist yet** | Reads every active Bev past RLS and calls the two service-role-only RPCs. |
| `SUPABASE_URL` | repository **variable** (a same-named secret also works) | The project's REST origin. Not a secret. |

A missing value **fails the run**: a preflight step exits 1 naming it, and the
script refuses to start for the same reason. This is deliberate.
`graph-keepalive.yml` has reported success every day since 2026-10-15 while
doing nothing, because its script exits 0 with a warning when `NEO4J_URI` is
unset and nobody ever set it. A warning in a log nobody opens is not a signal;
a red X on a scheduled run is.

```bash
npm run graph:edges                 # rebuild bev_edges
npm run graph:edges -- --dry-run    # write nothing; print the top-5 neighbours of
                                    # Coca-Cola, Pepsi, Diet Coke, a matcha and Red Bull
npm run graph:edges -- --strict     # also fail on a sanity-report breach
npm run test:scripts                # the pure half, no database needed
```

## Taste neighbours (A-16 (2)) — also without Neo4j

`user_neighbors` is the one table of **Stage 3** in
`docs/graph_db_implementation.md`, and like the Bev graph it is filled from
Postgres alone. M-28 (#131) put every formula in
`packages/ranking/src/graph.ts`, so the doc's `RANKED` edges, HMAC pseudonyms
and Cypher aggregation buy nothing at this size: `scripts/graph/build-neighbours.ts`
reads rankings, scores **every** user pair in TypeScript and replaces the table
in one transaction.

```sql
user_neighbors(user_id uuid, neighbor_id uuid,        -- both -> profiles(id), cascade
               sim numeric(5,4) not null check (sim between -1 and 1),
               common smallint not null,               -- co-rated Bevs
               shared_attrs smallint not null,         -- bridging attributes
               method text not null,                   -- 'pearson' | 'attr' | 'blend'
               version text not null,                  -- RANKING_VERSION at compute time
               computed_at timestamptz not null default now(),
               primary key (user_id, neighbor_id),
               check (user_id <> neighbor_id))
  -- (user_id, sim desc, neighbor_id) index: "my neighbours, best first".
```

**Both directions of a pair are stored**, which is the opposite of `bev_edges`
and not an inconsistency. `sim` is symmetric, but the *selection* is not —
`topUserNeighbours` keeps each user's own top 25, so "v is in u's 25 nearest"
does not imply the reverse. And the read is per user, so storing both keeps it
a single `where user_id = $1` against the index.

**RLS is on with no policy at all: no client reads or writes the table.** This
is the first table in the schema whose rows name *another user*. `neighbor_id`
is a profile id and the doc is explicit that it never reaches the client, and
even an owner-only select would hand the owner their neighbours' uuids with
`sim` and `common`. So it is stricter than the doc's owner-only rule: Stage 4
reads it inside the definer `get_prediction_snapshot`, joined to the alias CTE
it already builds, and emits `u<n>`. The job's log aliases users the same way
(`aliasUsers` in `build-neighbours.ts`), because Actions logs on this public
repo are public.

Three service-role-only functions, in `20261026000300`:

| Function | Why it is not a table read |
|---|---|
| `ranking_z_inputs()` | Returns **every** user's rankings, because a z-score is measured against the global mean — **whatever the Bev's status**, with an `active` flag. `get_prediction_snapshot` takes every user's μ/σ and the global ones from all rankings, so the job does too (`zScoresFromRankings` on every row), then keeps only active Bevs as co-rated ones (`activeZScores`): a hidden Bev moves its raters' z but never counts as a co-rating. `rankings_select` is owner-and-followees only, so a leftover default grant here would hand any account the whole ranking table. It also casts `score` to `float8` — PostgREST renders `numeric` as a JSON *string*, which `zScoresFromRankings` rejects as non-finite. |
| `replace_user_neighbors(jsonb, text)` | One call is one transaction. **An empty payload is accepted**, the one place it differs from `replace_bev_edges`: for `bev_edges` empty means a broken run, but for neighbours empty is the expected result today. |
| `bev_co_rater_counts(int)` | Which Bevs have ≥ 3 raters, so the `cop` term can skip the rankings read entirely when none do. |

**Expect few rows, or none.** #122's export measured why: 3 users, 27 rankings,
a median of 1 co-rater per rated pair. The α gate needs 2 co-rated Bevs and the
bridge rule needs 2 bridging attributes reached through *distinct* Bevs, so most
pairs score 0. The job reports that rather than treating it as a failure.

**Nothing reads these rows yet, by design.** Stage 4 — `get_prediction_snapshot`
emitting `(alias, sim, common)` and `layer2()` reading `snapshot.userNeighbors`
— is a separate PR, because `layer2.ts` is Matt's lane and the doc says Stage 4
needs the contract agreed first. Until then `layer2()` falls back to its
in-snapshot computation, which is exactly the doc's "3 or more rankings, not yet
synced" tier.

**There is no per-ranking webhook, and that is deliberate.** TASKS.md's A-16 (2)
row promises one, which is right for Bev edges — a new Bev changes a bounded,
knowable set of rows. A taste neighbourhood is not local in that way: one new
ranking changes u's z-scores against the global mean, so u's taste vector, so
u's similarity to *every* other user, and through the global stats every other
pair by a little. There is no incremental update smaller than the full rebuild.

The `cop` term of eq. (18) is computed from the same z-scores and stored in
`bev_edges.components.cop`: the **cosine** of two Bevs' z-score vectors over
their common raters, 0 below 3 of them. `EDGE_WEIGHTS.cop` is still **0**, so
no stored weight changes — switching γ on renormalises the other four and is a
constant change plus a `RANKING_VERSION` bump in Matt's lane. A **negative**
cosine clamps to 0 (sim_cop = max(0, cos), the convention eq. (w) uses for
sim_emb), so 0 always means "no evidence of similarity": eq. (18) sums
non-negative terms and has no way to express "these two move oppositely".
(1 + cos)/2 was rejected because it would lift w by γ/2 the night a pair gets
its third co-rater, and break the Coke–LaCroix < 0.4 bound once γ is on.

```bash
npm run graph:neighbours                 # read, score every pair, write
npm run graph:neighbours -- --dry-run    # score and print the report, write nothing
```

Scheduled by `graph-neighbours.yml` at 05:20 UTC, 30 minutes after
`graph-edges`. Neighbours do not read `bev_edges`, so that ordering is for
whoever reads the two logs, not a data dependency — either job runs alone.

## Secrets

Names only. Values live in `supabase/.env` (gitignored) locally,
`supabase secrets set` in the hosted project, and GitHub Actions secrets in CI.
See `supabase/.env.example`.

| Name | Where | Used by |
|---|---|---|
| `NEO4J_URI` | Supabase secrets, Actions secrets, `supabase/.env` | `graph-query`, `graph:schema`, `graph:keepalive`, the sync |
| `NEO4J_USERNAME` | same | same |
| `NEO4J_PASSWORD` | same | same |
| `NEO4J_DATABASE` | same; optional only in the sense that it defaults to `neo4j`, which is wrong for our instance, so it is always set | same |
| `BEVI_PSEUDONYM_SALT` | **Actions secrets only** | the Neo4j sync, for `(:User {pseudonym})`. **Still unused:** A-16 (2) shipped Postgres-only, and `user_neighbors` stores real profile ids behind owner-only RLS, so nothing pseudonymises anything until the `RANKED` mirror is built |
| `SUPABASE_SERVICE_ROLE_KEY` | **Actions secret** — set 2026-10-24; `supabase/.env` locally | **`graph-edges.yml` / `npm run graph:edges`** and **`graph-neighbours.yml` / `npm run graph:neighbours`**, to read Postgres past RLS and call the service-role RPCs; later the Neo4j sync |
| `SUPABASE_URL` | injected into Edge Functions; an Actions **variable** (`vars`) for both graph workflows; `supabase/.env` locally. Not a secret | same |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` | Actions secrets (already used by `backend.yml`) | deploying the function and pushing migrations |

No `NEO4J_*` value may ever reach `app/` or `packages/api`. The browser gets
the publishable key and nothing else. Aura shows the password exactly once, at
instance creation — save the credentials file outside the repo.

The live instance is `bevi-graph-db`, created 2026-10-24 in the Aura project
`c03f2541-d8b6-4cf4-8383-a0d3d8be8c04`. Its credentials file sets
`NEO4J_USERNAME` and `NEO4J_DATABASE` to the instance id rather than to
`neo4j`, so both must be read from that file and neither may be assumed. The
schema in `scripts/graph/schema.cypher` is applied, and `(:Meta).lastKeepAliveAt`
was written by hand the same day.

## Access paths

**`graph-query` Edge Function** — `supabase/functions/graph-query/`. JWT
verified. The client names one of a fixed set of templates (`similar`, `bev`,
`meta`) and passes values that are bound as Cypher parameters. There is no
path by which caller input becomes Cypher text, and no free-form query is
accepted. If you add a template, keep that property.

**Age gate.** Postgres hides alcoholic Bevs from anyone not verified 21+
(`bevs` RLS, `viewer_is_adult()`). `graph-query` runs as no user and any
holder of the publishable key passes `verify_jwt`, so it fails closed: every
template filters on `coalesce(isAlcoholic, true) = false`. Any new template
must do the same, or check `viewer_is_adult()` with the caller's JWT first.

```bash
# local
supabase functions serve graph-query
deno test supabase/functions/graph-query/test.ts
```

**Transport** — Aura exposes port 443 only, so everything uses the Query API
over HTTPS (`https://<host>/db/<database>/query/v2`) rather than the Bolt
driver. For an Edge Function that may cold-start per request this is also the
right choice: a Bolt connection pool has nothing to pool.

## Known gaps at the time of writing

- `bev_embeddings`, `bev_edges` and the `vector` extension exist, and so does
  the contract the app reads them through (`20261019000500`, #115).
- **The embedding writer exists and is deployed** ("How embeddings are
  produced", above): the `embed` Edge Function, the async `bevs` triggers
  (`20261023000100`, #117) and `scripts/graph/backfill-embeddings.ts`. The
  function is deployed with `--no-verify-jwt` and `EMBED_WEBHOOK_SECRET` is
  set on the project. Still outstanding before a vector exists for any Bev:
  the two `bevi.embed_*` database settings (for the trigger) and one backfill
  run (for the 378 existing Bevs).
- **The edge writer runs nightly and has run:** `scripts/graph/build-edges.ts`
  and `graph-edges.yml`, with `20261023000200` (D-11 inference) and
  `20261023000300` (the two service-role RPCs). `SUPABASE_SERVICE_ROLE_KEY` is
  set, the backfill has run, and prod holds 4669 edges (Coke–Pepsi 0.9001,
  Coke–LaCroix 0.3809).
- **The taste graph (A-16 (2)) is built and also Postgres-only:**
  `user_neighbors` in `20261026000300`, `scripts/graph/build-neighbours.ts` and
  `graph-neighbours.yml`, nightly at 05:20 UTC. Expect **few rows or none** at
  current volume — see "Taste neighbours".
- The **Neo4j** side of A-16 — steps 6, 8 and 9, `(:Bev)-[:SIMILAR_TO]`, the
  `RANKED` mirror and `(:Meta).lastSyncAt` — is still unbuilt, and nothing
  above depends on it. `Bev.embedding` is unset on every node.
- `Bev.vessel` arrives with A-07; the flavour properties (`base`,
  `carbonated`, `caffeine`, `sweetness`, `dairy`, `alcohol`) with A-17.
- `categories.parent_id` **landed with A-13**: Postgres now holds 15 roots and
  60 leaves (D-04), and `build-edges.ts` measures the tree term at each Bev's
  leaf while the content term keeps the root. `[:CHILD_OF]` in Neo4j is still
  unbuilt, with the rest of the mirror.
- So a fresh instance after A-15 alone has the constraints and indexes and no
  nodes. `graph-query`'s `similar` template correctly returns zero rows.
