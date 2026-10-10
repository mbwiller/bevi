# Bevi — Development plan: Matt (UI + ranking/recommendation logic)

Written 2026-10-09 from `vision.md` (source of truth), `CONVERSATION.md` (raw founding chat) and the agreed work-split brief. Arjun's counterpart is `DEVELOPMENT-ARJUN.md`; the two documents share the ownership table and the five seams word for word. Where this doc goes beyond vision.md it says so, and §18 lists everything that should be folded back into vision.md.

**Contents**

1. Your lane: what you own
2. Phase 0 research: UI skills and libraries (verified)
3. App foundation (`app/`)
4. Design system before screens (`design/`, `app/src/theme`)
5. From Beli screenshots to per-screen specs
6. Screen inventory
7. Accessibility, performance, distribution
8. `packages/ranking`: the math
9. `packages/ranking`: exports, types, package layout
10. Golden test vectors
11. Testing strategy (unit, property, offline evaluation)
12. Interfaces with Arjun (ownership table + the five seams)
13. Your draft of per-screen data needs for contract v0
14. Dependency and handoff table
15. Plan by phase (tasks, definitions of done, sub-agent tags)
16. First-week checklist
17. Deliberately not doing (from the conversation)
18. Open questions and proposed vision.md changes

---

## 1. Your lane: what you own

Repo: `/Users/matt/Desktop/bevi` (GitHub `mbwiller/bevi`). You are `@mbwiller`; Arjun is `@acheema5`.

### Ownership (identical in both DEVELOPMENT docs)

| Path | Owner | What lives there |
|---|---|---|
| `app/` | Matt | Expo RN app: navigation (5 tabs), screens, components, design system/tokens, logo usage, camera/image-picker UI, client state, the dev-only mock API |
| `packages/ranking/` | Matt | Pure TypeScript, zero I/O: pairwise placement state machine (gut-check bucket → binary search), score-from-position, normalization (per-user z-scores, per-category stats definitions), Bayesian leaderboard average, predicted score + recommendations (Layer 1, Layer 2, blend, exploration), onboarding starter-set selection, "rank on Bevi" formula. Unit-tested. |
| `design/` | Matt | Beli reference screenshots, brand, logo, per-screen specs |
| `supabase/` | Arjun | Migrations, RLS policies, SQL functions/RPCs, triggers, views, Edge Functions, cron/scheduled jobs, storage buckets + policies, auth config, `seed.sql` |
| `packages/api/` | Arjun | Typed data-access client wrapping supabase-js that implements the `BeviApi` interface. The ONLY thing the app imports to talk to the backend. |
| `data/catalog/` | Arjun | Seed Bev catalog (names, flavors, categories, price tiers), image sourcing + background-removal pipeline. Matt reviews image style. |
| `shared/` | Both, via `contract/*` PRs | Domain types, enums (buckets, categories, price tiers), the `BeviApi` interface, generated Supabase DB types, fixtures, golden test vectors |
| Root, `CLAUDE.md`, `vision.md`, `.github/`, `.claude/` | Both, via `chore/*` PRs | Workspace config, CI, agent definitions |

Branches: you use `ui/*` (app) and `rank/*` (ranking package); Arjun uses `be/*`; shared uses `contract/*` and `chore/*`. Never push to `main`; PR + CI + integrator review. Contract changes are their own PR, approved by the other owner.

### Conventions carried over from Bev Maps (you already know these)

- One lockfile at the root. `npm install <pkg> -w app` (or `-w packages/ranking`), never inside the workspace folder. Lockfile conflict: `git checkout origin/main -- package-lock.json && npm install`.
- Branch from fresh main (`git fetch && git switch -c ui/<thing> origin/main`), rebase daily, small PRs, open drafts early, squash merge, delete branch.
- Run the integrator agent locally before opening a PR. Per your memory note: you may squash-merge your own `ui/*` (and by extension `rank/*`) PRs after CI + integrator pass; anything touching `shared/` or root waits for Arjun's approval.
- Parallel agents: one agent, one branch, one worktree, one folder. Only one agent at a time touches the root layout / tab navigator (`app/src/app/_layout.tsx`, `(tabs)/_layout.tsx`), exactly like `app/page.tsx` was in Bev Maps.
- "Heads-up for the other side" section in every PR description when you need something from `supabase/`, `packages/api/` or `data/catalog/`.

### Workspace layout you own (proposed; settle names in the scaffold `chore/*` PR)

```
bevi/
  app/                      workspace "app"            (you)
  packages/ranking/         workspace "@bevi/ranking"  (you)
  design/                   not a workspace            (you)
  packages/api/             workspace "@bevi/api"      (Arjun)
  supabase/, data/catalog/                             (Arjun)
  shared/                   workspace "shared"         (both, contract/*)
```

Your `CLAUDE.md` contributions (Phase 0, via `chore/claude-md`): `app/CLAUDE.md` (an `INSTRUCTIONS.md`-style lane doc for your agents, modelled on `bev-maps/frontend/INSTRUCTIONS.md`), `packages/ranking/CLAUDE.md` (zero-I/O rule, vectors rule, test commands), and two agent definitions under `.claude/agents/`: `ui-screen` (Sonnet, medium) and `ranking-math` (Opus, high), plus the shared `integrator` adapted from Bev Maps (checks `shared/api.ts` and `shared/fixtures/*.vectors.json` instead of `shared/contract.ts`).

---

## 2. Phase 0 research: UI skills and libraries (verified 2026-10-09)

Vision §9 Phase 0 asks for "open-source mobile UI design skills/guidelines to use as a foundation". These exist today (checked via the GitHub API; star counts rounded):

| Candidate | What it is | Use for Bevi | Verdict |
|---|---|---|---|
| `anthropics/skills` → `skills/frontend-design` | Anthropic's official agent skill for distinctive, non-generic interface design (HTML/React oriented; principles transfer) | Load into `.claude/` for every `ui-screen` agent; it fights "AI-looking" UI | Adopt |
| `anthropics/skills` → `brand-guidelines`, `theme-factory` | Brand/theme token skills | Pattern for `design/brand/` and `app/src/theme/tokens.ts` | Borrow structure |
| `vercel-labs/agent-skills` → `skills/react-native-skills` (~32k stars repo) | Vercel's RN/Expo best practices: perf, animation (GPU-only props via Reanimated), native navigators | Load for every app agent; this is the performance checklist | Adopt |
| `vercel-labs/agent-skills` → `web-design-guidelines` | Web-oriented design review rules | Skim once; most rules (touch targets, contrast, motion) transfer | Reference |
| `gentleman-programming/gentleman-skills` → `react-native` (MIT) | Community RN/Expo project-structure skill | Compare its folder layout with §3; don't adopt wholesale | Reference |
| Apple Human Interface Guidelines (developer.apple.com, free, not open source) | Tab bars, navigation, type sizes, 44pt targets, Dynamic Type | The baseline for all iOS measurements; Beli is an iOS-first app | Adopt |
| Material 3 (m3.material.io, Apache-2.0 components) | Android equivalents | Only for Android-specific affordances (back behaviour, ripple) | Reference |
| `founded-labs/react-native-reusables` (MIT, ~8.7k) | shadcn/ui port for RN; copy-paste components on NativeWind | Only if you choose NativeWind (§3 recommends plain `StyleSheet` + tokens) | Optional |
| `nativewind/nativewind` (MIT) | Tailwind for RN | See above | Optional |
| `software-mansion/react-native-reanimated` (MIT) | Animations on the UI thread | Comparison-card transitions, tile presses | Adopt |
| `shopify/flash-list` (MIT) | Virtualised list, v2 is JS-only and needs the New Architecture | Feed, Bev'd, leaderboard | Adopt |
| `gorhom/react-native-bottom-sheet` (MIT) | Bottom sheets | Re-rank sheet, category picker, "Did you mean…" | Adopt |
| `expo-image` (part of Expo) | Disk+memory cache, `recyclingKey`, placeholders | Every Bev photo | Adopt |

Not found: a dedicated, well-maintained open-source "mobile UI design guideline skill" beyond the above. Registry sites list community `mobile-app-ui-implementation` / `frontend-app-design` SKILL.md files, but I could not verify their source repos or licences; treat them as unverified and don't install blind.

**Phase 0 research task (Sonnet, Medium):** install the two adopted skills into `.claude/skills/` (via `chore/skills` PR), write a one-page `design/research.md` listing what each contributes and the 10 rules you will actually enforce (e.g. 44pt targets, 4pt grid, no colour-only meaning, system font, Reanimated-only animation, FlashList for anything > 20 rows). Definition of done: file exists, skills load in a fresh Claude Code session, CLAUDE.md references them.

---

## 3. App foundation (`app/`)

### Stack (concrete)

| Piece | Choice | Notes |
|---|---|---|
| Expo | SDK 58 (current as of 2026-10-09: `expo@58.0.x`) with the New Architecture on (default) | FlashList v2 needs it |
| Routing | Expo Router, route root moved to `app/src/app` via `plugins: [["expo-router", { "root": "./src/app" }]]` in `app.json` | Avoids `app/app/`. Verify the `root` option name against the SDK 58 docs before relying on it |
| Language | TypeScript strict, `"moduleResolution": "bundler"` | Same tsconfig base as `shared/` |
| Styling | `StyleSheet.create` + tokens from `app/src/theme/`; no CSS-in-JS runtime | Fidelity to the Beli screenshots matters more than a component library. If you later want NativeWind, add it in one PR and keep tokens as the source of truth |
| Server state | TanStack Query (`@tanstack/react-query`) with `BeviApi` methods as query/mutation functions | Keys in one file `app/src/api/keys.ts` |
| Client state | Zustand, two stores: `session` (auth + profile) and `rankingFlow` (wraps the `@bevi/ranking` state machine) | Nothing else global |
| Lists | `@shopify/flash-list` v2 | No `estimatedItemSize` in v2 |
| Images | `expo-image` (`cachePolicy="memory-disk"`, `recyclingKey={bev.id}`, `contentFit="contain"`) | |
| Camera/picker | `expo-camera` + `expo-image-picker` + `expo-image-manipulator` (resize to max 1600px, JPEG q0.85 before upload) | |
| Animation | `react-native-reanimated` + `react-native-gesture-handler` | |
| Storage | `expo-secure-store` for the session (handled inside `packages/api`), `@react-native-async-storage/async-storage` for the mock's persistence and per-device prefs | |
| Tests | `jest-expo` + `@testing-library/react-native`; Maestro for e2e in Phase 3 | |
| Builds | EAS Build + EAS Submit; `expo-dev-client` from day one | §7 |

### Folder layout

```
app/
  app.json  eas.json  package.json  tsconfig.json  jest.config.js  CLAUDE.md
  src/
    app/                          expo-router routes (see navigation below)
    api/
      client.ts                   export const api: BeviApi = USE_MOCK ? mockApi : realApi   ← the one-line swap
      mock.ts                     MockApi implements BeviApi (dev only)
      mock-state.ts               in-memory DB seeded from shared/fixtures, persisted to AsyncStorage
      keys.ts                     TanStack query keys
      hooks/                      useFeed(), useBev(id), useMyRankings(), useSubmitRanking() ...
    theme/                        tokens.ts  typography.ts  colors.ts  spacing.ts  index.ts
    components/                   BevImage  PriceTier  ScoreBadge  BucketPill  Avatar  BevRow  FeedCard  StatTile
                                  SegmentedTabs  CategoryChips  EmptyState  ErrorState  Skeleton  Sheet  Wordmark
    features/
      ranking/                    GutCheck  CompareCard  PlacementProgress  RankResult  useRankingFlow (wraps @bevi/ranking)
      add-bev/                    SearchBevs  DidYouMean  CreateBevWizard  CameraCapture  LabelCapture  PriceTierPicker
      onboarding/                 ProfileSetup  AgeGate  StarterRanking
      profile/                    ProfileHeader  StatsRow  TilesRow  UserRankingsList
    lib/                          date (local day key), tz, format (score 1dp, counts), haptics, analytics (no-op v1)
    dev/                          ComponentGallery screen, mock controls (latency, fail-next), only in __DEV__
```

