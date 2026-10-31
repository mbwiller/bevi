# Next up: Matt

Your queue, updated 2026-10-31. Arjun's is in [`NEXT-ARJUN.md`](NEXT-ARJUN.md). The live status of every task is the board at the top of [`TASKS.md`](TASKS.md). Update your row there in the same PR whenever you start or finish something.

**Your lane:** `app/`, `packages/ranking/`, `design/`. Branches are `ui/*` and `rank/*`.

## Where it stands (2026-10-31)

**Done:** M-19 (#125), M-27 (b) (#126), D-04 (#127), M-22 (#128), M-04 (#129), M-28 (#131) and the `DEVELOPMENT-MATT.md` refresh (#136). Arjun's A-13 (#132) and A-16 (2) (#133) merged today, as did the embed guard (#135).

| PR / branch | What | State |
|---|---|---|
| **#137** · `rank/graph-recs` | M-27 (a) + the M-22 package follow-ups, `RANKING_VERSION` 1.4.0. `PredictOptions.bevSimilarity: 'content' \| 'edges'` (default `'content'`) and `PredictionSnapshot.edges?`; byte-identical to 1.3.0 by default. Also paper §10.1 for A-13 and A-16 (2) | **Waiting on Arjun's approval** (it changes `shared/fixtures`) |
| **#134** · `design/beverage-icon-pilot` | The Codex beverage-icon pilot: draft icons and the authoring workflow. Not wired into the app | Drafts, in review |
| **#138** | M-21's package half, stacked on #137, `RANKING_VERSION` 1.5.0 | **Open**: the review's one bug (a re-rank Bev's own tier) is fixed. Arjun approves `shared/fixtures`. Retarget it to `main` before deleting `rank/graph-recs` |

**Prod migrations:**
- [ ] Confirm `supabase migration list` shows all four: `20261026000100`, `0200`, `0300` (#132, #133) and `20261031000100` (#135). If not, `npx supabase db push`, dry-run first, in timestamp order. M-21's app half calls #132's functions, so this comes first.

## Next: in this order

| Task | Waits on | What "done" means |
|---|---|---|
| **M-21 · package half** (`rank/anchored-placement`) | #137 (it's stacked on it) | Tiers: 1 = same leaf, 2 = same root (a parent-level Bev is never tier 1), 3 = a cross-root edge with `w` ≥ 0.3. Every Phase 1 question is against a Bev of the most similar non-empty tier; with no anchors, or all in one tier, identical to plain binary search |
| **M-21 · app half** (`ui/anchored-placement`) | The package half merged; #132's migrations on prod | RankFlow calls `listBucketBevs` + `bevs.leaves` + optional `similarities`, then `placementTiers`, then `startPlacement({…, tiers})`. Any failure falls back to plain binary search. **Decide:** also fall back when the anchored bound exceeds plain + 1? Check on a `vercel deploy` preview before merging |
| **Stage 4 contract** (with Arjun) | — | Layer 2 reads `user_neighbors` through `get_prediction_snapshot` (the definer RPC, with aliases; the table has no client policy). Agree it together with S-21, so the RPC changes once |
| **Re-tune `CONF1_MASS`** | S-21, and a real export with enough co-raters | Done before edges mode is switched on: in #137's synthetic eval, edges mode drops mean conf1 from 0.585 to 0.400 |
| **M-29 · Beverage icons in the app** | #134 final | Codex makes the icons; wiring them in replaces the placeholder `BevArt` |

## Later: P2, after P0 and P1

| Task | Waits on (Arjun) | Note |
|---|---|---|
| **M-16 · The map** | **S-10 + A-08**, plus the Maps key | Centred on the Upper East Side with Roosevelt Island in frame. Pins are venues with a curated assortment. No Find Bev button and no "your score" pins (those were removed) |
| **M-20 · "Duplicate of…"** | **S-13 + A-12** | In the report sheet: when "Duplicate of another Bev" is picked, search for the original and send `duplicateOfId` |
| **`index.html` design pass** | — | Planned, not scoped |

## What you owe Arjun, and what he owes you

| You hand Arjun | So he can |
|---|---|
| M-22's SQL corrections (#128: two are wrong on prod today, streak history and stale `bayes_score`) | Fix them as A-14 follow-ups |
| #137's vector targets: the `bayesScoreStored` cases and the event-streak cases | Test the A-14 follow-ups against them |
| #137's `PredictionSnapshot.edges?` shape | Build S-21 |
| The Stage 4 contract, agreed together | Build Stage 4 with S-21, so the RPC changes once |
| A review of every FakeApi / conformance hunk in his PRs (they live in your lane) | Merge his combined PRs |
| Advance warning of any `@bevi/ranking` formula or constant change (1.4.0 in #137, 1.5.0 in M-21) | Re-run the graph sync; his edge weights come from `edgeWeight()` |

| Arjun hands you | So you can |
|---|---|
| His approval of #137 (`shared/fixtures`) | Merge M-27 (a), then M-21's package half on top |
| A-13 (#132: `categories.tree()`, `bevs.leaves()`), on prod | Build M-21's tiers |
| S-21 + Stage 4, on prod | Switch on edges mode; Layer 2 reads `user_neighbors` |
| An M-26 re-export once there are more users (privately, outside the repo) | Judge switching on edges mode and Pearson |
| S-10 + A-08 and the Maps key; S-13 + A-12 | Build M-16; build M-20 |
| A heads-up before any migration that changes what an existing function returns | Keep the app and the FakeApi in step |

## The shared map (identical in both plans)

```
Matt                                   Arjun
D-04 taxonomy + 378 assignments ─────▶ A-13 hierarchy (#132) ─────────┐
M-22 maths review ──(SQL fixes)──────▶ A-14 follow-ups (open)         │
#137 M-22 vectors ──(targets)────────▶ A-14 follow-ups                │
M-27 (b) Bevs like this ◀───────────── A-16 (1) Bev graph + S-14 (2)  │
M-21 placement (pkg, then app) ◀────── A-16 (1) + A-13 ◀──────────────┘
M-28 taste formulas ──(#131)─────────▶ A-16 (2) taste graph (#133)
M-27 (a) edges mode on (#137) ◀─────── S-21 edges in the snapshot
Layer 2 reads user_neighbors ◀──────── Stage 4 (same RPC change)
M-16 map UI ◀───────────────────────── S-10 + A-08 venues (P2)
M-20 duplicate step ◀───────────────── S-13 + A-12 duplicates (P2)
```

## Files we both touch: where conflicts happen

| Surface | Who edits it | Rule |
|---|---|---|
| `shared/src/` (the contract) and `CONTRACT_VERSION` | Mostly Arjun's combined PRs | One combined PR per feature (contract + migration + `packages/api` + FakeApi). Bump the minor version, currently `2.8.0` (A-13, #132). Whoever merges second rebases and takes the next number |
| `app/src/testing/fakeApi/*`, `conformance.ts` | Arjun (in his combined PRs) and you | Every new API method needs a FakeApi version, or the app's typecheck fails. Arjun writes it and you review it. Expect rebase conflicts if your branch edits the FakeApi too |
| `packages/ranking/` | You | Arjun's sync job and Edge Function import it. Any formula or constant change, or `RANKING_VERSION` bump, changes his edge weights: tell him first |
| `supabase/migrations/` | Arjun | Timestamped and append-only; the next timestamps go after `20261031000100`. Two branches once both took `20261026000100`, so check `ls supabase/migrations` and the open PRs before picking one. Whatever calls a new database function merges **only after its migration is on prod**. Push migrations in timestamp order |
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
