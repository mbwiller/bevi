# Next up: Matt

Your queue from 2026-10-19 on. Arjun's is in [`NEXT-ARJUN.md`](NEXT-ARJUN.md). The live status of every task is the board at the top of [`TASKS.md`](TASKS.md). Update your row there in the same PR whenever you start or finish something.

**Your lane:** `app/`, `packages/ranking/`, `design/`. Branches are `ui/*` and `rank/*`.

## Start now: nothing blocks these

| Order | Task | What "done" means | Unblocks |
|---|---|---|---|
| 1 | **M-19 · Taste Profile screen** | Profile › Taste Profile shows your average score per category as bars, high to low ("Coffee 8.1 · 9 ranked"), with a one-line read-out ("You prefer coffee and boba over soda"). Categories with no rankings are hidden. It works on anyone's profile, and the server already drops alcoholic categories for under-21s. Design-system component first. Data: `stats.getTasteProfile(userId)`, live since #101 | — |
| 2 | **D-04 · The finer category list** (high effort) | `design/taxonomy.md`: two levels, today's 15 categories as parents, leaves where it matters (coffee, tea, boba, soda, beer, cocktails first), lined up with the flavour-profile `base` words. **Also assign every one of the 378 catalog Bevs to a leaf**, as a slug → leaf table Arjun can load. Without that, the tree is only a list. Arjun reviews | **Arjun's A-13**, then your M-21 |
| 3 | **M-22 · Maths review** | Check the paper (`docs/bevi-ranking-math.tex`), `@bevi/ranking` and the SQL against each other (use the `ranking-math` agent and the golden vectors). Include Arjun's #107 (`bayes_prior`, the leaderboard order). Output a list of corrections split by lane: paper and package fixes are yours, SQL fixes go to Arjun | Any A-14 follow-ups for Arjun |

M-19 and D-04 can run in parallel. D-04 should not slip, because it's the one item in your lane that blocks Arjun.

## Then: these wait on Arjun

| Task | Waits on (Arjun) | What you build |
|---|---|---|
| **M-04 · Explore screen** | **S-04 + A-04** (the Explore backend) | An Explore segment on the Feed. Posts are **read-only** (D-15): reuse the plain post a stranger's Activity already renders, with no heart, counts or comments; tapping opens the Bev. A Follow button on the author. Paginates, with an empty state |
| **M-27 · Use the Bev graph** | **A-16 (1) + S-14 part 2** (the Bev graph and its contract) | (a) Layer 1's content-similarity term reads `bev_edges` weights, behind a flag. Bump `RANKING_VERSION`, regenerate the vectors and add a row to the paper's §11. Compare against the M-26 baseline before switching it on. (b) A "Bevs like this" row on Bev detail from `bevs.similar()` |
| **M-21 · Category-aware placement** | **A-13** (after your D-04) and **A-16 (1)** | The two-phase binary search from LaTeX §10.1. Same `PlacementResult`, so `submit_ranking` is untouched |
| **M-28 · Taste formulas** | A-16 (1) merged | Pure TypeScript in `packages/ranking/src/graph.ts`: `tasteVector`, `attributeSimilarity`, `blendUserSimilarity`, plus the Pearson fix in `layer2.ts`. **Blocks Arjun's A-16 (2)** |

## Later: P2, after P0 and P1

| Task | Waits on (Arjun) | Note |
|---|---|---|
| **M-16 · The map** | **S-10 + A-08**, plus the Maps key | Centred on the Upper East Side with Roosevelt Island in frame. Pins are venues with a curated assortment. No Find Bev button and no "your score" pins (those were removed) |
| **M-20 · "Duplicate of…"** | **S-13 + A-12** | In the report sheet: when "Duplicate of another Bev" is picked, search for the original and send `duplicateOfId` |

## What you owe Arjun, and what he owes you

| You hand Arjun | So he can |
|---|---|
| D-04's tree **plus the 378-Bev leaf assignment** | Build A-13 (the hierarchy in Postgres and Neo4j) |
| M-22's SQL corrections, if any | Fix them as A-14 follow-ups |
| M-28's taste formulas | Build A-16 (2), the taste graph |
| A review of every FakeApi / conformance hunk in his PRs (they live in your lane) | Merge his combined PRs |
| Advance warning of any `@bevi/ranking` formula or constant change | Re-run the graph sync; his edge weights come from `edgeWeight()` |

| Arjun hands you | So you can |
|---|---|
| S-04 + A-04 (Explore backend), on prod | Build M-04 |
| A-16 (1) + S-14 part 2 (Bev graph, `bev_edges`, `similar`/`similarities`), on prod | Build M-27, then M-21 |
| A-13 (`Category.parentId`) | Build M-21 |
| The M-26 export file (privately, outside the repo) | Get real baseline numbers before switching on M-27 |
| S-10 + A-08 and the Maps key; S-13 + A-12 | Build M-16; build M-20 |

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
| `shared/src/` (the contract) and `CONTRACT_VERSION` | Mostly Arjun's combined PRs | One combined PR per feature (contract + migration + `packages/api` + FakeApi). Bump the minor version, currently `2.4.0`. Whoever merges second rebases and takes the next number |
| `app/src/testing/fakeApi/*`, `conformance.ts` | Arjun (in his combined PRs) and you | Every new API method needs a FakeApi version, or the app's typecheck fails. Arjun writes it and you review it. Expect rebase conflicts if your branch edits the FakeApi too |
| `packages/ranking/` | You | Arjun's sync job and Edge Function import it. Any formula or constant change, or `RANKING_VERSION` bump, changes his edge weights: tell him first |
| `supabase/migrations/` | Arjun | Timestamped and append-only. Whatever calls a new database function merges **only after its migration is on prod**. Push migrations in timestamp order |
| `TASKS.md` and `NEXT-*.md` | Both | Small PRs; rebase if they collide. The board at the top is the source of truth |
| `design/system/` | You | Two design branches always conflict in the generated bundle: rebase, then `npm run build`. Publish to the artifact after the merge |
| `.github/workflows/` | You (`app.yml`), Arjun (`graph-sync.yml`, `backend.yml`) | Don't edit the other's workflow without a heads-up |
| `docs/graph*.md` and `docs/bevi-ranking-math.tex` | Arjun owns the graph docs, you own the paper | A change to one that affects the other gets a line in the PR's "Heads-up" section |

## Working rules (both of us)

- **Every merge to `main` deploys to production** (bevi-gamma.vercel.app). Merge when CI is green and the review has nothing blocking.
- **Migrations reach prod by hand.** Either of us can now run `npx supabase db push`: dry-run first, in timestamp order. Do it before merging any app code that calls the new function.
- **No local Docker:** pgTAP and the live API tests run only in CI's `db` job. A "rate limit exceeded" from `supabase/setup-cli` is a flake: re-run the job.
- **Lane reviews:** the `integrator` agent reviews `supabase/`, `packages/api/` and `shared/`; `integrator-app` reviews `app/`, `packages/ranking/` and `design/`. A combined PR gets both.
- **P0 and P1 before P2** (TASKS.md §0).
