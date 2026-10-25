# Next up: Matt

Your queue from 2026-10-19 on. Arjun's is in [`NEXT-ARJUN.md`](NEXT-ARJUN.md). The live status of every task is the board at the top of [`TASKS.md`](TASKS.md). Update your row there in the same PR whenever you start or finish something.

**Your lane:** `app/`, `packages/ranking/`, `design/`. Branches are `ui/*` and `rank/*`.

## Wave of 2026-10-24: where it stands

| Task | State |
|---|---|
| **M-19 · Taste Profile** | **Done in #125** |
| **M-04 · Explore** | **Done in #129** |
| **M-27 (b) · "Bevs like this"** | **Done in #126** (live: the graph has 4669 edges) |
| **M-22 · Maths review** | **Done in #128.** Paper fixed; the package list and the SQL list (A-14 follow-ups) are under M-22 in TASKS.md |
| **D-04 · Taxonomy + 378 leaf assignments** | **#127, waiting on Arjun's review.** 60 leaves under 13 parents; `water` and `sports` unsplit; a Bev may sit on a parent |
| **M-28 · Taste formulas** | **PR waiting on Arjun's approval** (it changes `shared/fixtures`). `RANKING_VERSION` 1.3.0, which also carries M-22's `compareCodePoints` fix. Pearson in Layer 2 ships off |

## Next: in this order

| Task | Waits on | What "done" means |
|---|---|---|
| **M-27 (a) · Edge weights in recommendations** | M-28 merged (it takes `RANKING_VERSION` 1.4.0) | Layer 1's content term reads `bev_edges` weights through `bevs.similarities`, behind a flag that ships **off**. #122 showed the M-26 export is too thin to be a baseline (3 users, 27 rankings), so the switch-on comparison waits for more data; the PR attaches the synthetic report instead |
| **M-22 package follow-ups** (`rank/m22-fixes`) | M-28 merged | The two golden vectors M-22 asked for (a `bayesianAverage` case on a .xx5 boundary; a `streakFromTimestamps` case written as events), and a decision on `effectiveCategoryStats` and `byCategoryMean` (keep with a note, or drop). Can ride with M-27 (a)'s bump |
| **M-21 · Category-aware placement** | **A-13** (after D-04 merges) | The two-phase binary search from LaTeX §10.1, with D-04's parent-level rule (a Bev on a parent is "kind unknown") |

## Later: P2, after P0 and P1

| Task | Waits on (Arjun) | Note |
|---|---|---|
| **M-16 · The map** | **S-10 + A-08**, plus the Maps key | Centred on the Upper East Side with Roosevelt Island in frame. Pins are venues with a curated assortment. No Find Bev button and no "your score" pins (those were removed) |
| **M-20 · "Duplicate of…"** | **S-13 + A-12** | In the report sheet: when "Duplicate of another Bev" is picked, search for the original and send `duplicateOfId` |

## What you owe Arjun, and what he owes you

| You hand Arjun | So he can |
|---|---|
| D-04's tree **plus the 378-Bev leaf assignment** (#127, his review) | Build A-13 (the hierarchy in Postgres and Neo4j) |
| M-22's SQL corrections (#128: two are wrong on prod today, streak history and stale `bayes_score`) | Fix them as A-14 follow-ups |
| M-28's taste formulas (his approval) | Build A-16 (2), the taste graph |
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
