# CLEANUP.md — what can be deleted from Bevi, and how risky each deletion is

Audit date: 2026-11-16. Baseline: `main` at `2667150` (#226), `origin` fetched and pruned the same day.
**Nothing in this file has been deleted yet.** The audit only read the repository.
Updated later on 2026-11-16: the founders' map decision (§1.1) and the pre-work of §4.

This file is the single tracker for the cleanup. Every candidate has an ID, a risk score and a
`Status` cell. Whoever acts on a row updates that cell in the same commit or session.

## 1. How to use this file

**Status values** (always the last cell of a row, exactly one of these words):

- `TODO`: not started.
- `DONE`: deleted, and the checks for that section passed.
- `KEPT`: an owner looked and decided to keep it. Add the reason to the change log (§11).
- `BLOCKED`: cannot proceed. Add what is missing to the change log.

**Protocol for an agent or a person picking up work:**

1. Count what is left: `grep -cE '\| TODO \|$' CLEANUP.md` (same for `DONE`, `KEPT`, `BLOCKED`).
2. Take rows in the order of §9. Never start an R3 or R4 row without the named owner's decision.
3. Re-verify before deleting. The evidence here is true for the SHAs and paths listed, as of the
   audit date. The commands in §10 re-check each tip and skip anything that moved.
4. Delete, then run the checks listed for that section.
5. Set the row's status, and add one line to the change log (§11): date, who, IDs, PR or commit.
6. If the facts no longer match (a tip moved, a file gained a reference), do not delete: set
   `BLOCKED` and say why.

**Rules that hold throughout:**

- Never delete or edit a file in `supabase/migrations/`. Merged migrations are frozen.
- Never pass `--force` to `git worktree remove`. A refusal means there is unsaved work.
- Tracked-file deletions go through a PR per lane (`app/`, `design/`, `packages/ranking/` are
  Matt's; `supabase/`, `packages/api/`, `shared/`, `data/catalog/` are Arjun's).
- Deleting a branch or a worktree changes no file on `main` and cannot affect the deployed app.
  The risk in those sections is losing work that exists nowhere else.

### 1.1 Decisions on record

**2026-11-16, Matt and Arjun** (founders board, card "Add Location to Bev Posts",
`CONVERSATION_2026-11-16.md`): Bev Maps no longer fits Bevi. The Map tab stops redirecting to Bev
Maps and becomes a Google Maps map of where you and your friends Bev'd. A Bev gets a location tag,
chosen through a Google-Maps-style search in Add Bev and editable on Bevs already logged. First
coverage is Roosevelt Island and the Upper East Side.

What that changes in this file:

- **F-06, the Google venue map, is `KEPT`.** It is the starting point for the new Map tab.
- **F-07, the Find Bev camera spike, is obsolete** and can go now.
- **F-10, the Find Bev screen that links out to Bev Maps, is obsolete** but is still what the Map
  tab renders. It goes in the PR that mounts the new map.

## 2. Risk scale

| Score | Meaning | What it takes to delete |
|---|---|---|
| **R1** | Safe. Nothing references it, or its content is verifiably on `main`. Deleting cannot change the build, the tests or the deployed app. | Run the section's guard command. No review needed. |
| **R2** | Low. Superseded or historical, but it holds something that is not byte-for-byte on `main`, or prose still points at it. | A two-minute look by the owner, plus the small follow-up edit the row names. |
| **R3** | Medium. Live code still reaches it, or it is the only copy of unmerged work, or it was parked on purpose. | An explicit decision by the named owner, then the row's checks. |
| **R4** | High. Deleting now loses unsaved work or breaks something in use. | Clear the named blocker first. Until then it is not a candidate. |

## 3. Status board

Risk counts as of the 2026-11-16 update. For progress, recount with the `grep` in §1 rather than editing these numbers.

| Section | Candidates | R1 | R2 | R3 | R4 |
|---|---|---|---|---|---|
| §4 Before anything else | 4 actions | - | - | - | - |
| §5 Worktrees (WT) | 14 | 12 | 2 | 0 | 0 |
| §6 Local branches (LB) | 29 | 22 | 7 | 0 | 0 |
| §7 Remote branches (RB) | 77 of 82 | 69 | 7 | 1 | 0 |
| §8.1 Tracked files (F) | 10 | 0 | 8 | 2 | 0 |
| §8.2 Dead exports (DC) | 7 | 7 | 0 | 0 | 0 |
| §8.3 Local-only files (L) | 8 | 5 | 1 | 2 | 0 |
| §12.2 Worktrees, Arjun (A-WT) | 28 | 21 | 5 | 0 | 2 |
| §12.3 Local branches, Arjun (A-LB) | 50 of 61 | 45 | 5 | 0 | 0 |
| §12.4 Local-only files, Arjun (A-L) | 3 | 2 | 1 | 0 | 0 |

Disk this frees on Matt's machine: about 7.0 GB from worktrees, 1.4 GB from `internal/`, 0.2 GB
from the rest. On Arjun's machine: about 11 GB from worktrees, 1 GB from the
`/private/tmp` loose files (§12.4). Tracked files removed from `main`: about 17 MB of about 94 MB.

## 4. Before anything else

| ID | Action | Why | Owner | Status |
|---|---|---|---|---|
| P-01 | Save the uncommitted change in `../bevi-wt/icon-redraw-04`: three review notes in `design/beverage-icons/verdicts/matt.json` (`horchata-traditional`, `mexican-coca-cola`, `minute-maid-fruit-punch`). | They existed only in that worktree. Committed on `design/icon-redraw-04` as `08b43fa` and merged to `main` in #229, the PR that added this file. | Matt | DONE |
| P-02 | Keep `VC-materials/`, `internal/` and `docs/apple-developer-account.pdf` out of reach of `git add`. | They were untracked but not ignored, in a public repository. Now listed in Matt's `.git/info/exclude`, which keeps the names out of the public `.gitignore`. `docs/bevi-cicd-pipeline.tex` is still untracked and visible: commit it or move it. | Matt | DONE |
| P-03 | Run the audit commands of §10.4 on Arjun's machine. | Only Matt's checkout, worktrees and local branches were audited. Run on 2026-11-16; results are §12. | Arjun | DONE |
| P-04 | Decide RB `be/hygiene-sweep`: bring it to `main`, or drop it. | **Brought to `main`** in #228. Arjun's 2026-10-24 commit (`03577f1`) is still the first commit on the branch -- `main` was merged, never rebased, so the sha survives. The migration was retimestamped twice to stay above what is already on prod and is now `20261119152455_hygiene.sql`; the `list_bucket_bevs` cap was dropped rather than retuned (its length *is* the client's `expectedBucketSize`, so a cap breaks every submission from a 501-Bev bucket); `graph_pipeline_status()` reports `tgenabled` instead of a boolean that called a replica-only trigger enabled; and the three-week gap's new tables were swept. Verified on a local stack: `supabase db reset` clean, `supabase test db` 43 files / 1899 assertions, `npm test` green, `npm run graph:verify` fails honestly and exits 1. **Not yet `db push`ed to prod.** | Arjun | DONE |

Optional, after §7: turn on "Automatically delete head branches" in the GitHub repository settings
(it is off, which is how the branches in §7.2 accumulated). GitHub retargets any open PR
stacked on a deleted branch to that branch's base.

## 5. Worktrees (Matt's machine)

`git worktree remove` deletes the folder only; the branch and its commits stay. So a clean worktree
is R1 whatever its branch holds. Ignored files (`node_modules`, build output) go with the folder.

| ID | Path | Checked out | State at audit | Size | Risk | Status |
|---|---|---|---|---|---|---|
| WT-01 | `../bevi-wt/be-dup` | `be/duplicates-cross-category` `06f3eda` | clean | 863 MB | R1 | TODO |
| WT-02 | `../bevi-wt/board-1026` | `chore/board-2026-10-26` `5434a99` | clean | 13 MB | R1 | TODO |
| WT-03 | `../bevi-wt/bug-report-cors` | `be/bug-report-cors` `b39775b` | clean | 46 MB | R1 | TODO |
| WT-04 | `../bevi-wt/bug-reporter` | `be/bug-reporter` `7e24d58` | clean; ignored build output (`app/.expo/`, `app/dist/`) | 829 MB | R1 | TODO |
| WT-05 | `../bevi-wt/db-push` | detached `63b8a64` (on `main`, #203) | clean; ignored `supabase/.temp/` (the Supabase CLI's project link). If this is where `supabase db push` is run, the next push needs `supabase link` again elsewhere. | 870 MB | R2 | TODO |
| WT-06 | `../bevi-wt/icon-redraw-01` | `design/icon-redraw-01` `5fe363d` | clean | 884 MB | R1 | TODO |
| WT-07 | `../bevi-wt/icon-redraw-02` | `design/icon-redraw-02` `08615b2` | clean | 108 MB | R1 | TODO |
| WT-08 | `../bevi-wt/icon-redraw-03` | `design/icon-redraw-03` `ec46dbb` | clean | 112 MB | R1 | TODO |
| WT-09 | `../bevi-wt/icon-redraw-04` | detached `2667150` (`main`) | clean since P-01 (was R4: three uncommitted review notes). **In use:** another session checked out `origin/main` here at 14:20 on 2026-11-16, minutes after P-01. Remove it only once the icon review running there is over. | 116 MB | R2 | TODO |
| WT-10 | `../bevi-wt/icon-swipe` | `tools/icon-swipe` `5fe363d` | clean | 101 MB | R1 | TODO |
| WT-11 | `../bevi-wt/ui-gutcheck-levels` | `ui/gut-check-levels` `81cff56` | clean; ignored `app/.expo/`, `app/expo-env.d.ts`, `design/system/shots/` (screenshots, rebuilt by `npm run shoot`) | 883 MB | R1 | TODO |
| WT-12 | `.claude/worktrees/agent-a00cf6927da604bc2` | `scratch/flavor-verify` `1fbbcea` | clean, untouched since 2026-10-14 | 786 MB | R1 | TODO |
| WT-13 | `.claude/worktrees/agent-a0b52b7bf18115dd2` | `scratch/feed-no-saves-verify` `ed660ca` | clean, untouched since 2026-10-14 | 786 MB | R1 | TODO |
| WT-14 | `.claude/worktrees/agent-acf8c08a8787ca4c9` | detached `a9d4eb0` (not on `main`; reachable from local branch `round-verify`) | clean, untouched since 2026-10-14 | 786 MB | R1 | TODO |

**Not a worktree, do not delete:** `../bevi-wt/icon-redraw-tools/` (144 KB: `BRIEF.md`,
`BRIEF-R3.md`, `BRIEF-FINISH.md`, the compare and trace scripts). It is the icon-redraw toolkit, it
is in no git repository, and this disk holds the only copy.

Checks after this section: `git worktree list` shows only the main checkout plus anything kept, and
`git worktree prune --dry-run -v` prints nothing.

## 6. Local branches (Matt's machine)

29 branches besides `main`. A branch checked out in a worktree cannot be deleted, so do §5
first. "On GitHub: no" means the branch was never pushed: once deleted, it is recoverable only with
`git branch <name> <tip>` until `git gc` prunes the commits (about two weeks by default).

### 6.1 R1: content is on `main` or held by a PR (22)

| ID | Branch | Tip | Last commit | Worktree | On GitHub | Evidence | Risk | Status |
|---|---|---|---|---|---|---|---|---|
| LB-01 | `be/bug-report-cors` | `b39775b` | 2026-11-09 | `bug-report-cors` | same tip | Merged as #171 at this tip. | R1 | TODO |
| LB-02 | `be/bug-reporter` | `7e24d58` | 2026-11-09 | `bug-reporter` | same tip | Merged as #167 at this tip. | R1 | TODO |
| LB-03 | `be/duplicates-cross-category` | `06f3eda` | 2026-11-12 | `be-dup` | older tip | Local tip is 6 commits behind `origin`'s, which merged as #197. | R1 | TODO |
| LB-04 | `be/feed-no-saves` | `adfdd4a` | 2026-10-14 | - | no | Merged as #69 at this tip. | R1 | TODO |
| LB-05 | `be/flavor-profiles` | `eb17f1b` | 2026-10-14 | - | no | Ancestor of #73's merged head (`4df0950`). | R1 | TODO |
| LB-06 | `be/graph-dashboard` | `fc25e9d` | 2026-11-10 | - | same tip | Merged as #179 at this tip. | R1 | TODO |
| LB-07 | `be/graph-instance` | `ef8c9d7` | 2026-10-14 | - | no | Merged as #72 at this tip. | R1 | TODO |
| LB-08 | `design/icon-redraw-01` | `5fe363d` | 2026-11-15 | `icon-redraw-01` | no | Same commit as `tools/icon-swipe`, merged as #219. | R1 | TODO |
| LB-09 | `design/icon-redraw-02` | `08615b2` | 2026-11-16 | `icon-redraw-02` | no | Ancestor of `design/icon-redraw-03`, merged as #225. | R1 | TODO |
| LB-10 | `design/icon-redraw-03` | `ec46dbb` | 2026-11-16 | `icon-redraw-03` | same tip | Merged as #225 at this tip. | R1 | TODO |
| LB-11 | `design/icon-redraw-04` | `08b43fa` | 2026-11-16 | - | no | `8495994` merged as #226. The one later commit (`08b43fa`, three review notes, P-01) is on `main` through #229. Never pushed under this name. | R1 | TODO |
| LB-12 | `fix-likes-test` | `ba61484` | 2026-10-14 | - | no | No PR. Every file version on the branch exists in `main`'s history. | R1 | TODO |
| LB-13 | `round-verify` | `ca7cc46` | 2026-10-14 | - | no | No PR. Every file version exists in `main`'s history. **Delete after WT-14**, whose detached HEAD (`a9d4eb0`) is reachable only from this branch. | R1 | TODO |
| LB-14 | `scratch/flavor-verify` | `1fbbcea` | 2026-10-14 | `agent-a00cf6927da604bc2` | no | CI probe for closed PR #77 ("DO NOT MERGE"); tip is that PR's head, kept by `refs/pull/77/head`. | R1 | TODO |
| LB-15 | `tools/icon-swipe` | `5fe363d` | 2026-11-15 | `icon-swipe` | same tip | Merged as #219 at this tip. | R1 | TODO |
| LB-16 | `ui/contract-v2-fakeapi` | `bfa0d36` | 2026-10-14 | - | same tip | Merged as #80 at this tip. | R1 | TODO |
| LB-17 | `ui/create-fixes` | `14ada2a` | 2026-10-11 | - | same tip | Merged as #55 at this tip. | R1 | TODO |
| LB-18 | `ui/gut-check-levels` | `81cff56` | 2026-11-10 | `ui-gutcheck-levels` | same tip | Merged as #175 at this tip. | R1 | TODO |
| LB-19 | `worktree-agent-a00cf6927da604bc2` | `921a712` | 2026-10-14 | - | no | On `main` (ancestor). Left over from an agent worktree. | R1 | TODO |
| LB-20 | `worktree-agent-a0b52b7bf18115dd2` | `921a712` | 2026-10-14 | - | no | On `main` (ancestor). Left over from an agent worktree. | R1 | TODO |
| LB-21 | `worktree-agent-acf8c08a8787ca4c9` | `921a712` | 2026-10-14 | - | no | On `main` (ancestor). Left over from an agent worktree. | R1 | TODO |
| LB-22 | `worktree-agent-af5614f32d9a0605b` | `921a712` | 2026-10-14 | - | no | On `main` (ancestor). Its worktree is already gone. | R1 | TODO |

### 6.2 R2: superseded, glance before deleting (7)

Verification scratch from 2026-10-14, one stale board commit, one pre-rebase backup, and the old Codex icon branch.

| ID | Branch | Tip | Last commit | Worktree | On GitHub | Evidence | Risk | Status |
|---|---|---|---|---|---|---|---|---|
| LB-23 | `backup/bug-reporter-rebased` | `1d9da9a` | 2026-11-09 | - | no | Never pushed. Pre-rebase backup of `be/bug-reporter` (merged as #167); 13 file versions differ from `main`. | R2 | TODO |
| LB-24 | `chore/board-2026-10-26` | `5434a99` | 2026-10-26 | `board-1026` | no | Never pushed. One docs commit (`TASKS.md`, `NEXT-MATT.md` as of 2026-10-26), stale since. | R2 | TODO |
| LB-25 | `design/beverage-icon-pilot` | `29e81a0` | 2026-11-01 | - | same tip | Same commit as RB `design/beverage-icon-pilot`; delete both together. | R2 | TODO |
| LB-26 | `review/be-post-likes` | `55777ae` | 2026-10-14 | - | no | Never pushed. Review commits for A-02 (likes, merged); one pgTAP file version differs from `main`. | R2 | TODO |
| LB-27 | `scratch/feed-no-saves-verify` | `ed660ca` | 2026-10-14 | `agent-a0b52b7bf18115dd2` | no | Never pushed. Verification merge of the feed-no-saves branches, which have since merged (#69 for the backend); one `FakeApi.ts` merge state differs from `main`. | R2 | TODO |
| LB-28 | `sim` | `002a3f9` | 2026-10-14 | - | no | Never pushed. A merge rehearsal ("squash be/...") from 2026-10-14; 15 file versions differ from `main`, all for features that merged since. | R2 | TODO |
| LB-29 | `tmp` | `350eb9a` | 2026-10-14 | - | no | Never pushed. Pre-review copy of A-15 (merged as #72); 6 file versions differ from `main`. | R2 | TODO |

## 7. Remote branches (`origin`)

82 branches besides `main`. 5 carry open PRs for work in progress and are not
candidates; the other 77 are listed below. One of those, `be/hygiene-sweep`, has a draft PR
that was opened only to hold its commit (P-04).

Any branch that has had a PR stays recoverable after deletion, because GitHub keeps the PR's head:
`git fetch origin pull/<N>/head:<branch>`. Where a row says no PR, that safety net does not exist.

### 7.1 Keep: open pull requests (5)

**Stale as of 2026-11-16 evening:** seven PRs are open, not five. #228 (`be/hygiene-sweep`,
P-04) and #230 (`be/recoup-hydration`, merged since) postdate the audit. The guard script in
§10.3 re-checks this itself, so the table below is a snapshot, not the authority.

| Branch | Tip | PR | Stack |
|---|---|---|---|
| `be/BEV-15-icon-quality-eval` | `ae4d0d9` | #227 open | base `be/custom-bev-icons-rebased` |
| `be/barcode-nutrition` | `fdda486` | #223 open (draft) | base `contract/barcode-nutrition`; PR(s) #224 stacked on it |
| `be/custom-bev-icons-rebased` | `06fc0f7` | #221 open | base `main`; PR(s) #227 stacked on it |
| `contract/barcode-nutrition` | `a280e26` | #222 open (draft) | base `main`; PR(s) #223 stacked on it |
| `ui/barcode-nutrition` | `7004b7b` | #224 open (draft) | base `be/barcode-nutrition` |

### 7.2 R1: merged or fully contained in `main` (69)

"Squash-merged; tip is the PR head" means GitHub merged exactly this commit, so nothing on the
branch is newer than what `main` received.

| ID | Branch | Tip | Last commit | Tip author | PR | Evidence | Risk | Status |
|---|---|---|---|---|---|---|---|---|
| RB-01 | `be/bug-report-cors` | `b39775b` | 2026-11-09 | Matt | #171 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-02 | `be/bug-reporter` | `7e24d58` | 2026-11-09 | Matt | #167 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-03 | `be/catalog-scaffold` | `91326e0` | 2026-10-09 | Arjun | #4 closed | PR closed unmerged, but every file version on the branch exists in `main`'s history. | R1 | TODO |
| RB-04 | `be/category-hierarchy` | `d99a2fb` | 2026-10-31 | Matt | #132 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-05 | `be/content-rpcs` | `c17ee87` | 2026-10-11 | Arjun | #21 closed | PR closed unmerged; every file version exists in `main`'s history. | R1 | TODO |
| RB-06 | `be/duplicates-cross-category` | `88622d2` | 2026-11-13 | Matt | #197 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-07 | `be/embed-batch-limit` | `017093f` | 2026-10-24 | Arjun | #120 closed | PR closed unmerged; a test merge into `main` changes nothing (both fixes are already there). | R1 | TODO |
| RB-08 | `be/embed-pipeline` | `d6d6e73` | 2026-10-23 | Arjun | #117 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-09 | `be/embed-vault-guard` | `8f9075f` | 2026-10-31 | Matt | #135 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-10 | `be/graph-dashboard` | `fc25e9d` | 2026-11-10 | Matt | #179 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-11 | `be/graph-edges` | `7045af1` | 2026-10-23 | Arjun | #118 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-12 | `be/graph-stats` | `9fece7c` | 2026-11-11 | Matt | #180 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-13 | `be/graph-tables` | `1ad2b96` | 2026-10-20 | Arjun | #115 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-14 | `be/social-context` | `3d448e4` | 2026-11-11 | Matt | #184 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-15 | `be/taste-graph` | `d582412` | 2026-10-31 | Arjun | #133 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-16 | `be/venues-api` | `4897c5a` | 2026-11-02 | Matt | #161 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-17 | `chore/board-state-2026-10-25` | `b4ed599` | 2026-10-26 | Arjun | #122 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-18 | `chore/tasks-week1-progress` | `ef5a8c6` | 2026-10-14 | Matt | #64 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-19 | `claude/sleepy-wozniak-ap1798` | `30deae1` | 2026-10-14 | Matt | #59 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-20 | `claude/upbeat-galileo-iuhp0s` | `dbab1ff` | 2026-10-12 | Matt | #56 merged, #57 merged, #58 merged | Reused for #56, #57, #58; all merged, tip is #58's head. | R1 | TODO |
| RB-21 | `contract/ranking-createdat-doc` | `04a2e8e` | 2026-11-14 | Arjun | #218 merged | On `main` (ancestor). | R1 | TODO |
| RB-22 | `contract/vectors-v1` | `6f00674` | 2026-10-09 | Matt | #9 closed | PR closed unmerged (base `rank/foundations`, since deleted); every file version exists in `main`'s history. | R1 | TODO |
| RB-23 | `design/beverage-icons-catalog` | `76d7559` | 2026-11-02 | Arjun | #160 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-24 | `design/icon-redraw-03` | `ec46dbb` | 2026-11-16 | Matt | #225 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-25 | `fix/app-jest-worker-memory` | `805d6ac` | 2026-11-14 | Arjun | #210 merged | One commit pushed after #210 merged (`805d6ac`, 1GB limit); the same change merged as #214. | R1 | TODO |
| RB-26 | `fix/app-jest-worker-memory-1gb` | `c811efe` | 2026-11-14 | Arjun | #214 merged | On `main` (ancestor). | R1 | TODO |
| RB-27 | `fix/bev-13-rename-rerank` | `72fc9d2` | 2026-11-15 | Arjun | #215 merged | On `main` (ancestor). | R1 | TODO |
| RB-28 | `fix/ranking-createdat-conformance` | `431baef` | 2026-11-14 | Arjun | #216 merged | On `main` (ancestor). | R1 | TODO |
| RB-29 | `rank/taste-graph` | `d968711` | 2026-10-24 | Matt | #131 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-30 | `test/rerank-redates-ranked-at` | `f0202c3` | 2026-11-15 | Arjun | #220 merged | On `main` (ancestor). | R1 | TODO |
| RB-31 | `tools/icon-swipe` | `5fe363d` | 2026-11-15 | Matt | #219 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-32 | `ui/avatar` | `11d7165` | 2026-10-20 | Matt | #111 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-33 | `ui/bev-8-report-drop` | `2c2b687` | 2026-11-14 | Matt | #212 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-34 | `ui/beverage-icons-batch11` | `d07a6b0` | 2026-11-14 | Arjun | #202 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-35 | `ui/beverage-icons-batch12` | `51635cd` | 2026-11-14 | Arjun | #213 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-36 | `ui/beverage-icons-batch13` | `220df6f` | 2026-11-14 | Arjun | #217 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-37 | `ui/beverage-icons-energy-next` | `8fc09cc` | 2026-11-11 | Arjun | #181 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-38 | `ui/beverage-icons-fresca` | `40334e9` | 2026-11-12 | Arjun | #195 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-39 | `ui/beverage-icons-next-20` | `d4a5cd7` | 2026-11-11 | Arjun | #189 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-40 | `ui/beverage-icons-production` | `1d5a38e` | 2026-11-10 | Arjun | #178 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-41 | `ui/contract-v2-fakeapi` | `bfa0d36` | 2026-10-14 | Matt | #80 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-42 | `ui/controls` | `9d178a6` | 2026-10-11 | Matt | #30 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-43 | `ui/create-fixes` | `14ada2a` | 2026-10-11 | Matt | #55 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-44 | `ui/dark-statusbar` | `6c2c06f` | 2026-10-14 | Matt | #61 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-45 | `ui/expo-57-patches` | `3273dae` | 2026-10-14 | Matt | #63 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-46 | `ui/feed-fixes` | `ca53430` | 2026-10-11 | Matt | #46 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-47 | `ui/find-bev-spike` | `9388377` | 2026-11-14 | Arjun | #204 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-48 | `ui/fix-sort-jump` | `e84acb2` | 2026-10-14 | Matt | #60 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-49 | `ui/flow` | `88261ca` | 2026-10-11 | Matt | #31 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-50 | `ui/gut-check-levels` | `81cff56` | 2026-11-10 | Matt | #175 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-51 | `ui/leaderboard-icons` | `a28eb93` | 2026-10-14 | Matt | #62 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-52 | `ui/mock-api` | `47d801f` | 2026-10-11 | Matt | #35 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-53 | `ui/mock-ranking` | `c551fc2` | 2026-10-11 | Matt | #45 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-54 | `ui/nav-redesign` | `98802a1` | 2026-11-11 | Matt | #185 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-55 | `ui/polish-feed-post` | `f7aab58` | 2026-11-11 | Matt | #188 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-56 | `ui/polish-profile` | `0e96b42` | 2026-11-11 | Matt | #187 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-57 | `ui/polish-rows` | `4c58042` | 2026-11-11 | Matt | #186 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-58 | `ui/polish-small-fixes` | `8816dc4` | 2026-11-11 | Matt | #190 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-59 | `ui/privacy-wording` | `bfd2855` | 2026-10-11 | Matt | #44 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-60 | `ui/rank-fixes` | `0f6cc59` | 2026-10-11 | Matt | #47 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-61 | `ui/rows` | `dd56ff5` | 2026-10-11 | Matt | #33 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-62 | `ui/scaffold` | `0994b4e` | 2026-10-10 | Matt | #13 closed | PR closed unmerged (base `rank/foundations`, since deleted); every file version exists in `main`'s history. | R1 | TODO |
| RB-63 | `ui/screens-auth` | `21bc3b4` | 2026-10-11 | Matt | #38 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-64 | `ui/screens-lists` | `667ebaa` | 2026-10-11 | Matt | #39 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-65 | `ui/screens-people` | `7840ff9` | 2026-10-11 | Matt | #51 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-66 | `ui/screens-profile` | `95a92f0` | 2026-10-11 | Matt | #43 merged | One commit pushed after #43 merged (`95a92f0`); `git cherry` finds that patch on `main`. | R1 | TODO |
| RB-67 | `ui/shell` | `dc35a48` | 2026-10-11 | Matt | #32 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-68 | `ui/social-context` | `3cdf1c6` | 2026-11-11 | Matt | #191 merged | Squash-merged; tip is the PR head. | R1 | TODO |
| RB-69 | `ui/taxonomy` | `45ce8ae` | 2026-10-26 | Arjun | #127 merged | Squash-merged; tip is the PR head. | R1 | TODO |

### 7.3 R2: superseded, but not identical to anything on `main` (7)

| ID | Branch | Tip | Last commit | Tip author | PR | Evidence | Risk | Status |
|---|---|---|---|---|---|---|---|---|
| RB-70 | `be/ranking-parity` | `5183389` | 2026-10-19 | Arjun | #107 closed | PR closed unmerged. An earlier version of `20261019000200_leaderboard_parity.sql` and its test; `main` has both files in a later version. Kept by `refs/pull/107/head`. | R2 | DONE |
| RB-71 | `chore/board-2026-10-24` | `aa12c7c` | 2026-10-24 | Matt | #124 closed | PR closed unmerged. One `TASKS.md` board edit, superseded by #122. Kept by `refs/pull/124/head`. | R2 | TODO |
| RB-72 | `design/beverage-icon-pilot` | `29e81a0` | 2026-11-01 | Matt | #134 merged, #148 closed | Tip is closed PR #148 (batch 3), kept by `refs/pull/148/head`. Its one icon that is not on `main`, `starbucks-frappuccino-mocha.svg`, was withdrawn on purpose by #160 (cafe or bottled identity unresolved, see `identity-issues.json`). This was the branch Codex wrote icon batches on; nothing has landed on it since 2026-11-01. Confirm Codex no longer starts from it. | R2 | TODO |
| RB-73 | `design/beverage-icons-batch-03` | `7fe42bd` | 2026-11-04 | Arjun | #164 closed | PR closed unmerged. Old bundled-icon pipeline (`app/public/bev-icons/`, removed by #199-#203). All 124 icon slugs on the branch exist on `main`. Kept by `refs/pull/164/head`. | R2 | DONE |
| RB-74 | `design/beverage-icons-batch-05` | `02b43f7` | 2026-11-04 | Arjun | none | **No PR, so no PR ref keeps it.** Batch-03 plus one commit, same old pipeline. All 152 icon slugs on the branch exist on `main`. | R2 | DONE |
| RB-75 | `spike/find-bev-s1` | `0b4413f` | 2026-11-14 | Arjun | none | **No PR.** Tip commit says "never merge"; the spike that shipped is #204 (`ui/find-bev-spike`). 13 file versions differ from `main`. Find Bev was dropped on 2026-11-16 (§1.1), so nothing here is wanted. | R2 | DONE |
| RB-76 | `ui/primitives` | `6938476` | 2026-10-11 | Matt | #26 merged | One commit pushed after #26 merged (`6938476`, 44pt hit areas, `HitTarget.tsx`). `HitTarget.tsx` is on `main`, but this commit is not covered by a PR ref. Diff it against `main` first. | R2 | TODO |

### 7.4 R3: owner decides, see P-04 (1)

| ID | Branch | Tip | Last commit | Tip author | PR | Evidence | Risk | Status |
|---|---|---|---|---|---|---|---|---|
| RB-77 | `be/hygiene-sweep` | `03577f1` | 2026-10-24 | Arjun | #228 merged | **Merged to `main`.** Nothing unmerged remains: the hygiene migration, `scripts/graph/verify-pipeline.ts` and its tests, and the extra pgTAP are all on `main`. `03577f1` is preserved as the branch's first commit. Safe to delete the branch now that #228 is closed. See P-04. | R3 | DONE |

## 8. Files

Method: an import graph of all 687 tracked source files, built with the TypeScript compiler's own
import scanner and resolved through the workspace aliases (`@/`, `@bevi/*`). Entry points were the
Expo Router routes, each package's `index.ts`, every script named in a `package.json`, a workflow
or `vercel.json`, the Edge Functions, and every test. Each candidate was then confirmed with
`git grep` across code, config, workflows and docs.

Result in one line: **the app has no orphan source files.** What is unreachable is one parked
feature (F-06, kept), one unused component (F-05) and seven dead exports. F-07 and F-10 are
reachable but obsolete.

### 8.1 Tracked files and folders

| ID | Path | What it is, and the evidence | After deleting | Owner | Risk | Status |
|---|---|---|---|---|---|---|
| F-01 | `CONVERSATION.md` (15 KB) | Raw transcript of the founding chat. Nothing reads it. Cited as a source in `DEVELOPMENT-ARJUN.md:6` and `DEVELOPMENT-MATT.md:3`. It is a private conversation in a public repository. | Reword the two citations. No checks. | Matt + Arjun | R2 | TODO |
| F-02 | `CONVERSATION-2.md` (29 KB) | Raw transcript of the second planning session. Nothing reads it. Cited in `TASKS.md:3` and `docs/bevi-ranking-math.tex:4,71`. | Reword the citations. No checks. | Matt + Arjun | R2 | TODO |
| F-03 | `index.html` at the repo root (67 KB) | The single-file static prototype from before the Expo app (tabs "Your lists", "Bev it", "Top bevs", "You"). Not deployed: Vercel builds `app/`, GitHub Pages is off, and no script, workflow or config reads it. `NEXT-MATT.md:44` and `TASKS.md:83` mention an "`index.html` design pass, not scoped", which may mean this file or `app/public/index.html`. | Drop or reword those two lines. No checks. | Matt | R2 | TODO |
| F-04 | `bevi-ui-inspiration/` (17 files, 6.7 MB) | 12 screenshots of the Beli app, 3 map images, a screens spec. No code reads it. Mentioned in `DEVELOPMENT-ARJUN.md`, `DEVELOPMENT-MATT.md`, `TASKS.md`. Screenshots of a third-party app in a public repository. | Reword the mentions, or keep `beli-screens-spec.md` alone. No checks. | Matt | R2 | TODO |
| F-05 | `app/src/components/FeaturedCard.tsx` and `app/src/components/__tests__/FeaturedCard.test.tsx` | A design-system component that no screen uses; only its own test imports it. | `npm run gen:components -w app`, then `npm run typecheck && npm test -w app`. | Matt | R2 | TODO |
| F-06 | The Google venue map: `app/src/features/map/` (15 source files, 5 tests), `app/src/components/{MapControls,MapFilterRow,VenueRow,VenueSheet}.tsx`, `app/src/components/__tests__/MapChrome.test.tsx`, `app/src/features/search/mapFilters.ts`, `app/src/lib/glass.ts`, `app/src/lib/venue.ts`. About 3,700 lines. | No route imports any of it today; it is reachable only from its own tests. **Decision 2026-11-16 (§1.1): keep.** The Map tab goes back to Google Maps, and this is the code to build from. With it stay `@googlemaps/js-api-loader`, `@types/google.maps`, `"google.maps"` in `app/tsconfig.json` and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`. | Nothing to delete. When the map is remounted, reword the three "kept for the Bev Maps integration" header comments (`app/src/api/hooks/venues.ts:1`, `app/src/features/map/MapView.tsx:1`, `app/src/features/search/mapFilters.ts:1`) and the "Search tab" note at `app/scripts/check-env.mjs:42`. For iOS: the Google Maps JavaScript API runs only in a browser, so the native build needs a native map view; the pure helpers (`filters.ts`, `reconcile.ts`, `lib/venue.ts`) carry over. | Matt | R3 | KEPT |
| F-07 | The Find Bev camera spike: `app/src/features/find-bev/spike/` (11 files, about 970 lines), `app/jest.cssModule.js`, and the `\.module\.css$` line in `app/jest.config.js`. | **Obsolete since the 2026-11-16 decision (§1.1)**: Find Bev is dropped, so the iPhone test it waited on (S2) no longer matters. The live Map route still imports it (`app/src/app/(tabs)/map/index.tsx` exports `MapTabWithSpike`), so it ships to production today, shown to internal reporters only. | Point the route at `FindBevScreen` (one line, until F-10), delete, then `npm run gen:components -w app`, `npm run typecheck && npm test -w app`. This also removes every citation of `docs/find-bev-in-app-plan.md`, a document that exists on no branch. | Arjun (author), Matt (lane) | R2 | DONE |
| F-08 | `design/beverage-icons/review/batch-*.png` (47 files) and `review/large-*.png` (16 files), 10.4 MB | Per-batch contact sheets from 2026-11-02 to 2026-11-14. `scripts/icons/review.py` rebuilds only `overview-NN.png` and `sizes-NN.png`, so these are a historical record that no script reads or regenerates. Named in `review/review.json` (66 times), `PROGRESS.md` (8), `README.md` (8). | Update those three files. `node scripts/icons/validate.mjs` must still pass. | Matt + Arjun | R2 | TODO |
| F-09 | `design/beverage-icons/graph-inspection.json` | One-off output of `scripts/icons/inspect-graph.ts`. Only `design/beverage-icons/PLAN.md` mentions it. | Reword the mention. No checks. | Arjun | R2 | TODO |
| F-10 | The Find Bev screen: `app/src/features/find-bev/FindBevScreen.tsx`, `FindArt.tsx`, `links.ts`, `__tests__/FindBevScreen.test.tsx`. | The Map tab's current content: an explainer that opens `bev-maps.vercel.app`. Obsolete since the 2026-11-16 decision (§1.1), but **it is the only screen the Map tab has** until the new map exists. | Delete in the PR that mounts the new map on the tab, not before. Then `npm run gen:components -w app`, `npm run typecheck && npm test -w app`. | Matt | R3 | DONE |

### 8.2 Dead exports inside live files

Each name appears exactly once in the repository: its own declaration. Deleting the declaration is
R1 because `npm run typecheck` proves it. An owner who expects to use one soon marks it `KEPT`.

| ID | Location | Symbol | Owner | Risk | Status |
|---|---|---|---|---|---|
| DC-01 | `app/src/api/hooks/auth.ts:13` | `useSessionQuery` | Matt | R1 | TODO |
| DC-02 | `app/src/api/hooks/feed.ts:210` | `useAppConfig` | Matt | R1 | TODO |
| DC-03 | `app/src/api/hooks/lists.ts:22` | `useRefreshRecommendations` | Matt | R1 | TODO |
| DC-04 | `app/src/features/bug-report/store.ts:790` | `isSending` | Matt | R1 | TODO |
| DC-05 | `app/src/theme/tokens.ts:115` | type `TypeStyle` | Matt | R1 | TODO |
| DC-06 | `packages/api/src/mappers.ts:710` | `mapWantToTryItem` | Arjun | R1 | TODO |
| DC-07 | `scripts/graph/sync-core.ts:84` and `:106` | types `ComputedLabel`, `ComputedType` | Arjun | R1 | TODO |

Checks: `npm run typecheck && npm test`.

### 8.3 Local-only files (untracked or ignored, Matt's machine)

| ID | Path | What it is | Risk | Status |
|---|---|---|---|---|
| L-01 | `internal/bevi-board/` (912 MB) | A nested git repository with one commit (2026-11-11) and **no remote**: it looks like an earlier build of the founders board (Cloudflare `worker/` and `.wrangler/` folders). This is its only copy. The current board is `~/Desktop/bevi-founders-board`. | R3 | TODO |
| L-02 | `internal/bevi-board-vercel/` (566 MB) | A clone of `mbwiller/bevi-founders-board`; its commit is in the real repository. **Its `backups/` folder is not**: `board-snapshot.json`, `cutover-snapshot.json`, `cutover-import.sql`, `import-snapshot.sql`. Move those out first. | R3 | TODO |
| L-03 | `VC-materials/untitled folder/` | Empty apart from a `.DS_Store`. | R1 | TODO |
| L-04 | `Beli-REA/` (131 MB) | The Beli APK used for the UI study, ignored through `.git/info/exclude`. Matt's reference material. | R2 | TODO |
| L-05 | `app/dist/` (3 MB) and `app/.expo/` | Web export from 2026-10-11 and Expo's cache. Both are rebuilt on demand. | R1 | TODO |
| L-06 | `design/system/node_modules/` (60 MB) | Rebuilt by `npm install` in `design/system/` when the design mirror is next built. | R1 | TODO |
| L-07 | `../bevi-wt/.npm-ci-*` (8 files) | Logs and marker files from an install on 2026-11-01. | R1 | TODO |
| L-08 | `.DS_Store` files (root, `design/`, `data/`, `bevi-ui-inspiration/`, `internal/`, `VC-materials/`) | Finder metadata, already ignored. | R1 | TODO |

Not candidates, keep: `.env.local`, `app/.env.local` and `supabase/.env` (credentials), `.vercel/`
and `supabase/.temp/` (project links), `VC-materials/Bevi-materials/` (the pitch pack) and
`docs/apple-developer-account.pdf` (both locally ignored since P-02, never to be committed), and
`docs/bevi-cicd-pipeline.tex` (untracked; commit it or move it).

### 8.4 Looked at and kept

These came up as possible candidates and are in use. Listed so nobody audits them twice.

| Path | Why it stays |
|---|---|
| `supabase/migrations/` (64 files) | Frozen once merged. Never a candidate. |
| `scripts/icons/` including the 68 `families/*.mjs` | No file imports the recipes because `build.mjs` loads the folder with `readdir`. Run by hand, documented in `design/beverage-icons/README.md` and the Codex skill. |
| `design/beverage-icons/{svg,portable-svg,png}/` (1,005 files, 62 MB) and `manifest.json` | Derived from the recipes but committed on purpose: `icons-sync.yml` publishes `portable-svg/` from the manifest, and `validate.mjs` checks all three. Open PRs #221 and #227 change this pipeline; revisit after they land. |
| `design/system/` including `project/components/bundle.js` | The design mirror's source and its committed build output. |
| `supabase/functions/graph-query/` | Deployed, with no caller in `app/` or `packages/api/` yet. `docs/graph.md` documents it as the graph's read path; recommendations are off pending data. |
| `supabase/functions/*/test.ts` | Run by `deno test`, not by an import. |
| `scripts/graph/dashboard/*.mjs`, `scripts/icons/swipe/app.mjs` | Browser modules served by `dashboard.ts` and `swipe.ts`. |
| `TASKS.md` (167 KB), `NEXT-ARJUN.md`, `NEXT-MATT.md`, `DEVELOPMENT-*.md`, `vision.md` | `TASKS.md` is cited by 59 files (task IDs in code comments and workflows). Tickets lived in Linear from 2026-11-09 and moved to the founders' board on 2026-11-17 (Linear is removed), so archiving the board is a separate job with its own plan. |
| `ICON-PIPELINE-VISION.md` | Nothing links to it, but it is the live BEV-15 plan. |
| `.claude/skills/` (43 files, the vendored `react-native-skills`) | Vendored at a pinned commit, and more relevant once the app goes native. |
| `.agents/skills/bevi-beverage-icons` | Symlink that gives Codex the icon skill. |
| `app/assets/icon.png` | Unreferenced today. It is the 1024 by 1024 app icon (byte-identical to `design/brand/app-icon-1024.png`), which the `icon` field of an iOS build needs. |
| App dependencies with no import: `expo-haptics`, `expo-glass-effect`, `expo-splash-screen`, `expo-system-ui`, `@react-native-async-storage/async-storage` | Unused because the app is web-only today (`app/CLAUDE.md:44`). A native build is what uses them. Removing them now means reinstalling them for the pivot. |
| `react-native-screens`, `react-native-web`, `react-native-worklets`, `react-dom` | No direct import, but required by Expo Router, the web build and Reanimated. |
| `app/public/`, `app/vercel.json`, `app/scripts/check-*.mjs`, `app/metro.minify.js` | The web build and its deploy checks. They stay for as long as the web app ships. |
| `CONTRACT_VERSION` in `shared/src/index.ts` | No code reads it; it is the contract's version marker. |
| 302 exports used only inside their own file | A redundant `export` keyword each. Harmless, not worth a PR. |

### 8.5 What this means for the iOS pivot

- F-07 is browser-only code that can go before the pivot: one of the app's three `.web.tsx` files
  and its only CSS module.
- F-06 stays, and it is the largest piece of browser-only code in the app: `MapView.web.tsx` drives
  the Google Maps JavaScript API, which does not run in a native build. The new Map tab (§1.1) is
  best designed once, with a native map view for iOS, instead of remounting the web map and porting
  it afterwards.
- The remaining browser-only pieces are in use and are pivot work, not cleanup: `html2canvas-pro`
  (the bug reporter's screenshot, `app/src/features/bug-report/capture.ts`), about 28 non-test
  files under `app/src/` that mention `document`, `window`, `navigator` or `localStorage`, and
  `app/app.config.ts`, which has no `ios` block, bundle identifier or EAS profile.
- `app/.gitignore` already ignores `ios/`, `android/` and signing files (`*.p8`, `*.p12`,
  `*.mobileprovision`), so a prebuild will not dirty the tree.

### 8.6 Not covered by this audit

- Database objects on prod (unused RPCs, tables, policies), storage buckets, and anything in the
  Supabase, Vercel, Neo4j, Google Cloud dashboards, including secrets and env vars.
- Arjun's machine (P-03).
- `npx knip` was blocked by the session's permission rules, so the import graph above stands in for
  it. Running `npx knip` once by hand is a cheap second opinion on §8.1 and §8.2.
- Git history size (a 208 MB pack, mostly icon PNG revisions). Shrinking it means rewriting public
  history, which is R4 and out of scope.

## 9. Suggested order

1. **§4**: P-01, P-02 and P-04 are done. P-03 is Arjun's and blocks only his rows.
2. **§5 worktrees**, R1 rows, then WT-05, then WT-09 when it is no longer in use. Frees about 7 GB.
3. **§6 local branches**: 6.1 with the guard script, then a glance at 6.2.
4. **§7 remote branches**: 7.2 with the guard script, then 7.3.
5. **§8.2, F-05 and F-07**: one small PR per lane, proven by typecheck and tests.
6. **F-01 to F-04, F-08, F-09**: one docs-only PR after Matt and Arjun agree.
7. **Still open**: F-10 with the new map, L-01, L-02. (P-04 closed: `be/hygiene-sweep` merged in #228.)

Steps 1 to 4 touch no file on `main` and need no PR.

## 10. Commands

### 10.1 Remove a worktree

```bash
git -C <path> status --porcelain          # must print nothing
git worktree remove <path>                # refuses a dirty tree; never add --force
```

### 10.2 Delete the R1 local branches (§6.1)

Skips any branch whose tip is no longer the audited one. `git branch -D` itself refuses a branch
that a worktree still has checked out.

```bash
while read -r b sha; do
  case "$(git rev-parse --verify -q "refs/heads/$b")" in
    "$sha"*) git branch -D "$b" ;;
    *) echo "SKIP $b: tip moved or branch gone" ;;
  esac
done <<'EOF'
be/bug-report-cors b39775b
be/bug-reporter 7e24d58
be/duplicates-cross-category 06f3eda
be/feed-no-saves adfdd4a
be/flavor-profiles eb17f1b
be/graph-dashboard fc25e9d
be/graph-instance ef8c9d7
design/icon-redraw-01 5fe363d
design/icon-redraw-02 08615b2
design/icon-redraw-03 ec46dbb
design/icon-redraw-04 08b43fa
fix-likes-test ba61484
round-verify ca7cc46
scratch/flavor-verify 1fbbcea
tools/icon-swipe 5fe363d
ui/contract-v2-fakeapi bfa0d36
ui/create-fixes 14ada2a
ui/gut-check-levels 81cff56
worktree-agent-a00cf6927da604bc2 921a712
worktree-agent-a0b52b7bf18115dd2 921a712
worktree-agent-acf8c08a8787ca4c9 921a712
worktree-agent-af5614f32d9a0605b 921a712
EOF
```

### 10.3 Delete the R1 remote branches (§7.2)

Skips a branch whose remote tip moved, and one that an open PR is based on.

```bash
git fetch origin --prune
while read -r b sha; do
  now=$(git ls-remote origin "refs/heads/$b" </dev/null | cut -c1-7)
  if [ "$now" != "$sha" ]; then echo "SKIP $b: remote tip is '${now:-gone}', audited $sha"; continue; fi
  if [ -n "$(gh pr list --base "$b" --state open --json number -q '.[].number' </dev/null)" ]; then
    echo "SKIP $b: an open PR is based on it"; continue
  fi
  git push origin --delete "$b" </dev/null
done <<'EOF'
be/bug-report-cors b39775b
be/bug-reporter 7e24d58
be/catalog-scaffold 91326e0
be/category-hierarchy d99a2fb
be/content-rpcs c17ee87
be/duplicates-cross-category 88622d2
be/embed-batch-limit 017093f
be/embed-pipeline d6d6e73
be/embed-vault-guard 8f9075f
be/graph-dashboard fc25e9d
be/graph-edges 7045af1
be/graph-stats 9fece7c
be/graph-tables 1ad2b96
be/social-context 3d448e4
be/taste-graph d582412
be/venues-api 4897c5a
chore/board-state-2026-10-25 b4ed599
chore/tasks-week1-progress ef5a8c6
claude/sleepy-wozniak-ap1798 30deae1
claude/upbeat-galileo-iuhp0s dbab1ff
contract/ranking-createdat-doc 04a2e8e
contract/vectors-v1 6f00674
design/beverage-icons-catalog 76d7559
design/icon-redraw-03 ec46dbb
fix/app-jest-worker-memory 805d6ac
fix/app-jest-worker-memory-1gb c811efe
fix/bev-13-rename-rerank 72fc9d2
fix/ranking-createdat-conformance 431baef
rank/taste-graph d968711
test/rerank-redates-ranked-at f0202c3
tools/icon-swipe 5fe363d
ui/avatar 11d7165
ui/bev-8-report-drop 2c2b687
ui/beverage-icons-batch11 d07a6b0
ui/beverage-icons-batch12 51635cd
ui/beverage-icons-batch13 220df6f
ui/beverage-icons-energy-next 8fc09cc
ui/beverage-icons-fresca 40334e9
ui/beverage-icons-next-20 d4a5cd7
ui/beverage-icons-production 1d5a38e
ui/contract-v2-fakeapi bfa0d36
ui/controls 9d178a6
ui/create-fixes 14ada2a
ui/dark-statusbar 6c2c06f
ui/expo-57-patches 3273dae
ui/feed-fixes ca53430
ui/find-bev-spike 9388377
ui/fix-sort-jump e84acb2
ui/flow 88261ca
ui/gut-check-levels 81cff56
ui/leaderboard-icons a28eb93
ui/mock-api 47d801f
ui/mock-ranking c551fc2
ui/nav-redesign 98802a1
ui/polish-feed-post f7aab58
ui/polish-profile 0e96b42
ui/polish-rows 4c58042
ui/polish-small-fixes 8816dc4
ui/privacy-wording bfd2855
ui/rank-fixes 0f6cc59
ui/rows dd56ff5
ui/scaffold 0994b4e
ui/screens-auth 21bc3b4
ui/screens-lists 667ebaa
ui/screens-people 7840ff9
ui/screens-profile 95a92f0
ui/shell dc35a48
ui/social-context 3cdf1c6
ui/taxonomy 45ce8ae
EOF
```

Restore a deleted branch that had a PR: `git fetch origin pull/<N>/head:<branch>`.
Restore a deleted local-only branch (before `git gc` prunes it): `git branch <name> <tip>`.

### 10.4 Re-run the audit (also for P-03, on Arjun's machine)

```bash
git fetch origin --prune
git worktree list
for w in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do
  echo "== $w: $(git -C "$w" status --porcelain | wc -l | tr -d ' ') uncommitted or untracked"
done
git branch -vv                              # local branches, with upstream state
git branch --no-merged origin/main          # squash-merged branches show here too: check the PR
gh pr list --state all --limit 1000 --json number,state,headRefName,headRefOid,baseRefName
git stash list                              # Matt's machine had none
```

A branch is R1 when its last PR is merged and that PR's `headRefOid` is the branch tip, or when
`git merge-base --is-ancestor <branch> origin/main` succeeds.

## 11. Change log

Append one line per action. Reasons for `KEPT` and `BLOCKED` go here.

| Date | Who | IDs | What happened | PR or commit |
|---|---|---|---|---|
| 2026-11-16 | Claude (Matt's session) | all | Audit written. Nothing deleted. Local `main` fast-forwarded from `380c425` to `2667150` to audit the current tree. | - |
| 2026-11-16 | Claude (Matt's session) | P-01, WT-09, LB `design/icon-redraw-04` | The three review notes committed on `design/icon-redraw-04` (`08b43fa`) and brought to `main`. WT-09 drops from R4 to R2 (clean, but another session is using it). | #229 |
| 2026-11-16 | Claude (Matt's session) | P-02 | `VC-materials/`, `internal/`, `docs/apple-developer-account.pdf` added to Matt's `.git/info/exclude`. | local only |
| 2026-11-16 | Matt | F-06, F-07, F-10 | Decision recorded (§1.1). F-06 `KEPT`: the Map tab returns to Google Maps. F-07 drops from R3 to R2 (Find Bev is obsolete). F-10 added. | #229 |
| 2026-11-16 | Claude (Matt's session) | RB and LB `design/beverage-icon-pilot`, P-04 | Both unmerged branches checked. The pilot branch's one icon missing from `main` (`starbucks-frappuccino-mocha`) was withdrawn on purpose in #160, so both rows drop from R3 to R2. `be/hygiene-sweep` is real unmerged work: P-04. | #229 |
| 2026-11-16 | Claude (Arjun's session) | P-03 | §10.4 run on Arjun's machine: 29 worktrees (about 13 GB), 61 local branches, three dirty trees, one stash. New rows in §12. | #TBD |
| 2026-11-16 | Claude (Arjun's session) | RB-70, RB-73, RB-74, RB-75 | Deleted from `origin`. Every tip matched the audited SHA and no open PR was based on any of them. `batch-05` and `spike/find-bev-s1` had no PR ref, but an identical local branch remains on Arjun's disk, so neither deletion is final; both locals move to A-LB R2 in §12.3. | #TBD |
| 2026-11-16 | Claude (Arjun's session) | A-01, A-02 | Two pieces of work that existed on exactly one disk are now on `origin`: `be/bayes-prior-propagation` (`884f559`, the A-14 follow-ups, 1,115 lines, uncommitted in an agent worktree since 2026-10-24) and `docs/ios-migration` (`ee6527d`, the iOS migration assessment, untracked since 2026-11-14). | §12.1 |
| 2026-11-18 | Claude (Matt's session) | F-07, F-10 | Deleted `app/src/features/find-bev/` (the spike and the Find Bev screen), `app/jest.cssModule.js` and the `.module.css` mapper in `app/jest.config.js`. The Map tab now shows an in-progress page (`app/src/features/map/MapInProgressScreen.tsx`) until the new map exists. Matt's go-ahead 2026-11-18; `gen:components`, typecheck and the app tests run. | `ui/bev-27-im-2-first-boot` |
| 2026-11-19 | Claude (Arjun's session) | P-04, RB-77 | #228 reviewed on a local stack and merged. Re-verified the premise (a new `public` table still inherits TRUNCATE for `anon`/`authenticated`) and the fix (0 TRUNCATE grants left; `truncate public.bevs` as `authenticated` now 42501). Found and fixed two regressions the 11-16 review could not have seen. (1) `20261116235414` sorted below `app_config` and `ping`, which merged on 11-18, so `supabase db push` refused it with `DbPushMissingRemoteError` -- retimestamped to `20261119152455`. (2) IS-7 (#254) merged `user_blocks` and `content_reports` mid-review, both holding TRUNCATE for `anon`/`authenticated`; on `user_blocks` one request would have unblocked every abuser from every victim, since TRUNCATE is not subject to RLS. Swept in a new section 2e (TRUNCATE only from `authenticated`, everything from `anon`, because `41_blocks_and_reports.test.sql` asserts the DML as RLS no-ops with bare statements). Added `supabase/tests/42_table_privileges.test.sql`: the revoke as a schema-wide invariant rather than a table list, so the next table that forgets it fails on the day it lands. | #228 |

## 12. Arjun's machine (P-03)

Audited 2026-11-16, `origin` fetched and pruned, same risk scale as §2. 29 worktrees (about
13 GB: 7.5 GB under `/private/tmp/bevi-*`, 4 GB under the session scratchpads, 1.6 GB in
`.claude/worktrees/`), 61 local branches, three dirty trees, one stash. A further 1 GB of loose
logs, npm caches, review sheets and `.json` scratch sits in `/private/tmp` outside any repository.

One difference from Matt's machine changes the risk: **24 of the 29 worktrees live under
`/private/tmp`, which macOS prunes daily.** It has already run. `bevi-icons-batch-03`,
`bevi-icons-batch-05`, `bevi-icons-publish` and one scratchpad worktree are 0 bytes with only
their `.git/worktrees` metadata left, and `…/scratchpad/tax` is gone from disk entirely. Nothing
whose only copy is a worktree should be left there, and §5's "a clean worktree is R1 whatever its
branch holds" holds here only because the branches are pushed.

### 12.1 Resolved during the audit

| ID | What | Outcome | Status |
|---|---|---|---|
| A-01 | `supabase/migrations/20261025000300_bayes_prior_propagation.sql` (32 KB) + `supabase/tests/15_bayes_prior_propagation.test.sql` (19 KB), untracked in `.claude/worktrees/agent-ac98ed97f9237fc36` since 2026-10-24, in no git object on any ref, plus 13 lines of edits to `shared/src/types.ts`, `09_leaderboard_parity.test.sql`, `TASKS.md` and `NEXT-ARJUN.md`. | Committed unchanged as `884f559` on `be/bayes-prior-propagation` and pushed. Not rebased, not reviewed, never run against a database; the timestamp is below `main`'s high-water mark (`20261113000100`) and needs renumbering before any `db push`. No `CONTRACT_VERSION` change (the `shared/src` edit is a doc comment). | DONE |
| A-02 | `docs/bevi-ios-migration.tex` + `.pdf`, untracked since 2026-11-14, on no branch. | Committed as `ee6527d` on `docs/ios-migration` and pushed, following `docs/bevi-ranking-math.{tex,pdf}`. Scanned for credentials first. Opened as #263, which reads it as a dated record: the pivot it argues about has since been decided and the live plans are `DEVELOPMENT-ARJUN-IOS.md` and `DEVELOPMENT-MATT-IOS.md` (#256). | DONE |
| A-03 | The main checkout was dirty: 751 untracked entries and 17 modified files, on `be/custom-bev-icons` while `main` had moved 38 commits. 461 untracked files were byte-identical to `main` and 122 more were older copies of files on `main` (including `CLAUDE.md` and `.claude/hooks/slack-inbox.sh`); 162 were `app/public/bev-icons/*.svg` from the pipeline #199–#203 removed, all 162 present in history. | Archived whole, then cleared; the 17 modified files reverted; the stash (`package-lock` churn, 47 lines) dropped. Checkout fast-forwarded to `main`. | DONE |
| A-04 | `docs/find-bev-in-app-plan.md` (39 KB), untracked and on no branch — the plan F-07 cites. | Binned under the §1.1 decision, archived not committed. This closes F-07's "citations of a document that exists on no branch": it existed, here, and no longer does. | DONE |
| A-05 | `beverage-ticketing-codex/` (9 files, 2026-11-02): a separate project sitting untracked in the repository root. | Moved to `~/projects/beverage-ticketing-codex`. | DONE |
| A-06 | `scripts/icons/staging/{hydration,sparkling}-expansion.mjs` and `scripts/icons/families/mountain-dew.mjs`, untracked. | Not committed, all three superseded: `staging/sparkling-expansion.mjs` is an older copy of `families/sparkling-expansion.mjs` on `main`, `staging/hydration-expansion.mjs`'s extra `power()` recipes were redrawn as `families/redraw-powerade.mjs` on `main`, and `families/mountain-dew.mjs` is byte-identical to its copy on #221. | DONE |

### 12.2 Worktrees (29)

`main` checkout aside, every one is clean. Sizes are after the `/private/tmp` pruning, so a 0 B
row is a folder the cleaner has already emptied.

| ID | Path | Branch | Size | Risk | Status |
|---|---|---|---|---|---|
| A-WT-01 | `/Users/arjuncheema/projects/bevi` | the checkout | 2.7 GB | - | not a candidate |
| A-WT-02 | `/private/tmp/bevi-barcode-poc` | `ui/barcode-nutrition-poc` | 830 MB | R4 | TODO |
| A-WT-03 | `/private/tmp/bevi-icon-app` | `ui/bev-icon-app-integration` | 881 MB | R4 | TODO |
| A-WT-04 | `/private/tmp/bevi-icon-quality-eval` | `be/BEV-15-icon-quality-eval` (#227 open) | 882 MB | R2 | TODO |
| A-WT-05 | `/private/tmp/bevi-nutrition-contract` | `contract/barcode-nutrition` (#222 open) | 98 MB | R2 | TODO |
| A-WT-06 | `/private/tmp/bevi-nutrition-backend` | `be/barcode-nutrition` (#223 open) | 98 MB | R2 | TODO |
| A-WT-07 | `/private/tmp/bevi-nutrition-production` | `ui/barcode-nutrition` (#224 open) | 912 MB | R2 | TODO |
| A-WT-08 | `…/efff4560-…/scratchpad/wt-icons` | `be/custom-bev-icons-rebased` (#221 open) | 881 MB | R2 | TODO |
| A-WT-09 | `/private/tmp/bevi-recoup` | `be/recoup-hydration` (#230 merged) | 900 MB | R1 | TODO |
| A-WT-10 | `/private/tmp/bevi-icons-fresca` | `ui/beverage-icons-fresca` (#195) | 884 MB | R1 | TODO |
| A-WT-11 | `/private/tmp/bevi-icons-batch11` | `ui/beverage-icons-batch11` (#202) | 867 MB | R1 | TODO |
| A-WT-12 | `/private/tmp/bevi-icons-batch13` | `ui/beverage-icons-batch13` (#217) | 98 MB | R1 | TODO |
| A-WT-13 | `/private/tmp/bevi-icons-batch12` | `ui/beverage-icons-batch12` (#213) | 93 MB | R1 | TODO |
| A-WT-14 | `/private/tmp/bevi-icons-batch09` | `ui/beverage-icons-next-20` (#189) | 21 MB | R1 | TODO |
| A-WT-15 | `/private/tmp/bevi-icons-energy` | `ui/beverage-icons-energy-next` (#181) | 18 MB | R1 | TODO |
| A-WT-16 | `/private/tmp/bevi-icons-release` | `ui/beverage-icons-production` (#178) | 10 MB | R1 | TODO |
| A-WT-17 | `/private/tmp/bevi-icons-publish` | `design/beverage-icons-catalog` (#160) | 0 B | R1 | TODO |
| A-WT-18 | `/private/tmp/bevi-icons-batch-03` | `design/beverage-icons-batch-03` (#164 closed) | 0 B | R1 | TODO |
| A-WT-19 | `/private/tmp/bevi-icons-batch-05` | `design/beverage-icons-batch-05` (no PR) | 0 B | R1 | TODO |
| A-WT-20 | `…/17c34adb-…/scratchpad/wt-findbev-spike` | `ui/find-bev-spike` (#204) | 862 MB | R1 | TODO |
| A-WT-21 | `…/e11f95c4-…/scratchpad/wt-tickets` | `fix/ranking-createdat-conformance` (#216) | 937 MB | R1 | TODO |
| A-WT-22 | `…/e11f95c4-…/scratchpad/wt-contract2` | `contract/ranking-createdat-doc` (#218) | 877 MB | R1 | TODO |
| A-WT-23 | `…/e11f95c4-…/scratchpad/track-a` | `test/rerank-redates-ranked-at` (#220) | 98 MB | R1 | TODO |
| A-WT-24 | `…/e11f95c4-…/scratchpad/bev13` | `bev13-local` (#215) | 94 MB | R1 | TODO |
| A-WT-25 | `…/e11f95c4-…/scratchpad/wt-contract` | `contract/gut-check-order-docs` (#211) | 88 MB | R1 | TODO |
| A-WT-26 | `…/76abc3b1-…/scratchpad/wt` | detached | 0 B | R1 | TODO |
| A-WT-27 | `…/76abc3b1-…/scratchpad/tax` | `ui/taxonomy` (#127) | gone from disk | R1 | TODO |
| A-WT-28 | `.claude/worktrees/agent-a5dcef9ce277606f6` | `be/hygiene-sweep` (#228 open, P-04) | 788 MB | R1 | TODO |
| A-WT-29 | `.claude/worktrees/agent-ac98ed97f9237fc36` | `be/bayes-prior-propagation` | 788 MB | R1 | TODO |

A-WT-02 and A-WT-03 are the only R4 rows: their branches exist on no remote and have no PR, so
each worktree's folder is the only place that work lives. Arjun is pushing both as of
2026-11-16; they drop to R1 the moment `git ls-remote origin <branch>` answers. A-WT-04 to
A-WT-08 are R2 only because an open PR is being worked in them — removing the folder would not
lose a commit. A-WT-28 and A-WT-29 are R1 as worktrees even though P-04 is undecided, because
removing a worktree never touches its branch.

Checks after this section: `git worktree list` shows the checkout plus anything kept, and
`git worktree prune --dry-run -v` prints nothing.

### 12.3 Local branches (61 besides `main`)

**R1, 45 branches.** 12 are dead `worktree-agent-*` left by agent sessions, all ancestors of
`main`. 6 more are ancestors of `main` outright. 14 are the exact head of a merged PR, and 13 are
contained in one (`git merge-base --is-ancestor <branch> <PR head>`), which covers a tip that sits
behind the merged head. Guard list for §10.2's script:

```
be/taste-graph d582412
tooling/agent-slack 3f8490a
be/embed-config-vault 2dad111
ui/find-bev-spike 9388377
docs/graph-db-implementation c3cffa2
contract/gut-check-order-docs 1768290
design/beverage-icons-catalog 76d7559
ui/beverage-icons-production 1d5a38e
ui/beverage-icons-fresca 40334e9
ui/beverage-icons-next-20 d4a5cd7
ui/beverage-icons-energy-next 8fc09cc
ui/beverage-icons-batch11 d07a6b0
ui/beverage-icons-batch12 51635cd
ui/beverage-icons-batch13 220df6f
ui/taxonomy 5173a27
be/venues-api 5dd0f2b
be/category-hierarchy cd19e6b
chore/board-state-2026-10-25 5c32b60
fix/bev-7-create-bev-fields-shift a23ec55
fix/bev-9-gut-check-order 4b4d1fb
fix/bev-10-bev-of-period-two-cards 0c3df90
fix/bev-11-bucket-filter-name 65656c4
be/recoup-hydration a8a0321
be/embed-batch-limit 017093f
design/beverage-icons-batch-03 7fe42bd
be/ranking-parity 5183389
pr175 81cff56
bev13-local 72fc9d2
fix/bev-13-rename-rerank 790f35a
fix/app-jest-worker-memory-1gb c811efe
contract/ranking-createdat-doc 04a2e8e
test/rerank-redates-ranked-at f0202c3
fix/ranking-createdat-conformance 431baef
```

plus `worktree-agent-{a1ace273c5d4ec4e2, a3329a9d582fe7057, a344d57a4fd63ee57, a4706de676e619f6d,
a502aebfd5f02b09f, a5dcef9ce277606f6, a5f73c78e7a21ab39, a66a9b01d1d0bca28, aa76ab55e6e63ac1d,
aad68c7c460a358dd, ac98ed97f9237fc36, acabb286fcfd3a30d}`, each at `921a712`, `86e09ad`, `39e5d5b`,
`bab79ee`, `80ea8e1`, `1a18ec0` or `cdbfc81` — all on `main`. Several are checked out in §12.2
worktrees, so do §12.2 first; `git branch -D` refuses the rest.

**R2, 5 branches.**

| ID | Branch | Tip | Evidence | Risk | Status |
|---|---|---|---|---|---|
| A-LB-01 | `be/custom-bev-icons` | `31381bc` | Never pushed. The pre-rebase version of #221: its tip commit has the same subject as `99661f1` on `be/custom-bev-icons-rebased`, and its two unique commits are pre-squash versions of #167 and #161. Matt's LB-23 is the same shape. The working tree that sat on it is archived (A-03). | R2 | TODO |
| A-LB-02 | `be/bug-reporter` | `c2d1e02` | Four commits not contained in #167's head, each a pre-squash version of merged work (#167 bug reporter 2.11.0, #161 venues 2.10.0). | R2 | TODO |
| A-LB-03 | `fix/app-jest-worker-memory` | `805d6ac` | Same as RB-25: one commit pushed after #210 merged, the same change merged as #214. | R2 | TODO |
| A-LB-04 | `design/beverage-icons-batch-05` | `02b43f7` | **Now the only copy** — RB-74 was deleted from `origin` on the strength of this branch. No PR, so no PR ref. All 152 icon slugs on it exist on `main`. | R2 | TODO |
| A-LB-05 | `spike/find-bev-s1` | `0b4413f` | **Now the only copy** — RB-75 was deleted from `origin` on the strength of this branch. No PR. Tip says "never merge"; the spike that shipped is #204, and Find Bev was dropped on 2026-11-16 (§1.1). | R2 | TODO |

**Keep, 11 branches:** the six with an open PR (`be/custom-bev-icons-rebased` #221, `contract/barcode-nutrition` #222, `be/barcode-nutrition` #223, `ui/barcode-nutrition` #224, `be/BEV-15-icon-quality-eval` #227, `be/hygiene-sweep` #228), the two just pushed (`be/bayes-prior-propagation`, `docs/ios-migration`), the two Arjun is pushing (`ui/barcode-nutrition-poc`, `ui/bev-icon-app-integration`), and `chore/cleanup-p03`, which carries this section.

### 12.4 Local-only files (Arjun's machine)

| ID | Path | What it is | Risk | Status |
|---|---|---|---|---|
| A-L-01 | `design/beverage-icons/style-refs/` (11 PNGs, 408 KB) | Style references for the served-drinks and agua-fresca icons (`horchata-traditional`, `generic-margarita`, `matcha-latte-with-boba`, …). **In no git ref on any branch**, and referenced by nothing on `main`. They are **outputs, not inputs**: `scripts/icons/export-style-refs.mjs` (on `be/BEV-15-icon-quality-eval`, #227) renders them from the authored SVG masters and uploads them to the private `bev-style-refs` bucket, and the bucket is what the worker reads. That same branch's `.gitignore` excludes the directory on purpose, with the reason in a comment: their hashes depend on whichever icon batch is in flight, so committing them would ship a drift guard that fails on a clean checkout. That ignore rule is also why no earlier session saw them. **Decided 2026-11-16: not committed**, left on disk and added to Arjun's `.git/info/exclude` so they stop showing up as untracked. | R1 | KEPT |
| A-L-02 | `/private/tmp/bevi-*` loose files (about 1 GB) | Not worktrees and in no repository: `bevi-nutrition-npm-cache` (314 MB), `bevi-icon-npm-cache` (237 MB), `bevi-swift-cache` (201 MB), `bevi-cloudflared{.tgz,-bin}` (57 MB), eleven review and batch folders, and about 40 logs, PR bodies and `.json` scratch files. Rebuilt or regenerated on demand. | R1 | TODO |
| A-L-03 | The A-03 archive (34 MB) | `untracked-working-tree.tar.gz`, the 17 modified files and the stash patch, in this session's scratchpad — which is itself temporary. Move it if it should outlive the session; otherwise it goes with the scratchpad. | R2 | TODO |

### 12.5 Not covered

Arjun's `internal/`, `VC-materials/` or equivalents were not inventoried — §8.3 is Matt's machine
only, and the `/private/tmp` sweep above stops at the repository's own scratch. Nothing on any
dashboard, database or hosted service was touched.
