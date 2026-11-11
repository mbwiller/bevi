# The Bev graph

S-17. Companion to `docs/bevi-ranking-math.tex` §10.1, which has the formulas.
This document is the operational half: what lives where, what the sync
promises, which secrets exist, and what to do when the instance is asleep.

Decided in TASKS.md revision 2, items 28–31.

## The one rule

**Neo4j is never on a request path.**

Nothing a user taps waits on a cross-cloud call. The ranking flow,
recommendations, Bev detail and "similar Bevs" rows all read `bev_edges` in
Postgres, which the nightly job writes; the graph signals reach the app the
same way, through `bev_graph_stats` in Postgres. If the Aura instance is
paused, deleted or simply down, the app behaves exactly as it did the day
before — it reads slightly staler edges and signals, and nothing else changes.

The one exception is the `graph-query` Edge Function, which queries the graph
directly for on-demand exploration. It is not wired into any screen, and it
returns a 503 rather than a fallback when the instance is unreachable.

The graph itself is a **mirror**, written nightly by `graph-sync` (see "The
sync", below) from tables Postgres already holds. Since A-16 (4) the same job
also **computes on it** — each Bev's centrality, taste family and bridge score —
and writes the result back to Postgres ("Graph signals", below), so even what
the graph computes does not live only there.

## What lives where

Postgres is the system of record, for the data **and** for everything derived
from it. The graph holds a copy, shaped as relationships.

| Owned by Postgres (the record) | Mirrored into the graph by `graph-sync` |
|---|---|
| the `bevs` row: name, brand, flavor, category, leaf, photo, price, status, UPC | `(:Bev)` nodes, active Bevs only |
| `categories` (15 roots, 60 leaves) | `(:Category)` with `[:CHILD_OF]`, and `(:Bev)-[:IN_CATEGORY]->` the Bev's **leaf** (or its root when it has none) |
| `bevs.brand`, free text | `(:Brand)` with `[:BY_BRAND]`, keyed by `normaliseBrand()` |
| `bev_flavor_profiles` (A-17) | profile properties on `(:Bev)`, and `(:Flavor)` with `[:TASTES_OF]` |
| `bevs.name` and `bevs.flavor` | `(:Note)` with `[:HAS_NOTE]`: the `flavorTokens()` shared by two or more Bevs |
| `bev_embeddings` (A-16) | `Bev.embedding` and the vector index |
| **`bev_edges`** — computed nightly by `graph-edges`, **from Postgres alone** | `(:Bev)-[:SIMILAR_TO]-(:Bev)` and its weight components, row for row |
| `rankings` | `(:User {pseudonym})-[:RANKED]->(:Bev)`, pseudonymised, plus the derived `[:LIKES]` and `[:DISLIKES]` |
| `bev_stats`, `global_stats`, `category_stats`, `user_neighbors` | — |
| `comparisons`, `want_to_try`, `follows`, `profiles`, auth, birth dates, handles, the age gate | — (never leaves Postgres) |
| trigram search, dedupe, the prediction snapshot | — |
| **`bev_graph_stats`** — written by `graph-sync` after each commit, **computed from the graph as read back** | `Bev.pagerank`, `strength`, `degree`, `bridge`, `community`; `(:Community)` (a **taste family**) with `[:IN_COMMUNITY]`. The one thing the graph computes rather than copies, and Postgres holds it too |
| | `(:Meta {key: 'singleton'})`: `lastSyncAt`, `syncId`, counts — the graph's own bookkeeping |

```
Supabase (Postgres)                                                  Neo4j AuraDB Free (A-15)
bevs, categories ─────────────────────────── graph-sync ───────────▶ (:Bev)-[:IN_CATEGORY]->(:Category)-[:CHILD_OF]->(:Category)
bev_flavor_profiles (A-17) ───────────────── graph-sync ───────────▶ (:Bev)-[:BY_BRAND]->(:Brand), -[:TASTES_OF]->(:Flavor), -[:HAS_NOTE]->(:Note)
bev_embeddings (pgvector, gte-small) ─────── graph-sync ───────────▶ Bev.embedding + vector index
rankings (pseudonymised, z in TypeScript) ── graph-sync ───────────▶ (:User {pseudonym})-[:RANKED {score, z, bucket, rankedAt}]->(:Bev), [:LIKES], [:DISLIKES]
bev_edges ◀── graph-edges (Postgres only)
bev_edges ────────────────────────────────── graph-sync ───────────▶ (:Bev)-[:SIMILAR_TO {w, tree, content, emb, profile, cop}]-(:Bev)
   ▲                                                                       │ read back inside the sync transaction (with each Bev's flavour base and notes),
   │                                                                       ▼ PageRank / flavour projection + Louvain / participation (@bevi/ranking)
   │                                                                 Bev.pagerank, .bridge, .community; (:Bev)-[:IN_COMMUNITY]->(:Community)
bev_graph_stats ◀─────────────────────────── graph-sync, after the commit ──┘
   ▲
   └── both read by the app's hot path (the prediction snapshot). Neo4j is not in this picture at request time.
```

The arrow that used to point **back** from the graph to `bev_edges` is gone:
A-16 (1) found that the edges need no graph to compute, so `graph-edges` fills
the table from Postgres and `graph-sync` copies it out. **One arrow points back
since A-16 (4): `bev_graph_stats`.** The signals in it are computed from the
graph, by the sync job itself, and written to Postgres by that job after the
graph commits; no request ever asks Neo4j for them.

## Nothing lives only in the graph

Every node and property is derived from Postgres. The graph can be dropped and
rebuilt from a single sync run, which is what makes the Aura Free constraints
below tolerable. Do not add a property that has no Postgres source.

The computed signals keep to that rule from the other side: they are derived
inside the sync from nodes and edges that are themselves copies, so a rebuilt
graph recomputes them, and the copy the app reads is the Postgres table
`bev_graph_stats`, not the node properties.

`User` nodes carry **only** a pseudonym — `hmac(user_id, BEVI_PSEUDONYM_SALT)`,
stable across runs so co-rating can accumulate over time — beside the `syncId`
stamp every synced node has. The sync verifies that before it commits. No handle, no display
name, no birth date, no email leaves Postgres (decision 31). The pseudonym is
deliberately *not* the per-call alias the prediction snapshot uses, because
those rotate and co-rating needs stability.

## AuraDB Free: the three rules that bite

1. **It auto-pauses after 72 hours without activity, and does not auto-resume.**
   The nightly sync's write to `(:Meta)` is what keeps it awake — the
   keep-alive is a side effect of doing real work, not a separate ping. A sync
   that **fails** still stamps `(:Meta).lastAttemptAt` in its own transaction,
   so a bad week is still activity; only an unreachable instance goes
   unstamped. `graph-sync.yml` has its own 05:50 UTC schedule for exactly this
   reason, independent of `graph-edges`.
   **`.github/workflows/graph-keepalive.yml` stays for now.** Once a day it
   runs `npm run graph:keepalive`, which stamps `(:Meta).lastKeepAliveAt` (the
   sync leaves that property alone). Delete that workflow and
   `scripts/graph/keepalive.ts` only when `graph-sync.yml` has run green for a
   week; until then it is the bridge. Without the `NEO4J_*` Actions secrets it
   logs a warning and does nothing.
2. **A paused instance is deleted after 30 days.** Because nothing lives only
   in the graph, that is a rebuild, not data loss. Still worth not doing.
3. **Resuming is a manual console action.** There is no API for it on the free
   tier. If the sync has been failing for three days, someone has to open the
   Aura console and press resume, then re-run the workflow.

Capacity: 200,000 nodes, 400,000 relationships, 1 GB. The catalog fixture is
about 850 nodes and 6,600 relationships with its communities — under 0.5% of
the node cap and under 2% of the relationship cap.

Graph Data Science is a separate paid product. We compute similarity ourselves
(`@bevi/ranking`, M-24) and the graph only stores the result; the graph
signals are computed the same way, by `network.ts` in that package, on rows
read back with plain Cypher. **The instance
does list `gds.*` procedures, and they are deliberately never called:** they
are stubs for paid "Aura Graph Analytics" sessions, and calling one could start
a billed session. No statement in `scripts/graph/` contains `gds.`, and a unit
test holds that down. APOC core is present too, and nothing depends on it.

## Schema

`scripts/graph/schema.cypher`, applied with:

```bash
npm run graph:schema              # apply (needs NEO4J_* in the environment)
npm run graph:schema -- --dry-run # print the statements, connect to nothing
```

Every statement is `IF NOT EXISTS`, so re-running is a no-op. That is the
idempotency guarantee A-15's definition of done asks for — run it twice and the
second run changes nothing.

Eight uniqueness constraints (`Bev.id`, `Category.id`, `Brand.key`,
`Flavor.name`, **`Note.token`** — added with the sync and applied to the
instance on 2026-11-10 — `User.pseudonym`, **`Community.id`** — added with the
graph signals and applied on 2026-11-11 UTC — and `Meta.key`), two lookup indexes
(`Bev.categoryId`, `Bev.brand`) and the vector index on `Bev.embedding`. The
uniqueness constraints are what make the sync's `MERGE` on a key an index
lookup, and `graph-sync.yml` runs `graph:schema` before every sync so a new one
exists before it is needed.

`(:Bev)` properties the sync writes are listed under "The sync" below, and the
five it computes (`pagerank`, `strength`, `degree`, `bridge`, `community`)
under "Graph signals". Two are worth knowing here. **`isAlcoholic`** is the Bev's root category's flag and is
mandatory: `graph-query` treats a Bev without it as alcoholic and never returns
it, and the sync refuses to commit a generation in which any Bev lacks it.
**`categoryId` is always one of the 15 roots**, exactly as `bevs.category_id`
is; the leaf is `leafCategoryId`, and **`[:IN_CATEGORY]` points at the leaf**
when the Bev has one, at the root otherwise. So "which of the 15" is the
property, and "the most specific category" is the relationship (plus one
`[:CHILD_OF]` hop to reach the root).

Neo4j cannot express "at most one `SIMILAR_TO` per unordered pair", so the sync
enforces it by convention: it only ever writes the direction where
`src.id < dst.id`, and every read traverses undirected. The vector index on
`Bev.embedding` (384 dimensions, cosine) holds every Bev that has a row in
`bev_embeddings`; a Bev without one has no `embedding` property and is simply
absent from the index.

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
documentation uses for this. The stored copy is encrypted at rest, though each
queued request still carries the token in clear text in
`net.http_request_queue` until pg_net's worker consumes it, as before.
`20261031000100` then moved the Vault reads inside an exception handler, so an
unreadable Vault is a no-op like a missing secret and can never abort a Bev
write.

To rotate a value, update it in place (the name stays the same, so the trigger
needs no change):

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'embed_webhook_token'),
  '<new EMBED_WEBHOOK_SECRET>');
