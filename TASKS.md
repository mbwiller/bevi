# Bevi — Tasks from the 2026-10-14 session

Source: `CONVERSATION-2.md` (raw transcript). This file turns that conversation into tasks, split by lane. The maths asked for in topic 6 lives in `docs/bevi-ranking-math.tex` (compiled: `docs/bevi-ranking-math.pdf`).

Lanes are the ones in `DEVELOPMENT-MATT.md` §1 / `DEVELOPMENT-ARJUN.md` §1 and do not change:

| Owner | Paths | Branches |
|---|---|---|
| **Matt** (`@mbwiller`) | `app/`, `packages/ranking/`, `design/` | `ui/*`, `rank/*` |
| **Arjun** (`@acheema5`) | `supabase/`, `packages/api/`, `data/catalog/` | `be/*` |
| **Both** | `shared/` (contract), root docs, `.github/`, `.claude/` | `contract/*`, `chore/*` |

Task ids: `M-nn` Matt, `A-nn` Arjun, `S-nn` shared contract or docs, `D-nn` a decision still open. Put the id in the PR title. Every task that needs the other lane says so under **Needs**; ship the contract PR (`S-`) first, then both sides build against it.

Priorities follow the order the conversation itself set:

- **P0 — "Our experience and immediate changes we want"** (topic 2, called *"probably the most important part of the conversation"*).
- **P1 — UI / UX** (topic 3) and the data the P0 screens need (topic 5).
- **P2 — Additional features** (topic 4: maps, nutrition label, Bev Maps integration).
- **P3 — Later**: parked ideas and algorithm evolutions (graph of Bevs, Smart Recommend).

---

## 0. The guardrail we agreed on

> "I feel like we can't keep throwing [features] at Bevi and thinking it's gonna still look good. At a certain point we reach the bottleneck … too many features." — "Yeah, very fair."

Rule for this round: **finish P0 and P1 before starting anything in P2 or P3.** A P3 item needs a yes from both of us before a branch is opened. The conversation itself parked one idea on this basis (Smart Recommend on the map, D-03).

---

## 1. What the conversation decided (the emphasis)

