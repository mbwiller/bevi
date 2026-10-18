# Bevi — Development plan: Matt (UI + ranking/recommendation logic)

Written 2026-10-09 from `vision.md` (source of truth), `CONVERSATION.md` (raw founding chat) and the agreed work-split brief. Arjun's counterpart is `DEVELOPMENT-ARJUN.md`; the two documents share the ownership table and the five seams word for word. Where this doc goes beyond vision.md it says so, and §18 lists everything that should be folded back into vision.md.

**Decided 2026-10-11 (Matt + Arjun): Bevi is a web app only.** The Expo app is built for the web (`expo export --platform web`), hosted on Vercel and added to the iPhone home screen; the backend stays Supabase. No native builds, EAS, App Store/TestFlight, Android, or Expo Go/dev client as a target. Under 20 users (friends), so sign-in is username + password gated by a shared invite code; no OAuth, no third-party services, no emails. Sections below are updated where this changed the plan.

**Status 2026-10-12 (end-to-end audit and launch work, branch `claude/upbeat-galileo-iuhp0s`).**

- Until now the deployed app ran entirely on the in-browser mock (each visitor got a private fake world with seeded fake users); it never talked to Supabase. Now the app runs only on `packages/api` against the hosted project (`tgfyqgqbqxhsxvbelect`); the mock is a jest-only test double with neutral fixture people (§3). The dev gallery and dev routes are gone; the old mock's localStorage (fake users, plain-text passwords) is wiped on launch.
- Hosted Supabase: all migrations through `20261012000900` applied; the 378-Bev catalog is loaded by a generated migration (`npm run catalog:migration`); confirm-email off, minimum password 8, invite code set (in `app_secrets`, not in the repo).
- Working end to end against hosted, checked in a real browser (sign up with the invite code → profile + birthdate → starter ranking with comparisons → feed; reload keeps the session; follow → their rankings in your feed; Recommended; Rank on Bevi; delete account) and by the `packages/api` live suites: photo upload → create a Bev visible to everyone, search, Bev detail with a predicted score, recommendations, streaks, user leaderboard, birth dates private.
- **Decided 2026-10-12 (deviates from seam 5 / §8 below, for Arjun's sign-off):** predictions and recommendations run in the client. `get_prediction_snapshot()` returns the caller's `PredictionSnapshot` as one jsonb value and `packages/api` runs `predictScore()` / `recommend()` from `@bevi/ranking` (no Edge Function). Revisit at ~200 users or a ~1 MB snapshot.
- Still to do: Taste Profile tab (Phase 3), background removal / thumbnails for user photos (raw photo is used), moderation tools (report exists; merge/hide by SQL), pagination on search and the leaderboards (fine under ~50 rows), SQL tests against the streak and rank-points golden vectors, running the BeviApi conformance suite against `packages/api`, and `site_url` once the production URL is final.

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
| Apple Human Interface Guidelines (developer.apple.com, free, not open source) | Tab bars, navigation, type sizes, 44pt targets, Dynamic Type | The baseline for measurements; Bevi runs as a home-screen web app on iPhones | Adopt |
| Material 3 (m3.material.io, Apache-2.0 components) | Android equivalents | Not needed: no Android target (decided 2026-10-11) | Skip |
| `founded-labs/react-native-reusables` (MIT, ~8.7k) | shadcn/ui port for RN; copy-paste components on NativeWind | Only if you choose NativeWind (§3 recommends plain `StyleSheet` + tokens) | Optional |
| `nativewind/nativewind` (MIT) | Tailwind for RN | See above | Optional |
| `software-mansion/react-native-reanimated` (MIT) | Animations on the UI thread | Comparison-card transitions, tile presses | Adopt |
| `shopify/flash-list` (MIT) | Virtualised list, v2 is JS-only and needs the New Architecture | Feed, Bev'd, leaderboard | Adopt |
| `gorhom/react-native-bottom-sheet` (MIT) | Bottom sheets | Re-rank sheet, category picker, "Did you mean…" | Adopt |
| `expo-image` (part of Expo) | Disk+memory cache, `recyclingKey`, placeholders | Every Bev photo | Adopt |
| `lucide-react-native` (ISC) | Outline line icons; the Beli spec (`bevi-ui-inspiration/beli-screens-spec.md` Part 2) names the same icon set | Every icon: heart, bookmark, plus-circle, check-circle, trophy, flame, clock, lock, share | Adopt |

Not found: a dedicated, well-maintained open-source "mobile UI design guideline skill" beyond the above. Registry sites list community `mobile-app-ui-implementation` / `frontend-app-design` SKILL.md files, but I could not verify their source repos or licences; treat them as unverified and don't install blind.

**Phase 0 research task (Sonnet, Medium):** install the two adopted skills into `.claude/skills/` (via `chore/skills` PR), write a one-page `design/research.md` listing what each contributes and the 10 rules you will actually enforce (e.g. 44pt targets, 4pt grid, no colour-only meaning, system font, Reanimated-only animation, FlashList for anything > 20 rows). Definition of done: file exists, skills load in a fresh Claude Code session, CLAUDE.md references them.

---

## 3. App foundation (`app/`)

### Stack (concrete)

| Piece | Choice | Notes |
|---|---|---|
| Platform | Web only (decided 2026-10-11): `expo export --platform web` → single-page app on Vercel (`app/vercel.json`), added to the iPhone home screen via the PWA manifest in `app/public/` | No native builds, EAS, App Store or Android |
| Expo | SDK 57 (latest stable on 2026-10-10; 58 is canary) with the New Architecture on (default) | |
| Routing | Expo Router, routes in `app/src/app` (picked up by default, no config) | Avoids `app/app/` |
| Language | TypeScript strict, `"moduleResolution": "bundler"` | Same tsconfig base as `shared/` |
| Styling | `StyleSheet.create` + tokens from `app/src/theme/`; no CSS-in-JS runtime | Fidelity to the Beli screenshots matters more than a component library. If you later want NativeWind, add it in one PR and keep tokens as the source of truth |
| Server state | TanStack Query (`@tanstack/react-query`) with `BeviApi` methods as query/mutation functions | Keys in one file `app/src/api/keys.ts` |
| Client state | Zustand, two stores: `session` (auth + profile) and `rankingFlow` (wraps the `@bevi/ranking` state machine) | Nothing else global |
| Lists | `@shopify/flash-list` v2 | No `estimatedItemSize` in v2 |
| Images | `expo-image` (`cachePolicy="memory-disk"`, `recyclingKey={bev.id}`, `contentFit="contain"`) | |
| Camera/picker | `expo-image-picker` (on web: a file input with camera capture, so the iPhone offers camera or library) + `expo-image-manipulator` (resize to max 1600px, JPEG q0.85 before upload) | No `expo-camera` (decided 2026-10-11) |
| Animation | `react-native-reanimated` + `react-native-gesture-handler` | |
| Storage | `localStorage` (supabase-js's web default) behind a small `authStorage` adapter (`getItem/setItem/removeItem`) that the app passes to `createBeviApi({ url, publishableKey, authStorage })`; `@react-native-async-storage/async-storage` for the mock's persistence and per-device prefs | `packages/api` builds the Supabase client itself; the app never imports supabase-js |
| Tests | `jest-expo` + `@testing-library/react-native`; browser e2e (e.g. Playwright) against the web build in Phase 3 | Maestro is native-only |
| Builds | `expo export --platform web`, deployed by Vercel; no EAS, no dev client (decided 2026-10-11) | §7 |
| Native-only APIs | Each needs a web path or is dropped: `expo-glass-effect` → translucent fallback; `expo-haptics` → no-op on web; `expo-secure-store` → localStorage. Check every library on web as its component is built | |

### Folder layout

```
app/
  app.config.ts  vercel.json  public/  package.json  tsconfig.json  jest.config.js  CLAUDE.md
  src/
    app/                          expo-router routes (see navigation below)
    api/
      client.ts                   export const api: BeviApi = createBeviApi(...)   (Supabase only, since 2026-10-12)
      config.ts  authStorage.ts   env-var validation; localStorage session adapter
      keys.ts                     TanStack query keys
      hooks/                      useFeed(), useBev(id), useMyRankings(), useSubmitRanking() ...
    theme/                        tokens.ts  typography.ts  colors.ts  spacing.ts  index.ts
    components/                   Wordmark  ScoreBubble  BevImage  PriceTier  Avatar  Pill  FilterPill  SortToggle  BevRow
                                  FeedPost  StatCard  ProfileListRow  SegmentedTabs  ListScopeDropdown  FeaturedCard
                                  SearchBar  TabBar  EmptyState  ErrorState  Skeleton  Sheet
    features/
      ranking/                    GutCheck  CompareCard  PlacementProgress  RankResult  useRankingFlow (wraps @bevi/ranking)
      add-bev/                    SearchBevs  DidYouMean  CreateBevWizard  CameraCapture  LabelCapture  PriceTierPicker
      onboarding/                 ProfileSetup  AgeGate  StarterRanking
      profile/                    ProfileHeader  StatsRow  TilesRow  UserRankingsList
    lib/                          date (local day key), tz, format (score 1dp, counts), haptics (no-op on web), analytics (no-op v1)
    testing/fakeApi/              jest-only in-memory BeviApi + neutral fixture people (never bundled)
```

### Navigation (5 tabs + stacks)

```
src/app/
  _layout.tsx                      root: QueryClientProvider, session gate (signed-out → (auth), no profile → onboarding)
  (auth)/
    sign-in.tsx  sign-up.tsx
  onboarding/
    profile.tsx                    name, birthdate (age gate), timezone captured silently (handle = username from sign-up)
    starter.tsx                    starter-set ranking
  (tabs)/
    _layout.tsx                    5 tabs: feed | lists | add (center: filled circle with +, inline, not raised) | leaderboard | profile
    feed/index.tsx
    lists/index.tsx                ?tab=bevd|want|recommended  (deep-linkable from Profile rows)
    add/index.tsx                  search: Bevs | People tabs (Beli's Restaurants | Members)
    leaderboard/index.tsx          ?scope=bevs|users&category=<id>
    profile/index.tsx              own profile, ?tab=activity|taste
  bev/[id].tsx                     Bev detail
  user/[id]/index.tsx              other user's profile
  user/[id]/followers.tsx  user/[id]/following.tsx
  rank/[bevId].tsx                 full-screen modal: gut check → comparisons → note → result
  add/new.tsx                      create-new-Bev wizard (modal stack)
  settings/index.tsx  settings/account.tsx  settings/privacy.tsx  settings/delete-account.tsx
  image/[url].tsx                  full-screen image viewer (nutrition label)
```

Tab order and the centre "Add Bev" slot follow vision §6 ("replaces Beli's search slot"). Tabs keep their own stacks so Bev detail pushed from Feed doesn't lose the Feed scroll position.

### Auth and onboarding (screens yours, Supabase Auth config Arjun's)

- The app never imports `@supabase/supabase-js`. `packages/api` exports `createBeviApi({ url, publishableKey, authStorage })`, builds the Supabase client itself, and exposes the auth surface `signUp({ username, password, inviteCode })`, `signIn({ username, password })`, `getSession`, `onAuthChange`, `signOut`, `deleteAccount`, implemented by Arjun on Supabase and by you in the mock.
- **Sign-in is username + password (decided 2026-10-11; replaces the 2026-10-09 Google-only plan).** No OAuth, no magic link, no third-party services.
  - Flow: Supabase email/password auth; `packages/api` maps the username to a synthetic email (`<username>@users.bevi.app` or similar), internal only and never shown. "Confirm email" is off, so no SMTP and no emails at all.
  - The username becomes the profile handle at sign-up, so handle rules apply on the sign-up form (lowercase, 3–20 chars, validated, reserved list, availability check).
  - Sign-up needs the shared invite code; where it is checked (sign-up RPC, auth hook) is Arjun's call.
  - No password-reset email: an admin resets a password from the Supabase dashboard.
  - Session persists in `localStorage` through the `authStorage` adapter.
- Session gate in the root layout: `signedOut → (auth)`; `signedIn && !profile.onboarded → onboarding`; else tabs. The gate reads one query, `api.profile.getMe()`.
- Onboarding step 1 collects: display name, birthdate (set once via `api.profile.setBirthDate`, §6.17), and silently `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Onboarding step 2 is the starter ranking (§6.3). Minimum 3 ranked to continue; "I haven't had this" skips an item.

### The mock API and when to swap

- `app/src/api/mock.ts` implements every `BeviApi` method against an in-memory copy of `shared/fixtures/` (Arjun's `bevs.sample.json` plus the users, rankings, follows and featured fixtures you generate with `@bevi/ranking`, §13). It runs `@bevi/ranking` for real: `submitRanking` checks `expectedBucketSize`, inserts at `insertIndex`, re-spaces the bucket with `respaceBucket()`, recomputes per-Bev stats, and `getRecommendations` calls `recommend()` on a snapshot built from the mock state. So the UI against the mock behaves like production, including `conflict` errors.
- Latency 200–600 ms (uniform) so loading states are real; dev panel toggles: `failNext(method)`, `latency`, `resetToFixtures()`, `emptyUser()` (first-run states).
- Swap: `EXPO_PUBLIC_BEVI_API=mock|supabase` read in `client.ts`. Default `mock` until Arjun's `packages/api` passes its own contract tests, then default `supabase` with `mock` kept for Storybook-style work and offline demos.
- **Done 2026-10-12 (superseded the above):** the app runs on `packages/api` only; there is no switch. The mock became `app/src/testing/fakeApi/`, a jest-only test double (`jest.setup.js` swaps `@/api/client` for it) with neutral fixture people; `scripts/check-bundle.mjs` fails a build that contains it.
- Rule copied from Bev Maps: TypeScript keeps both honest. If a screen needs something the interface lacks, propose a `contract/*` change, never a workaround.

### Data-fetching rules

- All reads through TanStack Query hooks in `app/src/api/hooks/`. Mutations: `submitRanking`, `rerankBev`, `removeRanking`, `follow/unfollow`, `addWantToTry/removeWantToTry`, `createBev`, `uploadImage`, `updateMe`, `setBirthDate`. Optimistic updates only for follow and want-to-try (cheap to roll back). After `submitRanking` invalidate: my rankings, the Bev, my stats, feed, leaderboard, recommendations.
- Cursor pagination everywhere a list can exceed 50 rows (feed, Bev'd, leaderboard, followers, user rankings): `{ cursor?: string; limit: number } → { items, nextCursor }`.

---

## 4. Design system before screens

Build this in week 1, before any screen, so Sonnet agents produce consistent screens.

### Tokens (`app/src/theme/tokens.ts`, mirrored in `design/brand/tokens.md`)

Values below come from the Beli spec's Part 2 table and from measuring the screenshots (1179×2556 px = 393×852 pt, scale 3; px ÷ 3 = pt). Beli's own brand colour (`#154F5C` teal) is the one thing not to copy; everything structural is fair game.

| Group | Values |
|---|---|
| Spacing | 4pt grid: `xs 4, sm 8, md 12, lg 16, xl 20, xxl 24`; screen gutter 16 (Beli uses 16–20; lists use 16) |
| Radius | `input 12` (search bar), `card 16`, `photo 14`, `pill 999`, `button 8` (outlined profile buttons), `stat 20` (profile stat cards) |
| Type | System font (SF Pro / Roboto); serif only in Beli's wordmark, ours is decided separately. Scale measured from the screenshots: `displayDrop 28 bold` ("All ⌄" list selector), `screenTitle 20 bold` (profile name, "You ranked X", row names), `tabLabel 20 semibold` (Been/Want to Try/Recs), `heading 17 semibold` (stat numbers, sort toggle, score text), `body 15` (meta lines, "Member since", pill labels), `sectionCaps 15 bold tracking 0.5` ("FEATURED LISTS", "MY LISTS"), `caption 13` ("2 likes"), `tabBar 10` (tab labels, active bold). `maxFontSizeMultiplier` 1.3 on dense rows |
| Colour, neutral | `text #111111`, `textSecondary #8A8A8E`, `border #E3E3E6`, `surface #FFFFFF`, `input #EDEDED` (grey search/composer pills), `avatarFill #EEF0F3`; dark set derived in week 1 |
| Colour, brand | `primary` = **not** `#154F5C`. Used exactly where Beli uses its teal: filled pills, primary buttons, active tab underline, saved-bookmark fill, count badges, "Rank"/"Streak" values. Pick in week 1 from two candidates, record in `design/brand/colors.md`. `primaryTint` (active filter pill background, Beli `#E8EEF2`-style) derived from it |
| Colour, score | `scoreHigh #2E9E5B`, `scoreMid #E8B423`, `scoreLow #D9534F`. Thresholds ≥ 7.0 / 4.0–6.9 / < 4.0, which are also our band edges (§8.1), so a bucket's colour and a score's colour always agree. The design system's darkened hexes supersede these |
| Colour, misc | `badgeRed #E05A55` (notification count, not v1), `tasteCard #332E80` (Taste Profile share card, Phase 3) |
| Elevation | None on cards; Beli uses 1pt `border` outlines, not shadows. Only the floating pill button ("View Map" in Beli) has a shadow; we have no floating button in v1 |
| Motion | `fast 150ms`, `base 250ms`, `springy` (Reanimated spring damping 18 stiffness 180); honoured `reduceMotion` |

### Core components (built with a `ComponentGallery` dev screen showing every state)

| Component | Spec (measurements from the screenshots) |
|---|---|
| `Wordmark` | SVG, lowercase "bevi" is fine, but **not** a serif in teal (that is Beli's mark). The conversation said "make it look like Beli with a v"; we **diverge**: original letterforms in a different family (rounded sans or slab), same clean playful spirit, no copied glyphs. Rendered 28pt tall at the header's left, 16pt gutter. Assets: `design/brand/wordmark.svg`, `wordmark-dark.svg`, `app-icon-1024.png`, `splash.png`. Two candidate directions from a Sonnet (Medium–High) agent, you pick one |
| `ScoreBubble` | Beli's score mark, used everywhere: white circle, 2pt `border` ring, score in bold coloured 17pt text (colour by bucket). Sizes 40 (rows, feed) and 56 (Bev detail). Optional `count` renders a 24pt `primary` badge with white 11pt text at bottom-right ("362", "5k"). Variants: `predicted` = dotted ring + "~" prefix; `locked` = grey lock icon, no number (Beli shows a lock where a score is hidden; we use it when prediction confidence < 0.25) |
| `BevImage` | Square tile, sizes 40/56/96/155, transparent-PNG cutout centred with 8% padding on a soft tint of `input`, radius `photo 14`; `contentFit="contain"`; blurhash/skeleton placeholder; `status="processing"` shows a shimmer over the raw photo while background removal runs. 155 is the Beli photo-strip tile size |
| `PriceTier` | Inline text "$$" in 15pt `text`, shown on Bev detail, the gut-check card and featured cards, never on rows or posts (D-06, 2026-10-18); `estimated` adds "~" and `accessibilityLabel="about $$, estimated"`. No glyph greying: Beli prints only the active count |
| `Avatar` | Circle, `avatarFill` with 1pt `border`, initials in `textSecondary` (two letters). Sizes 32 (tab bar), 44 (composer), 60 (feed/activity posts), 100 (profile hero, initials 40pt light) |
| `Pill` | Filled (`primary`, white 15pt text, leading icon, 30pt tall) and outlined (`border`, 30pt tall) variants, radius 999, horizontal padding 16 |
| `FilterPill` / `SortToggle` | Outlined pill with optional count badge (filter icon + "3" tinted `primaryTint` when active); sort toggle is a text button "↓↑ Score" in `primary` 17pt with a search icon right-aligned |
| `BevRow` | Beli list row, ~126pt tall: line 1 name 20pt bold (optionally "1. " numbered), line 2 category icon + "Category · Brand" 15pt (no price, D-06), bottom-left meta 15pt `textSecondary` (we show "Ranked Oct 3", not distance/hours), bottom-right action icons 28pt (plus-circle = Rank it, bookmark = Want to Try, filled `primary` when saved), `ScoreBubble 40` top-right. 1pt divider |
| `FeedPost` | Avatar 60 left; "**Arjun** Bev'd **Diet Coke**" 20pt (names bold, verb regular), meta line category icon + brand 15pt `textSecondary` (no price, D-06); `ScoreBubble 40` top-right; photo strip of 155pt square `BevImage`s (one tile for a Bev, more only if a ranking has user photos later), 8pt gaps, horizontal scroll; "**Notes:** …" 17pt with "…See more" at 4 lines; action row 28pt icons (bookmark + plus-circle on the right; heart/comment/send are Beli's and not in v1); timestamp 15pt `textSecondary` ("5 hours ago", "Wednesday"); 1pt divider. Variant `bookmarked`: "Arjun saved **Diet Coke**", no photo, no score |
| `StatCard` | Beli profile stat card: 181×84pt, radius 20, 1pt `border`, 24pt `primary` icon left, label 17pt `textSecondary` semibold over value 20pt bold `primary`. Two per row with 10pt gutter/gap |
| `ProfileListRow` | 44pt row: 24pt icon at 20pt from the left, label 20pt semibold at 67pt, right-aligned count 20pt, chevron 20pt; 1pt divider. Rows: Bev'd / Want to Try / Recommended for you |
| `SegmentedTabs` | Two styles: `underline-text` (Lists: 20pt semibold text tabs, 3pt black underline under the active one, horizontally scrollable) and `underline-icon` (Profile Activity/Taste Profile and Search Bevs/People: icon + 17pt label, equal widths, 3pt underline in `primary` on Search, black on Profile) |
| `ListScopeDropdown` | Beli's "All ⌄": 28pt bold text + chevron, opens a sheet to scope the list (All Bevs / one category) |
| `FeaturedCard` | 164×164pt photo card, radius 14, bottom dark gradient, title 20pt bold white, subtitle 15pt white ("You've had 1 of 10"); horizontal carousel, 16pt gap, under a `sectionCaps` header with "See all" in `primary` |
| `SearchBar` | Grey `input` field, 36pt tall, radius 12, leading search icon, placeholder 17pt `textSecondary` |
| `TabBar` | Icons 28pt outline, labels 10pt (active bold, black); centre tab is a 32pt `primary` filled circle with a white "+" sitting inline (not raised) with label "Add Bev"; Profile tab icon is `Avatar 32` with initials |
| `EmptyState`, `ErrorState` (with Retry), `Skeleton` | Every list screen uses these; no bare spinners except inside buttons |
| `Sheet` | bottom-sheet wrapper with handle, snap points 40/90% |

### Bev photo treatment (your review of Arjun's catalog, §12 seam note)

Acceptance for a catalog image: PNG with alpha, product fills 70–90% of the longest side, no shadow baked in, no text overlays, min 600px; user-added photos get the same look after Arjun's background removal. You write `design/photo-style.md` (10 lines + 3 good/3 bad examples) in week 1 so Arjun's Haiku seeding agents have a checklist.

---

## 5. From Beli screenshots to per-screen specs

The reference material is in the repo now and stays where it is: `bevi-ui-inspiration/beli-screens-spec.md` (the written spec: 12 screen descriptions, Part 2 tokens, Part 3 data model) and `bevi-ui-inspiration/beli-ui-images/IMG_1107.PNG … IMG_1118.PNG` (iPhone, 1179×2556 px, scale 3). Don't move or rename them. `design/` holds what you produce from them: `design/specs/<screen>.md`, `design/brand/`, `design/photo-style.md`.

File-to-spec mapping (the spec numbers screens 01–12; the files are in a different order):

| Spec screen | File | Bevi screen |
|---|---|---|
| 01 Home (new-user) | `IMG_1107` | 6.4 Feed (empty state + Featured) |
| 02 Profile top | `IMG_1108` | 6.13 Profile |
| 03 Profile › Activity (Angel) | `IMG_1109` | 6.13 Activity tab, `FeedPost` with photo strip + notes |
| 04 Activity (ZiZi + bookmark) | `IMG_1110` | `FeedPost` ranked + bookmarked variants |
| 05 / 11 Lists › Recs | `IMG_1113`, `IMG_1117` (duplicate) | 6.7 Recommended |
| 06 Lists › Been | `IMG_1114` | 6.5 Bev'd |
| 07 Lists › Want to Try | `IMG_1115` | 6.6 Want to Try |
| 08 Search | `IMG_1116` | 6.8 Add Bev (Bevs | People tabs) |
| 09 Activity (bookmarks + Wan Waan) | `IMG_1111` | `FeedPost` variants, Activity tab |
| 10 Profile › Taste Profile | `IMG_1112` | 6.20 Taste Profile (Phase 3) |
| 12 Feed (with friends) | `IMG_1118` | 6.4 Feed |

No screenshot exists for: the ranking flow (gut check, comparisons), Bev detail, Leaderboard, Followers/Following, Settings, Sign-in, Onboarding. Those screens are specified from the vision and this doc only; their look is derived from the components in §4.

Process:

1. For each screen, a Sonnet (Medium) agent reads the matching image(s), the spec entry and the §6 entry, and writes `design/specs/<screen>.md`: ASCII region diagram with pt values (px ÷ 3), components from §4, measured type sizes and paddings, interactions, and a "Bevi differences" list (what is dropped, renamed or added because this is drinks with no location).
2. You review the spec against the image; the spec, not the image, is what the `ui-screen` agent builds from.
3. Measurements are inputs, tokens are outputs: snap every measured value to the nearest token and note the snap.
4. After each screen is built, screenshot it in the simulator next to the reference and fix spacing/colour before moving on (the spec's Part 4 instruction; keep it).

What in the reference is a bad fit for Bevi and is dropped: everything location/venue driven (Reserve now, Order, Open now, distance, hours, "View Map", the party/date/time bar, "Recs Nearby", City filter, "Current Location"); the invite-unlock card (0/5 friends unlock features); Guides tab and guides lists; "Add School"; the "Import a list" card; notifications bell + calendar icons (no notifications in v1); share on posts (not in vision; see §18; likes and comments were added later, TASKS.md decisions 2–3, M-02, M-03); "with Rhea" co-visit tagging and "2 visits" repeat counts (a Bev is ranked once; re-rank replaces).

What the reference adds that the vision lacks and we adopt: the Profile is rows + stat cards, not tiles (§6.13); Bev'd is one numbered list sorted by score, not bucket sections (§6.5); search has a People tab (§6.8); the "locked" score state (§4 `ScoreBubble locked`); the Activity feed on the Profile is the same `FeedPost` as the Feed tab; the Taste Profile tab and calendar grid are a natural fit for our per-category stats and streaks (§6.20, Phase 3); a yearly goal card ("You've tried 60 spots in 2026") is cheap gamification for Phase 3.

---

## 6. Screen inventory

Common to every screen unless noted: loading = skeleton of the final layout; error = `ErrorState` with Retry and the message from `BeviApi` errors (`{ code, message, detail? }`, codes in §13); offline = top banner; pull-to-refresh on lists. Data is expressed in `BeviApi` terms (§13 has the method list). Header pattern (from the screenshots): 44pt row under the status bar, title left in 20pt bold (or the wordmark), 28pt icons right-aligned with 20pt spacing; list screens use a centred `sectionCaps` title ("MY LISTS" → "YOUR LISTS").

### 6.1 Sign in / sign up (`(auth)/sign-in.tsx`, `(auth)/sign-up.tsx`) — username + password (decided 2026-10-11)

- Purpose: get a session. Contents: wordmark centred in the top third, one-line tagline ("Rank every drink you've ever had"); sign in = username + password + "Sign in" `Pill filled`, link to sign up; sign up = username (`@`, lowercase, 3–20 chars, availability check debounced 400ms), password, invite code, "Create account"; 13pt legal line linking to the privacy policy.
- Data: `api.signIn({ username, password })`, `api.signUp({ username, password, inviteCode })`, `profile.checkHandle(username)`; `api.onAuthChange` drives the root gate.
- States: idle; submitting (button spinner, disabled); wrong username or password (`unauthorized`) → inline message; username taken / invalid; invite code wrong (`validation` from the server) → field error; `network` → inline message + retry; already signed in → gate skips this screen.
- Forgot password: copy says "Ask an admin to reset it"; no reset email. Not in v1: OAuth, magic links, any email.

### 6.2 Onboarding: profile + age gate (`onboarding/profile.tsx`)

- Contents: display name (prefilled from the username), birthdate (date picker) with the line "Set once. Used only to show 21+ categories. Can't be changed later without contacting us."; `Avatar 100` preview with initials.
- Data: `profile.updateMe({ displayName, timezone })`, `profile.setBirthDate(date)` (one call, one time; the server rejects a second call, only an admin can change it, Arjun's rule).
- States: birthdate missing blocks Continue; under-21 is allowed and just sets `profile.canSeeAlcohol = false`.

### 6.3 Onboarding: starter ranking (`onboarding/starter.tsx`)

- Purpose: cold-start baseline (vision §5). Contents: progress "3 of 10", `BevImage 155`, name, "Have you had this?" → Yes / No; Yes opens the ranking flow (§6.9) inline; No skips.
- Data: `bevs.getStarterCandidates()` returns at least 30 age-filtered `isStarter` Bevs, each with `ratingCount`; the app runs `selectStarterSet(candidates, { seed: userId })` from `@bevi/ranking` to pick 10 (§8.12). Then `rankings.submitRanking` per item and `profile.updateMe({ onboarded: true })`.
- States: first Bev (empty bucket, no comparisons: "Placed. Keep going."), finished summary ("You ranked 6 Bevs. Your top: Coke 8.3"), fewer than 3 ranked → "Rank at least 3 so we can learn your taste", candidates call fails → Retry (onboarding can't be skipped past this without ≥ 3).
- Interactions: skip-all link after ≥ 3 ranked. The set is deterministic for the user, so leaving and coming back shows the same 10.

### 6.4 Feed tab (ref 01, 12)

- Contents, top to bottom: header (wordmark left, 28pt; right: a "find people" icon that opens 6.8 on the People tab; no bell/calendar); `SearchBar` ("Search a Bev or a person") that focuses the Add tab's search; **Featured Bevs** under a `sectionCaps` header "FEATURED BEVS" + "See all": `FeaturedCard` carousel ("You've had 1 of 10" subtitle works for featured *lists*; for a single featured Bev the subtitle is its category + `$`); then "YOUR FEED" `sectionCaps` and `FeedPost`s of followed users' rankings and saves, newest first.
- Data: `feed.getFeatured()`, `feed.getFeed({ cursor, limit: 20 })`, `wantToTry.add/remove`.
- States: following nobody → `EmptyState` under YOUR FEED: "Follow friends to see their Bevs" + "Find people" `Pill` (Featured stays visible, as in ref 01); no activity yet; paginating footer.
- Interactions: tap post body → Bev detail; tap avatar/name → user profile; bookmark → Want to Try (optimistic, fills `primary`); plus-circle → ranking flow.
- Dropped from the reference: quick-action pills row, composer "Ask your friends for recs", invite card, likes/comments (likes and comments were added later: TASKS.md M-02, M-03).

### 6.5 Your Lists tab: Bev'd (ref 06)

- Contents: header "YOUR LISTS" centred, share icon (Phase 3) right; `ListScopeDropdown` "All ⌄" (All Bevs / one category); `SegmentedTabs underline-text` Bev'd · Want to Try · Recommended; filter row: `FilterPill` with count (opens a sheet: bucket, price tier, category), then `SortToggle` "↓↑ Score" (toggles Score / Recent / Name) with a search icon that reveals an inline search field. Rows: `BevRow` numbered "1. Diet Coke", line 2 category icon + "Diet soda · Coca-Cola", bottom-left "Ranked Oct 3", `ScoreBubble 40` coloured by bucket. One list sorted by score, as in the reference; buckets show through colour, not sections.
- Data: `rankings.listMine({ bucket?, categoryId?, sort, cursor })` ordered by `(bucket desc, position)`; the numbering is the global index across buckets.
- States: nothing ranked → "Add your first Bev" CTA to the Add tab; filter yields nothing; a Bev whose photo is still processing shows the shimmer tile.
- Interactions: tap → Bev detail; long-press/swipe → sheet: Re-rank (6.9 via `rerankBev`), Edit note, Remove (confirm; explains other scores in that bucket shift).

### 6.6 Your Lists: Want to Try (ref 07)

- Contents: same chrome; rows are `BevRow` without numbering, `ScoreBubble 40` showing the **global** Bayesian score with the rating-count badge (as Beli shows 7.3 with "5k"), bookmark filled `primary`, plus-circle = Rank it, bottom-left "Saved from @arjun" when saved via the feed.
- Data: `wantToTry.list({ cursor })`, `wantToTry.remove`, deep link into the ranking flow.
- States: empty → "Bookmark Bevs from the Feed, Leaderboard or a friend's profile". The "Import a list" card from the reference is dropped.
- Interactions: tap bookmark to unsave (confirm if the list is short); ranking it removes it from Want to Try automatically (server side; UI invalidates).

### 6.7 Your Lists: Recommended (ref 05)

- Contents: same chrome; `FilterPill` count defaults to 1 ("Not tried"); sort default "↓↑ Predicted". Rows: `BevRow` with `ScoreBubble 40 variant="predicted"` (dotted ring, "~8.2") and the rating-count badge, one-line reason in the bottom-left meta slot ("You love Diet sodas" / "People who rank like you" / "Something different" for exploration), bookmark + plus-circle actions. Header line under the tabs: "Based on N Bevs you've ranked · Updated 2h ago".
- Data: `recs.getRecommendations({ limit: 20 })` → items with `predictedScore`, `confidence`, `reason`, `isExploration`, `generatedAt`.
- States: < 3 rankings → "Rank 3 Bevs to unlock recommendations" with progress; confidence < 0.25 → `ScoreBubble locked` instead of a number; stale (> 24h) → still shown, "Refreshing" when `recs.refresh()` exists.
- Interactions: tap → detail; bookmark → Want to Try; "Not interested" is Phase 3 (§17).

### 6.8 Add Bev tab: search (ref 08)

- Contents: header with wordmark left and a grey 32pt ✕ circle right (closes to the previous tab); `SegmentedTabs underline-icon` **Bevs** (bottle icon) · **People** (people icon), half width each, `primary` underline; outlined 48pt search input ("Search a Bev, brand or flavor" / "Search by name or @handle"); a camera `Pill` row ("Snap it") replaces Beli's Reserve/Order/Recs pills; **Recents** list (clock icon, name, brand/category, ✕ to forget) when idle; results as `BevRow` (score bubble = global score + count, actions: plus-circle, bookmark); sticky footer "Can't find it? Add a new Bev".
- People tab: results rows `Avatar 44`, name, @handle, Follow/Following `Pill`; idle shows "Suggested" (users with the most rankings you don't follow). This is the Find-people screen; there is no separate route.
- Data: `bevs.search({ q, categoryId?, limit: 25 })` debounced 250ms, age-filtered server-side; `profile.searchUsers({ q, limit: 25 })`, `follows.suggested()`, `follows.follow/unfollow`.
- States: idle (recents + "Popular this week"), searching, no results (footer becomes primary), error.
- Interactions: tap a Bev result → if already ranked by you → detail with "Re-rank"; else straight into the ranking flow (vision §3 step 2). Camera → `CameraCapture` → the create wizard, prefilled with the photo (no image recognition in v1, §17).

### 6.9 Ranking flow (`rank/[bevId]`), full-screen modal (no reference screenshot)

- Step 1 Gut check: `BevImage 155`, name, brand, three full-width 52pt buttons: Loved it / It was fine / Didn't like it, each tinted with its score colour at 12% with a coloured left bar.
- Step 2 Compare: two stacked cards (new Bev on top, incumbent below; each `BevImage 96` left, name 20pt bold, brand 15pt), prompt "Which was better?", tap a card; secondary row: "Too close to call" (outlined `Pill`) and Undo (text); progress dots = `maxComparisons(n)`; card swap animates 250ms; prefetch both possible next candidates after each answer.
- Step 3 Note: optional 140-char note ("Tastes like flat Sprite"), Skip.
- Step 4 Result: `ScoreBubble 56` animates in, "#4 of 31 in Loved · 8.9", Done. Every ranking is a feed item; no separate share step.
- Data: `rankings.listMine({ bucket })` once at start (ordered ids; `expectedBucketSize = ids.length`), then `@bevi/ranking` runs locally; finish → `rankings.submitRanking({ bevId, bucket, insertIndex, expectedBucketSize, comparisons, note })` → `{ ranking, bucketSize }`. Every comparison is sent, as `{ winnerBevId, loserBevId, tie }`. `insertIndex` 0 = best.
- Re-rank: the same screen entered with `mode: 'rerank'`; the existing Bev is removed from the list before placement, the bucket can change, and the call is `rankings.rerankBev({ bevId, bucket, insertIndex, expectedBucketSize, comparisons, note? })`.
- States: empty bucket → straight to Step 3 ("First one in Loved"); submit returns `conflict` (the bucket changed on the server since the list was fetched, e.g. from another device) → toast "Your list changed, let's redo this one", refetch, restart placement; `validation` (index out of range: a client bug) → log and restart; `network` → keep the local result and Retry; closing mid-flow asks to discard.
- Interactions: Undo pops one comparison.

### 6.10 Create new Bev wizard (`add/new`)

- Step 1 Photo: `CameraCapture` = `expo-image-picker` (on web the iPhone offers camera or photo library; hint "fill the frame, plain background helps"); preview; retake.
- Step 2 Details: name, flavor, brand/shop, category picker (sheet listing `categories.list()`, which is already age-filtered), price tier picker (four tappable `$` cells, plus "Not sure, estimate it" which sends `priceTier: null, priceEstimated: true` and lets the server estimate from the category).
- Step 3 Did you mean…: triggered on leaving Step 2 (and live after 3 typed chars in name): `bevs.findLikelyDuplicates({ name, brand, flavor, categoryId })` → up to 5 `BevRow`s with "This is it" (jumps to ranking that Bev) vs "No, mine is different".
- Step 4 Nutrition label (optional): capture or skip.
- Submit: `media.upload({ kind: 'bev-photo', uri, mimeType })` → `{ assetId, url, status: 'processing' | 'ready' }`; `media.upload({ kind: 'label' })`; `bevs.create({ name, flavor, brand, categoryId, priceTier, priceEstimated, photoAssetId, labelAssetId })` → Bev; then the ranking flow immediately. `BevImage` shows the raw photo with the processing shimmer until `bevs.get(id).photoStatus === 'ready'` (poll 3s, max 60s, then show the raw photo silently).
- States: upload failure (retry keeps the form), duplicate chosen, picker cancelled (stay on the step), offline (block submit), `validation` from the server (field errors from `detail`).

### 6.11 Bev detail (`bev/[id]`) (no reference screenshot)

- Contents: `BevImage 155` hero centred, name 20pt bold, brand/flavor 15pt, category icon + name, `PriceTier`; two `StatCard`s: "Bevi score" (`ScoreBubble 56` global Bayesian + "N ratings") and "You'd rate it" (`ScoreBubble 56 predicted`, or `locked` with "Rank 3 Bevs to see your prediction", or your actual score + "#4 in Loved" if you ranked it); "Friends who've had it" avatar stack (`Avatar 32`) with their scores; buttons: Rank it (or Re-rank) `Pill filled` and Want to Try `Pill outlined` (filled when saved); nutrition label thumbnail → full-screen viewer; "Added by @handle" footer for user-created Bevs; "•••" → Report sheet → `bevs.report`.
- Data: `bevs.get(id)` returning global stats, `myRanking?`, `prediction?`, `friends[]`, `photoStatus`.
- States: no ratings yet ("Be the first"), `not_found`, `age_restricted` (deep link to an alcoholic Bev when `!canSeeAlcohol`) → neutral "Not available" screen.

### 6.12 Leaderboard tab (no reference screenshot; Beli's own leaderboard was not captured)

- Contents: header "LEADERBOARD" centred; `SegmentedTabs underline-text` Bevs · People; `ListScopeDropdown` "All ⌄" for category on the Bevs tab. Bevs rows: `BevRow` numbered by rank, `ScoreBubble 40` = Bayesian score with the rating-count badge, your own score as a small secondary bubble if you ranked it. People rows: rank number, `Avatar 44`, name/@handle, points, "N Bevs", flame + streak; your own row pinned at the bottom if off-screen.
- Data: `leaderboard.bevs({ categoryId?, cursor, limit: 50 })`, `leaderboard.users({ cursor })`.
- States: category with no Bev at `MIN_RATERS` (= 2) → "Not enough rankings yet"; Phase 3 adds a "This month" toggle.
- Interactions: tap → Bev detail / user profile; dropdown choice persists per session.

### 6.13 Profile tab (own): pixel spec from ref 02, 03, 04, 09

All values in pt on the 393-wide reference (px ÷ 3). The reference uses list rows + two stat cards where vision §6 says "three tappable tiles"; the rows are what we build (§18 item 12).

```
y   0   status bar (59 on Dynamic Island phones; use safe-area insets)
   59   ┌─────────────────────────────────────────────┐
        │ Matt Willer                     [share] [≡] │  44pt row; name 20pt bold at x16; icons 28pt at
  103   │                                             │  x≈305 and x≈343 (gear replaces ≡; share is Phase 3)
  104   │                 ( MW )                      │  Avatar 100, centred (x 146–246), y 104–204,
        │                                             │  avatarFill + 1pt border, initials 40pt light
  224   │                @mbwiller                    │  17pt bold, centred, baseline ≈ y 229
  246   │           Member since Oct 2026             │  15pt textSecondary
  280   │     7            9           #12            │  numbers 17pt semibold, columns centred at
  300   │  Followers    Following   Rank on Bevi      │  x 91 / 196 / 301; labels 15pt textSecondary
  341   │   [ Edit profile ] [ Share profile ] [▼]    │  36pt outlined buttons, radius 8: 120 / 120 / 34 wide,
        │                                             │  4pt gaps, centred; ▼ opens the settings sheet
  392   │ ⊙  Bev'd                          42   ›   │  ProfileListRow 44: icon 24 at x20, label 20pt
  436   │ ▮  Want to Try                     7   ›   │  semibold at x67, count 20pt right-aligned at x353,
  480   │ ♥  Recommended for you                 ›   │  chevron at x374; 1pt dividers
  543   │ ┌──────────────────┐ ┌──────────────────┐   │  StatCards 181×84, radius 20, at x10 and x202,
        │ │🏆 Rank on Bevi   │ │🔥 Current Streak │   │  y 543–627; icon 24 primary; label 17pt
  627   │ │   #12            │ │   4 days         │   │  textSecondary semibold; value 20pt bold primary
  641   │ [goal card: Phase 3]                        │
  ~660  │ ▤ Activity        ▥ Taste Profile          │  SegmentedTabs underline-icon, 17pt, equal halves,
        │ ━━━━━━━━━━━━━━━━━━                          │  3pt black underline (Guides tab dropped)
        │ (MW)  You Bev'd Diet Coke            (9.3)  │  FeedPost: Avatar 60 at x16, text at x100,
        │       🥤 • Coca-Cola • $                     │  ScoreBubble 40 at x333
        │       [155 BevImage]                        │
        │       Notes: … See more                     │
        │       [bookmark] [plus]        Wednesday    │
        │ …                                           │
        └─────────────────────────────────────────────┘
```

- Order honoured from vision §6: name top-left, avatar top-centre with handle, follower/following counts, Rank on Bevi, Streak, the three links (Recommended is the one that matters: it gets the heart icon and is always visible even at 0 ranked), scrollable rankings feed, settings via the corner menu.
- Data: `profile.getMe()`, `stats.getMine()` → `{ followers, following, rankOnBevi, rankPoints, currentStreak, longestStreak, streakAliveToday, bevdCount, wantToTryCount }`, `rankings.listUser(me, { cursor })` rendered as `FeedPost`s ("**You** Bev'd **Diet Coke**").
- States: brand-new user (0 everywhere; streak card says "Rank today to start"; rank card "Unranked" until ≥ 1 ranked); Activity empty → "Your rankings will show up here".
- Interactions: the three rows deep-link to `lists?tab=bevd|want|recommended`; Followers/Following numbers → 6.15; ▼ / gear → settings; Edit profile → 6.19; Share profile is Phase 3 (needs a web profile page).
- Polish task is Sonnet Medium–High (vision §10 "UI polish (profile page…)"), DoD: within 2pt of this spec and `design/specs/profile.md`.

### 6.14 Other user's profile (`user/[id]`)

- Same layout; the button row becomes [ Follow / Following ] [ Share profile ] with no ▼; the Recommended row is omitted (private); Bev'd and Want to Try rows open read-only lists of theirs; Activity tab shows their rankings.
- Data: `profile.getUser(id)`, `stats.getUser(id)`, `follows.follow/unfollow` (optimistic), `rankings.listUser(id)`.
- States: `not_found`; blocked/private is not a v1 concept.

### 6.15 Followers / Following lists

- Rows: `Avatar 44`, name, @handle, Follow/Following `Pill`; search within list.
- Data: `follows.listFollowers(userId, { cursor })`, `follows.listFollowing(userId, { cursor })`.
- States: empty.

### 6.16 Find people

Merged into the Add tab's **People** tab (§6.8), matching the reference's Restaurants | Members search. Feed empty state and the Feed header icon both deep-link to `add?tab=people`.

### 6.17 Age gate for alcoholic categories

- Birthdate is captured once in onboarding (§6.2) through `profile.setBirthDate`; it is not editable in the app. Settings shows it read-only with "Contact us to correct it" (admin-only change, Arjun's rule).
- `profile.canSeeAlcohol = age ≥ 21` is computed server-side (Arjun; RLS/view filtering) and mirrored in the client for UI hiding: category pickers, the list-scope dropdown, search, leaderboard categories, featured carousel and recommendations hide the three alcoholic categories (`beer`, `wine`, `spirits_cocktails`, all `isAlcoholic`) when false. Feed posts about alcoholic Bevs from friends still render but with no plus-circle (seeing a friend's beer is fine; ranking it isn't). Any direct fetch returns `age_restricted`, which maps to the neutral "Not available" screen.
- A profile with no birthdate cannot get past onboarding, so the under-21 default never applies to a real session.

### 6.18 Settings, privacy, account deletion

- Opened from the profile ▼ / gear as a sheet, then full screens: Account (username = handle, display name, birthdate read-only, timezone override), Privacy (link to the policy screen; "Location: never collected"), About (version, licences), Sign out, Delete account.
- Privacy policy: static markdown bundled in the app (`app/assets/privacy.md`), shown at `settings/privacy` (a plain URL now that the app is on the web). The conversation's "we don't need no damn privacy page" is overridden (§17).
- Delete account: kept although no app store requires it now (friends should be able to leave). Screen explains what is deleted (rankings, comparisons, follows, Want to Try, profile; Bevs you created stay with `createdBy = null`), type `DELETE`, calls `api.deleteAccount()`, then `signOut`.

### 6.19 Small screens and sheets

Edit profile (name, handle, avatar initials preview); Re-rank sheet (choose: change bucket → full placement, or keep bucket → placement within bucket; both end in `rerankBev`); Remove-ranking confirm; Category picker sheet; Filter sheet (bucket, price, category); Report Bev sheet; Full-screen image viewer; Not-found screen; Force-update/maintenance screen driven by `meta.getAppConfig()` (minimum version, maintenance flag).

### 6.20 Taste Profile tab and goal card (ref 10, 02) — Phase 3

- The reference's second profile tab maps cleanly onto data we already compute: an indigo share card ("LAST 30 DAYS · Top 34% Bevi drinker · 12 Bevs · 7 categories · More active than 66% of Bevi users"), then a monthly calendar card (‹ Oct 2026, "4 Bevs ranked · 3 categories") whose days carry the `BevImage 40` of a Bev ranked that day with a `primary` outline on today, which is the streak made visible. Below it: per-category averages from `user_category_stats` ("Your Soda average 7.2 · 9 ranked") as a simple bar list.
- Goal card ("Set your 2026 goal: you've ranked 42 Bevs so far. 80 / 100 / 150 / Customize") is optional Phase 3; needs a `profile.yearlyGoal` field (contract change).
- Data: `stats.getTasteProfile({ month })` (new method, Phase 3 contract PR): per-day ranked Bev ids, per-category stats, 30-day percentile.

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

### Builds and distribution to friends (web only, decided 2026-10-11)

- Build: `npx expo export --platform web` (from `app/`) → `app/dist/`; Vercel deploys it with `app/vercel.json` (project root directory `app`). Every merge to `main` deploys to production through Vercel's Git integration; other branches never deploy (`git.deploymentEnabled`: `main` on, `**` off; decided 2026-10-12, replacing manual-only deploys). `vercel deploy --prod` from the repo root still works. The build runs `scripts/check-env.mjs`, the export, then `scripts/check-bundle.mjs`.
- Install: friends open the URL in iPhone Safari → Share → Add to Home Screen; `app/public/manifest.json` and the icons make it open full-screen. No App Store, TestFlight, Apple Developer account, Android build or EAS.
- Dev: `npm start -w app -- --web` in a desktop browser, and the LAN/preview URL in iPhone Safari for real-device checks.
- Env: `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (see `app/.env.example`; `EXPO_PUBLIC_BEVI_API` is gone since 2026-10-12) are read in `client.ts` and passed to `createBeviApi({ url, publishableKey, authStorage })`. Arjun provides the Supabase values; they live in Vercel project env vars and `.env.local`, never committed. Service keys never exist in the app.

---

## 8. `packages/ranking`: the math

Everything here is pure: no `Date.now()`, no `Math.random()` (seeded PRNG passed in), no I/O. All constants live in `src/constants.ts` and are exported with the vectors so Arjun's SQL reads the same numbers.

### 8.1 Buckets and score bands

```
type Bucket = 'LOVED' | 'FINE' | 'DISLIKED'
BANDS = { DISLIKED: [0, 4], FINE: [4, 7], LOVED: [7, 10] }   // lo, hi; FINE and DISLIKED exclude hi
```

**Decided 2026-10-09 (closes vision §11's open question): Beli-style 7 / 4**, replacing the equal thirds this section first proposed. The edges are Beli's colour thresholds (≥ 7.0 green, 4.0–6.9 amber, < 4.0 red), so a bucket's colour and a score's colour always agree, and "a 7 is good" reads naturally. The unequal widths (Didn't like is 4 wide) don't bias the maths, because z-scores are per user. Integer edges also let stored scores be computed exactly (§8.2). Scores are stored to 2 dp and displayed to 1 dp.

### 8.2 Score from position

Within a bucket of `n` Bevs after insertion, index `i` (0 = best):

```
score(i, n, bucket) = hi − (hi − lo) · (i + 1) / (n + 1)
```

- `n = 1` → the band midpoint (Loved alone = 8.50; Fine alone = 5.50; Disliked alone = 2.00).
- Scores are strictly inside the open band, so bucket order is always preserved globally.
- Loved, `n = 3` → 9.25, 8.50, 7.75. Loved, `n = 50`, top → 9.94.
- Stored value, in exact integer arithmetic so JS and SQL agree on every half cent (rounding a double near x.xx5 can differ between them): `D = n + 1`, `N = 100·(hi·D − (hi − lo)·(i + 1))`, `cents = floor((2N + D) / (2D))` (round half up), capped at `hi·100 − 1` for FINE and DISLIKED (the cap only bites for buckets of 599+ / 799+ Bevs). Stored score = `cents / 100`, `numeric(4,2)`. SQL twin: `least((200*(hi*(n+1) - w*(i+1)) + (n+1)) / (2*(n+1)), max_cents)` with integer division. Examples: Loved `n = 7`, top = 9.625 → 9.63; Loved `n = 39`, top = 9.925 → 9.93. The vectors include these half-cent cases instead of excluding them.
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

Re-ranking an existing Bev: the UI removes it from `orderedIds` before `start` (the state machine also filters defensively), chooses the bucket again (may change), runs placement, and calls `rerankBev({ bevId, bucket, insertIndex, expectedBucketSize, comparisons, note? })`, its own method with the same shape as `submitRanking`. Server: delete old row, insert new, re-space the old bucket (if different) and the new bucket, append the new comparisons (old comparisons are kept; they're still true observations).

Stale list guard: both `submitRanking` and `rerankBev` carry `expectedBucketSize` = the length of the list the app binary-searched (after removing the Bev itself on a re-rank). If the server's current bucket size differs, it returns `conflict` and the app refetches the bucket and restarts placement. An `insertIndex` outside `[0, expectedBucketSize]` is a `validation` error (client bug, never expected). `insertIndex` 0 = best. Every comparison is sent as `{ winnerBevId, loserBevId, tie }`; on a tie both ids are set and `tie: true`.

Removal: `removeRanking(bevId)` → server deletes the row, re-spaces that bucket. Pure helper `removeFromBucket(orderedIds, bevId)` + `respaceBucket` exist so the mock and the vectors cover it.

Bucket encoding: the domain type is `'LOVED' | 'FINE' | 'DISLIKED'` everywhere in `shared/`, `app/` and `packages/ranking`; the DB stores smallint 3/2/1 and `packages/api` maps between them. Your code never sees the integers.

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
- Runs in the app (seam interpretation 1, §12): input is `bevs.getStarterCandidates()` (≥ 30 age-filtered `isStarter` Bevs with `ratingCount`); the server never calls this function.

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
- `computeStreak(dayKeys: string[] (unique 'YYYY-MM-DD'), todayKey) → { current, longest, lastKey }`:
  - `current`: walk back from `todayKey`; if today is in the set start at today, else if yesterday is in the set start at yesterday (streak alive but not extended yet), else 0; count consecutive days.
  - `longest`: longest consecutive run anywhere.
- Multiple rankings in one day count once. Re-ranks count (they are rankings). Removals don't retroactively break a streak (the comparison rows remain; the streak is computed from `rankings` rows plus a `ranking_events` log on Arjun's side if they prefer; see §18).
- Period: the function takes `period: 'day' | 'week'` (week key = ISO week of the local date, `YYYY-Www`) with `'day'` as the vision's definition. Beli's reference profile shows "Current Streak 9 weeks", i.e. a weekly streak; if daily proves too punishing at 20 users the switch is a constant and a vector regeneration, not a redesign (§18).
- UI copy: `current = 0` → "Rank today to start a streak"; alive-but-not-today → flame outlined, "Rank today to keep your 4-day streak".

---

## 9. `packages/ranking`: exports, types, package layout

Constraints agreed with Arjun for seam 5 (Arjun bundles `packages/ranking/src/index.ts` with esbuild into `supabase/functions/_shared/ranking.bundle.mjs`; you ship no `dist/`):

- ESM only, zero I/O, no Node or DOM APIs (no `Buffer`, `process`, `fetch`, `Date.now()`, `Math.random()`); `lib: ["ES2022"]`, no `@types/node`.
- Plain relative imports with extensions that esbuild resolves (`./score.ts` style or extensionless, pick one and lint it); **no tsconfig path aliases**, no workspace imports except `shared/` types via `import type`.
- Randomness is always a seed passed in (`prng.ts` mulberry32 + a string hash).
- `export const RANKING_VERSION = "1.1.0"` from `index.ts`, equal to the `version` field written into every vectors file; Arjun's Edge Function logs it and the snapshot carries it.
- A CI job on your side runs the same esbuild bundle command (`esbuild src/index.ts --bundle --format=esm --platform=neutral`) as a smoke test so a Node-only import fails in your PR, not in Arjun's.

```
packages/ranking/
  package.json        name "@bevi/ranking", "type": "module", "exports": { ".": "./src/index.ts" }; no dependencies; devDeps: vitest, fast-check, esbuild (bundle smoke test)
  tsconfig.json       strict, lib ES2022, no DOM, no node types
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
export function placementResult(s: PlacementState): PlacementResult;             // { bevId, bucket, insertIndex, expectedBucketSize, comparisons: { winnerBevId, loserBevId, tie }[] }
export function maxComparisons(n: number): number;                                 // ceil(log2(n + 1))
export function removeFromBucket(orderedBevIds: BevId[], bevId: BevId): BevId[];

// score.ts
export function scoreFromPosition(index: number, n: number, bucket: Bucket): number;      // unrounded
export function storedScoreCents(index: number, n: number, bucket: Bucket): number;     // exact integer hundredths (§8.2)
export function storedScore(index: number, n: number, bucket: Bucket): number;            // cents / 100
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
export function computeStreak(periodKeys: string[], todayKey: string, period: 'day' | 'week' = 'day'): { current: number; longest: number; lastKey: string | null };
export const RANKING_VERSION: string;                                              // "1.1.0"; equals the vectors' version field
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

Scope note for Arjun: at 20 users the snapshot is the full `rankings` table (≈ 1,000 rows). Past ~500 users Arjun should restrict `rankings` to the target user, the users sharing ≥ 2 items with them, and the candidate Bevs; the functions don't care. `PredictionSnapshot.version` must equal `RANKING_VERSION` of the bundle that consumes it; mismatch → the function throws and the Edge Function serves the cached result.

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
| `placement.vectors.json` | full answer sequences → `insertIndex`, `expectedBucketSize` + comparison logs as `{ winnerBevId, loserBevId, tie }` (incl. TIE, undo, re-rank with the Bev removed first) | app regression + Arjun's RPC consistency check |
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

- `jest-expo` + RNTL for components (`ScoreBubble` incl. `predicted`/`locked`, `PriceTier`, `FeedPost` ranked/bookmarked states) and for `useRankingFlow` (drives the state machine and the mock, including the `conflict` restart path).
- Mock contract test: `app/src/api/mock.test.ts` runs the same `BeviApi` conformance suite Arjun runs against the real client (lives in `shared/testing/api-conformance.ts`, written jointly in contract v0). This is what makes mock→real a one-line swap.
- Phase 3: browser e2e flows (e.g. Playwright) against the web build for sign-in → rank → profile.

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
- You need: `packages/api` exporting `createBeviApi({ url, publishableKey, authStorage }): BeviApi` with no React dependency (it builds the Supabase client itself; you pass a `localStorage`-backed `authStorage` adapter for session persistence), generated DB types in `shared/src/db.types.ts`, env var names, a staging Supabase project with seed data.
- By when: mock complete for Phase 1 screens by end of week 2 (2026-10-23); real client needed by the end of Phase 1 for the first friends deploy on Vercel.

**Seam 2 — Contract v0 is the first joint milestone.** You list the data each screen needs (§13); Arjun turns that into the schema + `BeviApi` methods; both approve one `contract/v0` PR. Nothing else merges into `shared/` before it.

- You provide: §13 as `shared/README-v0-needs.md` (or the PR description) by 2026-10-13, review of Arjun's `shared/api.ts` + `shared/types.ts` within one day of their draft.
- You need: the PR merged by end of week 1 (2026-10-16) so the mock and hooks can be typed against it.

**Seam 3 — Ranking write path.** The interactive comparison flow runs in the app using `packages/ranking` (pure state machine). On finish the app calls `api.submitRanking({ bevId, bucket, insertIndex, comparisons, note })`. Arjun's RPC applies it atomically (insert at position, shift others, store raw comparisons, update aggregates). Re-ranking/removing a Bev is the same shape.

- You provide: the exact `SubmitRankingInput`/`Result` types including `expectedBucketSize`, the separate `rerankBev` input (same shape), the comparison element `{ winnerBevId, loserBevId, tie }` with every comparison sent, `insertIndex` 0 = best, `placement.vectors.json` (so the RPC can validate comparison logs), `respaceBucket` semantics, and the client behaviour on `conflict` (refetch + restart, §6.9).
- You need: the RPC to return `{ ranking: { score, position, bucket }, bucketSize }` and to re-space in the same transaction; `conflict` when the server's bucket size ≠ `expectedBucketSize`; `validation` for an out-of-range `insertIndex`; the DB's smallint bucket (3/2/1) mapped to `'LOVED' | 'FINE' | 'DISLIKED'` inside `packages/api`; a `tie` column on comparisons (Arjun is adding it).
- By when: types in contract v0; vectors by end of week 2.

**Seam 4 — Formulas are yours; storage and execution are Arjun's.** Wherever math must run in SQL (score-from-position for aggregates, per-Bev avg/stddev, per-user per-category mean/stddev, Bayesian leaderboard average, streaks, user rank), you specify it in `packages/ranking` and export golden test vectors to `shared/fixtures/*.vectors.json`; Arjun's SQL must pass the same vectors in CI. Changing a formula = `contract/*` PR that regenerates the vectors.

- You provide: §8 + §10 (the vectors, the constants, the `vectors-fresh` CI job on your side).
- You need: a CI job on Arjun's side that loads each vectors file and asserts against the SQL (`supabase test db` or a pgTAP/psql script); the names of Arjun's SQL functions so the integrator can cross-reference. Stddev is population (`stddev_pop`) on both sides; settled.
- By when: score/stats/bayesian vectors end of week 2 (Phase 1 needs them); streak/rank vectors start of Phase 2; prediction vectors start of Phase 3.

**Seam 5 — Recommendations.** `packages/ranking` exports pure `predictScore()` / `recommend()` taking an explicit input snapshot type (defined by you). Arjun's Edge Function (or scheduled job) assembles that snapshot from the DB, calls your functions, and serves/caches results through `BeviApi`.

- Arjun's answer on the import: the Edge Function build step bundles `packages/ranking/src/index.ts` with esbuild into `supabase/functions/_shared/ranking.bundle.mjs`. You ship no `dist/`; `src/` is the contract. Your package must be ESM, zero I/O, free of Node and DOM APIs, use plain relative imports (no tsconfig path aliases), take all randomness as a passed-in seed, and export `RANKING_VERSION` (§9).
- You provide: `PredictionSnapshot` (the name stays), `Prediction`, `Recommendation` (§9) in `contract/v1`, the bundle-compatibility constraints enforced by your own esbuild smoke test, `prediction.vectors.json`, and the staleness/confidence rules the UI relies on.
- You need: `recs.getRecommendations()`, `recs.refresh()` (optional), `prediction` embedded in `bevs.get()`, `generatedAt` and `rankingVersion` on both.
- By when: snapshot type frozen at the start of Phase 2 (Layer 1 runs through the same function, so the Edge Function exists in Phase 2, not 3).

### Interpretations of the brief (flag if Arjun's doc differs)

1. **Starter set is selected client-side (agreed).** The app calls `bevs.getStarterCandidates()`, which returns age-filtered `isStarter` Bevs (at least 30, each with `ratingCount`), then runs `selectStarterSet(candidates, { seed: userId })` from `@bevi/ranking` and ranks the 10 it picks. The server never calls `selectStarterSet`.
2. **Background removal for user uploads:** the brief gives Arjun the catalog pipeline; vision §8 says "background removal on upload". I assume Arjun runs the same removal for user uploads (storage trigger/Edge Function) and exposes `photoStatus: 'processing' | 'ready'`; your side renders the raw photo with a shimmer meanwhile. If Arjun prefers on-device removal, that moves into `app/` and becomes an open question (§18).
3. **Age gate and birthdate (agreed):** birthdate is set once through `profile.setBirthDate`; only an admin can change it afterwards (Arjun's rule). Storage and alcohol filtering in queries/RLS are Arjun's; the screens and client-side hiding are yours. The server is the authority and returns `age_restricted`.
4. **Timezone:** stored on the profile (Arjun), captured by the app; the server computes streak days from it (not from a client-sent date).
5. **Price estimation when the user picks "not sure":** vision §2 says "estimate it". The client sends `priceTier: null, priceEstimated: true` and the server fills a tier (median of the category). Your side only displays the `~`.
6. **Category ids (agreed, Arjun's list):** `soda, diet_soda, juice, water, sparkling_water, energy, coffee, tea, boba, sports, smoothie, beer, wine, spirits_cocktails, other`. Vision's single "Alcoholic" category is split into three, all `isAlcoholic: true`.

---

## 13. Your draft of per-screen data needs for contract v0

This is your input to seam 2. Field names are proposals; Arjun owns the schema and may rename in the PR, but every screen below must stay satisfiable.

### Entities

| Entity | Fields the UI needs |
|---|---|
| `Profile` | `id, handle, displayName, initials (derived ok), createdAt, timezone, birthdate (self only), canSeeAlcohol, onboarded` |
| `ProfileStats` | `followers, following, bevdCount, wantToTryCount, rankOnBevi (number \| null), rankPoints, currentStreak, longestStreak, streakAliveToday (bool)` |
| `Category` | `id, name, isAlcoholic, sortOrder, icon`. Ids are Arjun's: `soda, diet_soda, juice, water, sparkling_water, energy, coffee, tea, boba, sports, smoothie, beer, wine, spirits_cocktails, other`; `beer`, `wine`, `spirits_cocktails` are `isAlcoholic` |
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
| `ApiError` | Arjun's set, lowercase: `{ code: 'unauthorized' \| 'not_found' \| 'conflict' \| 'validation' \| 'rate_limited' \| 'age_restricted' \| 'network' \| 'unknown', message, detail? }`. UI mapping: `conflict` → refetch + restart placement; `validation` → field errors from `detail`; `age_restricted` → "Not available" screen; `network` → Retry; `unauthorized` → sign-out |

### `BeviApi` methods by screen

| Namespace.method | Input → Output | Screens |
|---|---|---|
| `signUp({ username, password, inviteCode }) / signIn({ username, password }) / getSession() / onAuthChange(cb) / signOut() / deleteAccount()` | username + password → session (synthetic email internal to `packages/api`); `signUp` also creates the profile with `handle = username` and rejects a wrong invite code with `validation`. No OAuth (decided 2026-10-11) | 6.1, 6.18 |
| `profile.getMe()` | → `Profile` | root gate, 6.13 |
| `profile.updateMe(patch)` | `{ displayName?, handle?, timezone?, onboarded? }` → `Profile` | 6.2, 6.3, 6.18 |
| `profile.setBirthDate(date)` | set once; a second call is `validation`; admin-only change afterwards | 6.2 |
| `profile.checkHandle(handle)` | → `{ available }`; callable signed out (sign-up form) | 6.1, 6.19 |
| `profile.getUser(id)` / `searchUsers({ q, limit })` | → `Profile` / `Profile[]` | 6.14, 6.8 People tab |
| `stats.getMine()` / `stats.getUser(id)` | → `ProfileStats` | 6.13, 6.14 |
| `follows.follow(id) / unfollow(id)` | → void | 6.8, 6.14, 6.15 |
| `follows.listFollowers(id, page)` / `listFollowing(id, page)` / `suggested()` | → `Page<Profile & { isFollowing }>` | 6.15, 6.8 |
| `categories.list()` | → `Category[]` (already filtered by age) | pickers, scope dropdown |
| `bevs.search({ q, categoryId?, limit })` | → `BevSummary[]` | 6.8 |
| `bevs.get(id)` | → `Bev` | 6.11 |
| `bevs.findLikelyDuplicates({ name, brand?, flavor?, categoryId? })` | → `BevSummary[]` (≤ 5) | 6.10 |
| `bevs.create(input)` | `{ name, flavor?, brand?, categoryId, priceTier: 1–4 \| null, priceEstimated, photoAssetId, labelAssetId? }` → `Bev` | 6.10 |
| `bevs.report(id, reason)` | → void | 6.11 |
| `bevs.getStarterCandidates()` | → `BevSummary[]`: age-filtered `isStarter` Bevs, at least 30, each with `ratingCount`; the app runs `selectStarterSet(candidates, { seed: userId })` to pick 10 | 6.3 |
| `media.upload({ kind: 'bev-photo' \| 'label', uri, mimeType })` | → `{ assetId, url, status }` | 6.10 |
| `rankings.listMine({ bucket?, categoryId?, page })` | → `Page<Ranking & { bev: BevSummary }>` ordered by bucket, position | 6.5, 6.9 start |
| `rankings.listUser(id, page)` | → same | 6.13, 6.14 |
| `rankings.submitRanking({ bevId, bucket, insertIndex, expectedBucketSize, comparisons, note? })` | → `{ ranking, bucketSize }`; `conflict` if the server's bucket size ≠ `expectedBucketSize`; `validation` if `insertIndex` out of range. `comparisons: Array<{ winnerBevId, loserBevId, tie }>`, all of them; `insertIndex` 0 = best | 6.9 |
| `rankings.rerankBev({ bevId, bucket, insertIndex, expectedBucketSize, comparisons, note? })` | same shape and errors as `submitRanking`; replaces the existing ranking atomically | 6.9 re-rank, 6.19 |
| `rankings.updateNote(bevId, note)` / `removeRanking(bevId)` | → void | 6.5 |
| `wantToTry.list(page) / add(bevId, viaUserId?) / remove(bevId)` | → `Page<WantToTryItem>` / void | 6.4, 6.6, 6.11 |
| `feed.getFeed(page)` / `feed.getFeatured()` | → `Page<FeedItem>` / `FeaturedBev[]` | 6.4 |
| `leaderboard.bevs({ categoryId?, page })` / `leaderboard.users(page)` | → `Page<LeaderboardRow>` / `Page<UserLeaderboardRow>` | 6.12 |
| `recs.getRecommendations({ limit })` / `recs.refresh()` | → `{ items: Recommendation[], generatedAt, basedOnCount }` | 6.7 |
| `meta.getAppConfig()` | → `{ minAppVersion, maintenance: bool }` | root |

Constraints the schema must honour: `(userId, bevId)` unique in `rankings`; `position` unique per `(userId, bucket)`; bucket stored as smallint 3/2/1 and mapped to `'LOVED' | 'FINE' | 'DISLIKED'` in `packages/api`; `comparisons.tie boolean`; `handle` unique, lowercase; `score` numeric(4,2); all list calls cursor-paginated; alcoholic content filtered server-side by `canSeeAlcohol`.

Also in `contract/v0`: `shared/enums.ts` (`Bucket`, `PriceTier`, the 15 category ids) and `shared/testing/api-conformance.ts`.

Fixtures, split by owner:

| File (`shared/fixtures/`) | Owner | Content | By when |
|---|---|---|---|
| `bevs.sample.json` | Arjun | At least 60 Bevs covering every category (incl. a few in each alcoholic one), with dev-bucket image URLs, price tiers, `isStarter` on ≥ 30 | 2026-10-16 |
| `categories.json` | Arjun | The 15 categories | with `contract/v0` |
| `users.sample.json`, `rankings.sample.json`, `follows.sample.json`, `featured.sample.json` | You | 12 users with handles/timezones/birthdates (two under 21), ~300 rankings generated by running `packages/ranking` placement with planted tastes (scores therefore consistent with `scoreFromPosition`), a follow graph, 3 featured Bevs. Generated by `scripts/gen-fixtures.ts` in `packages/ranking`, deterministic seed | 2026-10-20 (needs `bevs.sample.json`) |

The mock loads all of them; Arjun's `seed.sql` loads the same files so staging and the mock agree.

---

## 14. Dependency and handoff table

| Your task | Blocked on (Arjun) | Unblocks (Arjun) |
|---|---|---|
| §13 data-needs list | nothing | Arjun's schema draft and `contract/v0` |
| Mock API | `contract/v0` merged (types); `bevs.sample.json` (Oct 16) for realistic data | Arjun's `api-conformance` run against the real client |
| Generated fixtures (`users/rankings/follows/featured.sample.json`) | `bevs.sample.json` | Arjun's `seed.sql` for staging |
| Placement machine + `score-from-position` vectors | nothing | `submit_ranking` / `rerank_bev` RPCs + `respace_bucket()` SQL |
| Stats + Bayesian vectors | nothing | aggregate triggers, leaderboard view |
| Ranking flow screen | mock only; real end-to-end needs the `submit_ranking` and `rerank_bev` RPCs | Arjun's RPCs get a real client exercising `conflict` and `validation` |
| Sign-in / sign-up screens | Arjun's `signUp`/`signIn` in `packages/api` (synthetic email, confirm-email off, invite-code check) | Arjun's auth path gets real sign-ups |
| Add Bev / create wizard | mock; real needs `media.upload` + storage bucket + background removal job | Arjun's dedupe `findLikelyDuplicates` gets real inputs |
| Feed, lists, leaderboard, profile screens | mock; real needs views + `getFeed`/`stats` RPCs | nothing |
| Age-gate UI | `canSeeAlcohol` on `Profile`, `setBirthDate`, `age_restricted` in contract v0 | Arjun's RLS/view filtering spec |
| `PredictionSnapshot` type + `prediction.vectors.json` (`contract/v1`) + bundle-safe package | nothing | Arjun's esbuild bundle and Edge Function |
| Recommended tab with real data | Edge Function serving `recs.getRecommendations` | nothing |
| Streak / rank cards on Profile | streak + rank SQL passing your vectors | nothing; you unblock Arjun with the vectors |
| Photo-style review (`design/photo-style.md`) | nothing | Arjun's Haiku image-seeding agents |
| First Vercel deploy to friends | staging Supabase project + env values in Vercel | Arjun's first real-user data for the offline eval |
| Onboarding starter screen | `bevs.getStarterCandidates()` in contract v0 | nothing (selection runs in the app) |

---

## 15. Plan by phase

Tags follow vision §10: model / effort. Each row is one Claude Code sub-agent deliverable; "DoD" = definition of done.

### Phase 0 — Setup & research

| # | Task | DoD | Tag |
|---|---|---|---|
| 0.1 | Workspace scaffold (`chore/scaffold`, joint): root `package.json` workspaces, tsconfig base, vitest, CI skeleton; your parts: `app/` (create-expo-app, router root), `packages/ranking/` skeleton | `npm install && npm run typecheck && npm test` green on an empty repo | Opus / High (architecture) for the layout decision, Haiku / Low for the boilerplate |
| 0.2 | UI skills research (§2) | `design/research.md`, skills installed, CLAUDE.md references | Sonnet / Medium |
| 0.3 | `app/CLAUDE.md`, `packages/ranking/CLAUDE.md`, `.claude/agents/ui-screen.md`, `ranking-math.md`, integrator adapted | Agents launch on the right model by default; integrator checks `shared/api.ts` + vectors | Haiku / Medium (docs), you review |
| 0.4 | Per-screen specs from `bevi-ui-inspiration/` (§5): Feed, Lists (×3), Search, Profile, Activity post, Taste Profile | `design/specs/*.md` with pt measurements, component mapping and a "Bevi differences" list; you have reviewed each against its image | Sonnet / Medium (one agent per screen, worktrees) |
| 0.5 | Tokens + `Wordmark` candidates + `photo-style.md` | `tokens.ts`, two SVG wordmark directions, chosen one committed, brand colour hex recorded | Sonnet / Medium–High |
| 0.6 | §13 → `contract/v0` review | PR approved by both | you + Sonnet / Medium for the fixtures generator |
| 0.7 | `packages/ranking`: placement + score + stats + bayesian with tests, vectors v1.0.0 | Property tests pass; `vectors-fresh` CI job exists | Opus / High (design + review), Haiku / Low–Medium (tests, generator) |

### Phase 1 — MVP: rank your Bevs

| # | Task | DoD | Tag |
|---|---|---|---|
| 1.1 | Mock API + fixtures + conformance suite | Every `BeviApi` method implemented; conformance green; dev panel | Sonnet / Medium |
| 1.2 | Core components + `ComponentGallery` | All §4 components with every state visible in the gallery; a11y labels | Sonnet / Medium |
| 1.3 | Root layout, session gate, tab navigator | 5 tabs, raised Add button, deep links `lists?tab=` work | Sonnet / Medium (one agent owns these files) |
| 1.4 | Sign-in / sign-up screens (username + password + invite code) + onboarding profile + `setBirthDate` age gate | Sign up → onboarding → tabs end-to-end on mock and against staging in the web build; wrong password / taken username / bad invite code states; handle validation | Sonnet / Medium |
| 1.5 | Ranking flow (6.9) | All states incl. empty bucket, TIE, undo, `conflict` restart via `expectedBucketSize`, re-rank via `rerankBev`; prefetch | Sonnet / Medium; Opus / High reviews the state-machine wiring |
| 1.6 | Starter ranking onboarding (6.3) | Min-3 rule, skip, summary | Sonnet / Medium |
| 1.7 | Add Bev search + Did-you-mean + create wizard + camera + label + price tier (6.8, 6.10) | Creates then ranks on mock; permission-denied paths | Sonnet / Medium |
| 1.8 | Your Lists: Bev'd + Want to Try (6.5, 6.6) | Bucket sections, filters, re-rank/remove sheet | Sonnet / Medium |
| 1.9 | Bev detail (6.11) with predicted-score placeholder states | All states | Sonnet / Medium |
| 1.10 | Profile (6.13) + settings/privacy/delete (6.18) + edit profile | Matches `design/specs/profile.md` within 2pt; VoiceOver pass | Sonnet / Medium–High |
| 1.11 | Leaderboard: Bevs overall (6.12) | Bayesian ordering from the API; MIN_RATERS strip | Sonnet / Medium |
| 1.12 | Swap to real `packages/api` on staging; fix drift | App runs on `EXPO_PUBLIC_BEVI_API=supabase`; conformance green on both | Sonnet / Medium |
| 1.13 | Phase-1 review + bug hunt; Vercel deploy to 5 friends with the invite code | Review findings fixed; added to the home screen on ≥ 3 phones | Sonnet / High (review), Haiku / Low (release notes) |

### Phase 2 — Social + recommendations

| # | Task | DoD | Tag |
|---|---|---|---|
| 2.1 | Ranking: z-scores, affinity, `g_b`, content similarity, Layer 1, `predictScore` v1, `PredictionSnapshot`; `contract/v1` + prediction vectors | Eval script: Layer 1 beats user-mean baseline on synthetic data | Opus / High (design), Haiku / Medium (tests) |
| 2.2 | Streak + rank formulas + vectors | `streak.vectors.json`, `rank-points.vectors.json` merged | Opus / High (review only; small), Haiku / Low |
| 2.3 | Feed + Featured carousel (6.4), People tab in search (6.8), followers/following (6.15), other profiles (6.14) | Optimistic follow/bookmark; empty states; `FeedPost` matches `design/specs/feed.md` | Sonnet / Medium |
| 2.4 | Recommended tab (6.7) + predicted score on Bev detail | Confidence gating; stale handling | Sonnet / Medium |
| 2.5 | Profile pills wired to real streak/rank | Copy for all streak states | Sonnet / Medium |
| 2.6 | Per-screen polish pass against Beli specs (feed, lists, profile) | Specs' "differences" list closed | Sonnet / Medium–High |
| 2.7 | Phase-2 review + friends deploy round 2 | | Sonnet / High |

### Phase 3 — Smarter and bigger

| # | Task | DoD | Tag |
|---|---|---|---|
| 3.1 | Layer 2 user-user CF + blend + exploration; eval on synthetic + real export; vectors v2 | Blend beats Layer 1 on synthetic; no regression on real | Opus / High, Haiku / Medium |
| 3.2 | Per-category leaderboards + "This month" toggle; user leaderboard | Category chips, month filter | Sonnet / Medium |
| 3.3 | Swipe gestures on comparison cards, haptics (no-op on web), Reanimated polish | 60fps in iPhone 12 Safari; reduce-motion fallback | Sonnet / Medium–High |
| 3.4 | Performance pass (bundle, images, query cache persistence), analytics stub | Budgets in §7 met | Sonnet / Medium |
| 3.5 | Browser e2e flows (e.g. Playwright) against the web build in CI; "Not interested" on recs; drift re-check prompts (vision §4 "optional later") | | Sonnet / Medium, Haiku / Low |
| 3.6 | ~~Android preview build, Play internal testing~~ Dropped 2026-10-11 (web only) | | |
| 3.7 | Taste Profile tab + calendar + per-category averages, optional yearly goal card (6.20); `stats.getTasteProfile` contract PR | Matches `design/specs/taste-profile.md` | Sonnet / Medium–High |
| ~~G1~~ | ~~Sign in with Apple before App Store submission~~ Obsolete 2026-10-11: no App Store, no OAuth | | |

---

## 16. First-week checklist (ordered)

1. [ ] Agree package names and the scaffold with Arjun; open `chore/scaffold` together (0.1).
2. [ ] Per-screen specs from `bevi-ui-inspiration/` into `design/specs/` (0.4); Profile and Feed first, since they gate 1.2 and 1.10.
3. [ ] Write §13 into the `contract/v0` PR description / `shared/README-v0-needs.md`; send to Arjun by 2026-10-13 (0.6). Confirm the 15 category ids, lowercase error codes, `expectedBucketSize`, `rerankBev`, `setBirthDate`, `getStarterCandidates` and the username/password auth surface (`signUp`, `signIn`, decided 2026-10-11) are in it.
4. [ ] Research spike (0.2): install `frontend-design` + `react-native-skills`, write `design/research.md`.
5. [ ] `app/CLAUDE.md`, `packages/ranking/CLAUDE.md` (with the bundle constraints from §9), agent definitions (0.3).
6. [ ] `packages/ranking`: `placement.ts`, `score.ts`, `stats.ts`, `bayesian.ts` + property tests + `gen-vectors.ts` + esbuild smoke test + `RANKING_VERSION` (0.7). Open `rank/placement` PR.
7. [ ] Tokens from §4, `Wordmark` candidates, pick one and the brand colour; `design/photo-style.md` (0.5).
8. [ ] Review Arjun's `contract/v0` draft within a day; approve by 2026-10-16.
9. [ ] Start `ui/mock-api` against the merged contract (1.1) and `ui/components` (1.2) in separate worktrees; wire `gen-fixtures.ts` once `bevs.sample.json` lands (Oct 16).
10. [ ] The web build running in iPhone Safari (and added to the home screen) with the component gallery; check each native-only library's web path as it lands (§3).

---

## 17. Deliberately not doing (from the conversation)

- Users "adding a row in the SQL": all writes go through `BeviApi`; no SQL exposure.
- "We don't need no damn privacy page" / "we got location off forever": a minimal privacy screen ships anyway (no store requires it now, but the data is real); location is genuinely never collected.
- "Make our logo look like Beli with a v": original wordmark in a similar spirit; no copied glyphs, colours or icon.
- Photo recognition of a drink from the camera ("take a picture and it's in the database"): v1 is search + manual create; the camera photo becomes the Bev's image, not a lookup key.
- Business model bits (promoted placements, subscriptions), "hottest this month" before Phase 3, matrix factorisation.
- Native builds, EAS, App Store/TestFlight, Android, Expo Go/dev client as a target, OAuth and any emailed flow (decided 2026-10-11: web app only).
- "Skip this comparator" in the ranking flow, periodic drift re-checks, push notifications, blocking/private profiles, Bev editing by non-creators (moderation is an open question).
- From the Beli reference (§5): reservations/ordering/hours/distance/maps, invite-unlock card, Guides, "Add School", list import, shares on posts (likes and comments were added later: TASKS.md M-02, M-03), co-visit tagging ("with Rhea"), visit counts, magic-link or social auth.

---

## 18. Open questions and proposed vision.md changes

Proposed edits to vision.md (via `chore/vision-*` PRs, both approve):

1. **§4 score bands (decided 2026-10-09):** Beli-style 7 / 4 (`[0, 4), [4, 7), [7, 10]`), `score = hi − (hi − lo)(i + 1)/(n + 1)`, stored 2 dp with exact integer rounding (§8.2), displayed 1 dp. Closes §11 item 3. (Done in vision.md.)
2. **§4 ties:** add the "Too close to call" answer and its rule (insert directly below the incumbent).
3. **§2/§4 stddev:** state that all stddevs are population (`stddev_pop`) with a floor of 1.0 and small-n fallbacks (§8.4).
4. **§5 normalisation subtlety:** category affinity uses the user's overall mean/σ (per-category z-scores would be identically 0).
5. **§5 Layer 2 choice:** user-user at launch, item-item at ≥ 200 users; blend weight from neighbour support (§8.9–8.10). Exploration = seeded jitter + ε = 0.15 slots.
6. **§7/§11 rank on Bevi:** `points = bevsRanked + 3·currentStreak + 2·bevsCreated`; followers excluded. Closes §11 item 4.
7. **§6 streak definition:** consecutive local days (profile timezone) with ≥ 1 ranking; alive if yesterday had one.
8. **§8 recommendations tech:** vision says "start as SQL views/functions in Postgres for Layer 1"; the agreed seam 5 runs Layer 1 and 2 through `packages/ranking` called by an Edge Function. Update §8 to match the brief (this is the one place the brief and vision conflict).
9. **§6 missing screens:** add a People tab in search (handle search + suggestions, as in the reference), Followers/Following lists, Edit profile, Account deletion, Report Bev.
10. **§2 users fields:** add `handle`, `display_name`, `birthdate`, `timezone`, `onboarded`; `categories.is_alcoholic`; `bevs.is_starter`, `bevs.photo_status`.
11. **§9 Phase 2:** the Edge Function for recommendations is Phase 2 work (Layer 1 already runs through it), not Phase 3.
12. **§6 Profile:** the reference (and this doc) uses three list rows (Bev'd / Want to Try / Recommended for you) plus two stat cards (Rank, Streak), not "three tappable tiles". Update the wording; the links and emphasis are unchanged.
13. **§6 Your Lists › Bev'd:** one numbered list sorted by score (reference 06), not bucket sections; buckets show through colour.
14. **§6 / §8 Auth:** record "username + password with a shared invite code, no OAuth, no emails; web app on Vercel, no native builds (decided 2026-10-11, replaces Google-only of 2026-10-09)". (Done in vision.md §8.) Supabase Auth config remains Arjun's.
15. **§2 Categories:** replace the list with the 15 ids (`soda … other`), alcohol split into `beer`, `wine`, `spirits_cocktails`.
16. **§8 Core tables:** `comparisons` gains `tie`; bucket is smallint 3/2/1 in the DB; `users` gets `birthdate` (set once), `timezone`, `handle`, `display_name`.

Open questions (need a decision, not a doc edit):

- **Streak period: daily (vision) vs weekly (Beli shows "9 weeks").** `computeStreak` supports both; pick before the streak vectors land (start of Phase 2).
- Alcohol in v1: proposal is yes, seeded minimally, gated by birthdate ≥ 21 (vision §11 item 1). Arjun's RLS enforces it; confirm that scope with Arjun.
- Likes on feed posts: the reference has heart/comment/share; vision doesn't. Proposal: no likes in v1, revisit in Phase 3 once the feed has traffic. **Superseded 2026-10-14:** likes and comments are in (TASKS.md decisions 2–3); likes shipped in #90 (M-02).
- Invite code: where it's checked (Arjun) and how it's shared and rotated among friends.
- Background removal for user uploads: server-side (assumed, Arjun) vs on-device (would move to `app/`). Also: does the pipeline produce blurhashes?
- Price estimation default when the user says "not sure": category median (proposed) vs always ask.
- Moderation for user-added Bevs (vision §11 item 5): proposal for v1 is `bevs.report` + Arjun's admin SQL; no in-app moderation UI.
- Brand colour and the final wordmark (vision §11 item 6): decide from the two week-1 candidates.
- Streak source of truth after removals: compute from current `rankings` rows (simplest; removing your only ranking of a day breaks that day) or from an append-only `ranking_events` log (Arjun's call; the vectors are the same either way).
- FlashList v2 and `@gorhom/bottom-sheet` on web (SDK 57): confirm in the first PR that uses each; the router root is settled (`src/app` by default).