```

Rotate `EMBED_WEBHOOK_SECRET` in `supabase secrets set` at the same moment, or
the queued requests in between get a 401.

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

## The sync: Postgres → Neo4j, nightly (A-16 steps 6, 8 and 9)

`scripts/graph/sync.ts` (`npm run graph:sync`) mirrors the whole Bev graph from
Postgres into the Aura instance: the catalog, the similarity edges
`graph-edges` wrote to `bev_edges`, and the rankings, pseudonymised. **The
mirror computes nothing new.** Every weight was computed by `build-edges.ts`
and every z-score by `zScoresFromRankings`; this job copies them, so the graph
cannot disagree with the tables it mirrors. Then, in the same transaction, the
**analytics phase** (A-16 (4)) reads the graph back and computes each Bev's
centrality, taste family and bridge score — "Graph signals", below.

**Nothing the app reads depends on Neo4j answering.** A red run leaves
yesterday's graph, and yesterday's `bev_graph_stats`, in place, and the app
does not notice ("the one rule", above).

**It has run.** #174 merged on 2026-11-11 (UTC). A `dry_run` dispatch of
`graph-sync` and then a real one both succeeded: Actions run 42946278280
committed at 02:29 UTC with 385 Bevs, 75 categories, 148 brands, 23 flavours,
203 notes and 4 users; 4,653 `SIMILAR_TO`, 42 `RANKED`, 21 `LIKES` and 13
`DISLIKES`. The vector index answered, and Coke–Pepsi read back as 0.9001, the
weight `bev_edges` holds. That generation predates the analytics phase, so it
carries no `(:Community)` and no computed property; see "Known gaps" for what
of the analytics phase has and has not run.

```bash
npm run graph:sync                # read Postgres, write the graph, verify, commit
npm run graph:sync -- --dry-run   # everything, then ROLL BACK: nothing is written
npm run graph:sync -- --fixture   # the source is the checked-in catalog, not Postgres;
                                  # forces --dry-run and needs only the four NEO4J_*