These are the statements both of us agreed to. Everything in the task board below traces back to one of them.

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
11. **Every Bev needs its own icon**, visible as a miniature in search results, posts and lists. We prefer **icons over photos** for the Bev's identity (*"I like icons more than photos"*); a user's photo is extra. Build **one great icon, turn it into a skill, replicate with sub-agents.** The placeholder art is wrong today (Mexican Coke draws as a can; it is a glass bottle). → M-10, A-07, S-08, D-07
12. **Vessels are not variants.** Can, glass bottle, plastic bottle: *"Coca-Cola is Coca-Cola."* No fluid-ounce input. **Mexican Coca-Cola is its own Bev** (a different product), and its icon is a glass bottle. → S-09, A-07
13. **Dark mode: the top of the screen (status bar area) stays white**; it must follow the system. → M-11
14. **The theme is good.** *"It looks really nice."* But **lists and the feed are too crowded** (*"with the dollars, them all having approximate … it's a lot of info … not laid out very cleanly"*). → M-12
15. **The gut-check buttons (Loved it / It was fine / Didn't like it) stick out too much.** → M-13, D-05
16. **The compare step and the note step are good.** Keep them. **The score reveal is not landing**: *"I don't think it tells you the score. It should show the number and animate a little bit."* → M-14
17. **"Searching for Bevs is amazing."** Keep it. Rename the tab: **Add Bev → Search, with tabs Bevs · People · Maps.** → M-15
18. **Maps**: a map of New York City with markers for spots, **filterable by Bev category** (sodas are everywhere; the value is craft coffee, lattes, cocktails) **and by retailer** (Duane Reade / CVS / Target carry a fixed subset). Include Bev Maps screenshots as the reference. → M-16, A-08, S-10, D-08
19. **Find Bev**: the Bev Maps glassmorphic button, *"smack right there"* on the map, initially linking to Bev Maps. → M-17
20. **Smart Recommend on the map** (Spotify "smart shuffle"): opt-in; show only spots we would recommend. **Challenged as too complicated** → parked under the guardrail. The maths is written anyway (LaTeX §10.5). → D-03
21. **Nutrition label**: a cheap or free open-source VLM reads the label photo and fills in the Bev's nutrition, **broken down by volume**; **for the user's own eyes** on the Bev, not a social feature. → A-09, S-11, M-18
22. **Bev Maps integration** starts as the Find Bev button (19); deeper integration later. → M-17, A-10
23. **Taste Profile stays** but means something concrete: **your average score per category** (*"your average score of cafe drinks could be this number out of 10"*), i.e. which kinds of drinks you prefer. → A-11, S-12, M-19
24. **Binary had-or-not.** One ranking per Bev per user; we never count how many times you drank it. (Already how the data works; record it.) → S-09
25. **Duplicates will happen** as the catalog grows (*"someone inputting a new name of a Bev that's the same as some other name"*). Collect enough unique identifiers to detect them and add a **flag-as-duplicate** path. → A-12, S-13, M-20
26. **Categories must be finer and hierarchical** (external feedback, below) and **Bevs should live in a graph with weighted edges**: the first comparisons are against the most similar Bevs you have ranked. → M-21, A-13, S-14, D-04
27. **The scoring maths is documented as a LaTeX paper**, academic and proof-based, covering what exists and what we plan. → S-15 (done in this session), M-22, A-14

---

## 2. Topic by topic

### Topic 1 — External feedback

- **Beli users don't use Beli for drinks.** Anisha, Jot and Raya: Beli is food; drinks *"not as much, obviously."* Takeaway: *"the market that we're in could be very good … something that's very low on Beli users' minds."* No task; this is the positioning.
- **Cross-category comparisons feel wrong.** Anisha *"didn't like the idea of ranking against other types of cuisines … I'd always take mid Indian food over top-tier American food."* Both agreed: *"Oh, that's such a great point."* Consequence: when you rank a mocha, the first things you compare it against are other mochas, then other coffees, then the rest. *"It has to be that."* This is the single biggest algorithm change requested (M-21, LaTeX §10.1).
- **How to get there:** finer, **hierarchical categories** (*"cafe → hot / cold → subcategories"*) and **a graph of Bevs where each edge holds a weight** (a similarity score, assigned by rules first, learned later). Storage note for Arjun: this is a graph *model*, not necessarily a graph *database*; at our size a `categories.parent_id` column plus a `bev_edges(src, dst, weight, kind)` table in Postgres does the job (A-13).

### Topic 2 — Our experience and immediate changes (P0)

Covered by decisions 1–13 above. One question raised here is answered now, because it was addressed to Claude:

> "I rated it a 7.6, you rated it 2.0 … 9.6 divided by 2 is not 5.9. I think it's weighed by your ranking on the leaderboard. We just need Claude to tell us what the logic there is."

**It is not weighted by anyone's leaderboard rank.** The number on a Bev is a **Bayesian average**: the plain mean is pulled toward the global mean of all scores with the weight of **3 phantom ratings** (`BAYES_C = 3` in `packages/ranking/src/constants.ts`, `public.bayes_score(sum, n, m, 3)` in SQL).

```
bayes = (C·m + Σ scores) / (C + n) = (3·m + 7.6 + 2.0) / (3 + 2)
```

For that to display 5.9 the global mean `m` was about 6.6 at that moment (`(3·6.63 + 9.6) / 5 = 5.90`). With only two raters the prior counts for more than the two of you combined, which is the point: one person's 10/10 cannot top the leaderboard. The full derivation, the n = 2 eligibility rule and the leaderboard order are in the LaTeX document, §5. Aside: a stored 7.6 means that Bev sat at the bottom of a Loved bucket of four (or 8th of 9), and 2.0 is a Didn't-like bucket of one (LaTeX §3).

### Topic 3 — UI / UX (P1)

Decisions 14–17. Keep: theme, user page, compare step, note step, search. Change: density of lists and feed, gut-check button weight, score reveal, tab naming.

### Topic 4 — Additional features (P2)

Decisions 17–22: the Search tab with Maps, the NYC map with category and retailer filters, Find Bev → Bev Maps, nutrition label via a VLM. Smart Recommend parked (D-03).

### Topic 5 — What is stored per user, and what is not

Asked as *"let's talk about what's not stored that needs to be stored."* Today the database has rankings, comparisons, Want to Try, follows, feed events, per-user stats, streaks, rank points. **Not stored, and needed by this round:**

| Needed by | Missing today | Task |
|---|---|---|
| Likes | a likes table, counts on feed rows | A-02 |
| Comments | a comments table, counts, paging | A-03 |
| Explore | a popularity ranking of posts / Bevs, friends-of-friends scope | A-04 |
| Bev of the day / week | a per-period winner (computed or cached) | A-05 |
| Category progress | total active Bevs per category | A-06 |
| Icons / vessel | per-Bev icon asset and vessel kind (can, glass bottle, cup…) | A-07 |
| Maps | venues, venue ↔ Bev links, chain vs craft | A-08 |
| Nutrition | parsed nutrition facts per Bev, per serving and per 100 ml | A-09 |
| Taste Profile | `user_category_stats` exists but **is never written** (`refresh_user_stats` only fills `user_stats`; `affinity_z` has no writer) | A-11 |
| Duplicates | a duplicate-of target on reports, a merge routine | A-12 |
| Finer categories | `categories.parent_id` (hierarchy), `bev_edges` weights | A-13 |

Already true and worth writing down: a user ranks a Bev **once** (`rankings` is unique on `(user_id, bev_id)`; a re-rank moves it). That is the "binary had-or-not" (S-09).

### Topic 6 — Scoring algorithms and rankings

> "Instead of a markdown file, please design a LaTeX document describing the algorithm … in the format of academics doing research … proof based but also just outline all the mathematics that are used … including what we are thinking about further implementing."

Done: `docs/bevi-ranking-math.tex` (S-15). It covers, with definitions, propositions and proofs: pairwise placement and its bounds, score-from-position and the exact cents rounding, population statistics and z-scores, the category-affinity subtlety, the Bayesian leaderboard (with the 5.9 worked example), Layer 1 and Layer 2 prediction, the blend, exploration, cold start, rank points and streaks; then the proposed extensions from this session: category-aware (anchored) placement over a weighted Bev graph, Taste Profile, Bev of the period, likes and the Explore ranking, Smart Recommend on the map, nutrition normalisation, duplicate detection. It ends with the known places where SQL and TypeScript differ today.

---

## 3. Task board — Matt (`app/`, `packages/ranking/`, `design/`)

### P0

**M-01 · Feed: stop rendering saves; keep the "you saved this" signal.** `ui/feed-no-saves`
- Today: `app/src/features/feed/FeedPostItem.tsx` renders `item.type === 'SAVED'` with `verb="saved"`; `FeedPost` has an `isSave` branch (no image strip, no score). The filled bookmark on a post (`inMyWantToTry`) already shows "you have this saved", which is the behaviour we want to keep.
- Do: remove the SAVED rendering path from `FeedPostItem`/`FeedPost` once S-01 lands (the type union shrinks, so TypeScript finds every spot); keep `FeedPost verb="saved"` only if Profile › Activity still needs it (it doesn't; rankings only). Update `Feed.test.tsx` fixtures.
- Needs: S-01, A-01.
- DoD: no save ever appears in the feed; the bookmark still fills on posts for Bevs in your Want to Try.

**M-02 · Likes on posts (Instagram-identical).** `ui/post-likes`
- Spec from the session: heart button in the post's action row, **filled `primary` (grape) when liked**, like count beside it, **double-tap anywhere on the post to like** with a heart burst over the image (Reanimated, transform + opacity only, reduced-motion fallback = fade). Optimistic update with rollback (same pattern as `useToggleSet` in the leaderboard).
- Design system: add `LikeButton` and the burst to `design/system` first (the system is the source of truth, `app/CLAUDE.md`), then port to `app/src/components/`. `primary` on the heart is consistent with the system's rule that grape marks "something to tap or a value you earned" (same as the saved bookmark).
- Accessibility: `accessibilityRole="button"`, label "Like" / "Unlike, 12 likes", `aria-pressed`; double-tap is an addition, never the only way.
- Needs: S-02, A-02.
- DoD: like, unlike, count, double-tap, works offline-optimistically, tests in `components/__tests__/` and `features/feed/__tests__/`.

**M-03 · Comments.** `ui/post-comments`
- Spec: comment icon in line with the heart, count beside it. Tapping opens a clean sheet/screen: list of comments (avatar 32, name, text, time), composer pinned to the bottom. **Inline on the post: the first comments are visible without tapping; after seven, show "View all N comments".** No likes on comments for now (D-01).
- Use the app's `Sheet` (`src/components/Sheet.tsx`) or a full-screen route `post/[id]/comments`; the list is a FlashList (can exceed 20 rows).
- Needs: S-03, A-03.
- DoD: post, read, delete own comment; seven-rule; empty state copy in the design system's voice.

**M-04 · Explore surface.** `ui/explore`
- Spec: the Feed keeps "Your feed" (friends). Add an **Explore** segment (`SegmentedTabs` on the Feed, or a second list under the header) showing posts from people one or two follows away, **ordered by popularity (likes)**, not time. Post cards are the same `FeedPost`. Follow button on the actor for people you don't follow yet.
- Needs: S-04, A-04, D-01 (hops and whether global is allowed as a fallback when the graph is tiny).
- DoD: Explore renders from `feed.getExplore()`, paginates, degrades to an empty state when nothing is popular yet.

**M-05 · Bev of the day · Bev of the week.** `ui/bev-of-period`
- Spec: **two cards side by side at the top of the feed, directly under the search bar** (above Featured Bevs; consider replacing the Featured carousel while the catalog has no hero art). Each card: the Bev's image/icon, a small caps label ("BEV OF THE DAY" / "BEV OF THE WEEK"), the Bev's name underneath, the Bayesian score bubble. Tapping opens the Bev. **Not a post.** When no Bev was ranked that day, show the most recent day's winner with its date, or hide the day card (D-02).
- Design system: a `BevOfCard` component (half-width, square image).
- Needs: S-05, A-05.
- DoD: both cards render from one call; empty states; snapshot test.

**M-06 · Leaderboard rows get Bev icons; explain People points.** `ui/leaderboard-icons`
- Today `app/src/features/leaderboard/BevBoard.tsx` renders `BevRow` without `showImage`; the row already supports it (`BevRow showImage` draws a 56pt `BevImage`). Turn it on. People rows already show the avatar; add an info affordance on the People board header explaining the points: "1 pt per Bev ranked · 3 per day of your current streak · 2 per Bev you added that someone else ranked" (the formula in `packages/ranking/src/rank.ts`; wording checked against `RANK_POINTS_WEIGHTS`).
- Optional with S-06: show the breakdown per row ("84 Bevs · 4-day streak · 2 added").
- DoD: icons on the Bevs board at all sizes; the points explainer sheet; tests updated.

**M-07 · Score bubble: rethink the count badge.** `ui/score-count`
- Today `ScoreBubble` draws the rating count as a small `primary` pill overlapping the bubble (bottom-right). Feedback: it reads like a vote tally and makes the score look off. Options (pick in the design system first): move the count into the row's meta line ("5.9 · 2 ratings"), or keep the badge but neutral (`input` fill, `textSecondary` text) and only above 10 ratings. Apply everywhere the bubble has `count` (leaderboard, search, Want to Try, Recommended, Bev detail).
- DoD: design system updated; `ScoreBubble.test.tsx` updated; no `primary` badge on the score.

**M-08 · Your Lists › Bev'd: gamify.** `ui/bevd-gamified`
- Spec: **icons on every row** (`BevRow showImage` in `BevdTab.tsx`, which currently has `actions={false}` and no image); a **category progress strip** above the list ("Soda · 4 of 61 tried · 7%") driven by A-06; and one visual "graph of Bevs" (e.g. a horizontal bar per category of your ranked count vs catalog size, or a collection grid of icons you've unlocked). Keep the rows less crowded (see M-12).
- Needs: S-07, A-06.
- DoD: rows show icons, progress strip shows real counts, test for the percentage copy (never show 0% as "0.4%"; round down).

**M-09 · Bug: sort toggle scrolls the list to the bottom.** `ui/fix-sort-jump`
- Where: `app/src/features/lists/BevdTab.tsx` cycles `sort` on `SortToggle` press; the whole `header` (filters + toggle) is the FlashList's `ListHeaderComponent`, and the query key changes, so the list re-mounts its data and the viewport lands at the end. Fix: keep the header outside the list or memoised, call `scrollToOffset({ offset: 0, animated: false })` on sort change (keep a list ref), or render the header as a sticky element above `BevList`. Check the same pattern in `RecommendedTab` and `WantToTryTab`.
- DoD: tapping Score → Recent → Name keeps the viewport at the top; a test asserts the list ref's scroll call or that the header stays mounted.

**M-10 · Bev icons: the style, the skill, the component.** `ui/bev-icons` (with Arjun's A-07)
- Decision 11: icons over photos for identity. Matt owns the look (`design/`): write `design/icons/STYLE.md` (one consistent illustrated cutout style: transparent background, fixed canvas, vessel-true, brand colours, no logos), make **one great reference icon**, then a `.claude/skills/bev-icon/SKILL.md` that produces icons in that style from a Bev's fields (name, brand, flavor, vessel). Arjun runs it across the catalog and uploads (A-07); Matt reviews a sample before the batch.
- App: `BevArt` chooses the silhouette by **the Bev's vessel** (`artKind` from S-08) instead of by category (`CATEGORY_KIND` in `app/src/components/BevArt.tsx` is why Mexican Coke draws as a can). Add the `glassBottle` kind. Icons then replace art wherever `photoUrl` exists.
- DoD: style doc + reference icon + skill merged; `BevArt` reads `artKind`; search results, posts and lists show the icon.

**M-11 · Dark mode: status bar area is white on the home-screen app.** `ui/dark-statusbar`
- Where: `app/public/index.html` sets `apple-mobile-web-app-status-bar-style="default"` and `app/public/manifest.json` has `"theme_color": "#ffffff"` (one value, no dark variant). iOS paints the status-bar strip from these, not from the app's `SafeAreaView` background, so it stays white in dark mode. The two `theme-color` metas already have light/dark media queries.
- Fix: set `apple-mobile-web-app-status-bar-style` to `black-translucent` so the page extends under the status bar (the app already uses `viewport-fit=cover` and `SafeAreaView edges=['top']`, so nothing overlaps), give `body` a `prefers-color-scheme` background matching `surface` in both themes so nothing white flashes under the inset, and remove or darken the manifest `theme_color`. Verify on a real iPhone from the home screen; this cannot be checked in jest.
- DoD: screenshots light and dark from the home-screen app with the strip matching the page.

### P1

**M-12 · Less crowded rows and posts.** `ui/density`
- Feedback: `$`/`~$` on every row, three text lines, meta line, two action icons. Proposal (in the design system first): `BevRow` → name, one secondary line (category · brand), the bubble; price only on Bev detail (or only when not estimated); actions as a single overflow on dense lists. `FeedPost` → remove the price from the post header line. Keep 44pt targets.
- DoD: updated design system previews and ported components; visual check of Feed, Bev'd, Leaderboard, Search.

**M-13 · Gut-check buttons: calmer.** `ui/bucket-buttons` (D-05)
- Feedback: the three `BucketButton`s *"stick out a lot"*. The glass is CSS `backdrop-filter` in `app/src/components/BucketButton.tsx` (no Apple developer route is needed on the web build; that worry is moot). Options: default to the `tint` material (12% bucket tint, 4pt bar) and reserve glass for when a `BevGlow` sits behind a real photo; reduce the orb to 40pt; drop the fizz unless selected. Decide in the design system.
- DoD: previews for both materials; the chosen default shipped.

**M-14 · Show the score, with motion, at the moment of placement.** `ui/score-reveal`
- Today the score only appears on `RankResult` after Save/Skip on the note step (`ScoreBubble 56` with `ZoomIn.springify()`), which is why it was missed. Change: compute the score locally the moment placement finishes (`storedScore(insertIndex, list.length + 1, bucket)` from `@bevi/ranking`; the server's re-spacing stores exactly this value, LaTeX §3) and show it **on the note step**: a 72pt bubble that pours in and **counts up to the number**, with "#4 of 31 in Loved" under it; the note field sits below. `RankResult` then confirms the saved value (unchanged unless a conflict occurred).
- DoD: the number is visible before the note is written; reduced-motion shows it without the count-up; tests cover the local score equals the submitted result.

**M-15 · Add Bev → Search, with a Maps tab.** `ui/search-tab`
- `app/src/components/TabBar.tsx` labels the centre circle "Add Bev"; `app/src/app/(tabs)/add/index.tsx` has Bevs · People. Rename to **Search** (tab label, header, route stays `/add` or moves to `/search` with a redirect), add a third tab **Maps** that hosts M-16. The grape circle stays the design system's.
- DoD: three tabs; deep links `?tab=people|maps`; the camera "Snap it" pill and "Can't find it? Add a new Bev" footer unchanged.

**M-19 · Taste Profile tab.** `ui/taste-profile`
- Replace the "Coming soon" tab (`app/src/features/profile/ActivityList.tsx`) with the simple definition from the session: a bar list of **your average score per category** ("Coffee 8.1 · 9 ranked"), ordered high to low, with a one-line read-out ("You prefer coffee and boba over soda"). The §6.20 calendar and share card can come later.
- Needs: S-12, A-11.
- DoD: renders from `stats.getTasteProfile`, hides categories with no rankings, works on another user's profile.

### P2

**M-16 · Maps tab: NYC map with filters.** `ui/maps`
- Spec: a map of New York City (bounded to the five boroughs) with markers for spots that carry Bevs. Filter pills: **by Bev category** (multi-select; the session's example: pick Soda and the map gets crowded, pick Coffee and it gets interesting) and **by venue kind**: chain retailers (Duane Reade, CVS, Target carry a fixed subset) vs craft spots. Marker states: open / closed, popular. Tap a marker → sheet with the venue's Bevs (`BevRow`s, rank and save actions).
- Library: evaluate MapLibre GL JS with free tiles vs Leaflet; no paid key if possible (D-08). Web-only, so a plain JS map component is fine.
- Reference: add Bev Maps screenshots under `design/reference/bev-maps/` (the session asked for them).
- Needs: S-10, A-08.
- DoD: markers from `venues.list({ bbox, categoryIds, kinds })`, filters work, 60fps panning on an iPhone 12 Safari.

**M-17 · The Find Bev button → Bev Maps.** `ui/find-bev-button`
- Spec: the Bev Maps glassmorphic button, ported as-is into the design system and placed at the bottom of the Maps tab. Tapping opens Bev Maps (external URL, with the current map centre as parameters if Bev Maps accepts them). Later it becomes in-app.
- DoD: component in `design/system` and `app/src/components/`; deep link works from the home-screen app.

**M-18 · Nutrition on the Bev detail.** `ui/nutrition`
- Spec: a collapsed "Nutrition" section on `bev/[id]` showing calories, sugar, caffeine, sodium **per serving and per 100 ml** (toggle), with the serving size, and the label thumbnail. Shown to everyone who opens the Bev but never on the feed or lists (decision 21).
- Needs: S-11, A-09.
- DoD: renders when `bev.nutrition` exists; hidden otherwise; per-100 ml maths uses the shared helper (LaTeX §10.6).

**M-20 · Report sheet: "Duplicate of…".** `ui/report-duplicate`
- `app/src/features/bev/ReportSheet.tsx` already offers the `duplicate` reason; add a Bev search step to pick the original, sent as `duplicateOfId`.
- Needs: S-13, A-12.

### P3 (needs a yes from both)

**M-21 · Category-aware placement (anchored binary search).** `rank/anchored-placement`
- The algorithm answer to Anisha's feedback. Specified in LaTeX §10.1: the user's bucket list is searched in two phases, first among **anchors** (ranked Bevs most similar to the new one, same subcategory first, then adjacent categories by edge weight), then among the remaining Bevs between the two anchors it landed between. Same `PlacementResult` shape (`insertIndex`, `expectedBucketSize`, `comparisons`), so `submit_ranking` is untouched; the comparison log stays consistent with the final index. Bump `RANKING_VERSION`, regenerate vectors (`contract/vectors-*`).
- Needs: S-14 (bucket lists must carry each Bev's category and the similarity inputs; today `rankings.listBucket` returns ids only), A-13, D-04.
- DoD: property tests: valid index, consistent log, first question is the most similar anchor when one exists, comparisons ≤ ⌈log₂(a+1)⌉ + ⌈log₂(g+1)⌉.

**M-22 · Keep the maths paper and the package in step.** `chore/ranking-doc`
- Any `RANKING_VERSION` bump updates `docs/bevi-ranking-math.tex` §11 (version table) in the same PR. Review the paper with Arjun once (S-15).

---

## 4. Task board — Arjun (`supabase/`, `packages/api/`, `data/catalog/`)

### P0

**A-01 · Saves are not feed events.** `be/feed-no-saves`
- Where: `add_want_to_try` (latest in `supabase/migrations/20261011000400_contract_v1_rpc_fixes.sql`) inserts `feed_events(kind = 'want_to_try')`; `get_feed` (same file) selects `kind in ('ranked','reranked','want_to_try')`. New migration: stop the insert, filter `get_feed` to `('ranked','reranked')`, delete existing `want_to_try` rows from `feed_events`, and tighten the `kind` check constraint (`'followed'` is also dead). `packages/api/src/mappers.ts` drops the `'SAVED'` mapping.
- Needs: S-01.
- DoD: pgTAP test that a save produces no feed row; live test `getFeed` has only RANKING items.

**A-02 · Likes.** `be/post-likes`
- Schema: `post_likes(user_id, feed_event_id, created_at)` PK `(user_id, feed_event_id)`, RLS select for authenticated, writes through `like_post(p_event_id)` / `unlike_post(p_event_id)` (security definer, idempotent, rate-limited via `user_actions`). `get_feed` returns `like_count` and `liked_by_me`. Cascade on event delete.
- `packages/api`: `feed.like(id)`, `feed.unlike(id)`; `FeedItem.likeCount`, `likedByMe` in the mapper.
- Needs: S-02.
- DoD: pgTAP for idempotency and RLS (no direct insert policy); live test round-trip.

**A-03 · Comments.** `be/post-comments`
- Schema: `post_comments(id, feed_event_id, user_id, body ≤ 280, created_at, deleted_at)`; RPCs `add_comment`, `delete_comment` (own only), `get_comments(p_event_id, p_limit, p_before_id)` keyset-paged; `get_feed` returns `comment_count` and the **first three comments** inline so the post can show them without a second call (the seven-rule is the app's). Rate limits; report path via `bev_reports`-style `comment_reports` or reuse with a `kind` column.
- `packages/api`: `comments.list/add/remove`; mappers.
- Needs: S-03.
- DoD: pgTAP for RLS and paging; live test.

**A-04 · Explore.** `be/explore`
- RPC `get_explore(p_limit, p_before)` over posts by users within two follows of the caller (recursive CTE on `follows`, depth ≤ 2, excluding the caller's own follows' posts already in the feed, D-01), ordered by a **time-decayed like count** (LaTeX §10.4: `(likes + 1) / (age_hours + 2)^1.5`; constant in one place). Also `get_popular_bevs(p_days)` for the "Bevs getting the most likes" ranking if the app wants a Bev-level list.
- Needs: S-04, A-02.
- DoD: `explain analyze` under 150 ms locally at 1k posts; live test.

**A-05 · Bev of the day / week.** `be/bev-of-period`
- RPC `get_bev_of_period()` returning two rows (`day`, `week`): among Bevs with at least one ranking created in the current **America/New_York** day (ISO week), the one with the highest **Bayesian score** (ties: more rankings in the period, then more raters overall, then name). Fallback (D-02): the most recent period with a ranking, with the period's date in the payload. Definition in LaTeX §10.3. Cheap enough to compute live; cache in a table only if the feed call gets slow.
- Needs: S-05.
- DoD: pgTAP with fixed timestamps across the midnight and ISO-week boundaries.

**A-06 · Category progress.** `be/category-progress`
- Add `bev_count` (active, age-filtered) to `categories.list()` and the caller's ranked count per category to `get_profile_stats` or a small `get_category_progress()`. Powers M-08's "you've tried 7% of Sodas".
- Needs: S-07.

**A-07 · Per-Bev vessel and the icon batch.** `be/bev-icons`
- Schema + catalog: `bevs.vessel` (`can | slim_can | glass_bottle | plastic_bottle | cup | mug | wine | pint | carton | other`) with a `vessel` column in `data/catalog/bevs.csv` (Mexican Coke → `glass_bottle`), validated by `scripts/catalog/validate.ts`, carried by `catalog:migration`; exposed on every Bev read.
- Icons: seeds are inserted **with no photo** (`build-seed-migration.ts` header), so every list shows placeholder art today. Run Matt's icon skill (M-10) across the 378 seeds with Haiku/Sonnet sub-agents, upload to the public bucket as `photo_path`/`thumb_path`, status stays `active`. Matt reviews a sample of 20 first. Photos sourced from the web are the fallback only where the skill cannot produce a faithful icon (D-07; mind licences, `image_license` column exists).
- Dedupe hygiene for decision 12: the natural unique index on `(category, brand, name, flavor)` already ignores vessel; make sure vessel words ("can", "bottle", "glass") never become part of a name during create (normalise in `create_bev`).
- Needs: S-08, M-10.
- DoD: `vessel` on 378 rows; icons live for the full catalog; `catalog:validate` enforces the enum.

### P1

**A-11 · Taste Profile data.** `be/taste-profile`
- `user_category_stats` is never written: `refresh_user_stats` (`20261011000700_streak_and_rank_points.sql`) only updates `user_stats`, and nothing writes `affinity_z`. Add `refresh_user_category_stats(p_uid)` (population stddev, `affinity_z = Σ z / (n + 2)` with z against the user's **overall** effective stats, as in `packages/ranking/src/stats.ts` and LaTeX §4.3), call it from `submit_ranking`, `rerank_bev`, `remove_ranking`, and from the nightly `refresh_all_stats`. RPC `get_taste_profile(p_user_id)` → rows `(category_id, rating_count, mean_score, affinity_z)`, visible for any user (means are not sensitive; birth dates stay private).
- Needs: S-12.
- DoD: golden-vector test against `shared/fixtures/user-stats.vectors.json`; live test.

### P2

**A-08 · Venues for the Maps tab.** `be/venues`
- Schema: `venues(id, name, kind chain|craft, lat, lng, address, neighborhood, hours jsonb, source, external_id)` with a NYC bounding-box check; `venue_bevs(venue_id, bev_id, verified_at)`; RPC `list_venues(p_bbox, p_category_ids[], p_kinds[])` returning venues with Bev counts; `get_venue(p_id)` with its Bevs. Seed from the Bev Maps backend (export of the NYC spots) plus chain presets (a Duane Reade carries the standard soda/energy/sports subset: encode as a `chain_assortments` table so one row covers every branch).
- No location features for users: we store venue coordinates, never the user's (vision §17 still holds; the map centres on NYC, not on the user, unless they tap "locate me", which stays on-device).
- Needs: S-10.

**A-09 · Nutrition extraction.** `be/nutrition`
- Pipeline: when a `label` asset is uploaded (`media.upload({ kind: 'label' })`, already exists), an Edge Function `extract-nutrition` sends the image to a cheap hosted open-weight VLM (candidates to evaluate, D-09) with a strict JSON schema prompt and stores `bev_nutrition(bev_id, serving_ml, servings_per_container, calories, total_fat_g, sodium_mg, total_carb_g, sugars_g, added_sugars_g, protein_g, caffeine_mg, confidence, model, raw jsonb)`. Per-100 ml values are derived, not stored (LaTeX §10.6, with the sanity checks: calories ≈ 4·carbs + 4·protein + 9·fat within tolerance; reject and mark `needs_review` otherwise). Admin re-run RPC.
- Needs: S-11.
- DoD: 20 real labels parsed with ≥ 90% field accuracy on a hand-checked set; failures leave `nutrition = null` and never block the Bev.

**A-10 · Bev Maps data link (later).** `be/bev-maps-sync`
- After A-08: a scheduled job that refreshes `venues` from Bev Maps, and a stable id mapping so the Find Bev button can pass a Bev or venue through.

**A-12 · Duplicates: identifiers, flagging, merging.** `be/duplicates`
- Today: `find_similar_bevs` (pg_trgm over `search_text` + aliases) runs during create; `bev_reports.reason` already allows `'duplicate'`; `bevs.upc` exists with a unique index; `status = 'merged'` and `merged_into` exist but there is no merge routine.
- Do: `report_bev` accepts `p_duplicate_of uuid`; admin RPC `merge_bev(p_src, p_dst)` that re-points rankings (if a user ranked both, keep the better-positioned one and remove the other with re-spacing), moves aliases and `want_to_try`, folds `bev_stats`, sets `status='merged'`; a view of pending duplicate reports for Studio. UPC becomes the strongest identifier (barcode scan was already in your §13 proposals).
- Needs: S-13.
- DoD: pgTAP merge test preserving bucket invariants (`unique (user_id, bucket, position)`, scores re-spaced).

### P3

**A-13 · Category hierarchy and the Bev graph.** `be/bev-graph`
- `categories.parent_id` (self-reference; leaves are what Bevs point to; today's 15 ids become the second level, e.g. `coffee → coffee_hot, coffee_iced, matcha, mocha…`; the taxonomy itself is D-04). `bev_edges(src_bev_id, dst_bev_id, weight numeric(4,3), kind rule|learned, updated_at)` with weights from the formula in LaTeX §10.1 (tree similarity + content similarity, later co-preference), refreshed nightly. `get_prediction_snapshot()` gains `parentId` per category and, for the ranking flow, `rankings.listBucket` returns each Bev's category and brand so the app can order anchors (S-14).
- This is a graph **model in Postgres**, which is what the maths needs; a graph database product is not required at our size (noted in LaTeX §10.1).

**A-14 · SQL ↔ TypeScript parity follow-ups.** `be/ranking-parity`
- Known divergences (LaTeX §11): the SQL prior is the global mean only (`get_bev_leaderboard`, `refresh_global_stats`), while `@bevi/ranking` uses a category's own mean once it has 30 rankings; `affinity_z` has no writer (A-11); the leaderboard's tie-break order in SQL is `bayes desc` only, the package specifies `bayes desc, n desc, name asc (C collation), id asc`. Align, with golden-vector tests.

---

## 5. Task board — shared (`contract/*` and `chore/*`; the other owner approves)

| Id | Contract or doc change | Unblocks |
|---|---|---|
| **S-01** | `FeedEventKind` → `'RANKING'` only; `WantToTryApi.add` no longer "posts a 'SAVED' feed item"; `FeedApi.getFeed` doc | M-01, A-01 |
| **S-02** | `FeedItem.likeCount: number`, `likedByMe: boolean`; `FeedApi.like(id)`, `unlike(id)` (idempotent, `'not_found'`, `'rate_limited'`) | M-02, A-02 |
| **S-03** | `FeedItem.commentCount`, `comments: Comment[]` (first three); `CommentsApi { list(eventId, page), add(eventId, body), remove(id) }`; `Comment { id, author: Profile, body, createdAt }` | M-03, A-03 |
| **S-04** | `FeedApi.getExplore(page)` → `Page<FeedItem>`; optional `leaderboard.popularBevs({ days })` | M-04, A-04 |
| **S-05** | `FeedApi.getBevOfPeriod()` → `{ day: PeriodWinner \| null, week: PeriodWinner \| null }`, `PeriodWinner { bev: BevSummary, periodStart: string, rankingsInPeriod: number }` | M-05, A-05 |
| **S-06** | `UserLeaderboardRow.bevsCreated: number` (optional) | M-06 |
| **S-07** | `Category.bevCount: number`; `StatsApi.getCategoryProgress()` → `{ categoryId, ranked, total }[]` | M-08, A-06 |
| **S-08** | `BevSummary.artKind: ArtKind` (vessel enum shared by app and catalog); `CreateBevInput.vessel` | M-10, A-07 |
| **S-09** | `vision.md` edits: vessels are not variants; one ranking per Bev per user ("binary"); Mexican Coke is its own Bev; icons over photos; feed = friends + Explore; Bev of the day/week; NYC only for maps and "area" | everyone |
| **S-10** | `VenuesApi { list({ bbox, categoryIds?, kinds? }), get(id) }`; `Venue`, `VenueKind` types | M-16, A-08 |
| **S-11** | `Bev.nutrition: Nutrition \| null` (per-serving fields + `servingMl`); a shared `per100ml()` helper in `shared/` | M-18, A-09 |
| **S-12** | `StatsApi.getTasteProfile(userId)` → `{ categoryId, rankingCount, mean, affinity }[]` | M-19, A-11 |
| **S-13** | `BevsApi.report(id, reason, opts?: { duplicateOfId })` | M-20, A-12 |
| **S-14** | `RankingsApi.listBucket(bucket)` → `{ id, categoryId, brand }[]` (or a parallel `listBucketBevs`), `Category.parentId` | M-21, A-13 |
| **S-15** | `docs/bevi-ranking-math.tex` + `.pdf` (this session). Both read it; comments become PRs against the `.tex` | M-22, A-14 |

---

## 6. Decisions still open (D-nn)

| Id | Question | Proposal (so a branch can start) |
|---|---|---|
| **D-01** | Explore scope: one hop, two hops, or global? Likes on comments? | Two hops (friends of friends); fall back to global while fewer than 20 users; no likes on comments this round. |
| **D-02** | Bev of the day when nobody ranked anything today? Score definition: the Bev's overall Bayesian score vs. only that day's scores? | Overall Bayesian score among Bevs ranked in the period; if the period is empty, show the latest non-empty day with its date (LaTeX §10.3). |
| **D-03** | Smart Recommend on the map | Parked under the guardrail (§0). Maths kept in LaTeX §10.5 so it is ready when wanted. |
| **D-04** | The finer category taxonomy (which leaves under each of today's 15 ids) and how deep | Two levels: today's 15 become parents; add leaves only for coffee, tea, boba, soda, beer, cocktails first. Matt drafts in `design/taxonomy.md`, Arjun stores it. |
| **D-05** | Bucket buttons: tint by default or keep glass | Tint by default; glass only over a real photo. |
| **D-06** | Price in lists: hide estimates (`~$`) or hide price entirely on rows | Hide on rows; keep on detail. |
| **D-07** | Icon production: generated illustrations via the skill vs. web product photos | Generated illustrations in one style; photos only as fallback with a recorded licence. |
| **D-08** | Map library and tiles | MapLibre GL JS + a free tile source; revisit if a key is needed. |
| **D-09** | Nutrition VLM | Trial two cheap hosted open-weight vision models on 20 labels; pick by field accuracy per dollar. |

---

## 7. Suggested order of work

1. **Week 1 (P0, small):** S-01 → A-01 + M-01 · M-09 · M-11 · M-06 · M-07 · S-08/S-09 docs.
2. **Week 2 (P0, social):** S-02/S-03 → A-02/A-03 + M-02/M-03 · S-05 → A-05 + M-05.
3. **Week 3 (P0/P1):** S-04 → A-04 + M-04 · S-07 → A-06 + M-08 · M-10 + A-07 (icons) · M-12 · M-13 · M-14 · M-15.
4. **Week 4 (P1):** S-12 → A-11 + M-19 · A-14 parity.
5. **Then P2:** maps (S-10, A-08, M-16, M-17), nutrition (S-11, A-09, M-18), duplicates (S-13, A-12, M-20).
6. **P3 only after both say yes:** D-04 → S-14 → A-13 → M-21.

Run `npm run typecheck && npm test` from the root and the lane's integrator agent before every PR, as before.
