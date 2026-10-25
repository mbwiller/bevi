# Next up: Arjun

Your queue from 2026-10-19 on, centred on Supabase and Neo4j. Matt's is in [`NEXT-MATT.md`](NEXT-MATT.md). The live status of every task is the board at the top of [`TASKS.md`](TASKS.md). Update your row there in the same PR whenever you start or finish something.

**Your lane:** `supabase/`, `packages/api/`, `data/catalog/`, `scripts/` (catalog and graph). Branches are `be/*`. Your combined PRs also carry the `shared/` contract and the FakeApi (Matt reviews that part).

## Start now: nothing blocks these

| Order | Task | What "done" means | Unblocks |
|---|---|---|---|
| 0 | **Neo4j instance** — **done 2026-10-24** | Instance `bevi-graph-db`. The four `NEO4J_*` secrets are set in GitHub Actions and in the Supabase project, the Cypher schema is applied (9/9) and `(:Meta).lastKeepAliveAt` is written. Two things are worth knowing: Aura's credentials file sets the username **and** the database to the instance id, not `neo4j`, so both come from that file; and `queryApiUrl()`'s scheme regex never matched `neo4j+s://`, so every graph call failed `fetch failed` regardless of the secrets. Both are in this PR. Dispatch `graph-keepalive` after it merges and check the log says `(:Meta).lastKeepAliveAt updated`. `graph-query` is still undeployed | Everything on the graph |
| 1 | **A-14 · #107** (already open, CI green) | Push `20261019000200_leaderboard_parity.sql` to prod (dry-run first), then merge | Matt's M-22 cross-check |
| 2 | **M-26 export** (about 15 min) | Run `packages/ranking/eval/export.sql` against prod as a role that bypasses RLS: `psql "$DATABASE_URL" -At -v salt="$SALT" -f packages/ranking/eval/export.sql > export.json`. Hand Matt the file privately. **It never goes in the repo** | Real baseline numbers for Matt's M-27, and for judging the graph |
| 3 | **S-04 + A-04 · Explore backend** — **done in #113**, `20261019000400` on prod, contract `2.6.0`. The security review found that using `p_before` as both the paging cut and the decay clock leaked exact like counts (a non-linear decay means sweeping the clock reveals the ratio); the clock is now server-side `now()`. Also gated non-active Bevs and bounded `p_offset` | — | **Matt's M-04, now unblocked** |
| 4 | **A-16 (1) + S-14 part 2 · The Bev graph** — **built and merged**, #115 + #117 + #118, all migrations on prod | Neo4j turned out not to be needed: step 3 allows pgvector for candidates, step 4 is pure TypeScript and step 7 writes Postgres, so only steps 6, 8 and 9 (the Cypher `MERGE`, the `RANKED` mirror, `(:Meta)`) still want the instance. `embed` is deployed with `--no-verify-jwt` and its secret is set. **Left to do, all operator steps:** run `npm run graph:backfill-embeddings` (needs `SUPABASE_SERVICE_ROLE_KEY`), set `bevi.embed_function_url` and `bevi.embed_webhook_token` on the database, add the `SUPABASE_SERVICE_ROLE_KEY` Actions secret and the `SUPABASE_URL` variable, then `npm run graph:edges -- --dry-run` and read the real Coke–Pepsi number before trusting the >= 0.8 bar | **Matt's M-27 and M-21** |

Items 3 and 4 each unblock Matt, so do 3 first: it's smaller and P0.

### A-16 (1), the Bev graph, in detail

The decision (2026-10-19): Neo4j holds Bevs, categories, brands and flavours as nodes, joined by weighted `SIMILAR_TO` edges. Postgres stays the system of record, and the app reads a `bev_edges` mirror, so Neo4j is never on a request path. The full spec is TASKS.md A-16, steps 1–7 and 9–10.