npm run test:scripts              # the pure half and the orchestration, no database
```

The files, split the way `build-edges.ts` / `edges-core.ts` are:

| File | What it is |
|---|---|
| `sync-core.ts` | The pure half: `buildGraphPlan(source, { pseudonymOf, rankingVersion })` and every Cypher statement, as fixed string constants. No fetch, no environment, no clock. |
| `analytics-core.ts` | The pure half of the analytics phase: `flavourProjection(nodes, memberships)` and `computeGraphStats({ nodes, similarity, partition, communityIdOf })`, which call `@bevi/ranking`'s network functions and nothing else, and the analytics report. |
| `sync.ts` | The I/O half: the reads, the two HMACs (user pseudonyms, community ids), the one transaction, the retries, the Postgres write-back, the reports. |
| `neo4j.ts` | A dependency-free Query API client with explicit transactions and a typed, redacted error. |
| `postgrest.ts` | The paged PostgREST client (`build-edges.ts` and `build-neighbours.ts` keep their own private copies and were not touched). The sync also calls `replace_bev_graph_stats` through it. |
| `sync-fixture.ts` | A source built from `data/catalog`, for the tests and for `--fixture`. |

### What it reads

Six ordered, paged table reads with the service role (`max_rows` is 1000 and
`bev_edges` holds about 4,700 rows): `categories`, `bevs` (`status = 'active'`
only), `bev_flavor_profiles` (read on its own: it has two foreign keys to
`bevs`, so an embed is ambiguous), `bev_embeddings`, `bev_edges` and
`rankings`. `rankings` is read **once**, so every z and every `RANKED` edge
come from the same snapshot. `numeric` columns arrive as JSON strings and are
converted and checked for finiteness; an embedding arrives as pgvector's text
form or as an array, and both are handled.

### The model

Every mirrored property has a Postgres source. The **computed** ones (marked
below) are derived inside the transaction from the mirrored graph and are
stored in Postgres as well, in `bev_graph_stats`.

| Node | Key | Properties |
|---|---|---|
| `(:Category)` | `id` | `name`, `isAlcoholic`, `sortOrder`, `depth` (1 root, 2 leaf), `parentId` (absent on a root) |
| `(:Brand)` | `key` = `normaliseBrand(bevs.brand)` | `name` = the most common raw spelling among its Bevs (a tie goes to the smaller in code-unit order) |
| `(:Flavor)` | `name` = `bev_flavor_profiles.base` | — |
| `(:Note)` | `token` = one of `flavorTokens(name, flavor)` | `bevCount`. **Only a token shared by at least two active Bevs becomes a node** (`TASTE_MIN_ATTR_BEVS`): a one-Bev token is a dead end for traversal |
| `(:Bev)` | `id` | `name`, `brand` (raw), `brandKey`, `flavor`, `categoryId` (**the root**), `leafCategoryId`, `priceTier`, `isAlcoholic` (the root category's flag; **mandatory**), `isStarter`, `source`; with a flavour profile also `base`, `carbonated`, `caffeine`, `sweetness`, `dairy`, `alcohol`, `serve`, `profileSource`; with an embedding also `embedding` (384 floats) and `embeddingModel`. **Computed, on every Bev:** `pagerank`, `strength`, `bridge` (floats), `degree` (integer), `community` (the opaque id of its `(:Community)`) |
| `(:User)` | `pseudonym` | **nothing else** |
| `(:Community)` — **computed**: a **taste family** | `id` = `c_` + 16 hex, **opaque** (see "Graph signals") | `size` |
| `(:Meta {key: 'singleton'})` | | `lastSyncAt`, `syncId`, `rankingVersion`, `edgesVersion`, one integer count per label and type (`bevCount`, `similarToCount`, `communityCount`, `inCommunityCount`, …), `modularity` (float), `analyticsVersion` (the `RANKING_VERSION` whose `network.ts` made the signals), `lastAttemptAt`, `lastAttemptOk`; `lastKeepAliveAt` is left untouched |

| Relationship | Rule |
|---|---|
| `(:Category)-[:CHILD_OF]->(:Category)` | a leaf to its root |
| `(:Bev)-[:IN_CATEGORY]->(:Category)` | **exactly one per Bev, to the most specific node**: `leaf_category_id ?? category_id`, which is `treeNodeOf` in `edges-core.ts`, the node the tree term of `bev_edges` is measured at (`design/taxonomy.md` §9, item 5) |
| `(:Bev)-[:BY_BRAND]->(:Brand)` | only when the brand key is not null (a null or blank brand is not a brand) |
| `(:Bev)-[:TASTES_OF]->(:Flavor)` | only when the Bev has a profile |
| `(:Bev)-[:HAS_NOTE]->(:Note)` | one per kept token |
| `(:Bev)-[:SIMILAR_TO {w, tree, content, emb, profile, cop, version, computedAt}]->(:Bev)` | `bev_edges` row for row, written only in the direction `src.id < dst.id`; both ends must be active in this run |
| `(:User)-[:RANKED {score, z, bucket, rankedAt}]->(:Bev)` | one per ranking of an **active** Bev. `z` comes from `zScoresFromRankings` called once over **every** ranking, active Bev or not, through `activeZScores` — the rule `graph-neighbours` uses |
| `(:User)-[:LIKES {w}]->(:Bev)` | derived: `z >= +0.25`, `w = z` |
| `(:User)-[:DISLIKES {w}]->(:Bev)` | derived: `z <= -0.25`, `w = -z`. The dead band gets neither |
| `(:Bev)-[:IN_COMMUNITY {hub}]->(:Community)` — **computed** | exactly one per Bev, to its taste family; `hub = true` on exactly one member of each family (the one the family's id is derived from) |

Every node and relationship of those seven labels and ten types also carries
`syncId`, the stamp of the run that last wrote it. In the code the first six
labels and nine types are `MIRRORED_*` (the plan counts them) and `Community`
and `IN_COMMUNITY` are `COMPUTED_*` (the analytics phase counts them); together
they are `OWNED_*`.

**Dropped, counted and logged, not errors:** anything hanging off a Bev that is
not `active`. A `bev_edges` row can reference a Bev hidden since the last edges
run, `bev_embeddings` outlives a status change, and a ranking can point at a
hidden Bev for ever. A user with no ranking of an active Bev gets no node.

**Thrown, before anything is sent:** a Bev whose `category_id` or
`leaf_category_id` is not in `categories`, a `category_id` that is not a root, a
category tree deeper than two levels, an edge with `src >= dst`, a weight or
component outside [0, 1] or non-finite, an embedding that is not 384 finite
numbers, and a duplicate key anywhere.

### One transaction: MERGE, stamp, sweep, compute, verify

Every Cypher statement is a **fixed string constant** in `sync-core.ts`. Data
travels only as parameters (`$rows`, `$syncId`); nothing is ever interpolated.
`syncId` is a timestamp plus random hex, generated once per run.

Inside **one explicit transaction** (the Query API's `/tx` endpoints):

1. **Upsert** every node, then every relationship, with `UNWIND $rows AS row
   MERGE … SET …` — 500 rows a request for nodes, 1000 for relationships, 100
   for Bevs, which carry the embedding. `SET n = { … }` **replaces** the
   property map, so a property that disappeared in Postgres (a deleted profile)
   disappears in the graph; a null in the map is simply not stored.
2. **Sweep** the mirror: delete every relationship of each mirrored type, then
   `DETACH DELETE` every node of each mirrored label, whose `syncId` is missing
   or is not this run's. That is how a removed ranking or a hidden Bev leaves
   the graph. `(:Meta)` is not an owned label and no sweep statement can match
   it.
3. **The analytics phase** ("Graph signals", below), in four moves:
   **read** every `(:Bev)` id, every `SIMILAR_TO` as `(a, b, w)` and every
   Bev's flavour base and notes as `{ node, attribute }` back out of the graph
   (three fixed, ordered statements; about 4,700 edges and 1,400 memberships
   come back, one response each); **compute** with `flavourProjection` and
   `computeGraphStats`; **write** the five
   properties on each `(:Bev)` — with their own statement, because the Bev
   upsert of step 1 replaced the whole property map, so they are set afresh
   every run — plus the `(:Community)` nodes and `[:IN_COMMUNITY]`, stamped
   with `syncId`; and **sweep** `IN_COMMUNITY` and `Community`.
4. **Verify**, still inside the transaction, by reading the graph back: the
   count per label and per type must equal the plan **exactly** (for
   `Community` and `IN_COMMUNITY`, the computation's counts); zero
   `SIMILAR_TO` with `startNode.id >= endNode.id`; zero Bevs without
   `isAlcoholic`; every Bev has exactly one `IN_CATEGORY`; the number of Bevs
   with an `embedding` equals the plan's, each stored as 384 floats; zero
   `(:User)` with any property other than `pseudonym` and `syncId`; the float
   and integer properties are stored with those types; and, for the analytics
   phase, every Bev has exactly one `IN_COMMUNITY`, every `(:Community)` has
   exactly one member with `hub = true` and a `size` equal to its member
   count, every Bev's `community` property names the community it points at,
   `pagerank`/`strength`/`bridge` are `FLOAT NOT NULL`, `degree` is `INTEGER
   NOT NULL`, `community` a string, `hub` a boolean, and the PageRanks sum to 1
   within 1e-6. That is 32 checks. **Any mismatch rolls back** and exits 1
   naming the check and both numbers.
5. **Stamp `(:Meta)`** and commit.

**Why the sweep is in two parts, in that order.** The analytics phase reads
the graph back, so by then the transaction must hold this generation and
nothing else: a Bev hidden yesterday, or an edge that dropped out of
`bev_edges`, would otherwise be ranked and clustered with the rest. So the
mirror is swept **before** the read, and moving the whole sweep after the
analytics would be wrong. `IN_COMMUNITY` and `Community` are swept **after**
tonight's were stamped: a Bev that changed community keeps its old
relationship until then, and a community whose hub changed keeps its old node.
This was proven on the live server on 2026-11-11 in one transaction that was
rolled back: generation A (the fixture: 380 Bevs, 11 taste families), then a
changed generation B (the hubs of A's five largest families hidden, every
citrus Bev relabelled berry and every tea Bev coffee, and every edge below
0.62 removed: 375 Bevs, 9 families, 7 of A's community ids gone, 277 Bevs in
a different family). B verified with zero failures; 0 `(:Community)` and 0
`IN_COMMUNITY` not stamped B remained; none of the 7 ids survived. As a
control, the same graph was written a second time with every community
renamed and **no** sweep: the verification failed on four checks (22
communities against 11, 760 memberships against 380, 380 Bevs without exactly
one, 380 whose property disagreed with their relationship), and the sweep
alone made it pass.

After the commit it confirms with one read that `(:Meta).syncId` is this run's,
then **writes the computed stats to Postgres** (`replace_bev_graph_stats`; see
"Graph signals"), then prints a **read-back report** produced by Cypher against
the committed graph: the top-5 `SIMILAR_TO` neighbours of Coca-Cola Classic, Pepsi, a matcha
and Red Bull; one two-hop traversal `bev_edges` cannot express (Bevs that share
a `(:Flavor)` **and** a `(:Note)` with Coca-Cola Classic but have no direct
`SIMILAR_TO` to it); and a probe of the vector index. The index updates
asynchronously after a commit, so an empty answer is retried briefly and then
reported as a warning. The **analytics report** follows it (the modularity of
the partition, each taste family with its hub and its commonest flavour bases,
the most central Bevs, the bridges, the category purity).

So the graph only ever moves from one complete, verified generation to the
next. A reader never sees a half-written night, and the signals on a
generation are always the ones computed from that generation.

### The float-coercion rule

JSON has no int/float distinction and Neo4j does: the server reads `1` as an
Integer and `0.5` as a Float. An edge's `tree` term is very often exactly `1`
and an embedding component can be exactly `0`. So **every float-valued property
is written through `toFloat(…)`** (lists: `[x IN row.embedding | toFloat(x)]`)
**and every integer one through `toInteger(…)`**, the unit tests check that
every statement does, and the verification reads the stored types back.

Measured on the instance (5.27-aura, 2026-11-10), uncoerced: a scalar `1` is
stored as `INTEGER`, a list of whole numbers as `LIST<INTEGER>`, and a list
mixing the two is stored widened to `LIST<FLOAT>`. So this server does not
reject a mixed list; what goes wrong without the coercion is quieter — `s.tree`
an Integer on half the edges and a Float on the rest.

Two more things the first live dry run settled:

- `RETURN 'x' AS name, count(n) AS n` groups by the literal, and a grouped
  aggregation over zero matches returns **zero rows**, not a row saying 0. The
  verification statements therefore aggregate in a `WITH` with no grouping key
  first, or "no violations" would read as a check that never answered.
- The vector index does not see an uncommitted transaction, so a dry run's
  probe is always empty and says so.

And one the analytics work found (2026-11-11), which the sync is not exposed to
but anything written against this server should know:

- **A node whose properties were `SET` and which is then deleted in the same
  transaction is still returned by a seek on its uniqueness index.**
  `MATCH (b:Bev) WHERE b.id IN $ids` counted such nodes as present, and reading
  a property of one raised `EntityNotFound` (which ends the transaction). A
  label scan (`USING SCAN b:Bev`) does not see them, and a node that is only
  deleted, or created and deleted, behaves. The sync never does both to one
  node in one transaction: it stamps a node or sweeps it. It showed up in the
  two-generations-in-one-transaction test above, where A set five Bevs and B
  swept them. The verification's counts are label scans and were right
  throughout.

### Failure, and what stays in place

- **Any error rolls the transaction back** (best effort; an unreachable server
  expires it after about 30 seconds idle), so yesterday's complete generation
  stays.
- **Transient errors retry the whole sync**, in a fresh transaction, up to 3
  attempts with backoff: a network failure, HTTP 429 or 5xx, a
  `Neo.TransientError.*` code, an expired or unknown transaction. Nothing else
  is retried — a verification mismatch would fail the same way again.
- **After a final failure** it stamps `(:Meta).lastAttemptAt` and
  `lastAttemptOk = false` in a separate implicit transaction, best effort, and
  exits 1. A failing sync is therefore still activity as far as Aura's 72-hour
  auto-pause is concerned, and a stale `lastSyncAt` beside `lastAttemptOk =
  false` says what happened.
- **The graph committed and Postgres was not updated.** The two stores cannot
  commit together, so the order is: the graph commits, then
  `replace_bev_graph_stats` replaces `bev_graph_stats`. If that call fails (or
  answers a different row count), the run exits 1 and says exactly that:
  the graph committed generation `<syncId>`, `bev_graph_stats` was **not**
  updated and still holds the previous night's values. Those are complete and
  self-consistent, one generation behind the graph; nothing the app reads is
  broken; the next run repairs it (or re-dispatch the workflow). It is not
  retried as a sync, because the graph is right, and `(:Meta).lastAttemptOk`
  stays true, because the graph's attempt did succeed. The RPC validates the
  whole payload before deleting anything, so a refused call cannot leave the
  table half-written or empty.
- **An empty read is refused before a transaction is opened.** Zero active
  Bevs, zero categories or zero `bev_edges` rows is a broken read, not a state,
  and syncing it would sweep the graph away. Zero rankings is a real state and
  only warns.
- **A missing variable is a hard exit 1** naming every missing one. There is no
  skip path (see "The nightly workflow" under edges for why).

### `--dry-run` and `--fixture`

`--dry-run` does everything — the reads, the plan, the full transaction with
its analytics phase, the in-transaction verification, the `(:Meta)` stamp, both
reports (read through the transaction) — and then **rolls back instead of
committing**, says so, and confirms from outside the transaction that no node
carries its `syncId`. It stamps nothing on failure either, and it **never
writes `bev_graph_stats`**: the stats are computed, printed and discarded, and
the log says so.

`--fixture` swaps Postgres for `sync-fixture.ts` and forces `--dry-run`: the
378 catalog Bevs, 75 categories and 378 profiles from `data/catalog`,
deterministic 384-d embeddings (with components set to exactly `0` and `1`),
edges from the real `candidatePairs` / `weighPairs` / `selectEdges`, three
extra Bevs (two active user-created ones with no profile, embedding or brand,
and a hidden one that still has an edge and a ranking), and six synthetic users
on, inside and outside the ±0.25 band. It exists because neither CI nor a
laptop has a Postgres to read: it is the only way to push a full-sized graph
through the real Cypher on the real server. It has no Postgres to write to
either, so it never calls `replace_bev_graph_stats`, and it derives community
ids from the fixture's constant instead of `BEVI_PSEUDONYM_SALT`.

That run was first done on 2026-11-10 and passed end to end, rolled back: 380
Bevs, 75 categories, 145 brands, 23 flavours, 201 notes, 5 users; 3,931
`SIMILAR_TO`, 1,040 `HAS_NOTE`, 14 `RANKED`, 5 `LIKES`, 4 `DISLIKES`; all 23
verification checks equal to the plan. It was run again on 2026-11-11 with the
analytics phase, against the instance that by then held the production graph,
and passed all **32** checks, rolled back: 1,400 flavour and note memberships
read back, 7,042 projected pairs, 10 taste families and one Bev alone (sizes
56, 50, 46, 39, 38, 36, 33, 32, 29, 20 and 1), modularity 0.6518, category
purity 0.4684, 286 of 380 Bevs with a non-zero bridge score. Those are the
**fixture's** numbers, not prod's, but they are close: the families are
clustered on the catalog's flavour bases and names, which the fixture shares
with prod, and not on its synthetic embeddings (those only shape `SIMILAR_TO`,
hence centrality and the bridge scores).

### The nightly workflow

`.github/workflows/graph-sync.yml`, with three triggers:

- **`workflow_run` after `graph-edges` succeeds** — the one that gives the
  right order, since the graph mirrors `bev_edges`. GitHub delays this
  repository's schedules by hours, so cron order alone guarantees nothing.
- **`cron: "50 5 * * *"`**, independently — the one that keeps Aura awake,
  because the `workflow_run` trigger does not fire while `graph-edges` is
  failing.
- **`workflow_dispatch`** with a `dry_run` input.

Both of the first two can fire on one night; the concurrency group queues the
second and the sync is idempotent. The job runs a preflight that exits 1 naming
every missing one of its seven values, `npm ci`, `npm run test:scripts`,
`npm run graph:schema` (idempotent, so a new constraint exists before the first
sync that needs it) and then the sync.

**The log is public.** The job prints catalog names, Bev ids and counts. It
never prints a user id, a pseudonym, a community id, a secret, the Neo4j host
or its URL; for users it prints counts only, and the analytics report names
communities by their hub's catalog name, never by id. `neo4j.ts` redacts the credentials, the host and
any 64-hex run out of every server message before it can reach an error.

## Graph signals: centrality, communities, bridges (A-16 (4))

This is the graph earning its keep. Every night, inside the sync's one
transaction, the graph is **read back out of Neo4j** and three signals are
computed per Bev, stored on the graph's nodes, and written to Postgres.

| Signal | What it is | What it is for |
|---|---|---|
| **centrality** (`pagerank`) | Weighted PageRank over `SIMILAR_TO`, damping 0.85. Sums to 1 over the Bevs of one run | How representative a Bev is of its neighbourhood: many similar Bevs, heavily weighted, lead to it. A smoothed strength — it also rewards being similar to Bevs that are themselves central |
| **community** (`community`) | The Bev's **taste family**: its Louvain community (modularity clustering, resolution 1) in the **flavour projection** of the graph — Bevs joined through the flavour bases and notes they share. An **opaque id** | Families that cut across the category tree (citrus, berry, cola, coffee, …), for community-aware diversity and exploration in `recommend()` |
| **bridge** (`bridge`) | The participation coefficient, in [0, 1): the share of a Bev's `SIMILAR_TO` weight that goes to Bevs of **other** taste families, measured as 1 − Σ (share per family)² | A gateway from one family into another. **Not a rare flag:** see below |

`strength` (the sum of a Bev's `SIMILAR_TO` weights) and `degree` (how many it
has) are stored alongside, for diagnostics.

**Nothing predicts from them.** No prediction reads `bevGraph`. Since
`@bevi/ranking` 1.8.0 (#176) `recommend()` can read the families and the
bridge scores, behind two options that ship **off**, and nothing passes them
yet. So this work changes no prediction and no recommendation.

### Where the formulas live

In `@bevi/ranking`, `packages/ranking/src/network.ts`, paper §10.9
(`docs/bevi-ranking-math.tex`, "Graph signals"): `graphStrength`, `pageRank`,
`louvainCommunities`, `participationCoefficient`, `communityHubs`.
and, since 1.8.0, `attributeProjection`. `scripts/graph/analytics-core.ts`
calls those six and nothing else — a unit test reads its imports to hold that
down — and there is no SQL twin and no Cypher twin. The functions are deterministic in the *set* of nodes and edges,
so shuffled input gives identical rows.

### Why not GDS

Neo4j's Graph Data Science library has PageRank and Louvain built in, and the
instance even lists the `gds.*` procedures. They are stubs for paid "Aura Graph
Analytics" sessions, and calling one could start a billed session. They are
never called: no statement in `scripts/graph/` contains `gds.`, and a unit test
checks every statement. The graph is the **substrate** — the place the
relationships live and are read from — and the arithmetic is ours, which also
means it is the same arithmetic the package's golden vectors pin.

### Two graphs: similarity for centrality, the flavour projection for the families

`computeGraphStats({ nodes, similarity, partition, communityIdOf })` takes the
graph the communities are computed on as a **separate input** from the
similarity graph, and the sync passes two different graphs:

| | Computed from |
|---|---|
| `strength`, `degree` | `graphStrength(similarity)` — `SIMILAR_TO` |
| `pagerank` | `pageRank(similarity)` — `SIMILAR_TO` |
| `community` | `louvainCommunities(partition)` — the **flavour projection** |
| the hub | `communityHubs(partition, communityOf)` — the hub **over the projection** |
| `bridge` | `participationCoefficient(similarity, communityOf)`: a Bev's `SIMILAR_TO` weight, spread across the families |

**The partition is the flavour projection.** Inside the transaction the sync
reads each Bev's memberships back from the graph (`READ_BEV_ATTRIBUTES`, a
fixed, ordered statement):

- one `flavor:<name>` row per `(:Bev)-[:TASTES_OF]->(:Flavor)`, **except the
  catch-all base `other`** — it is not a flavour, it is where a Bev goes when
  no base fits, and joining Bevs through it would glue unrelated drinks into
  one family;
- one `note:<token>` row per `(:Bev)-[:HAS_NOTE]->(:Note)`.

Cypher only **extracts** the memberships. `attributeProjection` in
`@bevi/ranking` turns them into a weighted graph over the Bevs (Adamic–Adar:
each attribute two Bevs share adds 1 / ln(the number of Bevs carrying it), so
a rare shared attribute says a lot and a common one little), and Louvain over
that graph gives the families. A Bev that shares no counted attribute with any
other is a family of one; that is legal.

**Why not cluster `SIMILAR_TO` itself.** Because it only rediscovers the root
categories: every edge weight carries the category (the tree term and the
content term), so Louvain over it hands back the taxonomy we already have.
Both were measured on the committed production graph on 2026-11-11, read-only,
with nothing written (385 Bevs, 4,653 `SIMILAR_TO`):

| Partition graph | Communities | Modularity | Category purity |
|---|---|---|---|
| `SIMILAR_TO` | 10, plus one Bev with no edge (sizes 65, 53, 41, 41, 41, 40, 33, 30, 22, 18, 1). Six of the ten are one root category exactly | 0.8265 | **0.84** |
| the flavour projection (1,422 memberships → 7,306 projected pairs) | 10 families, plus one Bev alone (sizes 50, 49, 47, 46, 41, 36, 34, 32, 29, 20, 1) | 0.6478 | **0.47** |

The ten families read as citrus and lemon-lime; berry; tropical; tea; orange,
grape and apple; cola; coffee; root beer, ginger and cream; mineral and
herbal; and beer with wine. The one Bev alone is Yakult. **Category purity**
is Σ over communities of the size of its largest root-category group, divided
by the number of Bevs — 1 when every community sits inside one root category,
lower the more the families cut across the tree. The analytics report prints
it every night, with each family's hub and its three commonest flavour bases.

**What a family is made of, said plainly.** Mostly the **hand-labelled flavour
base** (`bev_flavor_profiles.base`), plus **words shared between names**. The
clustering merges 23 uneven labels into about ten broad families, and it
places the Bevs whose base is `other` or missing by their notes alone. It does
not discover taste from behaviour: no ranking and no embedding enters it. A
relabelled base moves a Bev to another family the next night.

**So a high bridge score is not rare, and that is by design.** `SIMILAR_TO`
follows categories and the families cut across them, so most of a typical
Bev's similar Bevs belong to other families. On the production graph the
bridge score is zero for only 52 of 385 Bevs, its median is 0.62 and its
maximum 0.83. Read it as a ranking among Bevs — which ones reach furthest
outside their own family — not as a flag that something unusual was found.
(Clustered on `SIMILAR_TO` instead, 129 Bevs scored 0 and the ten highest
scores all sat in one leftover community.)

### The community id is opaque

A community is named after its **hub**: the member with the greatest
within-community strength **in the flavour projection** (`communityHubs`; a
tie goes to the smallest id). That keeps a family's name stable from night to
night for as long as its hub stays its hub.

But the id reaches every client in the prediction snapshot, a hub can be an
**alcoholic** Bev (on the production graph the hub of the beer-and-wine family
is a wine, and in the fixture a hard seltzer is the hub of the berry family,
whose commonest category is energy drinks), and a catalog Bev's id can be
derived by anyone (it is a
uuid v5 of a public slug under a public namespace). So neither the hub's id
nor a plain hash of it may be the public id — an under-21 client could confirm
"my lemonade's community is led by that beer" by hashing the catalog. The id
is therefore

```
"c_" + hex(hmac_sha256(BEVI_PSEUDONYM_SALT, "community:" + hubBevId)).slice(0, 16)
```

(`communityIdentifier` in `sync.ts`). The key is the salt the sync already
requires, which exists only in Actions secrets; the `community:` prefix keeps
these apart from the user pseudonyms made with the same key. `--fixture` uses
the fixture's constant. **Clients compare community ids for equality and
nothing else.**

What holds that down: `computeGraphStats` refuses an id that is not `c_` + 16
hex, that is itself a Bev id or cut from the hub's own, or that two communities
share; the table's CHECK (`^c_[0-9a-f]{16}$`) means a uuid cannot be stored in
`community_id` at all; which Bev is the hub is **not stored in Postgres**; in
the graph it is only the `hub` flag on `[:IN_COMMUNITY]`, and `graph-query`'s
`bev` template returns the id, not the hub; and no log line prints a community
id — the report names a community by its hub's catalog name, and a unit test
checks that no `c_…` reaches the log. Rotating `BEVI_PSEUDONYM_SALT` renames
every community as well as every user.

### `bev_graph_stats`

`supabase/migrations/20261110000100_bev_graph_stats.sql`.

```sql
bev_graph_stats(bev_id         uuid primary key references bevs(id) on delete cascade,
                community_id   text not null check (community_id ~ '^c_[0-9a-f]{16}$'),
                community_size integer not null check (community_size >= 1),
                pagerank       double precision not null check (pagerank >= 0 and pagerank <= 1),
                strength       double precision not null check (strength >= 0),
                degree         integer not null check (degree >= 0),
                bridge         double precision not null check (bridge >= 0 and bridge < 1),
                version        text not null,              -- RANKING_VERSION at compute time
                computed_at    timestamptz not null default now())
  -- index on (community_id).
