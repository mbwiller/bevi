# Next up: Arjun

Your queue, updated 2026-10-31, centred on Supabase and Neo4j. Matt's is in [`NEXT-MATT.md`](NEXT-MATT.md). The live status of every task is the board at the top of [`TASKS.md`](TASKS.md). Update your row there in the same PR whenever you start or finish something.

**Your lane:** `supabase/`, `packages/api/`, `data/catalog/`, `scripts/` (catalog and graph). Branches are `be/*`. Your combined PRs also carry the `shared/` contract and the FakeApi (Matt reviews that part).

## Start now (2026-10-31)

**Prod migrations:**
- [x] Confirmed 2026-10-31: all four are on prod.

| Order | Task | What "done" means | Unblocks |
|---|---|---|---|
| 1 | ~~**Approve #137**~~ — **merged 2026-10-31 from Matt's side**, with #138 (1.5.0) and #144 (1.6.0), under the rule that a PR flagged for you only because it regenerates `shared/fixtures` merges once every pre-existing case is byte-identical (checked, 706 cases) and the `db` job is green | Your review of the fixture hunks is welcome after the fact. `edgeWeight` is unchanged in all three, so the next nightly `graph:edges` only re-stamps `bev_edges`; the `cop` term and `user_neighbors` are untouched | — |
| 2 | **A-14 follow-ups** | M-22's SQL list (TASKS.md M-22 item 3), still unbuilt. **Two are wrong on prod:** the streak history rewritten by re-ranks and removals, and `bayes_score` stale at `rating_count = 0`. #137 adds vector targets: the `bayesScoreStored` cases (pgTAP, item 7) and the event-streak cases (the `touch_streak` fix, item 1) | Correct streaks and scores |
| 3 | **S-21 + Stage 4**, one combined PR | **The contract is fixed on the package side** (#144's "Heads-up for Arjun" has the full text). One revision of `get_prediction_snapshot`: **`edges`** = `[[src, dst, w], …]` for every `bev_edges` row touching the caller's ranked Bevs, visible Bevs only, `[]` never null; **`userNeighbors`** = `[[alias, sim, common], …]` from `user_neighbors where user_id = viewer`, joined to the same alias CTE as `users` and `rankings`, `order by sim desc, neighbor_id`, `[]` never null, **no `version` filter** (sim_B is unchanged since 1.3.0; filtering would empty stored mode after every bump). `toViewerSnapshot` maps `edges` to `{ a, b, w: num(w) }` and `userNeighbors` to `snapshot.userNeighbours = { [viewer.id]: rows.map(([userId, sim, common]) => ({ userId, sim: num(sim), common })) }`, each **whenever its key is present, even as `[]`**. A neighbour counts only if their rankings are in `rankings`, so if the RPC ever trims rankings or users, keep the viewer's neighbours. pgTAP for both keys. Also two doc lines: `docs/graph_db_implementation.md` §5 names the field `userNeighbors` with tuples and says "replace the cosine with Pearson" / "new constants" (as built: `userNeighbours` with objects, cosine fallback, Pearson its own option, no new constant), and the comment in `20261026000300` says `snapshot.userNeighbors` | Switching on M-27 (a)'s edges mode and stored neighbours in Layer 2 |
| 4 | **`categories_depth_guard` follow-up** | Moving a leafless root (`water`, `sports`) under another root makes its Bevs' `category_id` a leaf. Reject that move. Service-role only, so the app can't reach it | — |
| 5 | **First `graph-neighbours` run** | A `workflow_dispatch` dry-run. Expect few rows or none at today's volume | Stage 4's data |
| 6 | **The Neo4j mirror** (optional) | A-16 steps 6, 8 and 9. Nothing the app reads depends on it | — |
| 7 | **`app.yml` path filter** (optional, joint) | Add `design/beverage-icons/manifest.json` to the `app` workflow's paths, so an icon batch that forgets `node scripts/icons/export-app.mjs` fails its own PR's drift test (`app/src/lib/__tests__/bevIcons.test.ts`) rather than the next app PR. `.github/` is joint, so it needs both of us | — |

## Done since 2026-10-19

| Order | Task | What "done" means | Unblocks |
|---|---|---|---|
| 0 | **Neo4j instance** — **done 2026-10-24** | Instance `bevi-graph-db`. The four `NEO4J_*` secrets are set in GitHub Actions and in the Supabase project, the Cypher schema is applied (9/9) and `(:Meta).lastKeepAliveAt` is written. Two things are worth knowing: Aura's credentials file sets the username **and** the database to the instance id, not `neo4j`, so both come from that file; and `queryApiUrl()`'s scheme regex never matched `neo4j+s://`, so every graph call failed `fetch failed` regardless of the secrets. Both are in this PR. Dispatch `graph-keepalive` after it merges and check the log says `(:Meta).lastKeepAliveAt updated`. `graph-query` is still undeployed | Everything on the graph |
| 1 | **A-14** — **done in #112** (#107 closed as superseded) | `20261019000200_leaderboard_parity.sql` is on prod | Matt's M-22 cross-check |
| 2 | **M-26 export** — **done 2026-10-25** | Ran via `supabase db query --linked` (no DB password needed — the CLI's cached credentials suffice, which is worth remembering). Export and harness report live outside the repo at `~/bevi-m26-export.json` and `~/bevi-m26-report.txt`; the salt is `BEVI_EVAL_SALT` in `supabase/.env`, keep it if you want aliases stable across exports. **The numbers are not a baseline:** 3 users, 27 rankings, 31 comparisons; engine concordance 0.703 [0.500, 0.875] (CI includes chance), `category-mean` ahead by +0.064, Pearson identical. Hand the file to Matt and tell him M-27's comparison DoD is not satisfiable on this data | Real baseline numbers — **not yet achievable** |
| 3 | **S-04 + A-04 · Explore backend** — **done in #113**, `20261019000400` on prod, contract `2.6.0`. The security review found that using `p_before` as both the paging cut and the decay clock leaked exact like counts (a non-linear decay means sweeping the clock reveals the ratio); the clock is now server-side `now()`. Also gated non-active Bevs and bounded `p_offset` | — | **Matt's M-04, now unblocked** |
| 4 | **A-16 (1) + S-14 part 2 · The Bev graph** — **built and merged**, #115 + #117 + #118, all migrations on prod | Neo4j turned out not to be needed: step 3 allows pgvector for candidates, step 4 is pure TypeScript and step 7 writes Postgres, so only steps 6, 8 and 9 (the Cypher `MERGE`, the `RANKED` mirror, `(:Meta)`) still want the instance. `embed` is deployed with `--no-verify-jwt` and its secret is set. **Left to do, all operator steps:** run `npm run graph:backfill-embeddings` (needs `SUPABASE_SERVICE_ROLE_KEY`), set `bevi.embed_function_url` and `bevi.embed_webhook_token` on the database, add the `SUPABASE_SERVICE_ROLE_KEY` Actions secret and the `SUPABASE_URL` variable, then `npm run graph:edges -- --dry-run` and read the real Coke–Pepsi number before trusting the >= 0.8 bar. **All done since** (#121, #123; Coke–Pepsi 0.9001; `graph-edges` green nightly since 2026-10-25), and #135 guards the trigger's Vault reads (`20261031000100`) | **Matt's M-27 and M-21** |

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
| **A-13 · Category hierarchy** — **done in #132**, contract `2.8.0` | ~~D-04~~ merged as #127 | `categories.parent_id` and `bevs.leaf_category_id` in `20261026000100`, the catalog re-pointed in `20261026000200`, `category_is_alcoholic(id)` walking up one hop, `get_category_tree()` and `get_bev_leaves()`. **`bevs.category_id` still holds one of the 15 roots** — the app keys exhaustive `Record<CategoryId, …>` maps off those ids, so the leaf is a new nullable column instead. The tree term in `build-edges.ts` now measures at the leaf, the content term at the root. `CHILD_OF` stays with the deferred Neo4j mirror. Review fixes: the guard rejects a leaf in `category_id`; owner and revoke on the four new functions. Follow-up: `categories_depth_guard` (Start now, 4) |
| **A-14 follow-ups** | ~~M-22's list~~ delivered in #128; vector targets in #137 | Small SQL fixes, with pgTAP. **Still open, and two are wrong on prod today:** the streak history rewritten by re-ranks and removals, and `bev_stats.bayes_score` going stale at `rating_count = 0` |
| **A-16 (2) · The taste graph** — **done in #133**, Postgres-only | ~~M-28~~ merged as #131 | `user_neighbors` (RLS on, no client policy) in `20261026000300`, `scripts/graph/build-neighbours.ts` and `graph-neighbours.yml` nightly, plus the `cop` term stored in `bev_edges.components`. **No HMAC pseudonyms and no `RANKED` mirror** — both belong to the deferred Neo4j steps, as in A-16 (1). **No per-ranking webhook:** one new ranking moves the global mean, so every pair changes and there is no incremental update smaller than the rebuild. Review fixes: a pg_safeupdate-safe DELETE; **no client select policy** (Stage 4 reads through the definer snapshot RPC, with aliases); aliased user ids in the job log (Actions logs on this public repo are public); an empty-read guard. **`cop` is the cosine of z-scores over common raters, clamped at 0** (Matt's ruling, over (1+r)/2), and 0 below 3 co-raters; z comes from all rankings, with only active Bevs as co-rated. **Stage 4 is the follow-up** (Start now, 3); it touches Matt's lane, so the contract is agreed first |

## Later: P2, after P0 and P1

| Task | Unblocks | Note |
|---|---|---|
| **S-10 + A-08 · Venues**, one combined PR | Matt's M-16 (the map) | Start with the **Upper East Side and Roosevelt Island** (D-13), keeping the CHECK at the full NYC bounds. Trimmed contract: `venues.inView`, `venues.get`. No `rankings.venue_id`. You also provide the Google Maps key (D-12) |
| **S-13 + A-12 · Duplicates**, one combined PR | Matt's M-20 | The approved plan in TASKS.md S-13: `duplicateOfId` on reports (the database column already exists), an admin-only `merge_bev(src, dst)` run from Supabase Studio, and a Studio view of pending reports. Never merge automatically |

## What you owe Matt, and what he owes you

| You hand Matt | So he can |
|---|---|
| A-13 (#132: `categories.tree()`, `bevs.leaves()`), on prod | Build M-21's tiers |
| S-21 + Stage 4, on prod | Switch on edges mode and stored neighbours (both options exist in the package) |
| An M-26 re-export once there are more users (privately, outside the repo) | Judge switching on edges mode and Pearson |
| S-10 + A-08 and the Maps key; S-13 + A-12 | Build M-16; build M-20 |
| A heads-up before any migration that changes what an existing function returns | Keep the app and the FakeApi in step |

| Matt hands you | So you can |
|---|---|
| M-22's SQL corrections (#128: two are wrong on prod today, streak history and stale `bayes_score`) | Fix them as A-14 follow-ups |
| #137's vector targets: the `bayesScoreStored` cases and the event-streak cases | Test the A-14 follow-ups against them |
| The RPC contract for S-21 + Stage 4: `edges` (#137) and `userNeighbors` (#144), spelled out in #144's "Heads-up for Arjun" | Build S-21 + Stage 4 as one combined PR |
| A review of every FakeApi / conformance hunk in your PRs (they live in his lane) | Merge your combined PRs |
| Advance warning of any `@bevi/ranking` formula or constant change (1.4.0, 1.5.0 and 1.6.0 all merged on 2026-10-31; `edgeWeight` unchanged, so the nightly run only re-stamps) | Re-run the graph sync; your edge weights come from `edgeWeight()` |

## The shared map (identical in both plans)

```
Matt                                   Arjun
D-04 taxonomy + 378 assignments ─────▶ A-13 hierarchy (#132) ─────────┐
M-22 maths review ──(SQL fixes)──────▶ A-14 follow-ups (open)         │
#137 M-22 vectors ──(targets)────────▶ A-14 follow-ups                │
M-27 (b) Bevs like this ◀───────────── A-16 (1) Bev graph + S-14 (2)  │
M-21 placement (#138, app #140) ◀───── A-16 (1) + A-13 ◀──────────────┘
M-28 taste formulas ──(#131)─────────▶ A-16 (2) taste graph (#133)
M-27 (a) edges mode on (#137) ◀─────── S-21 edges in the snapshot
Stored neighbours on (#144) ◀──────── Stage 4 (same RPC change)
M-16 map UI ◀───────────────────────── S-10 + A-08 venues (P2)
M-20 duplicate step ◀───────────────── S-13 + A-12 duplicates (P2)
```

## Files we both touch: where conflicts happen

| Surface | Who edits it | Rule |
|---|---|---|
| `shared/src/` (the contract) and `CONTRACT_VERSION` | Mostly your combined PRs | One combined PR per feature (contract + migration + `packages/api` + FakeApi). Bump the minor version, currently `2.8.0` (A-13, #132). Whoever merges second rebases and takes the next number |
| `app/src/testing/fakeApi/*`, `conformance.ts` | You (in your combined PRs) and Matt | Every new API method needs a FakeApi version, or the app's typecheck fails. Write it to match your SQL, and Matt reviews it |
| `packages/ranking/` | Matt | Your sync job and Edge Function import `edgeWeight` / `topEdges` from it; never copy the formulas. A `RANKING_VERSION` bump means re-running the sync |
| `supabase/migrations/` | You | Timestamped and append-only; the next timestamps go after `20261031000100`. Two branches once both took `20261026000100`, so check `ls supabase/migrations` and the open PRs before picking one. App code that calls a new function merges **only after its migration is on prod**. Push in timestamp order |
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
- ~~Update `DEVELOPMENT-MATT.md` §5, §6.8 and §6.16~~ — done in #136.