**Status 2026-10-23:** items 2 and 4 are built **without Neo4j** on `be/graph-edges` — `scripts/graph/build-edges.ts` (steps 1, 3, 4, 5, 7, 10), `graph-edges.yml` (nightly, **needs a new `SUPABASE_SERVICE_ROLE_KEY` Actions secret and a `SUPABASE_URL` variable, or it fails red on purpose**), D-11 in `20261023000200`, the service-role RPCs in `20261023000300`, pgTAP `13`/`14`; nothing has been executed against a database, `bev_embeddings` is still empty so every `emb` term is 0, and the sanity thresholds are printed rather than enforced until a real run measures the `gte-small` cosine (M-24's 0.88 caveat; `--strict` opts in). Items 0, 1 and 3's Cypher half are still open.
0. ~~**The instance must be alive first:** that's item 0 above.~~ — **done 2026-10-24**, see item 0.
1. **Embeddings:** an `embed` Edge Function (`gte-small`, free in Supabase), a `bev_embeddings` table (pgvector, 384 dimensions), and the vector on each node.
   - **Built on `be/embed-pipeline`** and it needs no Neo4j, so it can ship before item 0: `supabase/functions/embed/`, the async pg_net trigger `20261023000100_embed_webhook.sql`, `npm run graph:backfill-embeddings` and pgTAP `12_embed_webhook`. **To deploy:** `supabase functions deploy embed`, optionally `supabase secrets set EMBED_WEBHOOK_SECRET=…`, then `alter database postgres set bevi.embed_function_url = '…/functions/v1/embed'` and `bevi.embed_webhook_token = '…'` (missing ⇒ the trigger no-ops), then run the backfill. Only the vector on the node is left for the sync.
2. **Edges:** candidates are the same category ∪ the same brand ∪ the 50 nearest by embedding. Weight each pair with `edgeWeight()` from `@bevi/ranking` (Matt's M-24; don't reimplement it), keep the top 20 per Bev with `w ≥ 0.3`, `MERGE` them into Neo4j, and write `bev_edges` back to Postgres in one transaction.
3. **When it updates:**
   - **A new or edited Bev** gets its edges right away, through an async database webhook to an Edge Function. That keeps a ranking or a create from ever waiting on Neo4j.
   - **A nightly full rebuild** runs in `graph-sync.yml` and prints the sanity report: Coke–Pepsi ≥ 0.8, Coke vs a sparkling water < 0.4. It doubles as the keep-alive: once it's green for a week, delete `graph-keepalive.yml`.
   - Check that the Edge Function can import `@bevi/ranking` (it's pure TypeScript with no dependencies). If bundling fights you, have the webhook mark the Bev "dirty" and let a frequent scheduled job pick it up.
4. **D-11 inference**, in the same on-create path:
   - A Bev with no flavour profile copies the profile of its nearest **seeded** Bev in the **same category**, by embedding cosine, with brand as the tie-break.
   - Store `inferred = true`, `inferred_from` and the similarity.
   - Below a cosine of 0.6, leave it empty.
5. ~~**S-14 part 2**, the contract, version `2.7.0`: `bevs.similarities(bevId, otherIds)`, `bevs.similar(bevId, n)` and `rankings.listBucketBevs(bucket)`, all reading `bev_edges`. Plus `packages/api`, FakeApi~~ — **done in half 1**, with pgTAP and `packages/api` unit tests. Live tests wait for half 2, since they need a non-empty `bev_edges`.
6. ~~**Docs:** update `docs/graph.md`, and `docs/graph_db_implementation.md`, whose user-neighbour MVP moves to increment 2.~~ — **done in half 1.**

## Then: these wait on Matt

| Task | Waits on (Matt) | What you build |
|---|---|---|
| **A-13 · Category hierarchy** | **D-04**: Matt's tree **plus the 378-Bev leaf assignment** | `categories.parent_id` (and depth) in Postgres, `CHILD_OF` in Neo4j, `Category.parentId` in the contract. The age gate walks up to the alcoholic ancestor (`category_is_alcoholic(id)`). Reassign the catalog Bevs to their leaves through `data/catalog`. Re-run the sync so the tree term uses the hierarchy |
| **A-14 follow-ups** | M-22's list of SQL corrections, if any | Small SQL fixes, with pgTAP |
| **A-16 (2) · The taste graph** | **M-28**: Matt's taste formulas in `packages/ranking/src/graph.ts` | `RANKED` edges with stable HMAC pseudonyms, **updated on every ranking** (async webhook) plus the nightly re-check. Taste neighbours in `user_neighbors` (RLS: owner-only select) and the co-rating `cop` term. Measured against #87's decision bar with Matt's M-26 harness |

## Later: P2, after P0 and P1

| Task | Unblocks | Note |
|---|---|---|
| **S-10 + A-08 · Venues**, one combined PR | Matt's M-16 (the map) | Start with the **Upper East Side and Roosevelt Island** (D-13), keeping the CHECK at the full NYC bounds. Trimmed contract: `venues.inView`, `venues.get`. No `rankings.venue_id`. You also provide the Google Maps key (D-12) |
| **S-13 + A-12 · Duplicates**, one combined PR | Matt's M-20 | The approved plan in TASKS.md S-13: `duplicateOfId` on reports (the database column already exists), an admin-only `merge_bev(src, dst)` run from Supabase Studio, and a Studio view of pending reports. Never merge automatically |

## What you owe Matt, and what he owes you

| You hand Matt | So he can |
|---|---|
| The M-26 export file (privately) | Measure today's engine and judge M-27 |
| S-04 + A-04, on prod | Build M-04 (the Explore screen) |
| A-16 (1) + S-14 part 2, on prod | Build M-27, then M-21 |
| A-13 (`Category.parentId`) | Build M-21 |
| S-10 + A-08 and the Maps key; S-13 + A-12 | Build M-16; build M-20 |
| A heads-up before any migration that changes what an existing function returns | Keep the app and the FakeApi in step |

| Matt hands you | So you can |
|---|---|
| D-04's tree plus the leaf assignment | Build A-13 |
| M-22's SQL corrections | Do the A-14 follow-ups |
| M-28's taste formulas | Build A-16 (2) |
| Reviews of your FakeApi / conformance hunks | Merge your combined PRs |
| Advance warning of any `@bevi/ranking` change (`RANKING_VERSION`) | Re-run the sync with the new weights |

## The shared map (identical in both plans)

```
Matt                                   Arjun
M-19 Taste Profile ──── ready
D-04 taxonomy + 378 assignments ─────▶ A-13 hierarchy ─────────────┐
M-22 maths review ───(SQL fixes)─────▶ A-14 follow-ups (#107 first) │
                                       M-26 export ──(file)──▶ Matt │
M-04 Explore UI ◀──────────────────── S-04 + A-04 Explore backend   │
M-27 graph in recs ◀───────────────── A-16 (1) Bev graph + S-14 (2) │
M-21 placement ◀────────────────────── A-16 (1) + A-13 ◀────────────┘
M-28 taste formulas ─────────────────▶ A-16 (2) taste graph
M-16 map UI ◀───────────────────────── S-10 + A-08 venues (P2)
M-20 duplicate step ◀───────────────── S-13 + A-12 duplicates (P2)
```

## Files we both touch: where conflicts happen

| Surface | Who edits it | Rule |
|---|---|---|
| `shared/src/` (the contract) and `CONTRACT_VERSION` | Mostly your combined PRs | One combined PR per feature (contract + migration + `packages/api` + FakeApi). Bump the minor version, currently `2.5.0` (Matt's avatars, #110): Explore takes `2.6.0`, S-14 part 2 takes `2.7.0`. Whoever merges second rebases and takes the next number |
| `app/src/testing/fakeApi/*`, `conformance.ts` | You (in your combined PRs) and Matt | Every new API method needs a FakeApi version, or the app's typecheck fails. Write it to match your SQL, and Matt reviews it |
| `packages/ranking/` | Matt | Your sync job and Edge Function import `edgeWeight` / `topEdges` from it; never copy the formulas. A `RANKING_VERSION` bump means re-running the sync |
| `supabase/migrations/` | You | Timestamped and append-only, so keep your next timestamps after `20261019000200`. App code that calls a new function merges **only after its migration is on prod**. Push in timestamp order |
| `TASKS.md` and `NEXT-*.md` | Both | Small PRs; rebase if they collide. The board at the top is the source of truth |
| `.github/workflows/` | You (`graph-sync.yml`, `backend.yml`), Matt (`app.yml`) | Don't edit the other's workflow without a heads-up |
| `docs/graph*.md` and `docs/bevi-ranking-math.tex` | You own the graph docs, Matt owns the paper | A change to one that affects the other gets a line in the PR's "Heads-up" section |

## Working rules (both of us)

- **Every merge to `main` deploys to production** (bevi-gamma.vercel.app). Merge when CI is green and the review has nothing blocking.
- **Migrations reach prod by hand.** Either of us can now run `npx supabase db push`: dry-run first, in timestamp order. Do it before merging any app code that calls the new function.
- **No local Docker:** pgTAP and the live API tests run only in CI's `db` job. A "rate limit exceeded" from `supabase/setup-cli` is a flake: re-run the job.
- **Lane reviews:** the `integrator` agent reviews `supabase/`, `packages/api/` and `shared/`; `integrator-app` reviews `app/`, `packages/ranking/` and `design/`. A combined PR gets both.
- **P0 and P1 before P2** (TASKS.md §0).

## Joint housekeeping (any time, both agree)

- Turn on `deploy-dev` (automatic migrations on merge), or keep pushing by hand.
- Drop `backup.feed_events_20261014`.
- Update `DEVELOPMENT-MATT.md` §5, §6.8 and §6.16 (they still describe Add Bev and the Bevs · People tabs).