```

`double precision`, not `numeric`, on purpose: these are derived floats, not
money, and a `numeric` can reach a client as a JSON string.

**RLS** is on, with one policy: `select` for `authenticated`, and **no**
insert/update/delete policy — the sync writes as the service role. The
predicate is `bev_embeddings_select`'s, for the same reasons ("The Postgres
half", above): a **positive** `exists` over the Bev, requiring
`status = 'active'` and (the category is not alcoholic or `viewer_is_adult()`).
A hidden Bev's row survives in the table until the next nightly run, so the
status half is what stops a plain `GET /rest/v1/bev_graph_stats` from serving
it meanwhile.

**The writer** is `replace_bev_graph_stats(p_rows jsonb, p_version text)`,
service role only, modelled on `replace_bev_edges`: one call is one
transaction, it validates the **whole** payload before deleting anything, it
uses `delete … where true` (pg_safeupdate) and `insert` rather than `truncate`,
and it returns the row count, which the job compares with what it sent. It
refuses, as `BEVI_VALIDATION` with a `detail`: a blank version; a payload that
is not an array; an **empty** array (an empty result is a broken run); a null
column; a value out of range; a `community_id` of the wrong shape; a duplicate
`bev_id`; an unknown Bev id; a `community_size` that disagrees with the number
of rows carrying that `community_id`; and PageRanks that do not sum to 1 within
1e-6. The last two are what make a payload a *generation* rather than a set of
rows: they can only hold for the complete output of one run.

### The `bevGraph` snapshot key

The same migration revises `get_prediction_snapshot()` — the latest definition
(`20261101000100`) byte-for-byte, with one added key:

```
bevGraph: [[bev_id, community_id, pagerank, bridge], …]
```

`community_id` is the Bev's taste family. One tuple per row whose Bev is in the function's own `visible` gate, so a
hidden Bev's row never appears and, for an under-21 viewer, neither does an
alcoholic Bev's. Ordered by `bev_id`. `[]`, never null. `pagerank` is rounded
to 8 decimals and `bridge` to 4 on the way out, to keep about 385 tuples per
snapshot small; the table keeps the full doubles. So the rounded PageRanks of
one payload need not sum to exactly 1, and an under-21 viewer's never do. No
`version` filter, as for `edges` and `userNeighbors`.

`packages/api/src/snapshot.ts` maps it onto `snapshot.bevGraph = { [bevId]: {
community, pagerank, bridge } }`, only when the key is present (`[]` maps to
`{}`). No `shared/` change and no `BeviApi` change: the snapshot is internal
to `packages/api`.

### The failure mode: graph committed, Postgres not updated

The graph and Postgres cannot commit together. The sync commits the graph
first and writes `bev_graph_stats` second, and says plainly when the second
step fails — "Failure, and what stays in place", above. Until the next run the
graph is one generation ahead of the table; both are complete and
self-consistent. A Bev created since the last successful write simply has no
row and no `bevGraph` tuple, which the package reads as "no signal".

## How edges are computed — and `bev_edges` is filled without Neo4j

**`bev_edges` is filled from Postgres alone.** `scripts/graph/build-edges.ts`
(`npm run graph:edges`) reads Postgres, weighs pairs with `@bevi/ranking` and
writes Postgres. It never opens a connection to Aura and reads no `NEO4J_*`
variable. The graph's `(:Bev)-[:SIMILAR_TO]-(:Bev)` is a **mirror of this
table**, written afterwards by `graph-sync` (A-16's steps 6, 8 and 9: the
Cypher `MERGE`, the `RANKED` edges and the `(:Meta)` stamp — "The sync",
above). So a paused, deleted or never-reachable instance costs the app nothing:
the similarity data is rebuilt regardless. That is "the one rule" above, taken to
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
and Cypher aggregation buy nothing **for this table** at this size (the graph
has them since `graph-sync`, as a mirror, and `user_neighbors` does not read
them): `scripts/graph/build-neighbours.ts`
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

**Stage 4 is built, and off by default.** The RPC half is
`20261101000100`: `get_prediction_snapshot` now emits the viewer's rows as the
key `userNeighbors: [[alias, sim, common], …]`, joined to the same alias CTE as
`users` and `rankings` (a neighbour with no rankings drops out; no uuid leaves
the function), `sim desc`, with no `version` filter, and `[]` rather than null.
`packages/api/src/snapshot.ts` maps it onto the package field
`snapshot.userNeighbours` whenever the key is present. The package half is #144:
`layer2()` reads that field only under `userSimilarity: 'stored'`
(`RANKING_VERSION` 1.6.0), weighting a listed neighbour by
sim_B · min(1, n_v / 15) and falling back to today's in-snapshot cosine when the
field is absent or the user has no rows — exactly the doc's "3 or more
rankings, not yet synced" tier. The same migration carries S-21's `edges` (every
`bev_edges` row touching the viewer's ranked Bevs, both ends visible) for
`bevSimilarity: 'edges'` (#137). Nobody passes either option yet: switching them
on waits for a real export with enough co-raters to evaluate them (NEXT-MATT.md),
since today's volume gives few rows or none.

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
| `NEO4J_URI` | Supabase secrets, Actions secrets, `supabase/.env` | `graph-query`, `graph:schema`, `graph:keepalive`, **`graph-sync.yml` / `npm run graph:sync`** |
| `NEO4J_USERNAME` | same | same |
| `NEO4J_PASSWORD` | same | same |
| `NEO4J_DATABASE` | same; `graph:schema`, `graph:keepalive` and `graph-query` default it to `neo4j`, which is wrong for our instance, so it is always set. **The sync has no default and refuses to start without it** | same |
| `BEVI_PSEUDONYM_SALT` | **Actions secret only** — set 2026-11-10 | **`graph-sync.yml` / `npm run graph:sync`**: the HMAC-SHA256 key behind `(:User {pseudonym})` **and behind every community id** (`c_…` in the graph, in `bev_graph_stats` and in the snapshot's `bevGraph`). At least 16 characters, or the sync refuses to start. **Set once and kept:** a new salt renames every user, so every `(:User)` is swept and recreated, and renames every community. Never in an Edge Function, never anywhere `packages/api` or `app/` can reach. `--fixture` does not read it (it uses a constant for both) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Actions secret** — set 2026-10-24; `supabase/.env` locally | **`graph-edges.yml` / `npm run graph:edges`** and **`graph-neighbours.yml` / `npm run graph:neighbours`**, to read Postgres past RLS and call the service-role RPCs; **`graph-sync.yml` / `npm run graph:sync`**, to read the six tables it mirrors and to call `replace_bev_graph_stats` after the commit |
| `SUPABASE_URL` | injected into Edge Functions; an Actions **variable** (`vars`) for the three graph workflows; `supabase/.env` locally. Not a secret | same |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` | Actions secrets (already used by `backend.yml`) | deploying the function and pushing migrations |