### Navigation (5 tabs + stacks)

```
src/app/
  _layout.tsx                      root: QueryClientProvider, session gate (signed-out → (auth), no profile → onboarding)
  (auth)/
    sign-in.tsx  sign-up.tsx
  onboarding/
    profile.tsx                    name, handle, birthdate (age gate), timezone captured silently
    starter.tsx                    starter-set ranking
  (tabs)/
    _layout.tsx                    5 tabs: feed | lists | add (center, raised) | leaderboard | profile
    feed/index.tsx
    lists/index.tsx                ?tab=bevd|want|recommended  (deep-linkable from Profile tiles)
    add/index.tsx                  search Bevs
    leaderboard/index.tsx          ?scope=bevs|users&category=<id>
    profile/index.tsx              own profile
  bev/[id].tsx                     Bev detail
  user/[id]/index.tsx              other user's profile
  user/[id]/followers.tsx  user/[id]/following.tsx
  users/search.tsx                 find people (handle search)
  rank/[bevId].tsx                 full-screen modal: gut check → comparisons → note → result
  add/new.tsx                      create-new-Bev wizard (modal stack)
  settings/index.tsx  settings/account.tsx  settings/privacy.tsx  settings/delete-account.tsx
  image/[url].tsx                  full-screen image viewer (nutrition label)
```

Tab order and the centre "Add Bev" slot follow vision §6 ("replaces Beli's search slot"). Tabs keep their own stacks so Bev detail pushed from Feed doesn't lose the Feed scroll position.

### Auth and onboarding (screens yours, Supabase Auth config Arjun's)

