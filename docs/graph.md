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

Neo4j cannot express "at most one `SIMILAR_TO` per unordered pair", so the sync
enforces it by convention: it only ever writes the direction where
`src.id < dst.id`, and every read traverses undirected. The vector index on
`Bev.embedding` (384 dimensions, cosine) is created now and stays empty until
A-16 populates embeddings; an empty vector index is valid and costs nothing.

## The sync contract (A-16, not yet built)

The nightly GitHub Actions workflow must, in order: read active Bevs,
categories, flavour profiles and pseudonymised rankings from Postgres; embed
new or changed Bevs; build candidate pairs from the same category subtree, the
same brand and the 50 nearest by embedding; weight each pair with
`edgeWeight()` from `@bevi/ranking`; keep the top 20 per Bev with `w ≥ 0.3`;
`MERGE` nodes and edges in batched `UNWIND`s and delete edges that dropped
out; write `bev_edges` back in one transaction; mirror `RANKED` edges; touch
`(:Meta).lastSyncAt`; print the sanity report.

**The sanity report is the acceptance test.** Every run prints it, and these
two lines are what a human checks:

- Coca-Cola ↔ Pepsi ≥ 0.8
- Coca-Cola ↔ a sparkling water < 0.4

If either fails, the weights are wrong and the run should be treated as
suspect even though it succeeded.

Failure is loud and safe: the job fails, Actions emails, `bev_edges` keeps
yesterday's values, and the app does not notice.

## Secrets

Names only. Values live in `supabase/.env` (gitignored) locally,
`supabase secrets set` in the hosted project, and GitHub Actions secrets in CI.
See `supabase/.env.example`.

| Name | Where | Used by |
|---|---|---|
| `NEO4J_URI` | Supabase secrets, Actions secrets, `supabase/.env` | `graph-query`, `graph:schema`, the sync |
| `NEO4J_USERNAME` | same | same |
| `NEO4J_PASSWORD` | same | same |
| `NEO4J_DATABASE` | same, optional (`neo4j` is the default) | same |
| `BEVI_PSEUDONYM_SALT` | **Actions secrets only** | the sync, for `(:User {pseudonym})` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Actions secrets only** | the sync, to read Postgres |
| `SUPABASE_URL` | injected into Edge Functions; set explicitly in Actions | the sync |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` | Actions secrets (already used by `backend.yml`) | deploying the function and pushing migrations |

No `NEO4J_*` value may ever reach `app/` or `packages/api`. The browser gets
the publishable key and nothing else. Aura shows the password exactly once, at
instance creation — save the credentials file outside the repo.

## Access paths

**`graph-query` Edge Function** — `supabase/functions/graph-query/`. JWT
verified. The client names one of a fixed set of templates (`similar`, `bev`,
`meta`) and passes values that are bound as Cypher parameters. There is no
path by which caller input becomes Cypher text, and no free-form query is
accepted. If you add a template, keep that property.

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

- `Bev.embedding`, `bev_embeddings` and the `vector` extension do not exist
  yet; they arrive with A-16.
- `Bev.vessel` arrives with A-07; the flavour properties (`base`,
  `carbonated`, `caffeine`, `sweetness`, `dairy`, `alcohol`) with A-17.
- `categories.parent_id`, and therefore `[:CHILD_OF]`, arrive with A-13 (D-04
  has to settle the taxonomy first). Until then every `(:Category)` is a root.
- So a fresh instance after A-15 alone has the constraints and indexes and no
  nodes. `graph-query`'s `similar` template correctly returns zero rows.