No `NEO4J_*` value may ever reach `app/` or `packages/api`. The browser gets
the publishable key and nothing else. Aura shows the password exactly once, at
instance creation — save the credentials file outside the repo.

The live instance is `bevi-graph-db`, created 2026-10-24 in the Aura project
`c03f2541-d8b6-4cf4-8383-a0d3d8be8c04`. Its credentials file sets
`NEO4J_USERNAME` and `NEO4J_DATABASE` to the instance id rather than to
`neo4j`, so both must be read from that file and neither may be assumed. The
schema in `scripts/graph/schema.cypher` is applied (all eleven statements: the
`note_token_unique` constraint since 2026-11-10, `community_id_unique` since
2026-11-11 UTC), and `(:Meta).lastKeepAliveAt`
was written by hand the day the instance was created. Because the instance id
is the host, the username and the database at once, **none of the three may
appear in a log**: `neo4j.ts` never prints the URL and redacts all of them from
server messages, `apply-schema.ts` no longer prints the URL either (it runs in
`graph-sync.yml`, whose log is public), and `postgrest.ts` blanks anything
shaped like a uuid or a pseudonym in a PostgREST error body. The id itself is
not a credential, but it was committed as a test fixture in
`scripts/graph/apply-schema.test.ts` from #121 until this change replaced it
with a made-up one, so treat it as public and rely on the password alone.