- The app never imports `@supabase/supabase-js`. `BeviApi` exposes an `auth` namespace (`signUp`, `signIn`, `signOut`, `getSession`, `onAuthStateChange`, `deleteAccount`) implemented by Arjun on Supabase and by you in the mock.
- v1 method: email + password. Sign in with Apple is **not** required by Apple unless you also offer another third-party login, so skip it in v1 (open question §18 if Arjun wants magic links instead).
- Session gate in the root layout: `signedOut → (auth)`; `signedIn && !profile.onboarded → onboarding`; else tabs. The gate reads one query, `api.profile.getMe()`.
- Onboarding step 1 collects: display name, handle (live availability check via `api.profile.checkHandle`), birthdate (age gate, §6.17), and silently `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Onboarding step 2 is the starter ranking (§6.3). Minimum 3 ranked to continue; "I haven't had this" skips an item.

### The mock API and when to swap

- `app/src/api/mock.ts` implements every `BeviApi` method against an in-memory copy of `shared/fixtures/` (bevs, categories, users, rankings, follows, featured). It runs `@bevi/ranking` for real: `submitRanking` inserts at `insertIndex`, re-spaces the bucket with `respaceBucket()`, recomputes per-Bev stats, and `getRecommendations` calls `recommend()` on a snapshot built from the mock state. So the UI against the mock behaves like production.
- Latency 200–600 ms (uniform) so loading states are real; dev panel toggles: `failNext(method)`, `latency`, `resetToFixtures()`, `emptyUser()` (first-run states).
- Swap: `EXPO_PUBLIC_BEVI_API=mock|supabase` read in `client.ts`. Default `mock` until Arjun's `packages/api` passes its own contract tests, then default `supabase` with `mock` kept for Storybook-style work and offline demos.
- Rule copied from Bev Maps: TypeScript keeps both honest. If a screen needs something the interface lacks, propose a `contract/*` change, never a workaround.

### Data-fetching rules

- All reads through TanStack Query hooks in `app/src/api/hooks/`. Mutations: `submitRanking`, `removeRanking`, `follow/unfollow`, `addWantToTry/removeWantToTry`, `createBev`, `uploadImage`, `updateMe`. Optimistic updates only for follow and want-to-try (cheap to roll back). After `submitRanking` invalidate: my rankings, the Bev, my stats, feed, leaderboard, recommendations.
- Cursor pagination everywhere a list can exceed 50 rows (feed, Bev'd, leaderboard, followers, user rankings): `{ cursor?: string; limit: number } → { items, nextCursor }`.

---

## 4. Design system before screens

Build this in week 1, before any screen, so Sonnet agents produce consistent screens.

### Tokens (`app/src/theme/tokens.ts`, mirrored in `design/brand/tokens.md`)

| Group | Values (proposed) |
|---|---|
| Spacing | 4pt grid: `xs 4, sm 8, md 12, lg 16, xl 24, xxl 32`; screen gutter 16 |
| Radius | `sm 8, md 12, lg 16, pill 999` |
| Type | System font (SF Pro on iOS / Roboto on Android). Scale: `display 28/34 bold`, `title 22/28 semibold`, `heading 17/22 semibold`, `body 15/20`, `caption 13/18`, `micro 11/14`. `maxFontSizeMultiplier` 1.3 on dense rows, unlimited on body text |
| Colour, neutral | `bg`, `surface`, `surfaceRaised`, `border`, `textPrimary`, `textSecondary`, `textTertiary`; light and dark sets |
| Colour, brand | `primary` (wordmark, Recommended tile, primary buttons), `primaryPressed`, `onPrimary`. Vision §11 leaves brand colour open; pick in week 1 from two candidate directions (see wordmark) and record the hex in `design/brand/colors.md` |
| Colour, score | `scoreLoved` (green family), `scoreFine` (amber), `scoreDisliked` (red); must pass 4.5:1 as text on `surface` and 3:1 as a fill with white text |
| Elevation | `card` (y2 blur8 8%), `raisedTab` (centre Add button, y4 blur12 16%) |
| Motion | `fast 150ms`, `base 250ms`, `springy` (Reanimated spring damping 18 stiffness 180); honoured `reduceMotion` |

### Core components (built with a `ComponentGallery` dev screen showing every state)

| Component | Spec |
|---|---|
| `Wordmark` | SVG, "Bevi" in a clean playful geometric face with a custom lowercase "v" cue (the conversation said "make it look like Beli with a v"; we **diverge**: original letterforms, same spirit, no copied glyphs). Assets: `design/brand/wordmark.svg`, `wordmark-dark.svg`, `app-icon-1024.png`, `splash.png`. Two candidate directions produced by a Sonnet (Medium–High) agent as SVG, you pick one |
| `BevImage` | Square tile, sizes 40/56/72/96/160, transparent-PNG cutout centred with 8% padding on a soft radial tint derived from `surfaceRaised`; `contentFit="contain"`; blurhash/skeleton placeholder; `status="processing"` shows a shimmer over the raw photo while background removal runs |
| `PriceTier` | Renders four `$` glyphs, tier N filled (`textPrimary`), rest `textTertiary`; `estimated` adds a `~` prefix and `accessibilityLabel="about $$, estimated"` |
| `ScoreBadge` | Rounded pill, 1-decimal score, fill = bucket colour, white text, sizes 28/36; `variant="predicted"` is outlined with a dotted border and prefix "~" |
| `BucketPill` | Loved / Fine / Didn't like, tinted |
| `Avatar` | Circle, initials (first letters of up to two words of display name), sizes 32/40/88, deterministic background from a 8-colour palette hashed on userId |
| `BevRow` | 72pt row: `BevImage 56`, name + brand/flavor line, right-aligned `ScoreBadge` or `PriceTier`, optional position "#4" |
| `FeedCard` | Avatar + "Matt Bev'd **Diet Coke**" + time, `BevImage 96` left, score badge, note (2 lines, "more"), actions: Want to Try (bookmark), Rank it |
| `StatTile` | 84pt tall tile: count 22 bold + label 13; `highlight` variant uses `primary` fill |
| `SegmentedTabs` | For Lists and Leaderboard sub-tabs; animated underline |
| `CategoryChips` | Horizontal scroll, single-select, "All" first |
| `EmptyState`, `ErrorState` (with Retry), `Skeleton` | Every list screen uses these; no bare spinners except inside buttons |
| `Sheet` | bottom-sheet wrapper with handle, snap points 40/90% |

### Bev photo treatment (your review of Arjun's catalog, §12 seam note)

Acceptance for a catalog image: PNG with alpha, product fills 70–90% of the longest side, no shadow baked in, no text overlays, min 600px; user-added photos get the same look after Arjun's background removal. You write `design/photo-style.md` (10 lines + 3 good/3 bad examples) in week 1 so Arjun's Haiku seeding agents have a checklist.

---

## 5. From Beli screenshots to per-screen specs

1. Drop screenshots into `design/reference/` named `<screen>-<variant>-<n>.png` (e.g. `profile-own-1.png`, `lists-bevd-1.png`, `rank-compare-2.png`). Record device and scale in `design/reference/README.md` (an iPhone 15/16 Pro screenshot is 1179px wide = 393pt, scale 3; divide px by 3 for pt).
2. For each screen run a Sonnet (Medium) agent with the screenshot(s) and the matching §6 entry; output `design/specs/<screen>.md` with: regions diagram (ASCII boxes with pt sizes), component list (from §4), measured values (heights, paddings, type sizes), interaction notes, and a "Bevi differences" list (what changes because it's drinks, Add Bev instead of Search, leaderboard added).
3. You review each spec against the screenshot; the spec, not the screenshot, is what the `ui-screen` agent builds from.
4. Rule: measurements from screenshots are inputs, tokens are outputs. If a screenshot implies 14pt and the scale has 13/15, pick the nearest token and note it.

Screenshots are not in the repo yet, so nothing in §6 asserts Beli-specific pixel values; the numbers there are the baseline to adjust once specs exist.

---

## 6. Screen inventory

Common to every screen unless noted: loading = skeleton of the final layout; error = `ErrorState` with Retry and the message from `BeviApi` errors (`{ code, message }`); offline = top banner; pull-to-refresh on lists. Data is expressed in `BeviApi` terms (§13 has the method list).

### 6.1 Sign in / Sign up (`(auth)/`)

- Purpose: get a session. Contents: wordmark, email, password, primary button, switch link; sign-up adds "confirm password".
- Data: `auth.signIn`, `auth.signUp`.
- States: validating, submitting (button spinner), error inline (wrong password, email in use), "check your email" if Arjun enables confirmation.
- Interactions: keyboard-avoiding, return-key chaining, password visibility toggle.

### 6.2 Onboarding: profile + age gate (`onboarding/profile.tsx`)

- Contents: display name, handle (`@`, lowercase, 3–20 chars, availability check debounced 400ms), birthdate (native date picker), explanation line "Birthdate is used only to show 21+ categories".
- Data: `profile.checkHandle(handle)`, `profile.updateMe({ displayName, handle, birthdate, timezone })`.
- States: handle taken / invalid; under-21 is allowed, it just sets `profile.canSeeAlcohol = false`.

### 6.3 Onboarding: starter ranking (`onboarding/starter.tsx`)

- Purpose: cold-start baseline (vision §5). Contents: progress "3 of 10", `BevImage 160`, name, "Have you had this?" → Yes/No; Yes opens the ranking flow (§6.9) inline; No skips.
- Data: `onboarding.getStarterSet()` (Arjun calls `selectStarterSet()` from `@bevi/ranking`, or the app does it from `bevs.listStarterCandidates()`; see §12 seam 5 note), `rankings.submitRanking` per item, `profile.updateMe({ onboarded: true })`.
- States: first Bev (empty bucket, no comparisons: "Placed. Keep going."), finished summary ("You ranked 6 Bevs. Your top: Coke 8.3"), fewer than 3 ranked → "Rank at least 3 so we can learn your taste".
- Interactions: skip-all link after ≥3 ranked.

### 6.4 Feed tab

- Contents: header with wordmark left and "find people" icon right; **Featured Bevs** horizontal carousel (card 140×180, polished image, name, category, tap → detail); then feed of followed users' rankings as `FeedCard`s, newest first.
- Data: `feed.getFeatured()`, `feed.getFeed({ cursor, limit: 20 })`, `wantToTry.add/remove`.
- States: following nobody → `EmptyState` "Follow friends to see their Bevs" with "Find people" button and the Featured carousel still shown; no activity yet; paginating footer.
- Interactions: tap card → Bev detail; tap avatar/name → user profile; bookmark → Want to Try (optimistic); "Rank it" → ranking flow.

### 6.5 Your Lists tab: Bev'd

- Contents: `SegmentedTabs` Bev'd / Want to Try / Recommended; Bev'd shows three bucket sections (Loved, Fine, Didn't like) in order, rows with position within bucket and `ScoreBadge`; `CategoryChips` filter; search field filters client-side.
- Data: `rankings.listMine({ bucket?, categoryId?, cursor })` ordered by `(bucket, position)`.
- States: nothing ranked → "Add your first Bev" CTA to the Add tab; filter yields nothing.
- Interactions: tap → Bev detail; long-press/swipe → sheet: Re-rank, Edit note, Remove (confirm; explains other scores in the bucket will shift).

### 6.6 Your Lists: Want to Try

- Contents: rows with `PriceTier` instead of score, "Rank it" button, who you saw it from (if saved from feed: "via @arjun").
- Data: `wantToTry.list({ cursor })`, `wantToTry.remove`, deep-link into ranking flow.
- States: empty → "Bookmark Bevs from the Feed or Leaderboard".
- Interactions: swipe to remove; ranking it removes it from Want to Try automatically (server side; UI invalidates).

### 6.7 Your Lists: Recommended

- Contents: ordered list of untried Bevs with predicted `ScoreBadge variant="predicted"`, one-line reason (`"You love Diet sodas"`, `"People who rank like you"`), exploration items tagged "Something different". Header line: "Based on N Bevs you've ranked" and "Updated 2h ago".
- Data: `recs.getRecommendations({ limit: 20 })` → items with `predictedScore`, `confidence`, `reason`, `isExploration`, `generatedAt`.
- States: < 3 rankings → "Rank 3 Bevs to unlock recommendations" with progress; confidence < 0.25 on every item → show them without numbers ("Try these") instead of fake precision; stale (> 24h) → still show, with "Refreshing" when `recs.refresh()` is available.
- Interactions: tap → detail; bookmark → Want to Try; "Not interested" is Phase 3 (§17).

### 6.8 Add Bev tab: search

- Contents: search field autofocused, camera button on the right ("Snap it"), recent searches, results as `BevRow` with `PriceTier` and rating count; sticky footer "Can't find it? Add a new Bev".
- Data: `bevs.search({ q, categoryId?, limit: 25 })` debounced 250ms; respects `canSeeAlcohol`.
- States: idle (recents + popular), searching, no results (footer becomes primary), error.
- Interactions: tap result → if already ranked by you → detail with "Re-rank" option; else straight into the ranking flow (vision §3 step 2). Camera button → `CameraCapture` → the photo is kept and passed into the create wizard prefilled (we do **not** do image recognition in v1; see §17).

### 6.9 Ranking flow (`rank/[bevId]`), full-screen modal

- Step 1 Gut check: `BevImage 160`, name, three big buttons Loved it / It was fine / Didn't like it.
- Step 2 Compare: two cards (new Bev on top, incumbent below, each `BevImage 120` + name + brand), prompt "Which was better?", tap a card; secondary row: "Too close to call" and Undo; progress dots = `ceil(log2(n+1))` max steps; card swap animates 250ms; prefetch the next candidate image after each answer (the next mid is computable for both answers, prefetch both).
- Step 3 Note: optional 140-char note ("Tastes like flat Sprite"), Skip.
- Step 4 Result: "#4 of 31 in Loved — 8.9", animated badge, buttons Done / Share-to-feed is implicit (every ranking is a feed item).
- Data: `rankings.listMine({ bucket })` once at start (ordered ids), then `@bevi/ranking` runs locally; finish → `rankings.submitRanking({ bevId, bucket, insertIndex, comparisons, note })` → returns `{ score, position, bucketSize }` for the result screen.
- States: empty bucket → straight to Step 3 (no comparisons, say "First one in Loved"); re-rank → the Bev is removed from the ordered list before placement and the request carries `replaceExisting: true`; submit failure → keep the local result, Retry (the flow is idempotent because the server re-validates `insertIndex` against the current bucket size and the comparisons; if the bucket changed meanwhile, the server returns `CONFLICT` and the UI restarts placement with the fresh list).
- Interactions: Undo pops one comparison; closing mid-flow asks to discard.

### 6.10 Create new Bev wizard (`add/new`)

- Step 1 Photo: `CameraCapture` (rear camera, framing guide "fill the frame, plain background helps"), or pick from library; preview; retake.
- Step 2 Details: name, flavor, brand/shop, category picker (sheet; alcoholic categories only if `canSeeAlcohol`), `PriceTierPicker` (4 tappable `$`, plus "Not sure, estimate it" which sets `priceTier: null, priceEstimated: true` and lets the server estimate from category; see §18).
- Step 3 Did you mean…: triggered on leaving Step 2 (and live after 3 typed chars in name): `bevs.findLikelyDuplicates({ name, brand, flavor, categoryId })` → up to 5 matches as rows with "This is it" (jumps to ranking that Bev) vs "No, mine is different".
- Step 4 Nutrition label (optional): capture or skip.
- Submit: `media.upload({ kind: 'bev-photo', file })` → `{ assetId, url, status: 'processing' | 'ready' }`; `media.upload({ kind: 'label' })`; `bevs.create({ name, flavor, brand, categoryId, priceTier, priceEstimated, photoAssetId, labelAssetId })` → Bev; then ranking flow immediately. The `BevImage` shows the raw photo with the processing shimmer until `getBev(id).photoStatus === 'ready'` (poll 3s, max 60s, then show raw photo silently).
- States: upload failure (retry keeps the form), duplicate chosen, camera permission denied (explain + Open Settings), offline (block submit).

### 6.11 Bev detail (`bev/[id]`)

- Contents: `BevImage 160` hero, name, brand/flavor, category chip, `PriceTier`; stats row: global score (Bayesian, 1dp) + rating count, **Your predicted score** (`ScoreBadge predicted` + "based on your tastes"), or your actual score and position if you ranked it; "Friends who've had it" avatar stack with their scores; buttons: Rank it (or Re-rank) and Want to Try (toggle); nutrition label thumbnail → full-screen viewer; "Added by @handle" footer for user-created Bevs; Report (sheet) → `bevs.report`.
- Data: `bevs.get(id)` returning global stats, `myRanking?`, `prediction?`, `friends[]`, `photoStatus`.
- States: no ratings yet ("Be the first"), prediction missing (fewer than 3 rankings by you → "Rank 3 Bevs to see your prediction"), alcohol and `!canSeeAlcohol` → not reachable (search hides it; deep link shows a neutral "Not available" screen).

### 6.12 Leaderboard tab

- Contents: `SegmentedTabs` Bevs / Users. Bevs: `CategoryChips` (All + categories), rows: rank number, `BevImage 56`, name, Bayesian score, "N ratings", your score badge if ranked. Users: rank, `Avatar`, name/handle, points, "N Bevs", streak flame; your own row pinned at the bottom if off-screen.
- Data: `leaderboard.bevs({ categoryId?, cursor, limit: 50 })`, `leaderboard.users({ cursor })`.
- States: category with fewer than `MIN_RATERS` (=2) rated Bevs → "Not enough rankings yet"; Phase 3 adds a "This month" toggle.
- Interactions: tap → Bev detail / user profile; chips persist per session.

### 6.13 Profile tab (own): pixel-careful spec

Baseline on a 393pt-wide iPhone; adjust to the `design/specs/profile.md` measurements once screenshots are in.

```
┌─────────────────────────────────────────────┐ safe-area top
│ Matt Willer (title 22 semibold)      [gear] │ 44pt row, gutter 16
│                                             │
│                 ( MW )                      │ Avatar 88, initials 32 semibold, centred
│                @mbwiller                    │ body 15 textSecondary, 6pt below
│                                             │ 16pt
│   128 Followers   ·   96 Following          │ heading 17 numbers, caption 13 labels, tappable
│                                             │ 12pt
│   [ #12 on Bevi ]   [ flame 4-day streak ]  │ two pills 32pt tall, radius pill, surfaceRaised
│                                             │ 20pt
│ ┌────────┐ ┌────────┐ ┌────────────┐        │ 3 StatTiles, 84pt tall, 12pt gaps, equal width
│ │  42    │ │  7     │ │  ★         │        │   (393-32-24)/3 = 112pt
│ │ Bev'd  │ │Want to │ │Recommended │        │ third tile = highlight (primary fill), label
│ │        │ │  Try   │ │  for you   │        │   "Recommended for you", no count
│ └────────┘ └────────┘ └────────────┘        │
│                                             │ 24pt
│ Recent Bevs                      (heading)  │
│ [BevRow 72] #1 Loved  Diet Coke        9.3  │ scrollable list of the user's rankings,
│ [BevRow 72] #2 Loved  Topo Chico       9.1  │   newest first, 20 per page
│ ...                                         │
└─────────────────────────────────────────────┘
```

- Vision §6 order honoured: name top-left, avatar top-centre with handle, follower/following counts, Rank on Bevi, Streak, three tiles (Recommended is the emphasised one), scrollable rankings feed, settings via the corner gear.
- Data: `profile.getMe()` (name, handle, initials), `stats.getMine()` → `{ followers, following, rankOnBevi, rankPoints, currentStreak, bevdCount, wantToTryCount }`, `rankings.listUser(me, { cursor })`.
- States: brand-new user (0 everywhere, streak pill says "Rank today to start a streak", tiles still tappable), rank unavailable (fewer than `MIN_RANKED_FOR_RANK`=1 ranked → "Unranked").
- Interactions: tiles deep-link to `lists?tab=bevd|want|recommended`; counts → followers/following lists; gear → settings; tap name/avatar → edit profile.
- Polish task is tagged Sonnet Medium–High (vision §10 "UI polish (profile page…)").

### 6.14 Other user's profile (`user/[id]`)

- Same layout minus the gear and the Recommended tile (tiles: Bev'd, Want to Try, and a Follow/Following button in the third slot); their rankings list.
- Data: `profile.getUser(id)`, `stats.getUser(id)`, `follows.follow/unfollow` (optimistic), `rankings.listUser(id)`.
- States: not found; blocked/private is not a v1 concept.

### 6.15 Followers / Following lists

- Rows: `Avatar 40`, name, handle, Follow/Following button; search within list.
- Data: `follows.listFollowers(userId, { cursor })`, `follows.listFollowing(userId, { cursor })`.
- States: empty.

### 6.16 Find people (`users/search`)

- Handle/name search, results with follow buttons; "Suggested" section = users with the most rankings you don't follow. Required for the social loop; vision §6 doesn't list it (§18).
- Data: `profile.searchUsers({ q, limit: 25 })`, `follows.suggested()`.

### 6.17 Age gate for alcoholic categories

- Birthdate is captured in onboarding (§6.2) and editable once in account settings (changing it again requires support; keep it simple: editable only while `canSeeAlcohol` is false).
- `profile.canSeeAlcohol = age ≥ 21` computed server-side (Arjun; RLS/view filtering), mirrored in the client for UI hiding: category pickers, chips, search, leaderboard categories, featured carousel and recommendations all hide `category.isAlcoholic` content when false. Feed items for alcoholic Bevs from friends still render but with no "Rank it" button (seeing a friend's beer is fine; ranking it isn't).
- Users with no birthdate (should not exist after onboarding) are treated as under 21.

### 6.18 Settings, privacy, account deletion

- Settings: Account (email, display name, handle, birthdate per rule above, timezone override), Privacy (link to the policy screen; "Location: never collected"), About (version, licences), Sign out, Delete account.
- Privacy policy: static markdown bundled in the app (`app/assets/privacy.md`), also published as a web page (Arjun or a GitHub Pages file via `chore/*`) because App Store Connect requires a URL. The conversation's "we don't need no damn privacy page" is overridden (§17).
- Delete account: Apple requires in-app account deletion. Screen explains what is deleted (rankings, comparisons, follows, Want to Try, profile; Bevs you created stay with `createdBy = null`), type `DELETE`, calls `auth.deleteAccount()`, then signs out.

### 6.19 Small screens and sheets

Edit profile; Re-rank sheet (choose: change bucket → full placement, or keep bucket → placement within bucket); Remove-ranking confirm; Category picker sheet; Report Bev sheet; Full-screen image viewer; Not-found screen; Force-update/maintenance screen driven by `meta.getAppConfig()` (minimum version, maintenance flag; cheap insurance).

---

## 7. Accessibility, performance, distribution

### Accessibility (checked in every `ui-screen` PR)

- Every touchable has `accessibilityRole` and a label; comparison cards announce "Diet Coke, candidate" / "Coke, currently ranked 3rd in Loved"; result announces the placement.
- Minimum target 44×44pt (price-tier glyphs grouped into one control, not four).
- Scores are never colour-only: badge always shows the number; bucket pills carry text.
- Dynamic Type: body text scales freely; rows cap at 1.3× and never clip the score.
- Contrast 4.5:1 for text, 3:1 for large text and icons, both themes.
- `reduceMotion` respected: card transitions become cross-fades.
- VoiceOver pass of the full ranking flow and the profile screen before Phase 1 ships (one Sonnet High review agent with a checklist).

### Performance

- Images: `expo-image` with `cachePolicy="memory-disk"`, `recyclingKey`, `placeholder` (blurhash from Arjun's pipeline if available, else skeleton); prefetch the next two comparison candidates; catalog PNGs served at 512px max from Supabase Storage (transform or pre-resized; Arjun).
- Lists: FlashList for feed, Bev'd, leaderboard, user rankings, followers; memoised rows; no inline closures in `renderItem` that capture changing state.
- Queries: `staleTime` 60s for catalog-ish data (bevs, categories, leaderboard), 15s for feed, 0 for my rankings during a ranking flow; persist the query cache to AsyncStorage for instant cold starts.
- Startup: lazy-load the camera and the create wizard; keep the JS bundle under control (check with `npx expo export --dump-sourcemap` + source-map-explorer once in Phase 3).
- Budgets: Feed cold render < 1.5s on an iPhone 12 with warm cache; comparison tap → next card < 100ms; 60fps card transitions.

### Builds and distribution to friends

- `eas.json` profiles: `development` (dev client, simulator + device), `preview` (internal distribution, `EXPO_PUBLIC_BEVI_API=supabase` against Arjun's staging project), `production`.
- iOS: TestFlight via `eas build --profile preview --platform ios` + `eas submit`; up to 100 internal testers without review, external testers need a one-time Beta review. Needs an Apple Developer account ($99/yr) and the bundle id `com.bevi.app` (whose account, see §18). Android: `eas build --profile preview --platform android` produces an APK shared by link; Play internal testing in Phase 3.
- Expo Go is fine for the first two weeks (camera, image, router all work); switch to the dev client the moment a native module outside Expo Go is added.
- Env: `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are consumed inside `packages/api` (Arjun provides values via EAS secrets and `.env.local`; never committed). Service keys never exist in the app.

---

## 8. `packages/ranking`: the math

Everything here is pure: no `Date.now()`, no `Math.random()` (seeded PRNG passed in), no I/O. All constants live in `src/constants.ts` and are exported with the vectors so Arjun's SQL reads the same numbers.

### 8.1 Buckets and score bands

```
type Bucket = 'LOVED' | 'FINE' | 'DISLIKED'
BANDS = { DISLIKED: [0, 10/3], FINE: [10/3, 20/3], LOVED: [20/3, 10] }   // lo, hi
```

Proposal for vision §11's open question: equal thirds, exactly as vision §4's example (Loved 6.7–10, Fine 3.4–6.7, Didn't like 0–3.4 after 1-dp display). Equal widths keep the z-score math unbiased across buckets, and the numbers match the Beli-style feel users expect ("a 7 is good"). Scores are stored to 2 dp and displayed to 1 dp.

### 8.2 Score from position

Within a bucket of `n` Bevs after insertion, index `i` (0 = best):

```
score(i, n, bucket) = hi − (hi − lo) · (i + 1) / (n + 1)
```

- `n = 1` → the band midpoint (Loved alone = 8.33; Fine alone = 5.00; Disliked alone = 1.67).
- Scores are strictly inside the open band, so bucket order is always preserved globally.
- Loved, `n = 3` → 9.17, 8.33, 7.50. Loved, `n = 50`, top → 9.93.
- Stored value: `round(score · 100) / 100` in double precision (`round(x::numeric, 2)` in SQL). The vector generator rejects any case within 1e-9 of a rounding boundary so JS and SQL agree exactly.
- `respaceBucket(orderedIds, bucket)` returns `[{ bevId, position: i, score }]` for all `n`; the RPC calls the SQL twin after every insert/remove (vision §4 "re-spaces scores in that bucket").

Alternative considered and rejected: `(i + 0.5)/n` (midpoint spacing) gives the same `n = 1` result but is not symmetric under re-indexing; `(i + 1)/(n + 1)` is simpler to prove and to write in SQL.

### 8.3 Placement state machine

State:

```
PlacementState = {
  bevId, bucket,
  list: BevId[]            // the user's ordered Bevs in that bucket, best first, EXCLUDING bevId
  lo: number, hi: number   // candidate insertion range [lo, hi], invariant 0 ≤ lo ≤ hi ≤ list.length
  history: { comparedBevId, answer, lo, hi }[]   // snapshot BEFORE each answer, for undo
  status: 'COMPARING' | 'DONE'
}
```

Transitions:

| Event | Effect |
|---|---|
| `start(bevId, bucket, orderedIds)` | `list = orderedIds.filter(id ≠ bevId)`; `lo = 0, hi = list.length`; if `hi === 0` → `DONE` with `insertIndex 0`, no comparisons (empty bucket). Else `COMPARING` |
| `currentPrompt()` | `mid = floor((lo + hi) / 2)`; returns `{ comparedBevId: list[mid] }`. Always `lo ≤ mid < hi` while comparing |
| `answer('NEW_BETTER')` | push snapshot; `hi = mid` |
| `answer('EXISTING_BETTER')` | push snapshot; `lo = mid + 1` |
| `answer('TIE')` ("too close to call") | push snapshot; `lo = hi = mid + 1` (insert directly below the incumbent; the incumbent keeps precedence because it was ranked first). Ends the search |
| after any answer | if `lo === hi` → `DONE`, `insertIndex = lo` |
| `undo()` | pop snapshot, restore `lo, hi`, `status = COMPARING`. No-op on empty history |
| `result()` | `{ bevId, bucket, insertIndex, comparisons: history.map(h => ({ winnerBevId, loserBevId, tie })) }` where for `NEW_BETTER` winner = bevId; for `EXISTING_BETTER` winner = comparedBevId; for `TIE` both ids with `tie: true` |

Guarantees (these are the property tests in §11):

- Terminates in at most `ceil(log2(n + 1))` answers without ties; `n = 100` → 7, `n = 1000` → 10.
- With a consistent oracle (a hidden true index `t`), `insertIndex === t`.
- `insertIndex ∈ [0, n]` always; the comparison log is exactly what the binary search asked, so Arjun's RPC can re-validate it (each logged comparison must be consistent with the final index).

Re-ranking an existing Bev: the UI removes it from `orderedIds` before `start` (the state machine also filters defensively), chooses the bucket again (may change), runs placement, submits with `replaceExisting: true`. Server: delete old row, insert new, re-space the old bucket (if different) and the new bucket, append the new comparisons (old comparisons are kept; they're still true observations).

Removal: `removeRanking(bevId)` → server deletes the row, re-spaces that bucket. Pure helper `removeFromBucket(orderedIds, bevId)` + `respaceBucket` exist so the mock and the vectors cover it.

Not in v1: "skip this comparator" (pick a different incumbent). TIE covers the "I can't decide" case; a skip would need a non-binary search. Listed in §17.

### 8.4 Per-Bev and per-user statistics

All standard deviations are **population** (`stddev_pop`, divide by `n`), not sample. Reasons: `n = 1` gives 0 instead of NULL, it matches `numpy.std` defaults, and we never do inference on these numbers. State this in vision §2/§4 (§18).

Per Bev `b` over all users' stored scores `s_{v,b}`:

```
rating_count n_b, avg_score μ_b = Σ s / n_b, score_stddev σ_b = sqrt(Σ (s − μ_b)² / n_b)
```

Per user `u` (overall) over all their stored scores: `n_u, μ_u, σ_u` same formulas. Per user per category `c`: `n_{u,c}, μ_{u,c}, σ_{u,c}` over scores of Bevs in `c`.

Small-n handling (`stats.ts`):

```
SIGMA_FLOOR = 1.0          // on the 0–10 scale
MIN_N_USER  = 3            // below this, use global stats for z-scores
MIN_N_CAT   = 3            // below this, per-category stats fall back to the user's overall stats
GLOBAL_FALLBACK = { mean: 5.0, stddev: 2.5 }   // only when there are zero rankings in the system
```

`effectiveStats(u) = n_u ≥ 3 ? { μ_u, max(σ_u, 1.0) } : { μ_global, max(σ_global, 1.0) }`.

### 8.5 z-scores and category affinity

```
z_{u,b} = (s_{u,b} − μ*_u) / σ*_u          // μ*, σ* = effectiveStats(u), OVERALL stats
```

Important subtlety for vision §5: category affinity must use the user's **overall** mean/σ, not the per-category ones. If you z-scored each category against its own mean, every affinity would be 0 by construction.

```
affinity_{u,c} = Σ_{b ∈ c ranked by u} z_{u,b} / (n_{u,c} + K_AFF),   K_AFF = 2
```

This is a shrunk mean (toward 0 = "neutral"). `n_{u,c} = 0` → 0. Per-category `μ_{u,c}, σ_{u,c}` are still stored (table `user_category_stats`) for display ("Your Soda average: 7.2") and for Arjun's vectors, but affinity is what prediction uses.

### 8.6 Normalised global score of a Bev

```
g_b = Σ_{v ranked b} z_{v,b} / (n_b + K_G),   K_G = 3
```

Mean z across raters, shrunk toward 0. New Bev → 0.

### 8.7 Bayesian average (leaderboard)

```
bayes_b = (C · m + n_b · μ_b) / (C + n_b)
```

- `m` = prior mean: the mean of **all stored scores in the Bev's category** when the category has ≥ 30 rankings, else the global mean of all stored scores. Per-category priors stop Water from being punished for being Water on the per-category boards; the overall board uses the global `m` for everyone (one `m` per board).
- `C` = prior weight = 3 (equivalent ratings). Tuning rule: `C` should be about the number of ratings at which you'd trust a Bev's own mean as much as the prior. At ~20 users, 3 is right; when the median `rating_count` over rated Bevs passes 10, raise `C` to 5. `C` and the rule are constants in `constants.ts`, versioned with the vectors.
- Leaderboard eligibility: `n_b ≥ MIN_RATERS = 2`. Bevs with one rater appear in a separate "New" strip, not the ranked list. Order: `bayes_b` desc, `n_b` desc, name asc.
- Worked example: `m = 6.0, C = 3`; one 10/10 → `(18 + 10)/4 = 7.0`; five 10/10 → `(18 + 50)/8 = 8.5`; one 2/10 → 5.0.

### 8.8 Layer 1: category affinity + content similarity

Content similarity between Bevs `b` and `b'`:

```
sim(b, b') = 0.40·[cat(b) = cat(b')] + 0.30·[brand(b) = brand(b')  (normalised, non-empty)]
           + 0.20·jaccard(flavorTokens(b), flavorTokens(b')) + 0.10·(1 − |tier(b) − tier(b')| / 3)
```

`flavorTokens` = lowercase words of flavor + name minus a stoplist (`original`, `classic`, `drink`, `can`, `bottle`, sizes). Pairs with `sim < 0.1` are dropped.

User's content term for candidate `b`:

```
content_{u,b} = Σ_{b' ranked by u, b' ≠ b} sim(b, b') · z_{u,b'}  /  (Σ sim(b, b') + 1)
```

The `+ 1` shrinks toward 0 when the similarity mass is small.

```
ẑ1_{u,b} = 0.40 · affinity_{u, cat(b)} + 0.40 · content_{u,b} + 0.20 · g_b
conf1_{u,b} = min(1, n_u / 10) · min(1, (n_{u,cat(b)} + Σ sim(b, b')) / 4)
```

Weights sum to 1 so `ẑ1` stays in z-units. Predicted score: `ŝ = clamp(μ*_u + σ*_u · ẑ, 0, 10)`, displayed to 1 dp with the "~" prefix.

Layer 1 recommendation list (Phase 2, before Layer 2 exists): all untried, visible (age gate) Bevs scored by `ẑ1`, top N.

### 8.9 Layer 2: collaborative filtering

Pick **user-user** at ~20 users. Reasoning: 20 users → 190 user pairs, each pair shares the 6 fixed starter Bevs plus whatever overlaps, so similarities are computable from day one. Item-item needs co-raters per *item pair*; with ~300 Bevs and 20 users almost every item pair has 0–1 co-raters. Switch to item-item when `users ≥ 200` or when the median number of co-raters per item pair among rated items reaches 3 (the eval script prints both numbers). Matrix factorisation only after that (vision §5 "later").

```
common(u, v) = items ranked by both
sim(u, v) = cosine(z_u[common], z_v[common])  if |common| ≥ 2 else 0
sim'(u, v) = sim(u, v) · min(|common|, 5) / 5          // significance weighting
N_k(u, b) = top K = 10 users v with sim'(u, v) > 0 who ranked b
ẑ2_{u,b} = Σ_{v ∈ N_k} sim'(u, v) · z_{v,b}  /  Σ_{v ∈ N_k} sim'(u, v)
support_{u,b} = Σ_{v ∈ N_k} sim'(u, v)                  // 0 when no neighbour ranked b
```

This is vision §5's "user's mean + weighted average of similar users' deviations" expressed in z-units (multiply by `σ*_u` and add `μ*_u` to get the score).

### 8.10 Blend

```
λ_{u,b} = Λ_MAX · support_{u,b} / (support_{u,b} + 1) · min(1, n_u / 15),   Λ_MAX = 0.7
ẑ_{u,b} = (1 − λ) · ẑ1 + λ · ẑ2
confidence = max(conf1, min(1, support))  // what the UI thresholds at 0.25
```

Layer 2's weight grows with neighbour support for that Bev (stands in for vision's `rating_count`) and with the user's history. `support = 0` → pure Layer 1, so Phase 2 and Phase 3 share one code path.

### 8.11 Exploration ("plus some air")

The conversation's "a beverage near another one in a group plus some air" = noise/epsilon. Two mechanisms, both deterministic given a seed:

- **Jitter for ordering only:** `ẑ_ordering = ẑ + N(0, 0.15)` using a seeded PRNG (`mulberry32(hash(userId + ':' + dayKey))`), so the list shuffles slightly day to day but is stable within a day. The displayed predicted score is the un-jittered `ŝ`.
- **ε-slots:** with `EPSILON = 0.15` and list length `N = 20`, `round(ε·N) = 3` slots (positions 4, 9, 15) hold exploration picks: untried Bevs from categories where `affinity_{u,c} ≤ median affinity` or `n_{u,c} = 0`, with `g_b ≥ 0`, chosen by weighted sampling proportional to `exp(g_b)` with the same PRNG. Tagged `isExploration: true` ("Something different"). If the pool is empty, the slots fall back to normal picks.

### 8.12 Cold-start: starter-set selection

Catalog Bevs carry `isStarter: boolean` (Arjun sets ~20: Coke, Diet Coke, Sprite, LaCroix, Red Bull, Gatorade, Pepsi, Dr Pepper, Mountain Dew, Monster, Celsius, Arizona Iced Tea, Minute Maid OJ, Topo Chico, Poland Spring, Starbucks bottled Frappuccino, Snapple, Yerba Mate, Fanta, Canada Dry; adjust to the seeded catalog).

```
selectStarterSet(candidates, { k = 10, core = 6, maxPerCategory = 2, seed, excludeCategoryIds })
```

- The **core** = the 6 most-rated starters (by `rating_count`, ties by name), shown to everyone. Shared items maximise `common(u, v)` for user-user CF.
- The remaining 4 are drawn with the seeded PRNG from the other starters, respecting `maxPerCategory` across the whole set of 10 and a spread of at least 5 categories if possible; `excludeCategoryIds` removes alcoholic categories for anyone under 21.
- Deterministic for a seed (`userId`), so the set is stable if the user leaves onboarding and comes back.

New Bev cold start needs no special code: `g_b = 0`, `support = 0` → prediction is affinity + content only.

### 8.13 "Rank on Bevi" (user leaderboard)

Vision §11 asks what counts. Proposal (effort-based, not popularity-based; followers are excluded because they are gameable and say nothing about ranking activity):

```
points_u = bevsRanked_u + 3 · currentStreak_u + 2 · bevsCreated_u
rank_u   = 1 + |{ v : points_v > points_u }|          // ties share a rank ("competition" ranking)
display order: points desc, bevsRanked desc, createdAt asc
```

`bevsCreated` counts Bevs the user added that at least one *other* user has ranked (so junk entries don't score). Users with `bevsRanked = 0` are "Unranked".

### 8.14 Streaks

- Day key = the calendar date of `ranking.created_at` in the user's profile timezone (IANA, captured at onboarding, editable in settings). SQL twin: `(created_at AT TIME ZONE profile.timezone)::date`. Day boundary = local midnight; DST handled by the tz conversion; a user who changes timezone gets their streak recomputed under the new zone (accepted).
- `computeStreak(dayKeys: string[] (unique 'YYYY-MM-DD'), todayKey) → { current, longest, lastDay }`:
  - `current`: walk back from `todayKey`; if today is in the set start at today, else if yesterday is in the set start at yesterday (streak alive but not extended yet), else 0; count consecutive days.
  - `longest`: longest consecutive run anywhere.
- Multiple rankings in one day count once. Re-ranks count (they are rankings). Removals don't retroactively break a streak (the comparison rows remain; the streak is computed from `rankings` rows plus a `ranking_events` log on Arjun's side if he prefers; see §18).
- UI copy: `current = 0` → "Rank today to start a streak"; alive-but-not-today → flame outlined, "Rank today to keep your 4-day streak".

---

## 9. `packages/ranking`: exports, types, package layout

```
packages/ranking/
  package.json        name "@bevi/ranking", "type": "module", exports → dist/index.js + types; no dependencies
  tsconfig.json       strict, lib ES2022, no DOM, no node types   (keeps it importable from Deno/Edge; Arjun verifies)
  src/
    index.ts  constants.ts  types.ts  prng.ts
    placement.ts  score.ts  stats.ts  bayesian.ts  similarity.ts
    layer1.ts  layer2.ts  blend.ts  explore.ts  recommend.ts  starter.ts  rank.ts  streak.ts
  test/               *.test.ts (vitest), *.property.test.ts (fast-check)
  scripts/            gen-vectors.ts  eval.ts
  eval/               synthetic.ts (generates the planted-taste dataset)
  CLAUDE.md
```

### Exported signatures

```ts
// placement.ts
export function startPlacement(input: { bevId: BevId; bucket: Bucket; orderedBevIds: BevId[] }): PlacementState;
export function currentPrompt(s: PlacementState): { comparedBevId: BevId; step: number; maxSteps: number } | null;
export function answer(s: PlacementState, a: ComparisonAnswer): PlacementState;   // 'NEW_BETTER' | 'EXISTING_BETTER' | 'TIE'
export function undo(s: PlacementState): PlacementState;
export function isDone(s: PlacementState): boolean;
export function placementResult(s: PlacementState): PlacementResult;             // { bevId, bucket, insertIndex, comparisons }
export function maxComparisons(n: number): number;                                 // ceil(log2(n + 1))
export function removeFromBucket(orderedBevIds: BevId[], bevId: BevId): BevId[];

// score.ts
export function scoreFromPosition(index: number, n: number, bucket: Bucket): number;      // unrounded
export function storedScore(score: number): number;                                       // 2 dp
export function respaceBucket(orderedBevIds: BevId[], bucket: Bucket): Array<{ bevId: BevId; position: number; score: number }>;
export function bucketForScore(score: number): Bucket;

// stats.ts
export function populationStats(values: number[]): { n: number; mean: number; stddev: number };
export function effectiveUserStats(user: { n: number; mean: number; stddev: number }, global: { mean: number; stddev: number }): { mean: number; stddev: number };
export function zScore(score: number, stats: { mean: number; stddev: number }): number;
export function categoryAffinity(zs: number[]): number;

// bayesian.ts
export function bayesianAverage(mean: number, n: number, prior: { m: number; C: number }): number;
export function leaderboardOrder(rows: Array<{ bevId; bayes; n; name }>): BevId[];

// similarity.ts / layer1.ts / layer2.ts / blend.ts / recommend.ts
export function contentSimilarity(a: BevFeatures, b: BevFeatures): number;
export function layer1(snapshot: PredictionSnapshot, userId: UserId, bevId: BevId): { z: number; confidence: number; parts: { affinity; content; global } };
export function userSimilarity(snapshot: PredictionSnapshot, u: UserId, v: UserId): number;
export function layer2(snapshot: PredictionSnapshot, userId: UserId, bevId: BevId): { z: number; support: number; neighbours: UserId[] };
export function predictScore(snapshot: PredictionSnapshot, userId: UserId, bevId: BevId): Prediction;
export function recommend(snapshot: PredictionSnapshot, userId: UserId, opts: { n: number; seed: string; epsilon?: number; excludeBevIds?: BevId[] }): Recommendation[];

// starter.ts / rank.ts / streak.ts
export function selectStarterSet(candidates: StarterCandidate[], opts: { k?: number; core?: number; maxPerCategory?: number; seed: string; excludeCategoryIds?: CategoryId[] }): BevId[];
export function rankPoints(a: { bevsRanked: number; currentStreak: number; bevsCreated: number }): number;
export function rankUsers(rows: Array<{ userId; bevsRanked; currentStreak; bevsCreated; createdAt }>): Array<{ userId; points; rank }>;
export function computeStreak(dayKeys: string[], todayKey: string): { current: number; longest: number; lastDay: string | null };
export function localDayKey(isoTimestamp: string, timeZone: string): string;   // Intl-based; only used by the app and tests
```

### Snapshot and result types (defined here, re-exported through `shared/` in contract v1)

```ts
export interface PredictionSnapshot {
  version: string;                       // RANKING_CONSTANTS.version, e.g. "1.0.0"
  generatedAt: string;                   // ISO; informational only
  global: { mean: number; stddev: number; byCategoryMean: Record<CategoryId, number> };
  bevs: Record<BevId, BevFeatures>;      // { id, categoryId, brandKey: string | null, flavorTokens: string[], priceTier: 1|2|3|4, ratingCount, mean, stddev, isAlcoholic }
  users: Record<UserId, UserSnapshot>;   // { id, stats: { n, mean, stddev }, categoryStats: Record<CategoryId, { n, mean, stddev }>, canSeeAlcohol }
  rankings: Array<{ userId: UserId; bevId: BevId; score: number }>;   // z computed inside; at 20 users this is the whole table
}
export interface Prediction { bevId; z: number; score: number; confidence: number; lambda: number; layer1: {...}; layer2: {...} }
export interface Recommendation { bevId; score: number; confidence: number; reason: 'CATEGORY' | 'SIMILAR' | 'NEIGHBOURS' | 'POPULAR'; isExploration: boolean }
```

Scope note for Arjun: at 20 users the snapshot is the full `rankings` table (≈ 1,000 rows). Past ~500 users he should restrict `rankings` to the target user, the users sharing ≥ 2 items with them, and the candidate Bevs; the functions don't care.

---

## 10. Golden test vectors

Seam 4: formulas are yours, SQL execution is Arjun's, and both must pass the same vectors in CI.

| File (`shared/fixtures/`) | Covers | Consumer |
|---|---|---|
| `score-from-position.vectors.json` | `scoreFromPosition`, `storedScore`, `respaceBucket` for n = 1…12 and 50, all buckets | Arjun's `respace_bucket()` SQL + app |
| `bev-stats.vectors.json` | per-Bev `n, mean, stddev_pop` incl. n = 1, identical scores | Arjun's aggregate trigger/view |
| `user-stats.vectors.json` | per-user overall + per-category stats, effective stats with fallbacks, z-scores, affinity | `user_category_stats` |
| `bayesian.vectors.json` | `bayesianAverage` with global and per-category priors, eligibility, tie order | leaderboard view |
| `streak.vectors.json` | `computeStreak` + `localDayKey` with tz cases: `America/Los_Angeles` across a DST change, `UTC`, `Asia/Kolkata`, a ranking at 23:59 local, two rankings in one day | streak RPC/cron |
| `rank-points.vectors.json` | `rankPoints`, `rankUsers` ties | user leaderboard view |
| `placement.vectors.json` | full answer sequences → `insertIndex` + comparison logs (incl. TIE, undo) | app regression + Arjun's RPC consistency check |
| `prediction.vectors.json` | a 12-user × 40-Bev snapshot → `predictScore`/`recommend` outputs for 6 users | Arjun's Edge Function smoke test (calls your function, compares) |

Format: `{ "version": "1.0.0", "constants": {...}, "cases": [{ "name", "input", "expected" }] }`. Numeric comparison: absolute tolerance `1e-6` on unrounded values; stored 2-dp values compared exactly.

Generation: `npm run vectors -w packages/ranking` runs `scripts/gen-vectors.ts` (seeded, deterministic) and writes the files. CI job `vectors-fresh` regenerates and fails on a diff, so nobody edits vectors by hand. Changing a constant or formula = `contract/vectors-<thing>` PR containing the ranking change, the regenerated vectors and a bumped `version`; Arjun approves and updates SQL in a `be/*` PR that must merge before or with it (coordinate in the PR; CI on `main` must stay green).

---

## 11. Testing strategy

### Unit (vitest, `packages/ranking`)

Each formula has table tests mirroring §8's worked examples (so the doc and the code can't drift silently) and edge cases: empty inputs, n = 1, identical scores (σ = 0 → floor), missing brand, no categories in common, user with zero rankings, snapshot with one user.

### Property tests (fast-check)

- Placement: for random `n ∈ [0, 300]` and hidden true index `t`, an oracle answering consistently yields `insertIndex === t` in `≤ maxComparisons(n)` steps; `insertIndex ∈ [0, n]` for random answers; `undo` after `k` answers restores the state before answer `k`; `answer ∘ undo` is identity on the comparison log; TIE at any step yields `insertIndex === mid + 1`; the logged comparisons are each consistent with the final index.
- Scores: `respaceBucket` output is strictly decreasing, inside the open band, and `bucketForScore(score) === bucket`; inserting at any index preserves relative order of the others.
- Stats: `populationStats` matches a naive two-pass implementation; z-scores of a user's own scores have mean 0 (when n ≥ 3 and σ > floor).
- Recommendation: `recommend` never returns a tried Bev, never an alcoholic Bev for `canSeeAlcohol = false`, returns exactly `round(ε·n)` exploration items when the pool allows, and is deterministic for a seed.

### Offline evaluation of recommendation quality (tiny data)

`npm run eval -w packages/ranking`:

1. `eval/synthetic.ts` builds 20 users × 60 Bevs with planted tastes: 4 taste clusters (soda-lover, health/water, caffeine, sweet/boba), per-user generosity offsets (μ ± 1.5) and spreads, 15–40 rankings per user generated by sampling a latent score and running the real placement machine with a noisy oracle (10% wrong answers), so stored scores come from the actual pipeline.
2. Leave-one-out: hold out one ranking per user, predict it, report MAE and Spearman ρ over all held-out pairs for: global-mean baseline, user-mean baseline, Layer 1 only, Layer 2 only, blend. Also prints users/co-rater statistics (the user-user → item-item switch inputs, §8.9).
3. Acceptance for Phase 2: Layer 1 beats the user-mean baseline on MAE. Phase 3: blend beats Layer 1 on both metrics on the synthetic set, and does no worse on the real export (Arjun provides an anonymised `rankings` dump as a fixture once there are ≥ 10 real users).
4. Weights (`0.4/0.4/0.2`, `K_AFF`, `K_G`, `Λ_MAX`, `K = 10`) are tuned only via this script; any change regenerates `prediction.vectors.json`.

### App tests

- `jest-expo` + RNTL for components (`ScoreBadge`, `PriceTier`, `FeedCard` states) and for `useRankingFlow` (drives the state machine and the mock).
- Mock contract test: `app/src/api/mock.test.ts` runs the same `BeviApi` conformance suite Arjun runs against the real client (lives in `shared/testing/api-conformance.ts`, written jointly in contract v0). This is what makes mock→real a one-line swap.
- Phase 3: Maestro flows for sign-in → rank → profile.

---

## 12. Interfaces with Arjun

### Ownership table (verbatim, same as §1)

| Path | Owner | What lives there |
|---|---|---|
| `app/` | Matt | Expo RN app: navigation (5 tabs), screens, components, design system/tokens, logo usage, camera/image-picker UI, client state, the dev-only mock API |
| `packages/ranking/` | Matt | Pure TypeScript, zero I/O: pairwise placement state machine (gut-check bucket → binary search), score-from-position, normalization (per-user z-scores, per-category stats definitions), Bayesian leaderboard average, predicted score + recommendations (Layer 1, Layer 2, blend, exploration), onboarding starter-set selection, "rank on Bevi" formula. Unit-tested. |
| `design/` | Matt | Beli reference screenshots, brand, logo, per-screen specs |
| `supabase/` | Arjun | Migrations, RLS policies, SQL functions/RPCs, triggers, views, Edge Functions, cron/scheduled jobs, storage buckets + policies, auth config, `seed.sql` |
| `packages/api/` | Arjun | Typed data-access client wrapping supabase-js that implements the `BeviApi` interface. The ONLY thing the app imports to talk to the backend. |
| `data/catalog/` | Arjun | Seed Bev catalog (names, flavors, categories, price tiers), image sourcing + background-removal pipeline. Matt reviews image style. |
| `shared/` | Both, via `contract/*` PRs | Domain types, enums (buckets, categories, price tiers), the `BeviApi` interface, generated Supabase DB types, fixtures, golden test vectors |
| Root, `CLAUDE.md`, `vision.md`, `.github/`, `.claude/` | Both, via `chore/*` PRs | Workspace config, CI, agent definitions |

### The five seams

**Seam 1 — App ↔ backend.** The app imports only `shared/` types and the `BeviApi` interface. `packages/api` implements it on Supabase. You build every screen first against a mock (`app/src/api/mock.ts`, implements `BeviApi`, backed by `shared/fixtures`), so UI work is never blocked on the backend. TypeScript keeps the mock and the real client honest. Swapping mock→real is a one-line change.

- You provide: the mock, the fixtures' *shape* needs, the `api-conformance` suite (joint), the one-line switch, and bug reports against `packages/api` phrased as failing conformance cases.
- You need: `packages/api` exporting `createBeviApi(env): BeviApi` with no React dependency, generated DB types in `shared/db.ts`, env var names, a staging Supabase project with seed data.
- By when: mock complete for Phase 1 screens by end of week 2 (2026-10-23); real client needed by the end of Phase 1 for TestFlight.

**Seam 2 — Contract v0 is the first joint milestone.** You list the data each screen needs (§13); Arjun turns that into the schema + `BeviApi` methods; both approve one `contract/v0` PR. Nothing else merges into `shared/` before it.

- You provide: §13 as `shared/README-v0-needs.md` (or the PR description) by 2026-10-13, review of Arjun's `shared/api.ts` + `shared/types.ts` within one day of his draft.
- You need: the PR merged by end of week 1 (2026-10-16) so the mock and hooks can be typed against it.

**Seam 3 — Ranking write path.** The interactive comparison flow runs in the app using `packages/ranking` (pure state machine). On finish the app calls `api.submitRanking({ bevId, bucket, insertIndex, comparisons, note })`. Arjun's RPC applies it atomically (insert at position, shift others, store raw comparisons, update aggregates). Re-ranking/removing a Bev is the same shape.

- You provide: the exact `SubmitRankingInput`/`Result` types, `placement.vectors.json` (so the RPC can validate comparison logs), `respaceBucket` semantics and the `CONFLICT` behaviour (§6.9), `removeRanking(bevId)` and `replaceExisting`.
- You need: the RPC to return `{ score, position, bucketSize }` and to re-space in the same transaction; a `CONFLICT` error code when `insertIndex > bucketSize`.
- By when: types in contract v0; vectors by end of week 2.

**Seam 4 — Formulas are yours; storage and execution are Arjun's.** Wherever math must run in SQL (score-from-position for aggregates, per-Bev avg/stddev, per-user per-category mean/stddev, Bayesian leaderboard average, streaks, user rank), you specify it in `packages/ranking` and export golden test vectors to `shared/fixtures/*.vectors.json`; Arjun's SQL must pass the same vectors in CI. Changing a formula = `contract/*` PR that regenerates the vectors.

- You provide: §8 + §10 (the vectors, the constants, the `vectors-fresh` CI job on your side).
- You need: a CI job on Arjun's side that loads each vectors file and asserts against his SQL (`supabase test db` or a pgTAP/psql script); the names of his SQL functions so the integrator can cross-reference.
- By when: score/stats/bayesian vectors end of week 2 (Phase 1 needs them); streak/rank vectors start of Phase 2; prediction vectors start of Phase 3.

**Seam 5 — Recommendations.** `packages/ranking` exports pure `predictScore()` / `recommend()` taking an explicit input snapshot type (defined by you). Arjun's Edge Function (or scheduled job) assembles that snapshot from the DB, calls your functions, and serves/caches results through `BeviApi`. (Arjun's doc verifies how a Supabase Edge Function can import a workspace TS package and names the approach; if impractical, he proposes the fallback without changing ownership.)

- You provide: `PredictionSnapshot`, `Prediction`, `Recommendation` (§9) in `contract/v1`, a dependency-free ESM build (`dist/`), `prediction.vectors.json`, and the staleness/confidence rules the UI relies on.
- You need: `recs.getRecommendations()`, `recs.refresh()` (optional), `prediction` embedded in `bevs.get()`, `generatedAt` on both; his chosen import approach (bundled `dist/` copied into `supabase/functions/`, npm specifier, or a Deno import map) so you know whether `src/` or `dist/` is the contract.
- By when: snapshot type frozen at the start of Phase 2 (Layer 1 runs through the same function, so the Edge Function exists in Phase 2, not 3).

### Interpretations of the brief (flag if Arjun's doc differs)

1. **Starter set:** `selectStarterSet()` is yours; it is called by Arjun inside `onboarding.getStarterSet()` (server has the catalog and rating counts) rather than by the app. The app only renders what it gets.
2. **Background removal for user uploads:** the brief gives Arjun the catalog pipeline; vision §8 says "background removal on upload". I assume Arjun runs the same removal for user uploads (storage trigger/Edge Function) and exposes `photoStatus: 'processing' | 'ready'`; your side renders the raw photo with a shimmer meanwhile. If Arjun prefers on-device removal, that moves into `app/` and becomes an open question (§18).
3. **Age gate:** birthdate storage and alcohol filtering in queries/RLS are Arjun's; the screens and client-side hiding are yours. The server is the authority.
4. **Timezone:** stored on the profile (Arjun), captured by the app; the server computes streak days from it (not from a client-sent date).
5. **Price estimation when the user picks "not sure":** vision §2 says "estimate it". The client sends `priceTier: null, priceEstimated: true` and the server fills a tier (median of the category). Your side only displays the `~`.

---

## 13. Your draft of per-screen data needs for contract v0

This is your input to seam 2. Field names are proposals; Arjun owns the schema and may rename in the PR, but every screen below must stay satisfiable.

### Entities

| Entity | Fields the UI needs |
|---|---|
| `Profile` | `id, handle, displayName, initials (derived ok), createdAt, timezone, birthdate (self only), canSeeAlcohol, onboarded` |
| `ProfileStats` | `followers, following, bevdCount, wantToTryCount, rankOnBevi (number \| null), rankPoints, currentStreak, longestStreak, streakAliveToday (bool)` |
| `Category` | `id, name, slug, isAlcoholic, sortOrder` |
| `BevSummary` | `id, name, brand, flavor, categoryId, photoUrl, photoStatus ('processing'\|'ready'), priceTier (1–4), priceEstimated, ratingCount, bayesScore (number \| null)` |
| `Bev` (detail) | `BevSummary + nutritionLabelUrl, avgScore, scoreStddev, createdBy (Profile summary \| null), createdAt, myRanking ({ bucket, position, bucketSize, score, note } \| null), prediction ({ score, confidence, generatedAt } \| null), inWantToTry, friends: Array<{ profile, score, bucket }>, isStarter` |
| `Ranking` | `id, userId, bevId, bucket, position, score, note, createdAt, updatedAt` |
| `Comparison` | `winnerBevId, loserBevId, tie (bool)`, stored with `rankingId, userId, createdAt` |
| `FeedItem` | `id, type ('RANKING' for v1), actor (Profile summary), bev (BevSummary), score, bucket, note, createdAt, inMyWantToTry` |
| `FeaturedBev` | `bev (BevSummary), heroImageUrl, tagline, startsAt, endsAt` |
| `LeaderboardRow` | `rank, bev (BevSummary), bayesScore, ratingCount, myScore (number \| null)` |
| `UserLeaderboardRow` | `rank, profile summary, points, bevsRanked, currentStreak` |
| `Recommendation` | `bev (BevSummary), predictedScore, confidence, reason, isExploration, generatedAt` |
| `WantToTryItem` | `bev (BevSummary), savedAt, via (Profile summary \| null)` |
| `Page<T>` | `{ items: T[], nextCursor: string \| null }` |
| `ApiError` | `{ code: 'NOT_FOUND' \| 'CONFLICT' \| 'UNAUTHORIZED' \| 'VALIDATION' \| 'RATE_LIMITED' \| 'NETWORK' \| 'UNKNOWN', message }` |

### `BeviApi` methods by screen

| Namespace.method | Input → Output | Screens |
|---|---|---|
| `auth.signUp / signIn / signOut / getSession / onAuthStateChange / deleteAccount` | email+password → session | 6.1, 6.18 |
| `profile.getMe()` | → `Profile` | root gate, 6.13 |
| `profile.updateMe(patch)` | `{ displayName?, handle?, birthdate?, timezone?, onboarded? }` → `Profile` | 6.2, 6.3, 6.18 |
| `profile.checkHandle(handle)` | → `{ available }` | 6.2 |
| `profile.getUser(id)` / `searchUsers({ q, limit })` | → `Profile` / `Profile[]` | 6.14, 6.16 |
| `stats.getMine()` / `stats.getUser(id)` | → `ProfileStats` | 6.13, 6.14 |
| `follows.follow(id) / unfollow(id)` | → void | 6.14–6.16 |
| `follows.listFollowers(id, page)` / `listFollowing(id, page)` / `suggested()` | → `Page<Profile & { isFollowing }>` | 6.15, 6.16 |
| `categories.list()` | → `Category[]` (already filtered by age) | pickers, chips |
| `bevs.search({ q, categoryId?, limit })` | → `BevSummary[]` | 6.8 |
| `bevs.get(id)` | → `Bev` | 6.11 |
| `bevs.findLikelyDuplicates({ name, brand?, flavor?, categoryId? })` | → `BevSummary[]` (≤ 5) | 6.10 |
| `bevs.create(input)` | `{ name, flavor?, brand?, categoryId, priceTier: 1–4 \| null, priceEstimated, photoAssetId, labelAssetId? }` → `Bev` | 6.10 |
| `bevs.report(id, reason)` | → void | 6.11 |
| `bevs.listStarterCandidates()` or `onboarding.getStarterSet()` | → `BevSummary[]` (10) | 6.3 |
| `media.upload({ kind: 'bev-photo' \| 'label', uri, mimeType })` | → `{ assetId, url, status }` | 6.10 |
| `rankings.listMine({ bucket?, categoryId?, page })` | → `Page<Ranking & { bev: BevSummary }>` ordered by bucket, position | 6.5, 6.9 start |
| `rankings.listUser(id, page)` | → same | 6.13, 6.14 |
| `rankings.submitRanking({ bevId, bucket, insertIndex, comparisons, note?, replaceExisting? })` | → `{ ranking, bucketSize }` | 6.9 |
| `rankings.updateNote(bevId, note)` / `removeRanking(bevId)` | → void | 6.5 |
| `wantToTry.list(page) / add(bevId, viaUserId?) / remove(bevId)` | → `Page<WantToTryItem>` / void | 6.4, 6.6, 6.11 |
| `feed.getFeed(page)` / `feed.getFeatured()` | → `Page<FeedItem>` / `FeaturedBev[]` | 6.4 |
| `leaderboard.bevs({ categoryId?, page })` / `leaderboard.users(page)` | → `Page<LeaderboardRow>` / `Page<UserLeaderboardRow>` | 6.12 |
| `recs.getRecommendations({ limit })` / `recs.refresh()` | → `{ items: Recommendation[], generatedAt, basedOnCount }` | 6.7 |
| `meta.getAppConfig()` | → `{ minAppVersion, maintenance: bool }` | root |

Constraints the schema must honour: `(userId, bevId)` unique in `rankings`; `position` unique per `(userId, bucket)`; `handle` unique, lowercase; `score` numeric(4,2); all list calls cursor-paginated; alcoholic content filtered server-side by `canSeeAlcohol`.

Also in `contract/v0`: `shared/enums.ts` (`Bucket`, `PriceTier`, category slugs), `shared/fixtures/` seed JSON (≥ 60 Bevs across all categories, 12 users, ~300 rankings generated by the ranking package so scores are consistent, 3 featured Bevs), and `shared/testing/api-conformance.ts`.

---

## 14. Dependency and handoff table

| Your task | Blocked on (Arjun) | Unblocks (Arjun) |
|---|---|---|
| §13 data-needs list | nothing | his schema draft and `contract/v0` |
| Mock API + fixtures | `contract/v0` merged (types) | his `api-conformance` runs against real client |
| Placement machine + `score-from-position` vectors | nothing | `submit_ranking` RPC + `respace_bucket()` SQL |
| Stats + Bayesian vectors | nothing | aggregate triggers, leaderboard view |
| Ranking flow screen | mock only; real end-to-end needs `submit_ranking` RPC | his RPC gets a real client exercising `CONFLICT` |
| Add Bev / create wizard | mock; real needs `media.upload` + storage bucket + background removal job | his dedupe `findLikelyDuplicates` gets real inputs |
| Feed, lists, leaderboard, profile screens | mock; real needs views + `getFeed`/`stats` RPCs | nothing |
| Age-gate UI | `canSeeAlcohol` on `Profile` in contract v0 | his RLS/view filtering spec |
| `PredictionSnapshot` type + `prediction.vectors.json` (`contract/v1`) | nothing | his Edge Function |
| Recommended tab with real data | Edge Function serving `recs.getRecommendations` | nothing |
| Streak / rank pills on Profile | streak + rank SQL passing your vectors | nothing; you unblock him with the vectors |
| Photo-style review (`design/photo-style.md`) | nothing | his Haiku image-seeding agents |
| TestFlight build | staging Supabase project + env values | his first real-user data for the offline eval |
| Onboarding starter screen | `onboarding.getStarterSet()` (calls your `selectStarterSet`) | nothing |

---

## 15. Plan by phase

Tags follow vision §10: model / effort. Each row is one Claude Code sub-agent deliverable; "DoD" = definition of done.

### Phase 0 — Setup & research

| # | Task | DoD | Tag |
|---|---|---|---|
| 0.1 | Workspace scaffold (`chore/scaffold`, joint): root `package.json` workspaces, tsconfig base, vitest, CI skeleton; your parts: `app/` (create-expo-app, router root, eas.json), `packages/ranking/` skeleton | `npm install && npm run typecheck && npm test` green on an empty repo | Opus / High (architecture) for the layout decision, Haiku / Low for the boilerplate |
| 0.2 | UI skills research (§2) | `design/research.md`, skills installed, CLAUDE.md references | Sonnet / Medium |
| 0.3 | `app/CLAUDE.md`, `packages/ranking/CLAUDE.md`, `.claude/agents/ui-screen.md`, `ranking-math.md`, integrator adapted | Agents launch on the right model by default; integrator checks `shared/api.ts` + vectors | Haiku / Medium (docs), you review |
| 0.4 | Beli screenshots into `design/reference/` + README | Named per §5; at least one per screen in §6 | you (manual) |
| 0.5 | Tokens + `Wordmark` candidates + `photo-style.md` | `tokens.ts`, two SVG wordmark directions, chosen one committed, brand colour hex recorded | Sonnet / Medium–High |
| 0.6 | §13 → `contract/v0` review | PR approved by both | you + Sonnet / Medium for the fixtures generator |
| 0.7 | `packages/ranking`: placement + score + stats + bayesian with tests, vectors v1.0.0 | Property tests pass; `vectors-fresh` CI job exists | Opus / High (design + review), Haiku / Low–Medium (tests, generator) |

### Phase 1 — MVP: rank your Bevs

| # | Task | DoD | Tag |
|---|---|---|---|
| 1.1 | Mock API + fixtures + conformance suite | Every `BeviApi` method implemented; conformance green; dev panel | Sonnet / Medium |
| 1.2 | Core components + `ComponentGallery` | All §4 components with every state visible in the gallery; a11y labels | Sonnet / Medium |
| 1.3 | Root layout, session gate, tab navigator | 5 tabs, raised Add button, deep links `lists?tab=` work | Sonnet / Medium (one agent owns these files) |
| 1.4 | Auth + onboarding profile + age gate | Sign-up to tabs end-to-end on mock; handle validation | Sonnet / Medium |
| 1.5 | Ranking flow (6.9) | All states incl. empty bucket, TIE, undo, CONFLICT restart; prefetch | Sonnet / Medium; Opus / High reviews the state-machine wiring |
| 1.6 | Starter ranking onboarding (6.3) | Min-3 rule, skip, summary | Sonnet / Medium |
| 1.7 | Add Bev search + Did-you-mean + create wizard + camera + label + price tier (6.8, 6.10) | Creates then ranks on mock; permission-denied paths | Sonnet / Medium |
| 1.8 | Your Lists: Bev'd + Want to Try (6.5, 6.6) | Bucket sections, filters, re-rank/remove sheet | Sonnet / Medium |
| 1.9 | Bev detail (6.11) with predicted-score placeholder states | All states | Sonnet / Medium |
| 1.10 | Profile (6.13) + settings/privacy/delete (6.18) + edit profile | Matches `design/specs/profile.md` within 2pt; VoiceOver pass | Sonnet / Medium–High |
| 1.11 | Leaderboard: Bevs overall (6.12) | Bayesian ordering from the API; MIN_RATERS strip | Sonnet / Medium |
| 1.12 | Swap to real `packages/api` on staging; fix drift | App runs on `EXPO_PUBLIC_BEVI_API=supabase`; conformance green on both | Sonnet / Medium |
| 1.13 | Phase-1 review + bug hunt; EAS preview build to 5 friends via TestFlight | Review findings fixed; build installed on ≥ 3 phones | Sonnet / High (review), Haiku / Low (release notes) |

### Phase 2 — Social + recommendations

| # | Task | DoD | Tag |
|---|---|---|---|
| 2.1 | Ranking: z-scores, affinity, `g_b`, content similarity, Layer 1, `predictScore` v1, `PredictionSnapshot`; `contract/v1` + prediction vectors | Eval script: Layer 1 beats user-mean baseline on synthetic data | Opus / High (design), Haiku / Medium (tests) |
| 2.2 | Streak + rank formulas + vectors | `streak.vectors.json`, `rank-points.vectors.json` merged | Opus / High (review only; small), Haiku / Low |
| 2.3 | Feed + Featured carousel (6.4), Find people (6.16), followers/following (6.15), other profiles (6.14) | Optimistic follow/bookmark; empty states | Sonnet / Medium |
| 2.4 | Recommended tab (6.7) + predicted score on Bev detail | Confidence gating; stale handling | Sonnet / Medium |
| 2.5 | Profile pills wired to real streak/rank | Copy for all streak states | Sonnet / Medium |
| 2.6 | Per-screen polish pass against Beli specs (feed, lists, profile) | Specs' "differences" list closed | Sonnet / Medium–High |
| 2.7 | Phase-2 review + TestFlight round 2 | | Sonnet / High |

### Phase 3 — Smarter and bigger

| # | Task | DoD | Tag |
|---|---|---|---|
| 3.1 | Layer 2 user-user CF + blend + exploration; eval on synthetic + real export; vectors v2 | Blend beats Layer 1 on synthetic; no regression on real | Opus / High, Haiku / Medium |
| 3.2 | Per-category leaderboards + "This month" toggle; user leaderboard | Category chips, month filter | Sonnet / Medium |
| 3.3 | Swipe gestures on comparison cards, haptics, Reanimated polish | 60fps on iPhone 12; reduce-motion fallback | Sonnet / Medium–High |
| 3.4 | Performance pass (bundle, images, query cache persistence), analytics stub | Budgets in §7 met | Sonnet / Medium |
| 3.5 | Maestro e2e flows in CI; "Not interested" on recs; drift re-check prompts (vision §4 "optional later") | | Sonnet / Medium, Haiku / Low |
| 3.6 | Android preview build, Play internal testing | APK/AAB installable | Haiku / Low–Medium |

---

## 16. First-week checklist (ordered)

1. [ ] Agree package names and the scaffold with Arjun; open `chore/scaffold` together (0.1).
2. [ ] Drop Beli screenshots into `design/reference/` with the README (0.4).
3. [ ] Write §13 into the `contract/v0` PR description / `shared/README-v0-needs.md`; send to Arjun by 2026-10-13 (0.6).
4. [ ] Research spike (0.2): install `frontend-design` + `react-native-skills`, write `design/research.md`.
5. [ ] `app/CLAUDE.md`, `packages/ranking/CLAUDE.md`, agent definitions (0.3).
6. [ ] `packages/ranking`: `placement.ts`, `score.ts`, `stats.ts`, `bayesian.ts` + property tests + `gen-vectors.ts` (0.7). Open `rank/placement` PR.
7. [ ] Tokens, `Wordmark` candidates, pick one; `design/photo-style.md` (0.5).
8. [ ] Review Arjun's `contract/v0` draft within a day; approve by 2026-10-16.
9. [ ] Start `ui/mock-api` against the merged contract (1.1) and `ui/components` (1.2) in separate worktrees.
10. [ ] Expo Go running on your phone with the component gallery; `eas build --profile development` queued once so credentials exist.

---

## 17. Deliberately not doing (from the conversation)

- Users "adding a row in the SQL": all writes go through `BeviApi`; no SQL exposure.
- "We don't need no damn privacy page" / "we got location off forever": a minimal privacy screen and a hosted policy ship because the stores require them; location is genuinely never collected.
- "Make our logo look like Beli with a v": original wordmark in a similar spirit; no copied glyphs, colours or icon.
- Photo recognition of a drink from the camera ("take a picture and it's in the database"): v1 is search + manual create; the camera photo becomes the Bev's image, not a lookup key.
- Business model bits (promoted placements, subscriptions), "hottest this month" before Phase 3, matrix factorisation, Android Play release before Phase 3.
- "Skip this comparator" in the ranking flow, periodic drift re-checks, push notifications, blocking/private profiles, Bev editing by non-creators (moderation is an open question).

---

## 18. Open questions and proposed vision.md changes

Proposed edits to vision.md (via `chore/vision-*` PRs, both approve):

1. **§4 score bands:** adopt equal thirds (`[0, 10/3), [10/3, 20/3), [20/3, 10]`), `score = hi − (hi − lo)(i + 1)/(n + 1)`, stored 2 dp, displayed 1 dp. Closes §11 item 3.
2. **§4 ties:** add the "Too close to call" answer and its rule (insert directly below the incumbent).
3. **§2/§4 stddev:** state that all stddevs are population (`stddev_pop`) with a floor of 1.0 and small-n fallbacks (§8.4).
4. **§5 normalisation subtlety:** category affinity uses the user's overall mean/σ (per-category z-scores would be identically 0).
5. **§5 Layer 2 choice:** user-user at launch, item-item at ≥ 200 users; blend weight from neighbour support (§8.9–8.10). Exploration = seeded jitter + ε = 0.15 slots.
6. **§7/§11 rank on Bevi:** `points = bevsRanked + 3·currentStreak + 2·bevsCreated`; followers excluded. Closes §11 item 4.
7. **§6 streak definition:** consecutive local days (profile timezone) with ≥ 1 ranking; alive if yesterday had one.
8. **§8 recommendations tech:** vision says "start as SQL views/functions in Postgres for Layer 1"; the agreed seam 5 runs Layer 1 and 2 through `packages/ranking` called by an Edge Function. Update §8 to match the brief (this is the one place the brief and vision conflict).
9. **§6 missing screens:** add Find people (handle search + suggestions), Followers/Following lists, Edit profile, Account deletion (Apple requirement), Report Bev.
10. **§2 users fields:** add `handle`, `display_name`, `birthdate`, `timezone`, `onboarded`; `categories.is_alcoholic`; `bevs.is_starter`, `bevs.photo_status`.
11. **§9 Phase 2:** the Edge Function for recommendations is Phase 2 work (Layer 1 already runs through it), not Phase 3.

Open questions (need a decision, not a doc edit):

- Alcohol in v1: proposal is yes, seeded minimally, gated by birthdate ≥ 21 (vision §11 item 1). Arjun's RLS must enforce it; confirm he's fine with that scope.
- Auth method: email+password (proposed) vs magic link. Email confirmation on or off for the friends-only phase?
- Whose Apple Developer account and bundle id (`com.bevi.app`)? Who holds the EAS org?
- Background removal for user uploads: server-side (assumed, Arjun) vs on-device (would move to `app/`). Also: does the pipeline produce blurhashes?
- Price estimation default when the user says "not sure": category median (proposed) vs always ask.
- Moderation for user-added Bevs (vision §11 item 5): proposal for v1 is `bevs.report` + Arjun's admin SQL; no in-app moderation UI.
- Brand colour and the final wordmark (vision §11 item 6): decide from the two week-1 candidates.
- Streak source of truth after removals: compute from current `rankings` rows (simplest; removing your only ranking of a day breaks that day) or from an append-only `ranking_events` log (Arjun's call; the vectors are the same either way).
- Expo Router `root` option and FlashList v2 on SDK 58: verify in the scaffold PR; both are my recollection, not re-verified against the SDK 58 docs today.
