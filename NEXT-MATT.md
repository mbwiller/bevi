# Next up: Matt

Your queue, updated 2026-11-01. Arjun's is in [`NEXT-ARJUN.md`](NEXT-ARJUN.md). The live status of every task is the board at the top of [`TASKS.md`](TASKS.md). Update your row there in the same PR whenever you start or finish something.

**Your lane:** `app/`, `packages/ranking/`, `design/`. Branches are `ui/*` and `rank/*`.

## Where it stands (2026-11-01)

**Done through 2026-10-31:** M-19 (#125), M-27 (b) (#126), D-04 (#127), M-22 (#128), M-04 (#129), M-28 (#131), the `DEVELOPMENT-MATT.md` refresh (#136), M-27 (a) + the M-22 package follow-ups (#137, 1.4.0), M-21's package half (#138, 1.5.0), the icon pilot (#134), M-29 (#143), the Expo patch bump (#142, S-18) and the Stage 4 package half (#144, 1.6.0); Arjun's A-13 (#132), A-16 (2) (#133) and the embed guard (#135).

**2026-11-01, from your side with your OK (Arjun's lane, his review after the fact):** the P1 items that blocked you were built and merged: **#146** (`categories_depth_guard` follow-up), **#147** (S-21 + Stage 4: the snapshot RPC carries `edges` and `userNeighbors`, `packages/api` maps them), **#149** (A-14 write path: `ranking_events`, Prop. 2.5 check) and **#150** (A-14 read/stats path: fresh `bayes_score`, `bayes_prior` everywhere, `category_stats`, 2-dp live figures, `20_vectors.test.sql`). The paper's implementation notes were brought up to date in the same wave. P2 opened and closed the same evening: **#151** (S-13 + A-12 duplicates, contract 2.9.0) and **#152** (M-20 on top of it) are merged. Codex's icon batch 3 is **#148**.

| PR / branch | What | State |
|---|---|---|
| **#140** · `ui/anchored-placement` | M-21's app half: RankFlow asks the like-for-like questions first; every failure degrades to today's search | **CI green, app-only.** Preview: https://bevi-hu7myzlpc-matts-projects-6b78eb05.vercel.app. **Your click-through checklist is in the PR**; rebase (main moved), then merge after it |
| **#148** · `design/beverage-icon-pilot` | Icon batch 3: 19 new icons (49 total, 40 of 43 starters) exported into the app; three starter identities recorded as unresolved; `app.yml` also watches the icon manifest | **CI green.** **Your visual sign-off** (checklist in the PR), then merge; afterwards `git checkout design/beverage-icon-pilot && git reset --hard origin/main` in `~/Desktop/bevi` while Codex is idle, so batch 4 starts from `main` |

**Prod migrations (yours to push, from `../bevi-wt/db-push`):**
- [x] `20261026000100`, `0200`, `0300` and `20261031000100` confirmed on prod 2026-10-31.
- [ ] **Five new ones, push together in this order** (`git checkout --detach origin/main` after a fetch, `npx supabase db push --dry-run`, then `db push`): `20261101000100` (#147), `20261101000200` (#149; its backfill and one-off streak recompute run inside the push), `20261101000300` (#150; its bootstrap call nulls the stale `bayes_score` rows and fills `category_stats`), `20261101000400` (#146), `20261101000500` (#151). Nothing in the app calls a new RPC, so prod is correct either way until then; the two prod bugs (streaks, stale `bayes_score`) are fixed the moment `000200` and `000300` land. Afterwards, in Studio: `select count(*) from bev_stats where rating_count = 0 and bayes_score is not null;` should be 0.

## Next: in this order

| Task | Waits on | What "done" means |
|---|---|---|
| **M-21 · app half, #140** | Your click-through of the preview (the checklist is in the PR) | Merge it. No cap on the anchored question count (decided, Remark 10.7); every failure degrades to today's search |
| **Icon batch 3, #148** | Your visual sign-off | Merge it, then reset `design/beverage-icon-pilot` onto `main`. Batch 4 onwards: Codex on that branch; after each batch `node scripts/icons/export-app.mjs`, commit `app/public/bev-icons/` and `src/lib/bevIcons.generated.ts` with it, your sign-off, merge, reset |
| **The five migrations** | — | `db push` in timestamp order (above). Then tell Arjun they are on prod |
| **Duplicates, live** | `20261101000500` on prod | A "Duplicate of another Bev" report now carries `duplicateOfId` (#151, #152). To resolve one: Studio → `select * from pending_duplicate_reports;` → paste its `merge_sql` (`select public.merge_bev('<duplicate>', '<original>');`) |
| **Switch-on plan: edges mode and stored neighbours** | `20261101000100` on prod (the RPC now returns both keys) and a real export with enough co-raters | Re-tune `CONF1_MASS` (edges mode drops mean conf1 from 0.585 to 0.400 in #137's synthetic eval) and review Layer 2's support under stored mode (#144's synthetic eval: every Δ CI includes 0). Then `recs.ts`/`bevs.ts` pass the options; the app itself does not change |
| **Expo patches** | — | Routine (S-18): when the app workflow's advisory step warns, `npx expo install --fix` from `app/` in a small `ui/*` PR (#142 was the last; the step was quiet on 2026-11-01) |

## Later: P2, after P0 and P1

| Task | Waits on (Arjun) | Note |
|---|---|---|
| **M-16 · The map** | **S-10 + A-08**, plus the Maps key | Centred on the Upper East Side with Roosevelt Island in frame. Pins are venues with a curated assortment. No Find Bev button and no "your score" pins (those were removed) |
| **`index.html` design pass** | — | Planned, not scoped |

## What you owe Arjun, and what he owes you

| You hand Arjun | So he can |
|---|---|
| ~~M-22's SQL corrections~~, ~~#137's vector targets~~, ~~the S-21 + Stage 4 RPC contract~~ | All built from your side on 2026-11-01 (#149, #150, #147). What he owes back is a read of those PRs and the follow-ups they list (an `authenticated` EXECUTE still on `refresh_bev_stats`; `respaceBucket`/`rankUsers` vectors untested in SQL; `submit_ranking`/`add_want_to_try` still accept a merged Bev's id) |
| A review of every FakeApi / conformance hunk in his PRs (they live in your lane) | Merge his combined PRs |
| Advance warning of any `@bevi/ranking` formula or constant change (1.4.0, 1.5.0 and 1.6.0 all merged on 2026-10-31; `edgeWeight` unchanged, so the nightly run only re-stamps) | Re-run the graph sync; his edge weights come from `edgeWeight()` |

| Arjun hands you | So you can |
|---|---|
| ~~A-13 (#132), on prod~~ | Done |
| ~~S-21 + Stage 4~~ (#147, from your side) — **you push `20261101000100` yourself** | Switch on edges mode and stored neighbours (both options exist in the package) |
| An M-26 re-export once there are more users (privately, outside the repo) | Judge switching on edges mode and Pearson |
| S-10 + A-08 and the Maps key | Build M-16 (S-13 + A-12 is #151, from your side) |
| A heads-up before any migration that changes what an existing function returns | Keep the app and the FakeApi in step |

## The shared map (identical in both plans)

```
Matt                                   Arjun
D-04 taxonomy + 378 assignments ─────▶ A-13 hierarchy (#132) ─────────┐
M-22 maths review ──(SQL fixes)──────▶ A-14 follow-ups (open)         │
#137 M-22 vectors ──(targets)────────▶ A-14 follow-ups                │
M-27 (b) Bevs like this ◀───────────── A-16 (1) Bev graph + S-14 (2)  │
M-21 placement (#138, app #140) ◀───── A-16 (1) + A-13 ◀──────────────┘
M-28 taste formulas ──(#131)─────────▶ A-16 (2) taste graph (#133)
M-27 (a) edges mode on (#137) ◀─────── S-21 edges in the snapshot (#147)
Stored neighbours on (#144) ◀──────── Stage 4 (same RPC change, #147)
M-16 map UI ◀───────────────────────── S-10 + A-08 venues (P2)
M-20 duplicate step (#152) ◀────────── S-13 + A-12 duplicates (#151)
```

## Files we both touch: where conflicts happen

| Surface | Who edits it | Rule |
|---|---|---|
| `shared/src/` (the contract) and `CONTRACT_VERSION` | Mostly Arjun's combined PRs | One combined PR per feature (contract + migration + `packages/api` + FakeApi). Bump the minor version, currently `2.9.0` (S-13, #151). Whoever merges second rebases and takes the next number |
| `app/src/testing/fakeApi/*`, `conformance.ts` | Arjun (in his combined PRs) and you | Every new API method needs a FakeApi version, or the app's typecheck fails. Arjun writes it and you review it. Expect rebase conflicts if your branch edits the FakeApi too |
| `packages/ranking/` | You | Arjun's sync job and Edge Function import it. Any formula or constant change, or `RANKING_VERSION` bump, changes his edge weights: tell him first |
| `supabase/migrations/` | Arjun | Timestamped and append-only; the next timestamps go after `20261101000500`. Two branches once both took `20261026000100`, so check `ls supabase/migrations` and the open PRs before picking one; when several PRs are open at once, pre-assign the timestamps (today's five were `20261101000100`–`000500`) and give each a disjoint set of functions to `create or replace`, since two migrations re-creating the same function silently revert each other. Whatever calls a new database function merges **only after its migration is on prod**. Push migrations in timestamp order |
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