## Access paths

**`graph-query` Edge Function** — `supabase/functions/graph-query/`. JWT
verified. The client names one of a fixed set of templates and passes values
that are bound as Cypher parameters. There is no path by which caller input
becomes Cypher text, and no free-form query is accepted. If you add a template,
keep that property.

| Template | Takes | Returns |
|---|---|---|
| `similar` | `bevId`, `limit` (1–50) | the nearest Bevs by `SIMILAR_TO` weight, with all five terms (`tree`, `content`, `emb`, `profile`, `cop`) |
| `bev` | `bevId` | the Bev's own node: `categoryId` (the root, from the property — `IN_CATEGORY` targets the leaf), `leafCategoryId`, `brandKey`, and the graph signals `pagerank`, `community` (the opaque id) and `bridge` — null until a sync with the analytics phase has committed |
| `why` | `bevId`, `otherId` | the attribute nodes the two Bevs **share** — `kind` (`Brand`, `Flavor`, `Note`, `Category`) and `value` — plus the direct `SIMILAR_TO` `weight` when the pair has an edge. A visible pair that shares nothing is one row with a null `kind` |
| `meta` | — | `lastSyncAt`, `lastKeepAliveAt` |

Both ids of `why` are uuid-validated before anything is sent upstream.

**Age gate.** Postgres hides alcoholic Bevs from anyone not verified 21+
(`bevs` RLS, `viewer_is_adult()`). `graph-query` runs as no user and any
holder of the publishable key passes `verify_jwt`, so it fails closed: every
template filters on `coalesce(isAlcoholic, true) = false` — `why` on **both**
Bevs, so an alcoholic or unknown Bev on either side returns no rows at all.
Any new template must do the same, or check `viewer_is_adult()` with the
caller's JWT first.

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
  current volume — see "Taste neighbours". Both tables reach the client through
  the prediction snapshot since `20261101000100` (S-21 + Stage 4), and both
  package modes that read them ship off.
