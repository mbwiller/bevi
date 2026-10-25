# Bevi — Tasks from the 2026-10-14 session

Source: `CONVERSATION-2.md` (raw transcript). This file turns that conversation into tasks, split by lane. The maths asked for in topic 6 lives in `docs/bevi-ranking-math.tex` (compiled: `docs/bevi-ranking-math.pdf`).

**Revision 2 (2026-10-14, later the same day, Matt with Claude).** Two additions that were not in the transcript, decided after research:

- **The Bev graph moves to a graph database.** Bevs, categories, brands and flavour profiles become nodes in **Neo4j AuraDB Free** with similarity-weighted edges (Pepsi next to Coke); Supabase stays the system of record for the Bev row, users and rankings; a nightly job keeps the two in step and writes the edges back to Postgres for the hot path. §1b, §1d, A-15..A-17, M-24.
- **The map lives in the Search tab.** The centre tab becomes **Search**: the Bev search bar on top, a live NYC map underneath that you can pan in place or open full screen, search results sliding over the map. The map copies Beli's map UI (three reference screenshots in `bevi-ui-inspiration/beli-map-images/`), is **strictly constrained to New York City**, runs on **Google Maps JS** with the Bev Maps key, draws venues imported from **OpenStreetMap** plus our own curation. §1b, §1c, M-15, M-16, A-08. *(The Find Bev button and "Where did you have it?" were removed on 2026-10-19.)*

## Now: the board (2026-10-19)

**Start here.** Each of us has a plan: [`NEXT-MATT.md`](NEXT-MATT.md) and [`NEXT-ARJUN.md`](NEXT-ARJUN.md). Both list what to build first, what blocks whom, and which files we both touch. Everything below this board is history and per-task detail. When you start or finish a task, update its row here in the same PR.

**P0 and P1: finish these before P2 (§0).**