- **The Neo4j side of A-16 — steps 6, 8 and 9 — is built and has run**
  (#174, merged 2026-11-11 UTC): `scripts/graph/sync.ts` and `graph-sync.yml`,
  described under "The sync". A `dry_run` dispatch and then a real dispatch
  both succeeded; Actions run 42946278280 committed at 02:29 UTC with 385
  Bevs, 75 categories, 148 brands, 23 flavours, 203 notes and 4 users; 4,653
  `SIMILAR_TO`, 42 `RANKED`, 21 `LIKES` and 13 `DISLIKES`. The vector index
  answered and Coke–Pepsi read back as 0.9001.
- **So the instance holds the production graph**, and `graph-query`'s
  `similar`, `bev` and `why` templates have data to return.
- **The graph signals are built (A-16 (4), `be/graph-stats`), and only partly
  run.** What **has** run, on 2026-11-11 against the live instance: the one new
  constraint (`community_id_unique`, applied); `npm run graph:sync --
  --fixture`, i.e. every upsert, the analytics phase with the flavour
  projection, both sweeps and all 32 verification checks on the catalog
  fixture, **rolled back**; and the generation-A-then-B check of the community
  sweep, also rolled back. What has
  **not** run anywhere: **any of the SQL** (`20261110000100` and pgTAP 30 —
  there is no Docker or psql on the machine it was built on, so CI's `db` job
  on the PR is the first execution); the **Postgres write-back**
  (`replace_bev_graph_stats` through PostgREST); the analytics phase's
  **commit path** (the committed graph still has no `(:Community)` and no
  computed property; the real catalog's numbers quoted under "Graph signals"
  were computed read-only and written nowhere); and `deno check` on
  `graph-query` (no Deno there either). The first real run is the first
  `graph-sync` after the merge — and **`20261110000100` must be on prod before
  that merge**, or the nightly run calls an RPC that does not exist (the graph
  would still commit; the run would be red every night).
- **A taste family is only as good as the flavour labels.** It is driven
  mostly by the hand-labelled base plus shared words in names ("Graph
  signals", above); the Bevs with base `other` and the user-created ones with
  no profile are placed by their notes alone, or not at all.
- **Nothing passes the options that read `bevGraph` yet.** `recommend()` can
  read the families and bridges since 1.8.0 (#176), behind two options that
  ship off.
- `graph-keepalive.yml` and `keepalive.ts` are still there on purpose, until
  the sync has run green for a week.
- `graph-query`'s Deno tests cover input handling only and skip without a
  served function; the `why` template's Cypher was checked by hand against the
  fixture inside a rolled-back transaction on 2026-11-10.
- `Bev.vessel` arrives with A-07.
- `categories.parent_id` **landed with A-13**: Postgres holds 15 roots and 60
  leaves (D-04), `build-edges.ts` measures the tree term at each Bev's leaf
  while the content term keeps the root, and the sync mirrors that shape —
  `[:CHILD_OF]` from each leaf, `[:IN_CATEGORY]` to the leaf.