| Task | What | Owner | Status | Blocked by | Unblocks |
|---|---|---|---|---|---|
| **A-15 fix (urgent)** | **Done 2026-10-24.** The instance is `bevi-graph-db`; the four `NEO4J_*` secrets are set in GitHub Actions and in the Supabase project, `scripts/graph/schema.cypher` is applied, and `(:Meta).lastKeepAliveAt` was written. The keep-alive's ten green runs were all no-ops (`NEO4J_URI is not set`), and a scheme regex that could not match `neo4j+s://` meant it would have failed anyway — fixed in this PR, so dispatch `graph-keepalive` once it merges | Arjun | **Done** | — | Everything on the graph |
| **A-14** | Leaderboard parity in SQL (prior, fallback, total order) | Arjun | **#107**, rebased on main, reviewed three ways. Merges once `20261019000200` is on prod. Follow-ups are listed under A-14 in §4 | — | M-22's cross-check |
| **M-19** | Taste Profile screen | Matt | **Ready** | — | — |
| **D-04** | The finer category list, `design/taxonomy.md` (high effort), **plus the 378 catalog Bevs assigned to leaves** | Matt | **Ready** | — | A-13, then M-21 |
| **M-22** | Maths review: paper ↔ `@bevi/ranking` ↔ SQL | Matt | **Ready** | — | Any A-14 follow-ups |
| **M-26 export** | Run `packages/ranking/eval/export.sql` on prod and hand Matt the file (outside the repo) | Arjun | **Ready**, about 15 min | — | Real baseline numbers for M-27 and A-16 |
| **S-04 + A-04** | Explore backend (read-only posts, D-15), one combined PR including the FakeApi | Arjun | **Done in #113**, `20261019000400` on prod, contract `2.6.0` | — | M-04 |
| **M-04** | Explore screen | Matt | **Ready**, backend live on prod (#113) | — | — |
| **A-16 (1) + S-14 (2)** | **The Bev graph:** embeddings, weighted `SIMILAR_TO` edges in Neo4j, a `bev_edges` mirror in Postgres, nightly rebuild plus new-Bev updates, D-11 inference. Includes the contract (`similar`, `similarities`, `listBucketBevs`) | Arjun | **Built, Postgres-only — no Neo4j needed.** #115 (`20261019000500`: tables, RLS, the three read RPCs, contract `2.7.0`), #117 (`20261023000100`: the `embed` Edge Function, async `bevs` triggers, backfill — function deployed, `EMBED_WEBHOOK_SECRET` set), #118 (`20261023000200`/`0300`: `build-edges.ts`, D-11 inference, the two service-role RPCs, `graph-edges.yml`). All on prod. **Three operator steps remain:** one backfill run (needs the service-role key), the two `bevi.embed_*` database settings for the trigger, and the `SUPABASE_SERVICE_ROLE_KEY` Actions secret. Until the backfill runs `bev_edges` stays empty, every `emb` term is 0 and the sanity figure is meaningless — the builder warns rather than failing. The Neo4j mirror (steps 6, 8, 9) is a separate increment and nothing above depends on it | — | M-27, M-21 |
| **M-27** | Use the Bev graph: recommendations read edge weights, plus a "Bevs like this" row | Matt | **Ready to build** against the FakeApi (contract `2.7.0` is live); real weights arrive with the backfill | — | — |
| **A-13** | Category hierarchy: `categories.parent_id` in Postgres, `CHILD_OF` in Neo4j, `Category.parentId` | Arjun | Waiting | D-04 | M-21, a better tree term |
| **M-21** | Category-aware placement (compare a new mocha with mochas first) | Matt | Waiting | A-13, A-16 (1) | — |
| **M-28** | Taste formulas for the second increment (`packages/ranking/src/graph.ts`) | Matt | Later | A-16 (1) | A-16 (2) |
| **A-16 (2)** | **The taste graph:** `RANKED` edges updated on every ranking, taste neighbours, the co-rating weight | Arjun | Later | A-16 (1), M-28 | — |

**P2: after P0 and P1.**

| Task | What | Owner | Status | Blocked by | Unblocks |
|---|---|---|---|---|---|
| **S-10 + A-08** | Venues (Upper East Side and Roosevelt Island first) and the trimmed venues contract | Arjun | Ready once P0/P1 are done | — | M-16 |
| **M-16** | Map UI in the Search tab | Matt | Waiting | S-10 + A-08, and the Maps key from Arjun | — |
| **S-13 + A-12** | Duplicates: `duplicateOfId` and the `merge_bev` admin routine (plan approved) | Arjun | Ready once P0/P1 are done | — | M-20 |
| **M-20** | "Duplicate of…" step in the report sheet | Matt | Waiting | S-13 + A-12 | — |

**Joint housekeeping, any time:**
- Decide whether to turn on `deploy-dev`.
- Drop `backup.feed_events_20261014`.
- Update `DEVELOPMENT-MATT.md` §5, §6.8 and §6.16 (they still describe Add Bev and the Bevs · People tabs).

---

**Graph and kickoff decisions (2026-10-19, Matt and Arjun).**
- **Neo4j stays, and it holds the Bev graph** (reverses Claude's "Postgres only" proposal):
  - Bevs, categories, brands and flavours are nodes, joined by weighted `SIMILAR_TO` edges (Pepsi next to Coke). We chose it because a weighted Bev graph is the right model for similarity, recommendations and placement, not because of data size.
  - Supabase stays the system of record. The app reads the `bev_edges` mirror in Postgres, so nothing a user taps waits on Neo4j, and the app still works if the instance pauses. "Neo4j is never on a request path" stays.
  - This **reverses #87's narrowing:** Bev-to-Bev edges come first (A-16 (1)), and taste neighbourhoods come second (A-16 (2)). `docs/graph_db_implementation.md` and `docs/graph.md` get updated in A-16 (1)'s PR.
- **When the graph updates:**
  - Bev-to-Bev edges depend on the catalog, not on ratings. So a new or edited Bev gets its edges right away (an async database webhook to an Edge Function), and a nightly full rebuild re-checks everything. The rebuild doubles as the keep-alive.
  - The rating-driven parts (`RANKED` edges, taste neighbours, the co-rating weight) update on every ranking in A-16 (2), also async, so a ranking never waits on the graph.
  - The free tier doesn't limit how often we run: it has no query cap. Its limits are 200,000 nodes and 400,000 relationships (we use under 1%), a pause after 72 hours with no activity, and no Graph Data Science, which we don't need (`edgeWeight` in `@bevi/ranking` computes the weights).
- **Embeddings are back in A-16 (1):** `gte-small`, free inside Supabase Edge Functions. `edgeWeight` gives them 0.30, and the Coke–Pepsi ≥ 0.8 sanity check needs them.
- **D-11 decided: option 1.** A user-created Bev copies the flavour profile of its most similar seeded Bev, marked `inferred` (structure in A-16 (1)).
- **D-04:** Matt writes the category list with high effort.
- **Duplicates plan (S-13, A-12, M-20) approved** as proposed.
- **The trimmed S-10 approved.** A "contract" is the shared `shared/src` interface, and it ships inside the feature's combined PR.
- **New tasks:** M-27 (use the Bev graph in the app) and M-28 (taste formulas for A-16 (2)).

---

## History: progress notes by session

**Progress (2026-10-14, evening, Matt with Claude).**
- **Done, live and checked by Matt on the site:** M-09 (#60), M-11 (#61) and M-06 (#62). What shipped, and the corrections to the original task text, are under each task in §3.
- **Every merge to `main` now deploys to production** at `bevi-gamma.vercel.app` (#58). Other branches never deploy. For a preview, run `vercel deploy` from the repo root, without `--prod`. Arjun's merges deploy too.
- **CI on `main` breaks whenever Expo ships an SDK patch.** `expo-doctor` checks against Expo's current versions. #63 bumped the SDK 57 patches, and S-18 is the lasting fix.
- **Next in Matt's lane:** M-07, which is decided and waits on the design-system change. Then the rest of §7.

**Progress (2026-10-15, early hours, Arjun with Claude).** The whole backend half of week 1 plus the week-2 contracts are merged, and **production already has the schema**.

- **Merged:** A-15 + S-17 (#72), A-01 (#69), S-01 (#65), S-02 (#82), S-03 (#67), S-14 part 1 (#68), A-02 (#70), A-03 (#71), A-17 (#73), and Matt's app-side #80. `main` is green.
- **The database was migrated before any of it merged.** All five migrations (`20261014000100`–`20261014000500`) were pushed to prod from `scratch/round-verify` on 2026-10-14. Matt's call, and the right one: merging the api code first would have broken the live feed, since the #69 mapper throws on old `want_to_try` rows and #71 reads `row.comments`. Migrations first is safe because `get_feed` keeps its parameters and only gains columns.
- **18 of 32 `feed_events` rows were deleted** (16 `want_to_try`, 2 `followed`). All 32 are preserved in `backup.feed_events_20261014`, in a private schema with no `anon`/`authenticated` grants. Drop it once nobody wants it.
- **Those five migration files are frozen.** Prod has them; a change now means a new migration, per the append-only rule.
- **Likes and comments exist end to end in the backend but have no UI.** Nothing in `app/` calls `feed.like` or `api.comments`; the only references are in the jest mock. M-02 and M-03 are the next two tasks that make the feature reachable. *(Closed since by M-02 #90 and M-03 #91.)*
- **S-14 shipped as part 1 only** — the flavour-profile field names. `BevsApi.similarities`/`similar`, `RankingsApi.listBucketBevs` and `Category.parentId` are deliberately deferred to part 2, which lands with A-16; declaring them earlier would oblige `packages/api` to implement methods with no SQL behind them.
- **A-15's "10 nearest Bevs" check moved to A-16.** It cannot pass on its own: nearest-by-embedding needs pgvector and `bev_embeddings`, nearest-by-edge needs `SIMILAR_TO`. The vector index ships empty and valid; `docs/graph.md` records this.
- **`deploy-dev` is still stubbed in `backend.yml`.** Its old comment claimed no hosted project existed, which #56 made untrue. It was corrected but not enabled: `supabase db push` on every merge would apply migrations unattended, and one of them deletes rows. Turning it on is a decision for both of us.
- **Closed since:** #74 (M-25) merged on 2026-10-15; #79 (Matt's verification branch) was closed without merging.

**Progress (2026-10-15, Matt with Claude).**
- **Merged and live:** M-07 (#85), M-13 (#88), M-14 (#89), M-02 (#90) and M-24 (#86, `RANKING_VERSION` 1.2.0). What shipped is under each task in §3.
- **The design step happens in the repo now.** Edit `design/system/src/` and the generators, run `npm run build` in `design/system`, and commit the result as the branch's first commit. After the merge, the changed `project/` files are published to the design-system artifact (version 8 matches `main` at #90). Two branches' generated files always conflict: rebase, then rebuild.
- **Contract gap found by M-02:** Profile › Activity can't show likes (details under M-02).
- **Next in Matt's lane:** M-03 (comments), then M-12 once D-06 is decided.

**Planning review (2026-10-19, Matt and Arjun with Claude).** What changed:
- **Removed from TASKS.md, for a future phase:** per-Bev icons and vessels (M-10, A-07, S-08, D-07); the Bev Maps integration (M-17, A-10, D-14, the Find Bev button); nutrition (S-11, A-09, M-18, D-09); location on a ranking (M-23, S-16, `rankings.venue_id`); and S-06. The existing placeholder art gets refined later. Each removed item is now a one-line note at its spot in §1.
- **Decided:**
  - **D-15:** Explore posts from people you don't follow are read-only: a simple post, with no hearts, counts or comments. Explore is unblocked.
  - **D-12:** Arjun has the Google Maps key, as for Bev Maps.
  - **D-13:** the map starts with the **Upper East Side and Roosevelt Island**; we refine it while building.
  - **M-21:** yes from both.
  - **S-14 part 2** ships together with A-16.
- **Owners:** Arjun does A-08 (venues); Matt does M-16's UI.
- **Awaiting your review (proposals only)**, *all resolved in the kickoff decisions above*:
  - A-13: which store holds the graph.
  - A-16: what makes it ready.
  - The duplicates plan (S-13, A-12, M-20).
  - S-10 trimmed to what the map needs.
  - D-04 and D-11, reworded so they're clear.
- **Next to build:** M-19 (ready), Explore (S-04 + A-04 + M-04, now unblocked) and the M-22 maths review.

**Progress (2026-10-19, later, Matt with Claude): wave 2.**
- **Merged and live:**
  - S-20's UI (#102), M-08 (#103) and M-15 (#104).
  - M-05 (#105).
  - S-12 + A-11 (#101).
  - Every prod deploy succeeded. A GitHub Actions incident held CI for about an hour.
- **On prod:** Matt pushed `20261019000100_taste_profile.sql` on 2026-10-19, and `migration list` matches.
- **Design system:**
  - The artifact is at version 13, matching `main` at #105. It has the `map` icon uploaded, and ScreenAddBev was removed for ScreenSearch.
  - `design/system/project/design-system.json` in the repo had fallen behind the artifact: `message-circle` was uploaded during M-03, but the repo copy never got the record. That's fixed in this PR.
- **Decided:** D-10 (one bar, grouped results).
- **D-01** was accepted as proposed. **Explore is still on hold**, pending a new joint decision, D-15: whether posts outside your follows can be liked and commented on.
- **What's left in P0 and P1:**
  - M-19, the Taste Profile screen. Its backend is live.
  - Explore, once D-15 is settled.
  - Graph Stages 2–3 (Arjun).
  - A-14 parity and the D-04 taxonomy draft.
  - ~~The icons, on hold under D-07~~ (removed in the planning review above).

**Progress (2026-10-19, Matt with Claude).**
- **Merged and live:**
  - M-12 (#95), the M-06 follow-ups (#94) and M-26 (#99).
  - The backend halves of S-05 + A-05 (#96), S-07 + A-06 (#93) and S-20 (#97).
  - #92's chores, plus the Expo SDK patch bump (#98) that S-18 now makes routine.
- **Three migrations on prod.** Matt pushed `20261018000100`–`0300` on 2026-10-19, and `supabase migration list` matches. Arjun added Matt to the Supabase project, so Matt can push migrations from now on: dry-run first, in timestamp order.
- **Design-system artifact:** version 12 matches `main` at #95.
- **What's left in this round:** the UI for M-05, M-08 and the S-20 hybrid Activity tab. Their backends are live.

**Progress (2026-10-18, Matt with Claude).**
- **Merged and live:** M-03 (#91). Likes and comments are now reachable in the app end to end. The design-system artifact has CommentButton and CommentsSheet, so it matches `main` at #91.
- **#87 re-scoped the graph work** (`docs/graph_db_implementation.md`, which wins where it and `docs/graph.md` disagree). The first increment is no longer `bev_edges`. It is **user taste neighbourhoods** (`user_neighbors`, read by Layer 2), built in five stages that start with an offline evaluation harness and end with a pre-registered keep-or-drop bar for Neo4j. Embeddings, pgvector, `bev_edges` and the full `SIMILAR_TO` graph are deferred. A-16 is rewritten below, and Stage 1 is a new task in Matt's lane, **M-26**.
- **Nothing is in flight:** no open PRs.
- **Still open from week 1:** S-08, S-09, S-18, S-19, and the M-06 follow-ups. (S-09, S-18 and S-19 are done in #92; the M-06 follow-ups are in progress.)
- **Decided by Matt today:**
  - **D-06:** price tier off rows, kept on detail, so M-12 is unblocked.
  - **D-07 and the icon work (M-10, A-07) are on hold:** craft cocktails and coffee-shop drinks can't get generated icons.
  - **S-20:** the direction is `feed.listUser`.
  - **M-03:** likes and comments checked working on iPhone.
- **Later the same day:**
  - **D-02 accepted** as proposed. Arjun confirms in review.
  - **M-12's scope is set:** one secondary line, and the actions stay.
  - **We build both lanes for the new backend features** (Matt's OK). Each ships as one combined PR (contract + migration + `packages/api` + FakeApi, as #72 did), because a contract-only PR fails typecheck until its implementations land.
  - **No new migration goes to prod without Matt's explicit OK.** A UI that calls a new RPC merges only after its migration is on prod.
  - S-18, S-19 and S-09 are done in #92.

Lanes are the ones in `DEVELOPMENT-MATT.md` §1 / `DEVELOPMENT-ARJUN.md` §1 and do not change:

| Owner | Paths | Branches |
|---|---|---|
| **Matt** (`@mbwiller`) | `app/`, `packages/ranking/`, `design/` | `ui/*`, `rank/*` |
| **Arjun** (`@acheema5`) | `supabase/`, `packages/api/`, `data/catalog/`, `scripts/` (catalog and graph pipelines) | `be/*` |
| **Both** | `shared/` (contract), root docs, `.github/`, `.claude/` | `contract/*`, `chore/*` |

Task ids: `M-nn` Matt, `A-nn` Arjun, `S-nn` shared contract or docs, `D-nn` a decision still open. Put the id in the PR title. Every task that needs the other lane says so under **Needs**; ship the contract PR (`S-`) first, then both sides build against it.

Priorities follow the order the conversation itself set, with the revision-2 work slotted in:

- **P0 — "Our experience and immediate changes we want"** (topic 2, called *"probably the most important part of the conversation"*).
- **P1 — UI / UX** (topic 3), the data the P0 screens need (topic 5), **the graph foundation** (A-15..A-17, M-24: backend and pure-package work that runs alongside P0 without touching screens) and **the Search tab shell** (M-15, because it changes the centre tab).
- **P2 — Additional features** (topic 4: the map itself, duplicates). Nutrition and the Bev Maps integration were removed on 2026-10-19 for a future phase.
- **P3 — Later**: parked ideas and algorithm evolutions (anchored placement on the graph, Smart Recommend).

---

## 0. The guardrail we agreed on

> "I feel like we can't keep throwing [features] at Bevi and thinking it's gonna still look good. At a certain point we reach the bottleneck … too many features." — "Yeah, very fair."

Rule for this round: **finish P0 and P1 before starting anything in P2 or P3.** A P3 item needs a yes from both of us before a branch is opened. The conversation itself parked one idea on this basis (Smart Recommend on the map, D-03).

---

## 1. What the conversation decided (the emphasis)

These are the statements both of us agreed to. Everything in the task board below traces back to one of them. Items 17–20 and 26 were superseded by revision 2 and now point to §1b.

1. **Saving a Bev is not a feed post.** *"When you're saving a beverage, it should not be on the feed … we should get rid of that, 100."* You should only see, on a post, that you already have that Bev saved. → A-01, S-01, M-01
2. **Likes, exactly like Instagram.** Heart on every post, **double-tap the post to like**, the heart in the **Bevi grape** (`primary`, *"the same purple as the Bevi logo"*), count next to it. *"This component needs to be very seamless."* Likes are for posts, above all posts with a photo of the Bev; likes on comments: *"maybe not."* → A-02, S-02, M-02
3. **Comments, in line with the like button**, *"exactly like the Instagram comment button"*, opening a *"very clean, multi-user comment section"*. Comments show inline; **only after seven** does it collapse to "View all N comments". → A-03, S-03, M-03
4. **The feed stays friends-only; add an Explore surface** that is *"one or two connections away"* (Venmo-style), **populated by the Bevs getting the most likes** (a popularity ranking). → A-04, S-04, M-04, D-01
5. **Bev of the day and Bev of the week at the top of the feed**, two components side by side under the search bar. **Not posts: just the Bev** (card or photo with the name underneath), so the feed stays *"simple, just your feed and you scroll it."* Defined from the leaderboard logic restricted to **Bevs ranked that day / that week**. **"This is strictly New York City"**: Bev of the area = NYC for now. → A-05, S-05, M-05, D-02
6. **The user (profile) page is right.** *"User page looks great."* No changes.
7. **Leaderboard: add the Bev's icon to each row.** The People board is unclear (*"I don't really know what leaderboard of people is … probably just the points"*): explain the points. → M-06, S-06
8. **The score bubble's purple count badge reads wrong** (*"I feel like that's like two people voted"*) and the number itself needed explaining (7.6 and 2.0 showing as 5.9). The logic is answered in §2 below and in the LaTeX document; the badge is a design task. → M-07
9. **Your Lists › Bev'd needs to be more gamified**: *"we're trying to do better than Beli."* Icons for every Bev (*"you're collecting something"*), **"you've tried this percentage of Bevs in this category"**, a visual *"graph of Bevs"*. → M-08, A-06, S-07
10. **Bug: the Score / Recent / Name sort button makes the list jump to the bottom.** *"It shoots to the bottom of the scroll bar."* → M-09
11. ~~**Every Bev needs its own icon**~~. *Removed on 2026-10-19:* generated icons can't cover every Bev (craft cocktails, one shop's own drinks). The existing placeholder art gets refined in a future session.
12. **Vessels are not variants.** Can, glass bottle, plastic bottle: *"Coca-Cola is Coca-Cola."* No fluid-ounce input. **Mexican Coca-Cola is its own Bev** (a different product), and its icon is a glass bottle. → S-09 (done). The per-Bev vessel field was removed with the icons.
13. **Dark mode: the top of the screen (status bar area) stays white**; it must follow the system. → M-11
14. **The theme is good.** *"It looks really nice."* But **lists and the feed are too crowded** (*"with the dollars, them all having approximate … it's a lot of info … not laid out very cleanly"*). → M-12
15. **The gut-check buttons (Loved it / It was fine / Didn't like it) stick out too much.** → M-13, D-05
16. **The compare step and the note step are good.** Keep them. **The score reveal is not landing**: *"I don't think it tells you the score. It should show the number and animate a little bit."* → M-14
17. **"Searching for Bevs is amazing."** Keep it. The tab itself changes: see §1b item 32 (Search tab with the map inside; no separate Maps tab). → M-15
18. **Maps**: a map of New York City with markers for spots, **filterable by Bev category** (sodas are everywhere; the value is craft coffee, lattes, cocktails) **and by retailer** (Duane Reade / CVS / Target carry a fixed subset). Superseded in detail by §1b items 32–37 and §1c. → M-16, A-08, S-10
19. ~~**Find Bev**~~. *Removed on 2026-10-19 with the Bev Maps integration (future phase).*
20. **Smart Recommend on the map** (Spotify "smart shuffle"): opt-in; show only spots we would recommend. **Challenged as too complicated** → parked under the guardrail. The maths is written anyway (LaTeX §10.5). → D-03
21. ~~**Nutrition label**~~. *Removed on 2026-10-19 (future phase).*
22. ~~**Bev Maps integration**~~. *Removed on 2026-10-19 (future phase).*
23. **Taste Profile stays** but means something concrete: **your average score per category** (*"your average score of cafe drinks could be this number out of 10"*), i.e. which kinds of drinks you prefer. → A-11, S-12, M-19
24. **Binary had-or-not.** One ranking per Bev per user; we never count how many times you drank it. (Already how the data works; record it.) → S-09
25. **Duplicates will happen** as the catalog grows (*"someone inputting a new name of a Bev that's the same as some other name"*). Collect enough unique identifiers to detect them and add a **flag-as-duplicate** path. → A-12, S-13, M-20
26. **Categories must be finer and hierarchical** (external feedback, below) and **Bevs should live in a graph with weighted edges**: the first comparisons are against the most similar Bevs you have ranked. Revision 2 decided where that graph lives and how the weights are computed: §1b items 28–31. → A-13, A-15, A-16, A-17, M-24, M-21, S-14, D-04
27. **The scoring maths is documented as a LaTeX paper**, academic and proof-based, covering what exists and what we plan. → S-15 (done in this session), M-22, A-14

### 1b. Decided in revision 2 (2026-10-14, after research)

28. **Scope of the graph: it holds the relationships; Postgres keeps the record.** Neo4j stores `Bev`, `Category`, `Brand` and `Flavor` nodes and the weighted `SIMILAR_TO` edges. Supabase keeps the `bevs` row (photo, stats, foreign keys from rankings, the age-gate RLS, trigram search, dedupe, the prediction snapshot). A nightly job syncs new Bevs into the graph, recomputes the weights and writes each Bev's top-k edges back to a `bev_edges` table, so nothing a user taps ever waits on a cross-cloud call, and the app keeps working if the graph instance is paused. → A-15, A-16
29. **Product: Neo4j AuraDB Free.** $0, no card: one instance, 200,000 nodes, 400,000 relationships, 1 GB, full Cypher, vector indexes (378 Bevs plus edges is under 1% of the cap). It auto-pauses after 72 hours without activity, does not auto-resume, and is deleted after 30 days paused, so the nightly sync doubles as the keep-alive and nothing lives only in the graph. Graph Data Science is a separate paid product; we compute similarity ourselves. Rejected: FalkorDB Cloud free (100 MB, stopped after a day idle, no persistence), Memgraph Cloud (14-day trial), Kùzu (archived October 2025), Dgraph Cloud (no free tier), MongoDB Atlas (a document store; `$graphLookup` is a capped recursive join, not a graph). SurrealDB Cloud's free instance was the runner-up. → A-15
30. **Similarity edges are computed from three signals in v1, a fourth later:** (a) the taxonomy-plus-content rules already in the paper (tree similarity, brand, flavour tokens, price tier); (b) **text embeddings** of "brand name flavour category" from the free `gte-small` model that ships inside Supabase Edge Functions (384 dimensions, cosine); (c) a **flavour profile** per Bev (base family such as cola / citrus / coffee / matcha, carbonation, caffeine, sweetness, dairy, alcohol), labelled once for the catalog; (d) later, the **co-rating** signal from users who ranked both. Formula, weights and the Coke–Pepsi worked example: LaTeX §10.1, eq. (18). → M-24, A-16, A-17
31. **Users and rankings stay in Supabase.** Auth, profiles, rankings, feed, streaks and leaderboards keep their RLS and RPCs. The graph gets **anonymised `RANKED` edges** (stable pseudonym, score, z-score, bucket), refreshed nightly, so graph-based recommendations and the co-rating signal can be computed there without any handle or birth date leaving Postgres. → A-16
32. **The centre tab becomes Search, and the map lives inside it.** *"Instead of having the Add Bev button in the center, we change that to Search … that page has the Bev search at the top still, but then below the search bar is a map that the user can fully click into or just scroll around without fully clicking into. If they go to the search bar then the search results populate over the map. Make that UI very seamless."* So: no Maps tab, no List | Map toggle in Your Lists; the Add-a-Bev flows (Snap it, Can't find it) stay inside the search results. The grape circle in the tab bar stays; its label becomes **Search**, exactly as Beli labels it. → M-15, M-16
33. **A Bev gets a location through curated venue assortments** (chain presets, menus for craft spots), so pins exist before anyone has been there. → A-08. *The optional "Where did you have it?" step on a ranking (`rankings.venue_id`) was removed on 2026-10-19: adding a Bev doesn't need a location yet.*
34. **Map engine: Google Maps JavaScript API**, the stack Bev Maps already runs, reusing its Google Cloud project. A Bevi **Map ID** with a muted, POI-free cloud style gets the look close to Beli's; **Advanced Markers** draw our own score pins. The free Dynamic Maps allowance is 10,000 map loads per month and each `new google.maps.Map` is a load, so the map is created once per app session and re-parented (the Bev Maps pattern), never on every tab visit. → M-16, D-12
35. **Venues come from OpenStreetMap plus our own curation.** An Overpass import of cafés, coffee shops, bars, delis, convenience stores, supermarkets, liquor stores and juice/tea shops inside the New York City boundary (OSM relation 175905), stored with attribution ("© OpenStreetMap contributors", ODbL), then curated by the two of us: craft spots we know, chain assortments, corrections. OSM opening hours are patchy in NYC, so **Open now is best-effort**. Google Places was rejected for the map because its data may not be cached and its per-SKU free tier is small. **Start (D-13): the Upper East Side and Roosevelt Island.** → A-08
36. **The map is strictly New York City.** Google Maps `restriction` to the five-borough bounds (lat 40.477–40.918, lng −74.260 to −73.700) with `strictBounds`, minimum zoom around 10, default view centred on Manhattan; the venues table carries the same bounds as a CHECK constraint; the OSM import is clipped to the city boundary. No other city, no "City ▾" filter: it becomes **Neighborhood ▾**. → M-16, A-08
37. **The map UI copies Beli's map as closely as the web allows** (§1c), with one addition: venue sheets listing the Bevs sold there. → M-16
38. **Location privacy stays as it was.** No location is stored for a ranking (the venue step was removed). "Locate me" on the map uses the browser's position on the device only, and sends nothing to the server. → S-09

### 1c. The Beli map, screenshot by screenshot, and the Bevi mapping

Reference images: `bevi-ui-inspiration/beli-map-images/` (README there describes each).

| Beli element (images 01–03) | Bevi equivalent on the Search tab |
|---|---|
| Header "You" + avatar, "Been ▾" scope, share (web, Been map) | Not needed: the Search header keeps the wordmark; scope comes from the filters and the people toggle |
| Floating segmented control `List \| Map` (dark fill on the active side) with a **people** circle button at its right | Same control over the map: `List` shows the venues in view as rows, `Map` the pins; the people button toggles **friends' pins** (venues where people you follow Bev'd) |
| Filter row: `Filters 2`, `City ▾`, `Cuisine ▾`, `$, $$ ▾` (Been map); filter icon, `City ▾`, `Reserve`, `Order`, `Open now`, `Cuisine ▾` (Recs map) | `Filters N` (sheet: bucket / your score, Want to Try available, friends only), `Neighborhood ▾`, `Category ▾` (multi-select Bev categories), `$, $$ ▾` (price tiers of the Bevs sold there), `Open now`, `Retailer ▾` (Chains / Craft). `Reserve` and `Order` are dropped |
| Teardrop pins coloured by score band with the score inside (Been map) | Venues where **you** have ranked something: teardrop in `scoreHigh` / `scoreMid` / `scoreLow` with **your best score there** |
| White callout pins with a green circle holding a category icon (fork & knife, cocktail, ice cream, coffee) and the score in bold (Recs map) | Venues you have not ranked at: white callout, grape circle with the **category icon** of the venue's best Bev (or the venue kind), and the **best Bayesian score** of its assortment; **predicted score** with the dotted ring when a prediction exists |
| ↗ trending badge, bookmark badge on some callouts | ↗ on venues with the most likes this week (A-04's popularity), bookmark where one of your Want to Try Bevs is sold |
| Pins overlap at every zoom; no clustering | Same: no clustering; the server caps pins per viewport by zoom instead |
| Blue location dot; locate button bottom-right | Same (device-only geolocation) |
| `View List` dark pill bottom-right | Same, opens the list of venues in view |
| Reservation bar "2 · Today · All Day" | Dropped |

| (none) | **Venue sheet** on pin tap: name, kind, neighborhood, open / closed, the Bevs sold there as `BevRow`s (your score or predicted, Rank it, Want to Try), "Rank it" |

Inline vs full screen (decision 32): under the search bar the map fills the rest of the screen and pans in place; tapping a pin, the `List | Map` control or an expand affordance opens the same map **full screen** with the full chrome and a close ✕; focusing the search bar slides the results panel **over** the map (Recents when idle, grouped results while typing, the sticky "Can't find it? Add a new Bev" footer); cancelling returns to the same map viewport. The map never steals gestures while the panel is up.

### 1d. The Bev graph: what lives where

```
Supabase (Postgres)                    nightly job (A-16)                 Neo4j AuraDB Free (A-15)
bevs, categories, brands  ──────────── sync nodes ───────────────────────▶ (:Bev)-[:IN_CATEGORY]->(:Category)-[:CHILD_OF]->(:Category)
bev_flavor_profiles (A-17) ─────────── sync props ──────────────────────▶ (:Bev)-[:BY_BRAND]->(:Brand), (:Bev)-[:TASTES_OF]->(:Flavor)
bev_embeddings (pgvector, gte-small) ─ sync vectors ────────────────────▶ Bev.embedding + vector index
rankings (pseudonymised) ───────────── sync edges ──────────────────────▶ (:User {pseudonym})-[:RANKED {score, z, bucket}]->(:Bev)
bev_edges  ◀────────────────────────── write back top-20 per Bev ◀──────── (:Bev)-[:SIMILAR_TO {w, tree, content, emb, profile, cop}]-(:Bev)
   ▲
   └── read by the app's hot path (anchored placement M-21, recommendations, "similar Bevs" rows); Neo4j is never on a request path
```

Weights: `w = 0.25·tree + 0.15·content + 0.30·embedding + 0.30·profile (+ co-rating later)`, top 20 edges per Bev with `w ≥ 0.3` (LaTeX §10.1). Sanity check the job must print: Coca-Cola ↔ Pepsi ≥ 0.8, Coca-Cola ↔ a sparkling water < 0.4.

---

## 2. Topic by topic

### Topic 1 — External feedback

- **Beli users don't use Beli for drinks.** Anisha, Jot and Raya: Beli is food; drinks *"not as much, obviously."* Takeaway: *"the market that we're in could be very good … something that's very low on Beli users' minds."* No task; this is the positioning.
- **Cross-category comparisons feel wrong.** Anisha *"didn't like the idea of ranking against other types of cuisines … I'd always take mid Indian food over top-tier American food."* Both agreed: *"Oh, that's such a great point."* Consequence: when you rank a mocha, the first things you compare it against are other mochas, then other coffees, then the rest. *"It has to be that."* This is the single biggest algorithm change requested (M-21, LaTeX §10.1).
- **How to get there:** finer, **hierarchical categories** (*"cafe → hot / cold → subcategories"*) and **a graph of Bevs where each edge holds a weight**. Revision 2 made this concrete: the graph is Neo4j AuraDB Free (§1b, §1d); the weights come from taxonomy, content, text embeddings and flavour profiles; the taxonomy itself is still to be written (D-04).

### Topic 2 — Our experience and immediate changes (P0)

Covered by decisions 1–13 above. One question raised here is answered now, because it was addressed to Claude:

> "I rated it a 7.6, you rated it 2.0 … 9.6 divided by 2 is not 5.9. I think it's weighed by your ranking on the leaderboard. We just need Claude to tell us what the logic there is."

**It is not weighted by anyone's leaderboard rank.** The number on a Bev is a **Bayesian average**: the plain mean is pulled toward the global mean of all scores with the weight of **3 phantom ratings** (`BAYES_C = 3` in `packages/ranking/src/constants.ts`, `public.bayes_score(sum, n, m, 3)` in SQL).

```
bayes = (C·m + Σ scores) / (C + n) = (3·m + 7.6 + 2.0) / (3 + 2)
```

For that to display 5.9 the global mean `m` was about 6.6 at that moment (`(3·6.63 + 9.6) / 5 = 5.90`). With only two raters the prior counts for more than the two of you combined, which is the point: one person's 10/10 cannot top the leaderboard. The full derivation, the n = 2 eligibility rule and the leaderboard order are in the LaTeX document, §5. Aside: a stored 7.6 means that Bev sat at the bottom of a Loved bucket of four (or 8th of 9), and 2.0 is a Didn't-like bucket of one (LaTeX §3).

### Topic 3 — UI / UX (P1)

Decisions 14–17. Keep: theme, user page, compare step, note step, search. Change: density of lists and feed, gut-check button weight, score reveal, and the centre tab (Search with the map, §1b item 32).

### Topic 4 — Additional features (P2)

Decisions 17–22 as revised: the Search tab's inline map (Beli UI, NYC only, Google Maps JS, OSM venues), Smart Recommend parked (D-03). Find Bev, Bev Maps and nutrition were removed on 2026-10-19 for a future phase.

### Topic 5 — What is stored per user, and what is not

Asked as *"let's talk about what's not stored that needs to be stored."* Today the database has rankings, comparisons, Want to Try, follows, feed events, per-user stats, streaks, rank points. **Not stored, and needed by this round:**

| Needed by | Missing today | Task |
|---|---|---|
| Likes | a likes table, counts on feed rows | A-02 |
| Comments | a comments table, counts, paging | A-03 |
| Explore | a popularity ranking of posts / Bevs, friends-of-friends scope | A-04 |
| Bev of the day / week | a per-period winner (computed or cached) | A-05 |
| Category progress | total active Bevs per category | A-06 |

| Maps | venues (OSM import + curation, starting with the Upper East Side and Roosevelt Island), venue ↔ Bev assortments, chain presets | A-08 |

| Taste Profile | `user_category_stats` exists but **is never written** (`refresh_user_stats` only fills `user_stats`; `affinity_z` has no writer) | A-11 |
| Duplicates | a duplicate-of target on reports, a merge routine | A-12 |
| Finer categories | `categories.parent_id` (hierarchy) in Postgres and as `CHILD_OF` in the graph | A-13 |
| The Bev graph | the Neo4j instance, its schema, the sync job, `bev_edges`, `bev_embeddings`, `bev_flavor_profiles`, stable user pseudonyms | A-15, A-16, A-17 |

Already true and worth writing down: a user ranks a Bev **once** (`rankings` is unique on `(user_id, bev_id)`; a re-rank moves it). That is the "binary had-or-not" (S-09).

### Topic 6 — Scoring algorithms and rankings

> "Instead of a markdown file, please design a LaTeX document describing the algorithm … in the format of academics doing research … proof based but also just outline all the mathematics that are used … including what we are thinking about further implementing."

Done: `docs/bevi-ranking-math.tex` (S-15). It covers, with definitions, propositions and proofs: pairwise placement and its bounds, score-from-position and the exact cents rounding, population statistics and z-scores, the category-affinity subtlety, the Bayesian leaderboard (with the 5.9 worked example), Layer 1 and Layer 2 prediction, the blend, exploration, cold start, rank points and streaks; then the proposed extensions from this session: category-aware (anchored) placement over the weighted Bev graph (now including the embedding and flavour-profile terms and the Neo4j decision), Taste Profile, Bev of the period, likes and the Explore ranking, Smart Recommend on the map, nutrition normalisation, duplicate detection. It ends with the known places where SQL and TypeScript differ today.

---

## 3. Task board — Matt (`app/`, `packages/ranking/`, `design/`)

### P0

**M-01 · Feed: stop rendering saves; keep the "you saved this" signal.** `ui/feed-no-saves`
- Today: `app/src/features/feed/FeedPostItem.tsx` renders `item.type === 'SAVED'` with `verb="saved"`; `FeedPost` has an `isSave` branch (no image strip, no score). The filled bookmark on a post (`inMyWantToTry`) already shows "you have this saved", which is the behaviour we want to keep.
- Do: remove the SAVED rendering path from `FeedPostItem`/`FeedPost` once S-01 lands (the type union shrinks, so TypeScript finds every spot); keep `FeedPost verb="saved"` only if Profile › Activity still needs it (it doesn't; rankings only). Update `Feed.test.tsx` fixtures.
- Needs: S-01, A-01.
- DoD: no save ever appears in the feed; the bookmark still fills on posts for Bevs in your Want to Try.
- **Done in #80, and the leftover in #90:** #80 stopped `FeedPostItem` rendering `SAVED`; FeedPost's own `verb="saved"` / `isSave` branch (app and design system) went with M-02 in #90.

**M-02 · Likes on posts (Instagram-identical).** `ui/post-likes`
- Spec from the session: heart button in the post's action row, **filled `primary` (grape) when liked**, like count beside it, **double-tap anywhere on the post to like** with a heart burst over the image (Reanimated, transform + opacity only, reduced-motion fallback = fade). Optimistic update with rollback (same pattern as `useToggleSet` in the leaderboard).
- Design system: add `LikeButton` and the burst to `design/system` first (the system is the source of truth, `app/CLAUDE.md`), then port to `app/src/components/`. `primary` on the heart is consistent with the system's rule that grape marks "something to tap or a value you earned" (same as the saved bookmark).
- Accessibility: `accessibilityRole="button"`, label "Like" / "Unlike, 12 likes", `aria-pressed`; double-tap is an addition, never the only way.
- Needs: S-02, A-02.
- DoD: like, unlike, count, double-tap, works offline-optimistically, tests in `components/__tests__/` and `features/feed/__tests__/`.
- **Done in #90:**
  - `LikeButton` leads FeedPost's action row (heart, then Rank, then Want to Try): filled `primary` when liked, the count beside it, hidden at 0.
  - **Double-tap anywhere on the post outside the photo strip likes it** (Matt, 2026-10-15: a single tap on the photo still opens the Bev). It never unlikes; on a liked post it only plays the burst. The post sets `touch-action: manipulation` so iOS Safari doesn't zoom.
  - `useToggleLike` updates every FeedItem cache optimistically and runs taps in order. The latest tap on a post settles it by writing back the server-confirmed state, so a feed refetch that lands mid-like can't undo it.
  - FeedPost's `verb` / saved variant is gone, which closes M-01's leftover.
- **Not done:**
  - **Profile › Activity has no hearts.** It renders `RankedBev`s from `rankings.listUser`, which carry no feed-event id, `likeCount` or `likedByMe`. Needs a contract change: those fields on `listUser`, or a `feed.listUser(id, page)` returning `FeedItem`s. Tracked as **S-20**.
  - ~~Only the most recent like shows an error message.~~ Fixed in #91: `useToggleLike({ onFailed })` reports errors per post.

**M-03 · Comments.** `ui/post-comments`
- Spec: comment icon in line with the heart, count beside it. Tapping opens a clean sheet/screen: list of comments (avatar 32, name, text, time), composer pinned to the bottom. **Inline on the post: the first comments are visible without tapping; after seven, show "View all N comments".** No likes on comments for now (D-01).
- Use the app's `Sheet` (`src/components/Sheet.tsx`) or a full-screen route `post/[id]/comments`; the list is a FlashList (can exceed 20 rows).
- Needs: S-03, A-03.
- DoD: post, read, delete own comment; seven-rule; empty state copy in the design system's voice.
- **Done in #91:**
  - Design system: `message-circle` icon, `CommentButton` and `CommentsSheet`. FeedPost's action row is now heart, comment, Rank, Want to Try. Up to seven comments show inline under it; with more, "View all N comments".
  - The comments sheet is the app's `Sheet` (new `scroll={false}`), not a route. Comments run oldest first, with "Load earlier comments" for paging. You can delete your own comments, with a confirm in the row. There is an empty state. The composer stays pinned above the iOS keyboard (`useKeyboardInset`, from `visualViewport`), and a countdown appears in the last 20 of the 280 characters.
  - `api/hooks/comments.ts` updates the thread and every FeedItem cache: the count ±1 and the first seven. `not_found` closes the sheet and refetches; `validation`, `rate_limited` and `network` keep the draft.
  - FakeApi comments are implemented to match `20261014000300_post_comments.sql` (they were a stub).
  - Also fixed M-02's per-post like errors.
- **Not done:**
  - Profile › Activity has no comments either (S-20).
  - **Checked on Matt's iPhone (2026-10-18):** likes and comments work functionally. Matt plans changes to both later; they're not specified yet.
  - No likes on comments and no comment reports. Both are deferred on purpose (D-01, A-03).

**M-04 · Explore surface.** `ui/explore`
- **Waiting on S-04 + A-04 (Arjun).** **Unblocked 2026-10-19 (D-15 decided):** Explore posts are **read-only**, rendered as the plain post a stranger's Activity already uses (`FeedPost` with no heart, no counts, no comments; tapping opens the Bev). Explore excludes people you follow, so every Explore post is a stranger's. Keep the Follow button on the author. `feed_event_visible` doesn't change: likes and comments stay follower-only.
- Spec: the Feed keeps "Your feed" (friends). Add an **Explore** segment (`SegmentedTabs` on the Feed, or a second list under the header) showing posts from people one or two follows away, **ordered by popularity (likes)**, not time. Post cards are the same `FeedPost`. Follow button on the actor for people you don't follow yet.
- Needs: S-04, A-04, D-01 (hops and whether global is allowed as a fallback when the graph is tiny).
- DoD: Explore renders from `feed.getExplore()`, paginates, degrades to an empty state when nothing is popular yet.

**M-05 · Bev of the day · Bev of the week.** `ui/bev-of-period`
- **Done in #105:**
  - The pair replaces the Featured carousel (Matt's pick).
  - Each card flexes to half the row; an earlier period's winner shows its date.
  - Under-21 users don't see alcoholic winners: the server filters them out and the app hides them too.
  - Removed from the app: FeaturedCarousel, `useFeatured` and `keys.featured`. `feed.getFeatured` stays in the contract, and FeaturedCard stays in the design system.
- **Backend live (#96, contract 2.1.0):** `feed.getBevOfPeriod()`. A Bev with a single rating can win, and its `bayesScore` is then set even below `MIN_RATERS` (LaTeX §10.3). The UI is what remains.
- Spec: **two cards side by side at the top of the feed, directly under the search bar** (above Featured Bevs; consider replacing the Featured carousel while the catalog has no hero art). Each card: the Bev's image/icon, a small caps label ("BEV OF THE DAY" / "BEV OF THE WEEK"), the Bev's name underneath, the Bayesian score bubble. Tapping opens the Bev. **Not a post.** When no Bev was ranked that day, show the most recent day's winner with its date, or hide the day card (D-02).
- Design system: a `BevOfCard` component (half-width, square image).
- Needs: S-05, A-05.
- DoD: both cards render from one call; empty states; snapshot test.

**M-06 · Leaderboard rows get Bev icons; explain People points.** `ui/leaderboard-icons`
- Today `app/src/features/leaderboard/BevBoard.tsx` renders `BevRow` without `showImage`; the row already supports it (`BevRow showImage` draws a 56pt `BevImage`). Turn it on. People rows already show the avatar; add an info affordance on the People board header explaining the points: "1 pt per Bev ranked · 3 per day of your current streak · 2 per Bev you added that someone else ranked" (the formula in `packages/ranking/src/rank.ts`; wording checked against `RANK_POINTS_WEIGHTS`).
- The per-row points breakdown (S-06) was dropped on 2026-10-19.
- DoD: icons on the Bevs board at all sizes; the points explainer sheet; tests updated.
- **Done in #62:**
  - The Bevs board now shows each Bev's image (`BevRow showImage`), as category placeholder art (per-Bev icons were removed on 2026-10-19).
  - The People board has a "Ranked by points" `SectionHeader` whose "How points work" link opens a `Sheet`.
  - The sheet's lines come from `pointsRules()` in `features/leaderboard/copy.ts`, built from `RANK_POINTS_WEIGHTS`, so they can't drift from `rank.ts` or the SQL.
  - There's no info icon, because `Icon.test.tsx` requires the app's icons to match the design system's set exactly.
- **Follow-ups: all three done in #94.**
  - Screen readers announce the link as "How points work ranked by points". The label comes from `SectionHeader`; add an `actionLabel` prop.
  - Build the streak line from `STREAK_PERIOD`, as the weights are.
  - In the design system artifact, add the leaderboard to the BevRow README's list of `showImage` uses, and show images on ScreenLeaderboard.

**M-07 · Score bubble: rethink the count badge.** `ui/score-count`
- Today `ScoreBubble` draws the rating count as a small `primary` pill overlapping the bubble (bottom-right). Feedback: it reads like a vote tally and makes the score look off. Options (pick in the design system first): move the count into the row's meta line ("5.9 · 2 ratings"), or keep the badge but neutral (`input` fill, `textSecondary` text) and only above 10 ratings. Apply everywhere the bubble has `count` (leaderboard, search, Want to Try, Recommended, Bev detail).
- DoD: design system updated; `ScoreBubble.test.tsx` updated; no `primary` badge on the score.
- **Decided 2026-10-14 (Matt):** the badge goes. The count moves to the row's meta line, in words: "Your score 7.6 · 2 ratings".
- **Step 1 (Matt with the design agent, on the artifact):**
  - Drop ScoreBubble's `count` prop and badge.
  - Make BevRow print `count` in the meta line.
  - Remove "count badges" from the README's list of `primary` uses (line 21). The ScoreBubble README also names the `primary` badge.
  - Update the ScoreBubble, BevRow and ScreenLeaderboard previews.
  - Re-sync `design/system/` as the branch's first commit.
- **Step 2 (`ui-screen`):**
  - `ScoreBubble`: remove `count`, the badge and ", N ratings" from the accessible label.
  - New `formatRatings(n)` in `@/lib/format` ("1 rating", "12 ratings", "5k ratings").
  - `BevRow` keeps its `count` prop and appends ` · ${formatRatings(count)}` to `meta` when `count > 0`. The call sites (BevBoard, BevSearch, WantToTryTab, RecommendedTab) stay as they are.
  - `BevStats` reuses `formatRatings` in place of its local `ratings()` and drops `count` from its bubble, since the tile meta already prints it.
  - Update the ScoreBubble, BevRow and Leaderboard tests: the meta text gains " · N ratings", and the label `'Predicted score 8.2, 58 ratings'` in `BevRow.test.tsx` loses the count.
  - It overlaps M-12 (density), so do M-07 first.
- **Done in #85:**
  - ScoreBubble has no count or badge, in the design system and the app.
  - **Changed from step 2 (Matt, 2026-10-15): the count shows only on rows with no meta of their own.** Bev search shows "362 ratings"; the Leaderboard, Want to Try and Recommended show only their own meta line. The Bev detail tile reads "5k ratings" (`formatRatings`).
  - The design system's SortToggle needs `onClick` and shows the search icon only with `onSearch`; the dead "Predicted" example is gone (M-25's follow-up).

**M-08 · Your Lists › Bev'd: gamify.** `ui/bevd-gamified`
- **Done in #103:**
  - A `ProgressStrip` under the filters ("Soda · 4 of 61 tried · 6%"; "All Bevs · …" with no category picked) opens a "Your collection" `CollectionSheet` with one `ProgressBar` per category.
  - Tapping a row filters Bev'd to that category.
  - Percentages round down and show "<1%" for any share above zero.
- Backend: #93 (contract 2.2.0), `Category.bevCount` and `stats.getCategoryProgress()`. Per-row icons were removed from this task on 2026-10-19.
- Spec: **icons on every row** (`BevRow showImage` in `BevdTab.tsx`, which currently has `actions={false}` and no image); a **category progress strip** above the list ("Soda · 4 of 61 tried · 7%") driven by A-06; and one visual "graph of Bevs" (e.g. a horizontal bar per category of your ranked count vs catalog size, or a collection grid of icons you've unlocked). Keep the rows less crowded (see M-12).
- Needs: S-07, A-06.
- DoD: rows show icons, progress strip shows real counts, test for the percentage copy (never show 0% as "0.4%"; round down).

**M-09 · Bug: sort toggle scrolls the list to the bottom.** `ui/fix-sort-jump`
- DoD: tapping Score → Recent → Name keeps the viewport at the top; a test asserts the list ref's scroll call or that the header stays mounted.
- **Done in #60. The root cause was not the one first written here.** The header wasn't the problem: FlashList 2.0.2 turns `maintainVisibleContentPosition` (MVCP) on by default.
  - MVCP remembers the key of the first visible row and keeps that key across the empty "loading" state.
  - When the sort changes the query key, the rows come back in a new order, and MVCP scrolls to wherever that row now sits, often the bottom.
  - Bev'd's Bucket and Category filters had the same bug.
- **The fix:**
  - `BevList` disables MVCP. Every list built on it is anchored at the top and loads more at the bottom.
  - `BevList` gains an optional `resetScrollKey` prop that scrolls to offset 0 when the key changes, but not on first mount.
  - `BevdTab` passes `sort|bucket|categoryId` as the key.
- **Not touched:** Recommended and Want to Try don't change their sort.
- **Optional nit:** the reset runs in `useEffect`. `useLayoutEffect` would avoid a possible one-frame flash when the new sort is already cached.

**M-11 · Dark mode: status bar area is white on the home-screen app.** `ui/dark-statusbar`
- Where: `app/public/index.html` sets `apple-mobile-web-app-status-bar-style="default"` and `app/public/manifest.json` has `"theme_color": "#ffffff"` (one value, no dark variant). iOS paints the status-bar strip from these, not from the app's `SafeAreaView` background, so it stays white in dark mode. The two `theme-color` metas already have light/dark media queries.
- DoD: screenshots light and dark from the home-screen app with the strip matching the page.
- **Done in #61 and checked on Matt's iPhone. The first proposal here was wrong:** a fixed `black-translucent` would break light mode. iOS always draws the status-bar symbols white with it, so the clock and battery would disappear on the white header.
- **What shipped:**
  - An inline `#status-bar-style` script in `index.html` sets `black-translucent` only when `prefers-color-scheme: dark` matches at launch. Light mode stays `default`.
  - `html, body` get the `surface` background in each theme.
  - `<meta name="color-scheme" content="light dark">` is added.
  - The single-valued `theme_color` is removed from `manifest.json`.
  - `src/__tests__/htmlShell.test.ts` ties the colours to the theme tokens.
- **Known limit:** iOS reads the style at launch, so changing appearance while the app is open only takes effect on the next launch.

### P1

**M-12 · Less crowded rows and posts.** `ui/density`
- **Done in #95:**
  - `BevRow` shows one line, `[icon] Category · Brand`. `FeedPost`'s meta line is `[icon] Brand`. There's no price on any row or post.
  - The gut-check card, Featured cards, Bev detail and the create picker still show the tier, deliberately (outside D-06's "rows").
  - Row min-height is unchanged (126).
  - Matt is checking on iPhone.
- Feedback: `$`/`~$` on every row, three text lines, meta line, two action icons. Proposal (in the design system first): `BevRow` → name, one secondary line (category · brand), the bubble; price only on Bev detail (or only when not estimated); actions as a single overflow on dense lists. `FeedPost` → remove the price from the post header line. Keep 44pt targets.
- DoD: updated design system previews and ported components; visual check of Feed, Bev'd, Leaderboard, Search.
- **Unblocked 2026-10-18 (D-06):** no price tier on any `BevRow` or `FeedPost`, estimated (`~$`) or not. Price shows only on Bev detail.
- **Scope (Matt, 2026-10-18):**
  - `BevRow` has one secondary line, `[category icon] Category · Brand`, then the meta line. Rank and Want to Try stay, as on Beli's rows. No overflow menu.
  - `FeedPost`'s header meta is `[icon] Brand`.

**M-13 · Gut-check buttons: calmer.** `ui/bucket-buttons` (D-05)
- Feedback: the three `BucketButton`s *"stick out a lot"*. The glass is CSS `backdrop-filter` in `app/src/components/BucketButton.tsx` (no Apple developer route is needed on the web build; that worry is moot). Options: default to the `tint` material (12% bucket tint, 4pt bar) and reserve glass for when a `BevGlow` sits behind a real photo; reduce the orb to 40pt; drop the fizz unless selected. Decide in the design system.
- DoD: previews for both materials; the chosen default shipped.
- **Done in #88:**
  - The design system defaults to `material="tint"`; glass is only ever the native `GlassView` on iOS 26+, never a CSS blur. Both materials stay in the preview.
  - The web app always draws tint: the `backdrop-filter` path, the `material` prop and `supportsBackdropFilter` are gone. `useReducedTransparency` stays for BevGlow.
  - The orb is 40 (was 48), Matt's pick from a side-by-side preview.

**M-14 · Show the score, with motion, at the moment of placement.** `ui/score-reveal`
- Today the score only appears on `RankResult` after Save/Skip on the note step (`ScoreBubble 56` with `ZoomIn.springify()`), which is why it was missed. Change: compute the score locally the moment placement finishes (`storedScore(insertIndex, list.length + 1, bucket)` from `@bevi/ranking`; the server's re-spacing stores exactly this value, LaTeX §3) and show it **on the note step**: a 72pt bubble that pours in and **counts up to the number**, with "#4 of 31 in Loved" under it; the note field sits below. `RankResult` then confirms the saved value (unchanged unless a conflict occurred).
- DoD: the number is visible before the note is written; reduced-motion shows it without the count-up; tests cover the local score equals the submitted result.
- **Done in #89:**
  - ScoreBubble size 72 (`size-scoreBubble-xl` / `scoreBubbleXl`). On the note step, the bubble and "#4 of 31 in Loved" (or "First one in Loved") replace the "Add a note" title, since the keyboard opens at once.
  - The bubble pours in and the number counts up from the bucket's lower edge (`BANDS`) over `pour` (450ms); Reduce Motion shows the number at once. The label is always the final score.
  - RankFlow computes `storedScore(insertIndex, expectedBucketSize + 1, bucket)`. Tests check it equals the saved score for a new ranking, a re-rank, the first in a bucket, after Undo and after a conflict restart; `integrator-app` checked it against `submit_ranking` / `rerank_bev`.
  - RankResult keeps its 56 confirmation, and its `ZoomIn` now respects Reduce Motion.

**M-15 · The Search tab: search bar on top, the map underneath, results over the map.** `ui/search-tab` (decision 32)
- **Done in #104 (D-10: one bar, grouped results):**
  - The centre tab reads "Search". `/add` stays the route, and `/search` redirects to it.
  - Under the bar is a static "Map coming soon" placeholder (M-16 brings the map). It is mounted once and never re-mounted.
  - The results panel slides over it. `?tab=people` and `?focus=1` open it, and so does every "go find a Bev" button in the app.
  - The keyboard lift has a unit test with iPhone numbers.
  - `DEVELOPMENT-MATT.md` §5, §6.8 and §6.16 still describe Add Bev and the Bevs · People tabs: a joint docs follow-up.
- Tab bar: `app/src/components/TabBar.tsx` labels the centre grape circle "Add Bev"; it becomes **Search** (Beli's label for the same circle). Route stays `/add` with a redirect from `/search`, or moves; `?tab=people` keeps working.
- Layout, top to bottom: header (wordmark, ✕ close as today); the outlined `SearchBar` ("Search a Bev or a person"); the **Snap it** pill row; then the **map area** filling the rest of the screen (M-16 provides the map; until it lands, a static NYC placeholder with the same chrome).
- Behaviour: the map pans and zooms **in place** without being "clicked into"; tapping a pin, the `List | Map` control or the expand affordance opens the **full-screen map** (a modal route, e.g. `/search/map`) with the full chrome from §1c and a close ✕. **Focusing the search bar** (or any text in it) slides the **results panel over the map** from under the bar: Recents while idle, then results while typing, the sticky "Can't find it? Add a new Bev" footer; clearing the bar or tapping Cancel slides it away and the map is exactly where it was. The map must not receive gestures while the panel is up (`pointerEvents="none"` on the map host).
- People: one bar searches Bevs and people; results are grouped under "Bevs" and "People" section headers with the existing `BevRow`s and `UserRow`s (replaces the Bevs · People segmented tabs; D-10 if you prefer to keep the tabs).
- Everything that exists today in `app/src/features/add-bev/BevSearch.tsx` and `features/people/PeopleSearch.tsx` is reused inside the panel; the create-Bev wizard and the ranking flow are untouched.
- Needs: nothing from the backend for the shell; M-16 for the live map.
- DoD: the tab reads "Search"; map visible and pannable under the bar; panel slides over and back without the map re-mounting; keyboard never covers results; tests for the panel state machine (idle → typing → results → cancelled).

**M-19 · Taste Profile tab.** `ui/taste-profile`
- **Ready (2026-10-19): Matt, next to build.** The backend has been live since #101.
- **Unblocked:** S-12 + A-11 are live (#101, contract 2.4.0, on prod). `stats.getTasteProfile(userId)` returns rows ordered by mean; alcoholic categories are dropped unless both the viewer and the owner are 21+. Only the UI remains.
- Replace the "Coming soon" tab (`app/src/features/profile/ActivityList.tsx`) with the simple definition from the session: a bar list of **your average score per category** ("Coffee 8.1 · 9 ranked"), ordered high to low, with a one-line read-out ("You prefer coffee and boba over soda"). The §6.20 calendar and share card can come later.
- Needs: S-12, A-11.
- DoD: renders from `stats.getTasteProfile`, hides categories with no rankings, works on another user's profile.

**M-24 · Edge-weight formulas in `packages/ranking`.** `rank/edge-weight` (decision 30)
- Add, pure and vector-tested: `treeSimilarity(catA, catB, taxonomy)` (Wu–Palmer over `Category.parentId`), `profileSimilarity(a, b)` (eq. 17 in the paper: base family 0.40, carbonation 0.15, dairy 0.10, alcohol 0.05, caffeine closeness 0.15, sweetness closeness 0.15), `embeddingSimilarity(a, b)` (cosine clamped at 0), `edgeWeight({ tree, content, emb, profile, cop })` with `EDGE_WEIGHTS = { tree: 0.25, content: 0.15, emb: 0.30, profile: 0.30, cop: 0 }`, and `topEdges(candidates, k = 20, min = 0.3)`. Types for `FlavorProfile` and `Taxonomy`. New `edges.vectors.json` (golden vectors, including Coke–Pepsi and Coke–sparkling-water), `RANKING_VERSION` bump.
- The nightly job (A-16) imports these; the app's anchored placement (M-21) consumes the resulting weights. Nothing here does I/O (package rule).
- Needs: the flavour-profile schema from A-17 (agree the column names in S-14 first).
- DoD: vectors committed; `npm test -w packages/ranking` green; bundle smoke passes.
- **Done in #86 (`RANKING_VERSION` 1.2.0):**
  - `packages/ranking/src/edges.ts`: `treeSimilarity` (over a `Taxonomy` passed in, since `Category.parentId` and D-04 don't exist yet), `profileSimilarity` (eq. 17; `serve` and `source` are not in it), `embeddingSimilarity`, `edgeWeight` (eq. 18), `topEdges`.
  - `shared/fixtures/edges.vectors.json` (43 cases). The other vectors files changed only in their header. Code and vectors shipped in one PR, as #37 did, because ranking CI checks the vectors on every `packages/ranking` change. Paper §11 has the 1.2.0 row.
  - **Nothing consumes these yet.** #87 deferred `bev_edges`, the formulas' only planned consumer, so they wait for the full A-16 or M-21.
  - **For A-16:** a top-level category has depth 1 under an implicit root (`treeDepth` in the vectors header; the paper doesn't define it yet). `topEdges` breaks ties by `bevId` in code-unit order, so SQL tie-breaks need `collate "C"`. With today's flat categories, Coca-Cola vs a sparkling water stays under 0.4 only while their embedding cosine is ≤ 0.88, so the sanity check may trip on real `gte-small` embeddings. No SQL change.

**M-25 · Recommended's "Predicted" sort toggle does nothing.** `ui/recs-sort-toggle` (found during M-09)
- `RecommendedTab.tsx` renders `<SortToggle label="Predicted" onSearch={false} />` with no `onPress`, so screen readers get a button that does nothing.
- Fix: give `SortToggle` a non-interactive form (no `onPress` → plain text, no `button` role), or drop it from Recommended. Recommendations have one order.
- DoD: no touchable without an action on Recommended; test updated.
- **Done in #74:**
  - Recommended no longer renders a SortToggle; recommendations have one order.
  - `SortToggle` requires `onPress`, so a dead toggle doesn't type-check, and draws the search icon only when `onSearch` is a function. It used to draw a search button with no action whenever `onSearch` was omitted.
  - ~~**Follow-up (design system):** the SortToggle preview still renders a `Predicted` toggle with no `onClick`.~~ Done in #85, with M-07.

**M-26 · Graph Stage 1: the baseline evaluation harness.** `rank/eval-harness` (from #87, `docs/graph_db_implementation.md` § Stage 1)
- **Done in #99:**
  - `npm run eval -w packages/ranking -- <export.json>`.
  - Real baseline numbers need one prod export, `packages/ranking/eval/export.sql`, run by Arjun as a role that bypasses RLS. The export uses salted aliases and hour-truncated timestamps.
  - Synthetic output is labelled "not an accuracy result".
- What: an offline harness that measures the **current** recommendation engine, in a new `packages/ranking/eval/`, reusing `test/snapshot-fixture.ts`. No graph work and no production change. Every later graph stage is judged against its numbers, under the doc's pre-registered decision bar.
- Leakage rules the doc spells out (each of them is a real trap in today's code):
  - Recompute `users[u].stats` for every fold.
  - Clone the snapshot per fold: `snapshotContext` caches in a `WeakMap` by identity.
  - Strip the held-out item from the Bev's `ratingCount` / `mean` / `stddev` and from `raters`.
- Metrics:
  - Primary: pairwise concordance on `comparisons`.
  - Secondary: macro Spearman, NDCG@10, bucket accuracy (3-class confusion matrix) and CF coverage (share of predictions with `support > 0`).
  - Break every metric down by cohort, `n_u` ∈ {3–5, 6–14, 15+}.
  - Report paired-bootstrap CIs over users, never a point estimate alone.
  - Baselines: μ_u, category mean, Bayesian, `globalScore`, Layer 1 affinity-only and Layer 1 content-only.
- Needs: a service-role export of `rankings` and `comparisons` (Arjun, `scripts/`). Without it, build against fixtures and say which export is missing. `syntheticSnapshot()` can test the harness but must never be reported as accuracy.
- Spotted by the doc, on its own merits: `cosineSimilarity` in `layer2.ts` isn't re-centred on the common subset. Stage 3 replaces it with Pearson. The harness should show by how much it matters.
- DoD: the doc's seven-point Stage 1 report (files, method, commands, tests, missing data, baseline numbers, blockers before Stage 2). **Stop there.** Stage 2 doesn't start automatically.

**M-27 · Use the Bev graph in the app.** `rank/graph-recs` + `ui/similar-bevs` (new 2026-10-19)
- **Recommendations:** Layer 1's content-similarity term reads `bev_edges` weights (via S-14 part 2) instead of recomputing `contentSimilarity`. It sits behind a flag, with `RANKING_VERSION` bumped, vectors regenerated and the paper's §11 row added. Compare against the M-26 baseline before turning it on.
- **"Bevs like this":** a row on Bev detail from `bevs.similar(bevId, n)`, using BevRows with placeholder art, age-filtered.
- Needs: A-16 (1) + S-14 part 2 (Arjun). For the comparison, the M-26 export (Arjun).
- DoD: flag on and off both tested; the harness report attached to the PR; the row hidden when there are no edges.

**M-28 · Taste formulas for the taste graph.** `rank/taste-graph` (new 2026-10-19; #87 Stage 3)
- Pure TypeScript in `packages/ranking/src/graph.ts`: `tasteVector()`, `attributeSimilarity()`, `blendUserSimilarity()`, plus the Pearson fix in `layer2.ts`, all vector-tested. The sync job (A-16 (2)) imports them.
- Needs: A-16 (1). Blocks: A-16 (2).

### P2

**M-16 · The map: Beli's map UI on Google Maps, NYC only.** `ui/map` (decisions 34–37, §1c)
- **Owners (2026-10-19):** Matt builds the UI; Arjun provides the Google Maps key, set up as for Bev Maps (D-12). The default view centres on the **Upper East Side** with Roosevelt Island in frame (D-13). The NYC bounds stay as the outer limit.
- **Scope after the 2026-10-19 removals:**
  - No Find Bev button.
  - No "your score" teardrops or friends' pins: both needed `rankings.venue_id`, which was removed.
  - Pins are venues with a curated assortment: a white callout with the best Bayesian or predicted score of what they sell.
- Engine: Google Maps JavaScript API via `@googlemaps/js-api-loader` in a web-only component (`MapView.web.tsx`; there is no native build). A Bevi **Map ID** (vector, cloud-styled: POI labels and transit off, muted palette, neighborhood labels on) created in the Bev Maps Google Cloud project; a second browser key restricted to Bevi's Vercel domain and localhost (D-12). Create the `google.maps.Map` **once per app session** and re-parent its element between the inline host and the full-screen host (the Bev Maps `minimap/maps.ts` pattern); each `new Map` is a billable load against the 10,000 free per month.
- NYC: `restriction: { latLngBounds: NYC_BOUNDS, strictBounds: true }`, `minZoom: 10`, default centre Manhattan (zoom 12); `NYC_BOUNDS` lives in `shared/` so the venue CHECK constraint (A-08) uses the same numbers.
- Pins: `AdvancedMarkerElement` with our own DOM: the teardrop (your score, band colour) and the white callout (category icon in a grape circle + score, dotted ring for predicted), ↗ and bookmark badges, 44pt targets, selected pin raised. No clustering (Beli doesn't); the viewport query (S-10) caps results by zoom.
- Chrome, exactly §1c: `List | Map` control with the people button, the filter row (`Filters N`, `Neighborhood ▾`, `Category ▾`, `$, $$ ▾`, `Open now`, `Retailer ▾`), blue dot + locate button, `View List` pill, and the venue sheet. Design-system components for all of it first (`MapPin`, `MapCallout`, `MapFilterRow`, `VenueSheet`).
- Data: `venues.inView({ bounds, zoom, filters })` → pins; `venues.get(id)` → sheet.
- Reference: `bevi-ui-inspiration/beli-map-images/`.
- Needs: S-10 (trimmed), A-08, M-15 (done).
- DoD: Beli screenshots side by side with Bevi screenshots at the same three zooms; 60fps panning on an iPhone 12 Safari; map never created more than once per session (assert in a test on the loader wrapper); bounds cannot be escaped.

**M-20 · Report sheet: "Duplicate of…".** *(plan approved: see S-13; waits on S-13 + A-12)* `ui/report-duplicate`
- `app/src/features/bev/ReportSheet.tsx` already offers the `duplicate` reason; add a Bev search step to pick the original, sent as `duplicateOfId`.
- Needs: S-13, A-12.

### P3 (needs a yes from both)

**M-21 · Category-aware placement (anchored binary search) on the graph.** `rank/anchored-placement`
- **Yes from both (2026-10-19).** It needs A-13 (after D-04) and A-16 (1)'s `bev_edges` through S-14 part 2.
- The algorithm answer to Anisha's feedback. Specified in LaTeX §10.1: the user's bucket list is searched in two phases, first among **anchors** (ranked Bevs most similar to the new one by edge weight `w`, same leaf first), then among the remaining Bevs between the two anchors it landed between. Same `PlacementResult` shape (`insertIndex`, `expectedBucketSize`, `comparisons`), so `submit_ranking` is untouched; the comparison log stays consistent with the final index. Bump `RANKING_VERSION`, regenerate vectors (`contract/vectors-*`).
- Similarity inputs come from `bev_edges` through S-14 (`bevs.similarities`), with `treeSimilarity` from M-24 as the fallback when no edge exists.
- Needs: S-14 part 2 and A-16 (1) (Arjun), A-13 (Arjun, after D-04), M-24 (done), D-04 (Matt).
- DoD: property tests: valid index, consistent log, first question is the most similar anchor when one exists, comparisons ≤ ⌈log₂(a+1)⌉ + ⌈log₂(g+1)⌉.

**M-22 · Keep the maths paper and the package in step.** `chore/ranking-doc`
- **Ready (Matt, 2026-10-19):** review that the maths is correct across the paper (`docs/bevi-ranking-math.tex`), `@bevi/ranking` and the SQL (including #107's `bayes_prior`), with the `ranking-math` agent and the golden vectors. Output: a list of corrections, split by lane. Paper and package fixes are Matt's; SQL fixes go to Arjun as A-14 follow-ups. The maths will grow with the data model, so the paper's §11 version table stays the record.
- Any `RANKING_VERSION` bump updates `docs/bevi-ranking-math.tex` §11 (version table) in the same PR. Review the paper with Arjun once (S-15).

---

## 4. Task board — Arjun (`supabase/`, `packages/api/`, `data/catalog/`, `scripts/`)

### P0

**A-01 · Saves are not feed events.** `be/feed-no-saves`
- **Done in #69. One correction to the task text above:** `'followed'` was *not* dead. It was dead on the read side (`get_feed` had filtered it since `20261011000400`) but `follow_user` still inserted it, so narrowing the `kind` check alone would have made every new follow fail with `23514`. Both inserts were dropped in the same migration.
- Also corrected: `packages/api/test/mappers.test.ts` asserted `want_to_try → SAVED` and had to change with it. The live test is Matt's (`feed.live.test.ts`).
- Where: `add_want_to_try` (latest in `supabase/migrations/20261011000400_contract_v1_rpc_fixes.sql`) inserts `feed_events(kind = 'want_to_try')`; `get_feed` (same file) selects `kind in ('ranked','reranked','want_to_try')`. New migration: stop the insert, filter `get_feed` to `('ranked','reranked')`, delete existing `want_to_try` rows from `feed_events`, and tighten the `kind` check constraint (`'followed'` is also dead). `packages/api/src/mappers.ts` drops the `'SAVED'` mapping.
- Needs: S-01.
- DoD: pgTAP test that a save produces no feed row; live test `getFeed` has only RANKING items.

**A-02 · Likes.** `be/post-likes`
- **Done in #70.** Added `feed_event_visible(bigint)` as the single definition of "may the caller see this post?". `DEVELOPMENT-ARJUN.md` §4.1 wants that predicate to live in a `bev_cards` view — **that view does not exist**; the only mention in `supabase/` is a comment in `20261011000300`. The helper is the narrow version of the same idea, and A-03 reuses it.
- Review caught two things: like reads needed scoping to visible posts, and the pgTAP fixture set birth dates with a bare `update`, which `protect_profile_columns` silently ignores — the "30-year-old" could not see alcohol and the test died at 2/18. It now goes through `bevi.rpc_bypass`.
- Schema: `post_likes(user_id, feed_event_id, created_at)` PK `(user_id, feed_event_id)`, RLS select for authenticated, writes through `like_post(p_event_id)` / `unlike_post(p_event_id)` (security definer, idempotent, rate-limited via `user_actions`). `get_feed` returns `like_count` and `liked_by_me`. Cascade on event delete.
- `packages/api`: `feed.like(id)`, `feed.unlike(id)`; `FeedItem.likeCount`, `likedByMe` in the mapper.
- Needs: S-02.
- DoD: pgTAP for idempotency and RLS (no direct insert policy); live test round-trip.

**A-03 · Comments.** `be/post-comments`
- **Done in #71. Two corrections to the task text above:** `get_feed` carries the first **seven** comments, not three — decision 3 shows every comment inline until there are more than seven. And the `post_comments` select policy must gate on post visibility: as first written (`using (deleted_at is null)`) any signed-in user could read every comment body, including on strangers' posts and, under 21, on alcoholic Bevs' posts. Caught in review.
- **Comment reports are deferred.** `bev_reports` is keyed `(reporter_id, bev_id, reason)` with `bev_id not null`, so a comment report needs its own table or a loosened live constraint. Follow-up, not in this round.
- Schema: `post_comments(id, feed_event_id, user_id, body ≤ 280, created_at, deleted_at)`; RPCs `add_comment`, `delete_comment` (own only), `get_comments(p_event_id, p_limit, p_before_id)` keyset-paged; `get_feed` returns `comment_count` and the **first three comments** inline so the post can show them without a second call (the seven-rule is the app's). Rate limits; report path via `bev_reports`-style `comment_reports` or reuse with a `kind` column.
- `packages/api`: `comments.list/add/remove`; mappers.
- Needs: S-03.
- DoD: pgTAP for RLS and paging; live test.

**A-04 · Explore.** `be/explore`
- **Unblocked (D-15):** `get_explore` returns posts with **no like or comment fields** (or with them nulled), and doesn't touch `feed_event_visible`. Like counts can still order the results on the server. It ships with S-04 as one combined PR.
- RPC `get_explore(p_limit, p_before)` over posts by users within two follows of the caller (recursive CTE on `follows`, depth ≤ 2, excluding the caller's own follows' posts already in the feed, D-01), ordered by a **time-decayed like count** (LaTeX §10.4: `(likes + 1) / (age_hours + 2)^1.5`; constant in one place). Also `get_popular_bevs(p_days)` for the "Bevs getting the most likes" ranking if the app wants a Bev-level list, and `get_popular_venues(p_days)` for the map's ↗ badge.
- Needs: S-04, A-02.
- DoD: `explain analyze` under 150 ms locally at 1k posts; live test.

**A-05 · Bev of the day / week.** `be/bev-of-period`
- **Done in #96, with S-05:** `get_bev_of_period()` wraps an internal `bev_of_period_at(p_now, p_adult)` that no client can call. It has 25 pgTAP checks and is on prod. The query scans all rankings; it gets an index or a cache when the feed slows.
- RPC `get_bev_of_period()` returning two rows (`day`, `week`): among Bevs with at least one ranking created in the current **America/New_York** day (ISO week), the one with the highest **Bayesian score** (ties: more rankings in the period, then more raters overall, then name). Fallback (D-02): the most recent period with a ranking, with the period's date in the payload. Definition in LaTeX §10.3. Cheap enough to compute live; cache in a table only if the feed call gets slow.
- Needs: S-05.
- DoD: pgTAP with fixed timestamps across the midnight and ISO-week boundaries.

**A-06 · Category progress.** `be/category-progress`
- **Done in #93, with S-07:** `get_category_progress()`. `categories.list()` takes both visibility and `bevCount` from it. It's on prod.
- Add `bev_count` (active, age-filtered) to `categories.list()` and the caller's ranked count per category to `get_profile_stats` or a small `get_category_progress()`. Powers M-08's "you've tried 7% of Sodas".
- Needs: S-07.

### P1

**A-11 · Taste Profile data.** `be/taste-profile`
- **Done in #101, with S-12:**
  - `refresh_user_category_stats` upserts on `(user_id, category_id)` with no race, and runs via `refresh_user_stats` (same signature).
  - A nightly pg_cron job runs at 04:20 UTC, and the migration backfilled existing users.
  - `get_taste_profile(p_user_id)` is the read path.
  - `user_category_stats_select` is narrowed to owner-only: it was `using (true)`, and the backfill made that matter.
  - It's on prod.
- `user_category_stats` is never written: `refresh_user_stats` (`20261011000700_streak_and_rank_points.sql`) only updates `user_stats`, and nothing writes `affinity_z`. Add `refresh_user_category_stats(p_uid)` (population stddev, `affinity_z = Σ z / (n + 2)` with z against the user's **overall** effective stats, as in `packages/ranking/src/stats.ts` and LaTeX §4.3), call it from `submit_ranking`, `rerank_bev`, `remove_ranking`, and from the nightly `refresh_all_stats`. RPC `get_taste_profile(p_user_id)` → rows `(category_id, rating_count, mean_score, affinity_z)`, visible for any user (means are not sensitive; birth dates stay private).
- Needs: S-12.
- DoD: golden-vector test against `shared/fixtures/user-stats.vectors.json`; live test.

**A-15 · Neo4j AuraDB Free: the instance, the schema, the access path.** `be/graph-instance` (decisions 28, 29)
- **Done in #72, with S-17 (`docs/graph.md`). The DoD above changed:** "returns the 10 nearest Bevs" cannot pass after A-15 alone — nearest-by-embedding needs pgvector and `bev_embeddings`, nearest-by-edge needs `SIMILAR_TO`, and all of those are A-16. The vector index ships empty (valid, free) and that check moved to A-16.
- `(:Bev)` carries `id, name, brand, flavor, categoryId, priceTier, isAlcoholic` only. `vessel` was dropped with the icons (2026-10-19), the flavour properties on A-17, `[:CHILD_OF]` on A-13.
- `graph-query` is the repo's first Edge Function, so it also added `supabase/functions/`, the `[functions.graph-query]` config block and a `deno check` CI step.
- Instance: one AuraDB Free instance (region close to the Supabase project), credentials in Supabase secrets (`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`) and GitHub Actions secrets; never in `app/` or `packages/api`. Document in `docs/graph.md` (S-17): the 72-hour pause, the 30-day deletion, that the nightly write is the keep-alive, and that resuming a paused instance is a manual console action.
- Schema (Cypher, idempotent `CREATE CONSTRAINT IF NOT EXISTS`): `(:Bev {id, name, brand, flavor, categoryId, vessel, priceTier, isAlcoholic, embedding, base, carbonated, caffeine, sweetness, dairy, alcohol})` unique on `id`; `(:Category {id, name, depth})` with `[:CHILD_OF]` to the parent; `(:Brand {key})` with `[:BY_BRAND]`; `(:Flavor {name})` with `[:TASTES_OF]`; `(:User {pseudonym})-[:RANKED {score, z, bucket, rankedAt}]->(:Bev)`; `(:Bev)-[:SIMILAR_TO {w, tree, content, emb, profile, cop, version, computedAt}]->(:Bev)` stored once per unordered pair (`src.id < dst.id`); a vector index on `Bev.embedding` (384 dimensions, cosine).
- Access: a Supabase Edge Function `graph-query` (JWT-verified, read-only Cypher templates, no free-form queries from the client) for on-demand exploration such as "Bevs similar to X"; the official JavaScript driver or the Query API over HTTPS (port 443, the only one Aura exposes). The hot path (ranking flow, recommendations, Bev detail) reads Postgres only (`bev_edges`), never the graph.
- DoD: instance up; schema script in `scripts/graph/schema.cypher` applied idempotently; `graph-query` returns the 10 nearest Bevs to a given id; `docs/graph.md` written.

**A-16 · The Bev graph, then the taste graph.** `be/graph-sync` (decisions 28, 30, 31)
- **Decided 2026-10-19 (Matt and Arjun):** Neo4j holds the Bev graph, and #87's narrowing is reversed. It comes in two increments:
- **Increment 1, the Bev graph: ready, Arjun, one PR with S-14 part 2.**
  - **Steps:** run steps 1–7 and 9–10 below as written, embeddings included.
  - **Step 2 (embeddings) is built** on `be/embed-pipeline`, Neo4j-free: the `embed` Edge Function (`verify_jwt = false` + a shared-secret check), an async pg_net trigger on `bevs` (`20261023000100`), `scripts/graph/backfill-embeddings.ts` and pgTAP `12_embed_webhook`; the text template, the two `bevi.embed_*` database settings and the re-run command are in `docs/graph.md`.
  - **On write:** a new or edited Bev triggers an async database webhook. An Edge Function embeds that Bev, infers its flavour profile if it has none (D-11), computes its candidates and edges, and updates Neo4j and `bev_edges`. The Edge Function's 2s CPU budget covers one Bev; the batch work stays in the nightly job.
  - **D-11 inference:**
    - Only seeded Bevs (never inferred ones) **in the same category** are candidates.
    - The nearest by embedding cosine is chosen, with brand match as the tie-break.
    - It copies that Bev's profile with `inferred = true`, `inferred_from = <bev id>` and the similarity.
    - Below a cosine of 0.6 the profile stays empty, and the Bev falls back to category and brand.
    - Matt and Arjun relabel inferred rows into the CSV now and then.
  - **Edge weights done (steps 1, 3, 4, 5, 7, 10), no Neo4j:** `scripts/graph/build-edges.ts` + `graph-edges.yml` (nightly 04:50 UTC, needs a new `SUPABASE_SERVICE_ROLE_KEY` Actions secret), D-11 inference in `20261023000200`, the service-role RPCs in `20261023000300`, pgTAP `13`/`14`, `docs/graph.md` rewritten; never run against a database, and the sanity thresholds are printed as a measurement rather than enforced (M-24's 0.88 cosine caveat), with `--strict` to opt in.
  - **Nightly:** `graph-sync.yml` does a full rebuild plus the sanity report (Coke–Pepsi ≥ 0.8, Coke vs a sparkling water < 0.4). Once it's green for a week, delete `graph-keepalive.yml`.
  - **Docs, in the same PR:** update `docs/graph.md`, `docs/graph_db_implementation.md` (the user-neighbour MVP moves to increment 2) (`vision.md`'s graph line was already updated on 2026-10-19).
  - **Before starting:** fix the instance (the board's "A-15 fix": the keep-alive's secrets were never set), and run the M-26 export so increment 1 has a baseline to compare against.
- **Increment 2, the taste graph: later, after increment 1 and M-28.**
  - Step 8 below (`RANKED` edges with stable pseudonyms), **updated on every ranking** through an async webhook, plus the nightly re-check.
  - #87's taste neighbourhoods (`user_neighbors`, approach B) and the `cop` co-rating term.
  - The formulas are Matt's (M-28). The Cypher, tables and RLS are Arjun's.
  - Measure with the M-26 harness against #87's decision bar.
- Where the nightly job runs: a GitHub Actions scheduled workflow (`.github/workflows/graph-sync.yml`, nightly after `refresh_all_stats`, plus `workflow_dispatch`), running `scripts/graph/sync.ts` with Node (no CPU limit, free minutes cover a few minutes a night). Fallback if Actions is not wanted: pg_cron → an Edge Function, mindful of its 2 s CPU cap.
- Steps, idempotent and resumable: (1) read active Bevs, categories (with `parent_id`), flavour profiles and pseudonymised rankings from Postgres with the service role; (2) **embed** new or changed Bevs through an `embed` Edge Function (`Supabase.ai.Session('gte-small')`, normalised 384-d), stored in `bev_embeddings` (pgvector `vector(384)`, HNSW) and on the node; (3) build candidate pairs: same category subtree ∪ same brand ∪ the 50 nearest by embedding (pgvector or the Neo4j vector index); (4) weight each candidate with `edgeWeight()` from `@bevi/ranking` (M-24); (5) keep the top 20 per Bev with `w ≥ 0.3`; (6) `MERGE` nodes and edges in Neo4j in batched `UNWIND`s, delete edges that dropped out; (7) **write back** `bev_edges(src_bev_id, dst_bev_id, weight, components jsonb, version, computed_at)` in one transaction (truncate-and-insert is fine at this size); (8) mirror `RANKED` edges with a **stable pseudonym** (`encode(hmac(user_id, secret_salt), 'hex')`, never the per-call aliases the prediction snapshot uses); (9) touch a `(:Meta {lastSyncAt})` node (the keep-alive); (10) print the sanity report from §1d.
- Failure modes: if the instance is paused the job fails loudly (Actions email) and nothing in the app degrades; a `--dry-run` prints the top-5 neighbours of Coca-Cola, Pepsi, Diet Coke, a matcha and Red Bull.
- Needs: A-15, A-17, M-24, S-14 (the `bev_edges` RPC), S-17.
- DoD: nightly run green for a week; `bev_edges` populated for every active Bev; Coke–Pepsi ≥ 0.8 and Coke–sparkling water < 0.4 in the report; `bevs.similarities()` live test.

**A-17 · Flavour profiles for the catalog.** `be/flavor-profiles` (decision 30)
- **Done in #73.** 378 rows, one per `bevs.csv` slug. The `notes` column carries the judgement calls (103 rows) rather than restating the other columns, which is what a reviewer should read first.
- **The validator is the real deliverable**, because a wrong label is a wrong recommendation rather than a crash. It checks the vocabulary, both 0–3 ranges, the booleans, the `serve` enum, that every slug appears in both files exactly once in both directions, that no field contains a comma (this CSV has no quoting), and that each profile's `alcohol` flag agrees with its category's `is_alcoholic` — the age gate keys off that.
- Keyword labelling hit five substring traps worth knowing if the rules are ever extended: `pine`**`apple`**, `cho`**`cola`**`te`, `mi`**`nut`**`e`, `Cut`**`water`**, and `agua `**`Fresca`**. Review corrected eight further labels.
- `data/catalog/flavor-profiles.csv`: `slug, base, carbonated, caffeine, sweetness, dairy, alcohol, serve, notes` with `base` from a fixed vocabulary (cola, citrus, lemon-lime, berry, tropical, apple, grape, orange, ginger, root-beer, cream, coffee, tea, matcha, chai, chocolate, nut, herbal, mineral, hop, wine, agave, grain, other), `carbonated/dairy/alcohol` booleans, `caffeine` and `sweetness` 0–3, `serve` hot/cold/either. Produced once by a sub-agent for the 378 seeds ("do this 378 times": Haiku), validated by `scripts/catalog/validate.ts` (vocabulary, ranges, every slug present), loaded by `catalog:migration` into `bev_flavor_profiles(bev_id, …)`, exposed on `Bev` reads. Matt reviews a sample of 30.
- User-created Bevs: D-11 (nearest seeded Bev by embedding, flagged `inferred`, until a labelling step exists).
- Needs: S-14 (column names agreed with M-24).
- DoD: 378 rows validated and loaded; the sync job sees them.

### P2

**A-08 · NYC venues: OpenStreetMap import, curation, assortments.** `be/venues` (decisions 33, 35, 36)
- **Owner: Arjun (2026-10-19).** Start the import and curation with the **Upper East Side and Roosevelt Island** (D-13). Keep the CHECK constraint at the full NYC bounds so it can grow later.
- **Scope after the 2026-10-19 removals:** no `rankings.venue_id` and no S-16. `venues_in_view` drops the viewer's-best-score and friends filters; `venues_search` (for the removed ranking step) isn't needed.
- Schema: `venues(id, name, kind chain|craft, osm_id, lat, lng, address, neighborhood, borough, hours_osm text, hours_known boolean, website, source osm|manual, status, updated_at)` with `CHECK (lat between 40.477 and 40.918 and lng between -74.260 and -73.700)` (the same `NYC_BOUNDS` as `shared/`); `chains(id, name, assortment_bev_ids[])` for Duane Reade / CVS / Target / 7-Eleven / Whole Foods presets; `venue_bevs(venue_id, bev_id, source menu|chain, verified_at)`.
- Import: `scripts/venues/import-osm.ts` queries Overpass for `amenity in (cafe, bar, pub, juice_bar)` and `shop in (convenience, supermarket, alcohol, beverages, coffee, tea, deli)` inside `area(3600175905)` (the New York City relation), identifies with a `User-Agent`, keeps `name, brand, opening_hours, addr:*`, assigns `kind = chain` when `brand` matches a chain preset, writes a reviewable CSV, then upserts by `osm_id`. Attribution "© OpenStreetMap contributors" in the venue sheet and the map's attribution control; keep the OSM-derived venue table separable from our own curation (assortments, scores) so the ODbL share-alike obligation, if ever invoked, covers only the venue table. Re-run monthly for new spots; manual rows (`source = manual`) are never overwritten.
- Curation: the two of us add craft spots (coffee, cocktails, boba) and their menus as `venue_bevs`; a venue with no assortment and no ranking still exists but gets no pin until it has one (D-13).
- RPCs (S-10): `venues_in_view(p_bounds, p_zoom, p_category_ids[], p_kinds[], p_price_tiers[], p_open_now, p_neighborhoods[], p_friends_only)` returning pins with the viewer's best score there, the best Bayesian or predicted score of the assortment, trending and Want-to-Try flags, capped by zoom (e.g. 60 pins at zoom 11, 300 at zoom 15); `venue_detail(p_id)`; `venues_search(p_q, p_lat, p_lng)` for the ranking step; `neighborhoods()` for the filter.
- Open now: evaluate `opening_hours` (the `opening_hours` npm parser) in the RPC or the API for venues with `hours_known`; others show "Hours unknown".
- Needs: S-10 (trimmed).
- DoD: import runs clean for the starting area; `explain analyze` under 150 ms for `venues_in_view` with a GiST index on the point; pgTAP for the bounds constraint and the zoom cap.

**A-12 · Duplicates: identifiers, flagging, merging.** `be/duplicates`
- **Plan approved 2026-10-19 (see S-13).** Arjun, once P0/P1 are done.
- Today: `find_similar_bevs` (pg_trgm over `search_text` + aliases) runs during create; `bev_reports.reason` already allows `'duplicate'`; `bevs.upc` exists with a unique index; `status = 'merged'` and `merged_into` exist but there is no merge routine.
- Do: `report_bev` accepts `p_duplicate_of uuid`; admin RPC `merge_bev(p_src, p_dst)` that re-points rankings (if a user ranked both, keep the better-positioned one and remove the other with re-spacing), moves aliases, `want_to_try` and `venue_bevs`, folds `bev_stats`, sets `status='merged'`, and marks the Bev for the next graph sync (A-16 removes the node and its edges). A view of pending duplicate reports for Studio. UPC becomes the strongest identifier (barcode scan was already in your §13 proposals); the embedding neighbour from the graph becomes a second "Did you mean…" signal.
- Needs: S-13.
- DoD: pgTAP merge test preserving bucket invariants (`unique (user_id, bucket, position)`, scores re-spaced).

### P3

**A-13 · Category hierarchy in both stores.** `be/category-tree`
- **Decided 2026-10-19:** both stores, as titled. `parent_id` in Postgres and `CHILD_OF` in Neo4j. It starts once Matt's D-04 list is approved, and it can land after A-16 (1): the tree term works on today's flat categories and improves when the hierarchy arrives.
- `categories.parent_id` (self-reference; today's 15 ids become the second level, e.g. `coffee → coffee_hot, coffee_iced, matcha, mocha…`; the taxonomy itself is D-04), `depth` derived; `get_prediction_snapshot()` and `categories.list()` gain `parentId`; the sync (A-16) mirrors it as `CHILD_OF`. The age gate keys off the alcoholic ancestor, so RLS helpers walk up the tree (a `category_is_alcoholic(id)` function with the result cached in the table).
- Needs: D-04 (Matt). Ships `Category.parentId` (the S-14 part 2 field).

**A-14 · SQL ↔ TypeScript parity follow-ups.** `be/ranking-parity`
- **Follow-ups found by the three reviews of #107 (2026-10-19), none of them blocking it.** They are a second `be/*` PR, and M-22 may add to the list:
  - **The 0 prior survives outside the leaderboard.** `coalesce((select mean_score from global_stats limit 1), 0)` is still live in `get_feed` (`20261014000300:244`), `get_user_feed` (`20261018000300:75`) and `bev_of_period_at` (`20261018000100:55`), whose package twin is `globalPrior()` too. Each could call `public.bayes_prior(null)`. Only observable while `global_stats.rating_count = 0`, so prod never sees it, but it makes an empty system internally inconsistent.
  - **`bayes_prior`'s two branches differ in freshness and precision:** the category branch is live and exact, the global branch reads `global_stats.mean_score`, a `numeric(5,3)` written by a 15-minute cron. Materialising category means in `refresh_global_stats` fixes this *and* removes the per-call `rankings ⋈ bevs` aggregate, which no index serves (`bevs_category_idx` is partial on `status = 'active'` and the prior deliberately does not filter status).
  - **The leaderboard returns an unrounded `numeric`** where `bev_stats.bayes_score` and `bev_of_period_at` are `numeric(4,2)` and the FakeApi applies `round2`, so fake and real disagree in the digits. Pre-existing.
  - **Matt's lane:** `compareCodePoints` (`packages/ranking/src/bayesian.ts:28-30`) compares UTF-16 code units, while `collate "C"` and the paper's §5 say code points. They differ only when one name holds an astral character and the other U+E000–U+FFFF. Every one of the 378 catalog names is ASCII, but `create_bev` does not restrict names. Needs a `RANKING_VERSION` bump and regenerated vectors.
  - **Docs:** `docs/bevi-ranking-math.tex` §11 needs `impl:prior` narrowed to the functions that really are still global, the leaderboard-order note removed, and `impl:affinity` struck (A-11 closed it). Matt owns the paper. `shared/src/types.ts:113` documents `BevSummary.bayesScore` as the global score, but a category board now puts the category-prior score there in both engines — a one-line contract doc change.
- **In review: #107 (Arjun, 2026-10-19).**
  - `bayes_prior(p_category_id)` mirrors `globalPrior` and `categoryPrior`.
  - The empty-system fallback is 5.0, not 0.
  - The leaderboard has a total order: `bayes desc, n desc, name collate "C", id`.
  - `affinity_z` was already closed by #101.
  - Merge after its migration `20261019000200` is on prod.
  - Matt's M-22 review may add follow-ups.
- Known divergences (LaTeX §11): the SQL prior is the global mean only (`get_bev_leaderboard`, `refresh_global_stats`), while `@bevi/ranking` uses a category's own mean once it has 30 rankings; `affinity_z` has no writer (A-11); the leaderboard's tie-break order in SQL is `bayes desc` only, the package specifies `bayes desc, n desc, name asc (C collation), id asc`. Align, with golden-vector tests.

---

## 5. Task board — shared (`contract/*` and `chore/*`; the other owner approves)

| Id | Contract or doc change | Unblocks |
|---|---|---|
| **S-01** | `FeedEventKind` → `'RANKING'` only; `WantToTryApi.add` no longer "posts a 'SAVED' feed item"; `FeedApi.getFeed` doc | M-01, A-01 |
| **S-02** | `FeedItem.likeCount: number`, `likedByMe: boolean`; `FeedApi.like(id)`, `unlike(id)` (idempotent, `'not_found'`, `'rate_limited'`) | M-02, A-02 |
| **S-03** | `FeedItem.commentCount`, `comments: Comment[]` (first seven; corrected by A-03); `CommentsApi { list(eventId, page), add(eventId, body), remove(id) }`; `Comment { id, author: Profile, body, createdAt }` | M-03, A-03 |
| **S-04** | **Unblocked (D-15).** `FeedApi.getExplore(page)` → `Page<ExplorePost>`, where an Explore post is a `FeedItem` without `likeCount`, `likedByMe`, `commentCount` or `comments` (read-only). Ships with A-04 as one combined PR | M-04, A-04 |
| **S-05** | **Done in #96.** `FeedApi.getBevOfPeriod()` → `{ day: PeriodWinner \| null, week: PeriodWinner \| null }`, `PeriodWinner { bev: BevSummary, periodStart: string, rankingsInPeriod: number }` | M-05, A-05 |
| **S-07** | **Done in #93.** `Category.bevCount: number`; `StatsApi.getCategoryProgress()` → `{ categoryId, ranked, total }[]` | M-08, A-06 |
| **S-09** | **Done in #92.** `vision.md` edits: vessels are not variants; one ranking per Bev per user ("binary"); Mexican Coke is its own Bev; icons over photos; feed = friends + Explore; Bev of the day/week; NYC only; **the Bev graph lives in Neo4j AuraDB Free with Postgres as the system of record (§1b, §1d); the map is inside the Search tab, Google Maps JS, OSM venues, strictly NYC; rankings may carry a venue, GPS is never stored** | everyone |
| **S-10** | **Trimmed, approved 2026-10-19:** `VenuesApi { inView({ bounds, zoom, filters }), get(id) }`, `Venue`, `VenuePin { venue, bestScore, predictedScore, openNow \| null }`, and `NYC_BOUNDS` in `shared/`. Ships with A-08 as one combined PR, not a separate contract PR | M-16, A-08 |
| **S-12** | **Done in #101.** `StatsApi.getTasteProfile(userId)` → `{ categoryId, rankingCount, mean, affinity }[]` | M-19, A-11 |
| **S-13** | **Plan approved 2026-10-19.** `BevsApi.report(id, reason, opts?: { duplicateOfId })`. The database already has `bev_reports.duplicate_of` and `report_bev(…, p_duplicate_of)`; only the contract and the app are missing. **Duplicates plan:** (1) prevention: the existing "Did you mean…" step at create, plus normalising names; (2) flagging: the "Duplicate of another Bev" report asks which Bev; (3) resolution by hand: an admin-only `merge_bev(src, dst)` run from Supabase Studio, with a Studio view of pending reports. The merge moves rankings (if someone ranked both, keep their ranking of `dst` and re-space the bucket), Want to Try and aliases (the old name becomes an alias), folds the stats, and sets `src` to `merged`, so old links redirect. Never merge automatically | M-20, A-12 |
| **S-14** | `RankingsApi.listBucketBevs(bucket)` → `{ id, categoryId, brandKey }[]` (beside `listBucket`); `BevsApi.similarities(bevId, otherIds)` → `{ bevId, weight }[]` from `bev_edges`; `BevsApi.similar(bevId, n)` for "Bevs like this"; `Category.parentId`; `FlavorProfile` type and `Bev.flavorProfile` (column names agreed between M-24 and A-17). **Part 1 done in #68** (the flavour-profile names). **Part 2 ships with A-16 (1)** (Arjun, decided 2026-10-19), as originally specified: `similarities`, `similar` and `listBucketBevs` from `bev_edges`. `Category.parentId` comes with A-13 | M-21, M-24, A-13, A-16, A-17 |
| **S-15** | `docs/bevi-ranking-math.tex` + `.pdf` (this session; §10.1 updated in revision 2 with the embedding and profile terms and the Neo4j decision). Both read it; comments become PRs against the `.tex` | M-22, A-14 |
| **S-17** | `docs/graph.md`: the graph schema, what Postgres owns vs the graph, the sync contract and its sanity report, secret names, the keep-alive rule, "Neo4j is never on a request path", how to resume a paused instance; plus a `supabase/CLAUDE.md` line pointing at it | A-15, A-16 |
| **S-18** | **Done in #92.** `.github/workflows/app.yml`: stop `expo-doctor`'s dependency-version check from turning `main` red when Expo ships an SDK patch (it compares against Expo's *current* expected versions; this happened at #58, fixed by #63). Make that check advisory (its own step with `continue-on-error`, or exclude it) and keep the other doctor checks blocking. Bump patches with `npx expo install --fix` from `app/` in a small `ui/*` PR when it warns (first time: #98) | `main` CI stays green |
| **S-19** | **Done in #92.** `.claude/agents/ui-screen.md` asks for a `ComponentGallery` entry, but no such screen exists in `app/src`. Either drop that step or build the gallery (DEVELOPMENT-MATT §4 planned one). **The gallery did exist, and #56 removed it on purpose at launch** ("the dev gallery and dev routes are gone", DEVELOPMENT-MATT status 2026-10-12). The design system's `preview.html` files now show every state, so the proposal is to drop the step. In the same PR, `app/CLAUDE.md` line 7 still says the design changes "in the artifact first and the mirror is re-synced". Since 2026-10-15 the order is repo first (`design/system/src/`, `npm run build`), then publish to the artifact after the merge | ui-screen runs |
| **S-20** | **Done: backend #97, UI #102 (hybrid; contract 2.3.0).** Profile › Activity can't show likes or comments: `RankedBev` from `rankings.listUser` has no feed-event id, `likeCount`, `likedByMe` or `commentCount`. Either add those fields to `listUser`, or add `feed.listUser(userId, page)` returning `FeedItem`s (found by M-02 and M-03). **Matt's pick (2026-10-18), for Arjun to approve in the contract PR:** `FeedApi.listUser(userId, page)` → `Page<FeedItem>`. This is how Beli and Instagram do it: a profile's activity is the same post as the feed, with the same likes and comments. It also means one card and one cache. Backend: `get_feed`'s row shape filtered to one actor and gated by `feed_event_visible`. `rankings.listUser` stays as it is for lists.
**Blocked on a visibility decision (found 2026-10-18):**
- `rankings_select` lets any signed-in user read anyone's rankings, so a stranger's Activity shows today. Only the age gate applies.
- `feed_event_visible`, which gates posts, likes and comments, requires that you are the author or follow them.
- So a follow-gated `get_user_feed` would empty a stranger's Activity. Options:
  - (1) Hybrid: posts for you and the people you follow, plain rankings for strangers.
  - (2) Make posts public, which changes like and comment policy everywhere and touches D-01.
  - (3) Strangers see posts and counts read-only.
- Nothing was widened | Profile › Activity hearts and comments |

---

## 6. Decisions (D-nn)

| Id | Question | Proposal (so a branch can start) |
|---|---|---|
| **D-01** | Explore scope: one hop, two hops, or global? Likes on comments? | **Accepted 2026-10-19 (Matt; Arjun confirms):** two hops (friends of friends); fall back to global while fewer than 20 users; no likes on comments this round. Explore itself waits on D-15. |
| **D-02** | Bev of the day when nobody ranked anything today? Score definition: the Bev's overall Bayesian score vs. only that day's scores? | **Decided 2026-10-18 (Matt; Arjun confirms in review):** overall Bayesian score among Bevs ranked in the period; if the period is empty, show the latest non-empty day with its date (LaTeX §10.3). |
| **D-03** | Smart Recommend on the map | Parked under the guardrail (§0). Maths kept in LaTeX §10.5 so it is ready when wanted. |
| **D-04** | The finer category list: the actual subcategories under each of today's 15 (for example coffee → hot coffee, iced coffee, espresso drinks, cold brew; tea → hot tea, iced tea, matcha) | **Matt writes it with high effort (2026-10-19)** in `design/taxonomy.md`, together with a slug → leaf assignment for the 378 catalog Bevs, which A-13 needs to migrate the catalog. Arjun reviews. Two levels to start, lined up with the flavour-profile `base` vocabulary. Blocks A-13, then M-21 |
| **D-05** | Bucket buttons: tint by default or keep glass | **Done in #88:** tint everywhere on the web app. |
| **D-06** | Price in lists: hide estimates (`~$`) or hide price entirely on rows | **Decided 2026-10-18 (Matt): the `$`–`$$$$` price tier, estimated or not, comes off rows and posts. It stays on Bev detail.** |
| **D-08** | Map library and tiles | **Decided 2026-10-14: Google Maps JavaScript API with the Bev Maps Google Cloud project** (decision 34). MapLibre + OpenFreeMap (free, no key) stays the fallback if the free map-load allowance is ever exceeded. |
| **D-10** | People search in the new Search tab: one bar with grouped Bevs / People results, or keep the Bevs · People segmented tabs above the bar | **Decided 2026-10-19 (Matt): one bar, grouped results.** Shipped in #104. |
| **D-11** | Flavour profile for a user-created Bev | **Decided 2026-10-19 (Matt and Arjun): option 1.** Copy the most similar seeded Bev's profile, marked `inferred`. How it works (seeded candidates in the same category, embedding cosine, brand tie-break, empty below 0.6) is spelled out in A-16 (1) |
| **D-12** | Google Maps key and quota | **Decided 2026-10-19:** Arjun has it set up (as for Bev Maps) and provides it when M-16 starts |
| **D-13** | Which venues get a pin | **Decided 2026-10-19:** start with the Upper East Side and Roosevelt Island; venues with a curated assortment get pins. Refine while building |
| **D-15** | Explore shows posts from people you don't follow. Can you like and comment on them? | **Decided 2026-10-19 (Matt and Arjun): no.** A plain, read-only post: no hearts, counts or comments. `feed_event_visible` is unchanged |

---

## 7. Suggested order of work

1. **Week 1 (P0, small):** ~~S-01~~ (#65) → ~~A-01~~ (#69) + ~~M-01~~ (folded into #80) · ~~M-09~~ (#60) · ~~M-11~~ (#61) · ~~M-06~~ (#62) · ~~M-07~~ (#85) · S-08/S-09 docs · ~~M-25~~ (#74) · S-18, S-19 (small, found on 2026-10-14). **In parallel (graph foundation, no screens):** ~~A-15~~ (#72, with S-17) · ~~S-14 column names~~ (#68, part 1 only) · ~~M-24~~ (#86) · ~~A-17~~ (#73). **Left on 2026-10-18:** ~~S-08~~ (removed with the icons, 2026-10-19). ~~S-09, S-18, S-19~~ (#92).
2. **Week 2 (P0, social):** ~~S-02~~ (#82) / ~~S-03~~ (#67) → ~~A-02~~ (#70) / ~~A-03~~ (#71) + ~~M-02~~ (#90) / ~~M-03~~ (#91) · ~~S-05 → A-05~~ (#96) + ~~M-05~~ (#105). **Graph (re-planned by #87):** ~~the implementation plan~~ (#87) → ~~M-26~~ (#99, needs the export) → A-16 Stage 2 (sync live; it replaces the keep-alive). **Likes and comments are done end to end;** the only gap left is Profile › Activity: ~~S-20~~ (#97, #102).
3. **Week 3 (P0/P1):** S-04 → A-04 + M-04 (**unblocked**, D-15 decided) · ~~S-07 → A-06~~ (#93) + ~~M-08~~ (#103) · ~~M-12~~ (#95) · ~~M-13~~ (#88) · ~~M-14~~ (#89) · ~~M-15~~ (#104).
4. **Week 4 (P1), now:** see the board at the top, and `NEXT-MATT.md` / `NEXT-ARJUN.md`. In short:
   - **Matt:** M-19, D-04 and M-22 now; M-04 after Explore's backend; M-27, then M-21, after the Bev graph.
   - **Arjun:** #107 (A-14); the M-26 export; S-04 + A-04 (Explore); A-16 (1) + S-14 part 2 (the Bev graph); A-13 after D-04; A-16 (2) after M-28.
5. **Then P2:** the map (S-10 trimmed + A-08 by Arjun → M-16 by Matt; Upper East Side and Roosevelt Island first) · duplicates (S-13 + A-12 → M-20, once the plan is approved).
6. **P3:** A-13 (after D-04) → M-21 (yes from both). Both are now on the P1 board, since the Bev graph is the priority.

Run `npm run typecheck && npm test` from the root and the lane's integrator agent before every PR, as before.

Lessons from week 1 (Matt's lane, with sub-agents):
- **Check every agent report against `git diff --stat origin/main...HEAD` before trusting it.** An agent once reported a test that never reached the commit.
- **A fresh worktree needs `npm ci` at its root.**
- **Only one agent at a time may edit `app/src/app/_layout.tsx` or `(tabs)/_layout.tsx`.** None of M-06/M-09/M-11 touched them. M-15 will.
- **Since #58 a merge to `main` is a production deploy.** Do the device and visual checks before merging, or on a `vercel deploy` preview.
- **Hygiene sweep (`be/hygiene-sweep`, `20261025000400`):** the six reviewer findings from #115/#117/#118 — `cardinality()` for `array_length(arr, 1)`, `revoke insert/update/delete/**truncate**` from `anon`/`authenticated` on every `public` table (TRUNCATE is not subject to RLS, so it passed), `list_bucket_bevs` capped at 500, the missing `rollback;` in `07_user_feed.test.sql`, and eight new pgTAP assertions in `11_graph_tables.test.sql` — plus `npm run graph:verify` (`scripts/graph/verify-pipeline.ts`), which asserts the Vault secrets, embedding coverage, `bev_edges` version/orientation and the two embed triggers, and exits non-zero, because every silent failure here so far has been success-shaped.
