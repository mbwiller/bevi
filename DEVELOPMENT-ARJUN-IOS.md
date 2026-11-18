# Bevi — iOS development plan: Arjun (backend, release engineering)

Companion to `DEVELOPMENT-ARJUN.md`. That document still governs the schema,
RLS, RPCs and the catalog; this one covers only what changes because Bevi stops
being a web app that always matches its backend and becomes a binary that lives
on a phone for months.

Written 2026-11-17, when the decision of 2026-10-11 ("Bevi is a web app only")
was reversed. Matt's half is `DEVELOPMENT-MATT-IOS.md`. Milestones here are
`IA-n`, Matt's are `IM-n`, shared ones `IS-n`; they are a new namespace and do
not renumber anything in `TASKS.md`.

## 0. The one thing that actually changes

Today the app and the backend ship together. A merge to `main` deploys both, so
`CONTRACT_VERSION` (2.14.0 on `main`) is a build-time fact: there is exactly one client and
it is always the newest one. Every rule in `DEVELOPMENT-ARJUN.md` that says
"append-only" or "bump the contract" assumes that.

On the App Store there is no such thing as one client. A binary approved in
January is still making RPC calls in June, because someone turned off automatic
updates. `expo-updates` fixes JavaScript but cannot change native code, and a
review cycle is a day at best. So:

> **The backend must keep working for contract versions it has already
> outgrown.** That is the whole content of this plan. Everything else here is
> accounts, keys and CI.

One limit on `expo-updates`, worth knowing before we lean on it: guidelines
2.5.2 and 3.1.1 allow over-the-air changes to the app's own interpreted code,
which covers bugfixes and copy. Anything that changes what the app *does*, its
age rating, or its App Privacy answers goes through review even when it is pure
JavaScript.

## 1. Lane, unchanged

Mine: `supabase/`, `packages/api/`, `shared/` (via `contract/*`), `data/catalog/`,
`scripts/`, `.github/workflows/`, every secret and every hosted account.

Matt's: `app/` (including `app.config.ts`, `eas.json`, icons, splash, every
native code path, and everything under `app/src/testing/`),
`packages/ranking/`, `design/`.

Two new seams need a word, because iOS is the first time they matter:

| Thing | Owner | Why it is not obvious |
|---|---|---|
| `app/app.config.ts`, `eas.json` | Matt | It is app config, in Matt's lane, but the values inside it (bundle id, Maps key, EAS project, Sentry DSN) come from accounts I own. I hand over values; Matt commits them. |
| Signing credentials, App Store Connect API key, `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN` | Me | Same class as `SUPABASE_ACCESS_TOKEN` (§2.4 of the main doc): a secret in a GitHub Environment, never in the repo. |
| `.github/workflows/ios.yml` | Me, `chore/*` PR, Matt approves | Same as `app.yml` today. Includes the CI steps for suites Matt writes in `app/`. |
| Crash reporting | Me (account, build secret), Matt (SDK wiring) | New: see IS-4. |

`AuthStorageAdapter` is **not** a contract type — it is defined at
`packages/api/src/client.ts:4` and re-exported from `@bevi/api`. Changing it is
an ordinary `packages/api` PR of mine: it does not move `CONTRACT_VERSION` and
does not queue behind the one-bump-at-a-time rule.

## 2. Milestones

Each one lists what it delivers, what it unblocks on Matt's side, and how a
human checks it in under a minute. They are ordered. **IA-1 is the only thing
gating Matt's first build**; IA-2 gates IM-9, which is a G3 concern.

---

### IA-1 — Apple and EAS accounts, keys, signing, devices (gating, no code)

Matt cannot produce a build at all until this exists.

- Apple Developer Program enrollment ($99/yr) on the Bevi account. Decide
  individual vs organization **before** enrolling: an organization needs a
  D-U-N-S number and weeks of lead time, an individual shows a personal legal
  name as the seller. For a two-person friends app, individual.
- Bundle identifier, registered once and never changed: **`app.bevi.ios`**,
  registered 2026-11-17 as an explicit App ID under team prefix `9NA45GL4CJ`,
  with no capabilities enabled (EAS adds what the entitlements need). It is
  baked into signing, universal links and the App Store record, so it is fixed
  from here.
- App Store Connect app record: name, primary language, category
  (Food & Drink), bundle id.
- **Register our devices.** `eas device:create` for each iPhone we test on, so
  the UDID lands in the dev account and in the development provisioning
  profile. **IM-2 and gate G1 are impossible without this**, and it is the step
  that is easiest to forget because nothing else mentions it.
- EAS: `eas project:init` (writes `extra.eas.projectId` into `app.config.ts` —
  Matt's file, my value), plus an `EXPO_TOKEN` robot account for CI.
- App Store Connect API key (.p8) for `eas submit`, into a new GitHub
  Environment `ios` alongside `dev` / `prod`.
- Signing: let EAS manage the distribution certificate and provisioning
  profile. Do not hand-manage certificates; there is no second developer to
  recover them from.
- `SENTRY_AUTH_TOKEN` (IS-4) belongs in the same environment and must be
  readable by the EAS build, or the crash reports arrive unsymbolicated and
  tell us nothing.

**Hands Matt:** bundle id, EAS project id, Apple team id, registered device UDIDs.
**Check:** `eas whoami` works in CI; the app record is visible in App Store Connect; `eas device:list` shows both our phones.

---

### IA-2 — The version gate, for real

The contract already has the seam and nothing is behind it:

- `shared/src/types.ts:538` — `AppConfig { minAppVersion, maintenance }`.
- `packages/api/src/meta.ts` — returns `placeholderAppConfig()`, a hardcoded
  `{ minAppVersion: '0.1.0', maintenance: false }`
  (`packages/api/src/mappers.ts:853`), with a comment saying no versioning
  infra exists.
- `app/src/api/hooks/feed.ts:210` — `useAppConfig()` exists and no screen calls it.

Deliver:

1. A migration adding a single-row `app_config` table: `min_app_version`,
   `min_contract_version`, `maintenance`, `maintenance_message`,
   `ios_min_build` (nullable), `updated_at`. One row, enforced by a
   `check (id = true)` singleton pattern.
2. `get_app_config()`, security definer, **callable signed out** — which is
   what the contract already promises in both places: `shared/src/api.ts:7`
   lists `meta.getAppConfig` among the methods that do *not* throw
   `unauthorized` when signed out, and `shared/src/api.ts:652` says "Callable
   signed out." No comment needs changing; keep the two in sync if that set
   ever moves.
3. RLS: `select` for `anon` and `authenticated`, no write path except service
   role. Nobody edits this from the app.
4. `packages/api/src/meta.ts` reads the row and drops the placeholder; delete
   `placeholderAppConfig` from `mappers.ts`.
5. Contract fields for what the app needs to compare against: add
   `minContractVersion` and optional `maintenanceMessage` to `AppConfig`.
   `CONTRACT_VERSION` bump: minor (additive). **One bump in flight at a time**
   — IA-4 is the other one, and §5 says which goes first.
6. `app/src/testing/fakeApi/FakeApi.ts:2405` and
   `app/src/testing/conformance.ts:110` need the new fields or `npm test -w app`
   goes red. Both live under `app/`, so both are Matt's: either Matt takes them
   the same hour or we land the contract PR with the change pre-agreed in the
   `#agents` thread.

**Unblocks:** IM-9 (the "Update required" screen).
**Check:** at IA-2 time, a `select` against the dev project plus the FakeApi test — the user-visible check belongs to IM-9, because IM-9 is the screen. Once IM-9 lands: flip `maintenance` in the dev project and the app shows the maintenance screen within 5 minutes (the hook's `staleTime`), then recovers when it is flipped back.

---

### IA-3 — Backward compatibility becomes a rule, not a vibe

This is the real work and the one that is easy to skip until it bites.

- **Policy, written into `supabase/CLAUDE.md` and `DEVELOPMENT-ARJUN.md`:**
  the backend supports the current contract major and the two previous minors
  (`N`, `N-1`, `N-2`). Anything older gets `minContractVersion` bumped and is
  told to update, never silently broken.
- **Migrations:** "append-only once merged" stays, and gains a second rule —
  **no destructive change while a shipped binary still reads the thing.**
  Concretely: dropping a column, renaming a column, narrowing a check
  constraint, removing an enum value, or changing an RPC's return shape are all
  two-release operations (add the new thing, ship a client that reads it, wait
  out `minAppVersion`, then remove). Add this to the `integrator` agent's
  checklist so it is enforced on review, not remembered.
- **RPC versioning:** when a return shape must change incompatibly, add
  `rpc_name_v2` and keep `rpc_name` answering the old shape until the old
  clients are gated out. Never change a live RPC's columns in place.
- **A compat test job — but stand the runner up first.** There is no
  conformance run in `packages/api` today: its vitest suite is
  `packages/api/test/*.test.ts` plus the `*.live` files. The suite lives at
  `app/src/testing/conformance.ts` and the only thing that executes it is
  `app/src/testing/fakeApi/__tests__/conformance.test.ts`, against the FakeApi,
  under jest-expo (its header says "Uses Jest globals"). So:
  1. build a `packages/api` live test that calls
     `runConformance(() => createBeviApi({ … }))` against `bevi-dev` — the call
     is sketched in that file's header and needs the jest globals shimmed or the
     suite made runner-agnostic;
  2. *then* matrix it over the previous two contract versions.
  Contract tags do not exist (`git tag` has only
  `archive/hygiene-sweep-pre-rebase` and `pre-rebase-3.0.0`), so create them
  retroactively for the versions that will still be in the field — 2.14.0 and
  back. Note 3.0.0 lives on the unmerged #221, not on `main`.
- **Deprecation ledger:** a short table at the end of `DEVELOPMENT-ARJUN.md`:
  what is deprecated, which contract version stopped using it, the earliest
  `minAppVersion` that lets us delete it.

**Landed** (`chore/ia-3-contract-compat`): the policy as `DEVELOPMENT-ARJUN.md`
§14, with the mid-task short form in `supabase/CLAUDE.md`; the ledger as §15;
the enforcement as checks (g)–(i) in `.claude/agents/integrator.md`. The tags
below exist locally and are **not pushed**. The matrix is still the proposal
below and nothing is built.

#### Retroactive contract tags (created locally, not pushed)

Every `CONTRACT_VERSION` that has ever been on `main`, read off the git history
of `shared/src/index.ts`. Scheme: `contract/<version>`, annotated, on the
commit that introduced that version.

| Tag | Commit | Date | Introduced by |
|---|---|---|---|
| `contract/2.14.0` | `70d7b5b` | 2026-11-16 | optional barcode nutrition snapshots (#222) |
| `contract/2.13.0` | `af4ab37` | 2026-11-12 | every Bev read returns `iconUrl` from `bev_icons` (#200) |
| `contract/2.12.0` | `262983e` | 2026-11-11 | social context: friends ranking, Bev'd it too, followed by (#184) |
| `contract/2.11.0` | `cb1ffb9` | 2026-11-09 | the internal bug reporter (#167) |
| `contract/2.10.0` | `e0c1f7a` | 2026-11-02 | S-10 + A-08: the venues contract and read path (#161) |
| `contract/2.9.0` | `2979595` | 2026-11-01 | S-13 + A-12: duplicates, `duplicateOfId`, `merge_bev` (#151) |
| `contract/2.8.0` | `5440010` | 2026-10-31 | A-13: the category hierarchy (#132) |
| `contract/2.7.0` | `68eb163` | 2026-10-20 | A-16 + S-14: `bev_edges` and `bev_embeddings` (#115) |
| `contract/2.6.0` | `c26ec45` | 2026-10-20 | S-04 + A-04: the Explore backend (#113) |
| `contract/2.5.0` | `1ec7c27` | 2026-10-20 | profile photos: storage policy, `set_avatar` (#110) |
| `contract/2.4.0` | `baa1e96` | 2026-10-19 | S-12 + A-11: Taste Profile data (#101) |
| `contract/2.3.0` | `84eaf2c` | 2026-10-19 | S-20: `feed.listUser` (#97) |
| `contract/2.2.0` | `3e7fbe2` | 2026-10-19 | S-07 + A-06: category progress (#93) |
| `contract/2.1.0` | `56f2e8d` | 2026-10-18 | S-05 + A-05: Bev of the day and Bev of the week (#96) |
| `contract/2.0.0` | `8cbc10d` | 2026-10-14 | S-01: feed carries rankings only (#65) |
| `contract/1.0.0` | `e4e8b2e` | 2026-10-11 | contract v1: username auth, string buckets, ranking writes (#25) |

All sixteen are ancestors of `origin/main`. Two deliberate absences: 3.0.0,
which lives on the unmerged #221 and not on `main` (`pre-rebase-3.0.0` already
marks that line of work), and the `contract/v0` scaffold (`0b7de7f`, #2), which
declared no `CONTRACT_VERSION` at all. From here, a tag is cut by the PR that
bumps the version, and a release tag per build (IA-9) is a separate scheme.

#### Where the conformance suite has to live (IS-8)

A proposal, because the decision crosses the lane line.

What is true today, checked rather than remembered:
`app/src/testing/conformance.ts` is 1471 lines, exports `runConformance`, and
imports only `@bevi/shared` and `@bevi/ranking`. It uses the shared test
globals (`describe` / `it` / `expect` / `beforeAll`) and **no `jest.*` API
anywhere** — the file does not contain the string `jest` outside its header
prose. Its only runner is the nine-line
`app/src/testing/fakeApi/__tests__/conformance.test.ts`, under jest-expo.
`packages/api` runs vitest 5 with no `globals` setting, so its tests import
`describe`/`it`/`expect` from `vitest`. The suite is therefore already close to
runner-agnostic; what actually blocks the matrix is ownership and module
boundaries, not Jest.

What a matrix entry even is, which decides the rest: "today's backend still
satisfies what contract 2.13 promised" means running the suite **as it stood at
that tag**, through that tag's `packages/api`, against today's `bevi-dev` —
i.e. `git worktree add` at `contract/2.13.0`, `npm ci`, run. Two consequences.
First, whatever we decide, the tag's own tree has to be able to run the suite
outside jest-expo, so the matrix can only cover versions tagged *after* this
decision lands; the retroactive tags above are markers and a free
`git diff contract/2.13.0..contract/2.14.0 -- shared/src`, not matrix inputs.
Second, a live run needs an invite code, an alcoholic Bev id, and an operator
hook for `makeInternalReporter` (`set_profile_role` has no contract path), so
either the bugs cases are skipped live or `packages/api/test` grows a
service-role helper.

| Option | What it costs |
|---|---|
| **A. Move it into `shared/`** | Contract and suite travel in one tag, and both lanes already approve `shared/`. But `shared/` is dependency-free and has no `test` script today; it would gain a runner and a dependency on `@bevi/ranking` (Matt's package, zero-dep by its own rule). Worse, every edit to a 1471-line test file becomes a `contract/*` PR needing both owners and queueing behind §4's one-bump-at-a-time rule. Conformance churns; contract bumps are rationed. |
| **B. Extract `packages/conformance`** | A new workspace (`package.json`, `tsconfig.json`, a root `workspaces` entry, a CI line) and a verbatim file move. `@bevi/conformance` depends on `@bevi/shared` + `@bevi/ranking`, devDepends on vitest with `globals: true`; `app`'s existing test becomes a nine-line import, `packages/api` gets `test/conformance.live.test.ts`. Only the suite moves — the FakeApi stays in `app/src/testing/`, so `check-bundle.mjs` and `test-double-isolation.test.ts` keep covering exactly what they cover now. Needs one ownership answer: jointly owned like `shared/`, but on ordinary PRs. |
| **C. Make it runner-agnostic in place** | Almost no diff — `packages/api` sets `globals: true` and imports across the workspace. The cost is structural: a backend package importing `app/src/testing/**`, the one tree the repo works to keep isolated, and a workspace dependency from `packages/api` on `app`, which inverts the direction everything else runs in. It also leaves the file that gates my releases in Matt's lane, where I may not edit it. |

**Recommendation: B**, in three steps that each stand alone.

1. `packages/conformance`: move `runConformance` verbatim, vitest `globals: true`
   the only runner assumption. `app`'s FakeApi test becomes an import — Matt's
   one-line change, and jest-expo must stay green, since that run is the suite's
   only current coverage. Half a day, most of it the lane agreement.
2. `packages/api/test/conformance.live.test.ts` against `bevi-dev`, skipping
   like the other `*.live` files when no stack is configured. Half a day, plus
   whatever the operator hook turns into.
3. The matrix: a workflow that checks out the last two `contract/*` tags into
   worktrees and runs each tree's suite against `bevi-dev`. A workflow file
   once 1 and 2 exist.

A is the fallback if we would rather not add a workspace. C should be refused:
it buys a week and costs the lane boundary.

**Check:** the policy, the ledger and the integrator checks are readable in the three files above, and a deliberately destructive migration makes the integrator FAIL. The matrix half is checked when it exists: the live conformance run goes green against `bevi-dev`, then against the two older tags; a deliberate breaking change to an RPC turns the matrix red.

---

### IA-4 — Media upload that works off the web

`UploadMediaInput.file` is typed `Blob` (`shared/src/api.ts:379`) and
`packages/api/src/media.ts` hands it straight to supabase-js Storage. On the
web that is a canvas-produced Blob. React Native's `Blob` is not the same
object: it has no real byte backing that supabase-js can read, and uploading
one commonly produces a 0-byte object with no error. This is the single most
likely "it works on the simulator and the photo is blank in production" bug.

- Widen the contract: `file: Blob | ArrayBuffer | Uint8Array`.
- In `media.ts`, normalise to `ArrayBuffer`. `contentType` is already passed
  explicitly, so the real work is the byte source and the size check, which
  reads `file.size` today (`media.ts:62`; `bugs.ts:205` does the same for bug
  evidence) and must move to a byte length that all three shapes have.
- Keep the Blob path for web so nothing regresses.
- Verify against a real device upload, not a simulator one, and verify the
  object's **byte size in the bucket**, not just a 200 response.
- If the bug reporter stays off on native (IM-10), `bugs.ts`'s evidence upload
  is web-only for now. Note it so it is not forgotten when the reporter is
  ported.

**Unblocks:** IM-5.
**Check:** a photo taken on an iPhone appears on the Bev at the right dimensions, and `supabase storage ls` shows a non-zero size.

---

### IA-5 — Hermes and cellular reality in `packages/api`

The client code has only ever run in a browser or Node. Audit, with a device
build in hand:

- `atob` — used in `packages/api/src/paging.ts:24` (cursor decoding) and
  `app/src/api/config.ts` (key role check). Hermes has shipped `atob`/`btoa`
  for a while, but **verify on device**, not from memory; a missing global here
  breaks every paged list.
- `crypto.randomUUID` — already has a Hermes fallback in `media.ts:45`. Good
  pattern; check nothing else assumes it.
- `URL` / `URLSearchParams` — partial in Hermes.
- `fetch` timeouts: a browser tab on wifi forgives a hanging request; a phone
  on a subway platform does not. Give every call an `AbortController` deadline
  and make `ApiError('network')` the result. Note that the offline state Matt
  has today (`app/src/features/create-bev/useOnline.ts`) is `navigator.onLine`
  plus `window` listeners, so on Hermes it reports "online" forever — the
  `ApiError('network')` I produce here is what Matt's native offline state will
  actually be derived from (IM-4).
- **Token refresh across background/foreground needs a new seam.**
  `packages/api/src/client.ts` sets `autoRefreshToken: true`, but supabase-js
  needs an `AppState` nudge on React Native or a session can come back stale
  after the app sits backgrounded overnight. `packages/api` cannot import
  `AppState` (it is consumed by vitest/Node and by the web build), and
  `packages/api/src/index.ts` deliberately keeps the supabase client private.
  So I export an app-visible control from `@bevi/api` —
  `startAutoRefresh()` / `stopAutoRefresh()`, or `onAppActive()` on the
  returned api — and Matt calls it from an `AppState` listener in IM-3. Neither
  half works alone.

**Check:** airplane mode mid-scroll gives a clean "you're offline", not a spinner forever; leaving the app backgrounded overnight and reopening it does not sign you out.

---

### IA-6 — Sessions that survive a store binary

- `AuthStorageAdapter` (in `@bevi/api`, not the contract) stays the seam; Matt
  supplies a native implementation in IM-3. Its `getItem` already returns
  `string | null | Promise<string | null>`, so an async store drops in with no
  signature change on my side.
- Confirm the JWT/refresh-token lifetimes in Supabase Auth config are long
  enough that a friend who opens Bevi twice a month is not signed out every
  time, and short enough to be sane.
- `deleteAccount()` already exists end to end
  (`app/src/app/settings/delete-account.tsx` → `api.deleteAccount()`), which is
  what App Store Guideline 5.1.1(v) demands. `DEVELOPMENT-MATT.md:471` says it
  was kept "although no app store requires it now" — that note becomes "required
  by 5.1.1(v)" in IS-1. Verify the full delete on a device account before
  submission; a broken delete is a rejection.

---

### IA-7 — A second Google Maps key, for iOS

**Blocked on IS-6, and void if we go with Apple Maps.** If `expo-maps` renders
through Apple Maps there is no Google key, no bundle-id restriction and no new
billing surface; everything below applies only to the Google path.

`app/.env.example` documents one **browser** key restricted to HTTP referrers
(the Vercel domain and localhost). That key cannot be used by a native map, and
loosening its restrictions to make it work would expose it.

- Create a second key in the Bev Maps Google Cloud project, restricted to
  **iOS apps** by bundle id, and to the Maps SDK for iOS only.
- The Map ID (vector, cloud-styled) carries over; confirm the iOS SDK honours
  the same Map ID style.
- It ships inlined in the binary (`ios.config.googleMapsApiKey`), so it is
  public by design — the bundle-id restriction is the control, exactly as the
  referrer restriction is on web.
- Billing: each `new Map` was a billable load on web and we re-used one
  instance to stay under the 10,000 free monthly loads (TASKS.md:640). The iOS
  SDK bills per session, differently. Set a budget alert before Matt starts
  IM-7, not after.

**Hands Matt:** `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY` (an EAS env var, not a Vercel one).

---

### IA-8 — What App Review needs from the backend

Review is a stranger with no invite code, on a device we cannot see, and they
reject rather than ask.

- **A demo account.** Sign-up is gated by a shared invite code
  (`SignUpInput.inviteCode`), so a reviewer cannot get in unaided. Provide, in
  the review notes, a username, a password and a live invite code — and do not
  rotate that code mid-review. Needed at **G3** too if any tester is external
  (IA-9).
- **Seeded demo data.** The account must show a populated feed, lists and
  leaderboard on first open; an empty app looks broken and gets rejected under
  2.1. Script it (`scripts/` is mine) so it can be re-seeded between rounds.
  Same data feeds Matt's screenshots (IM-12).
- **Guideline 1.2, user-generated content — see IS-7.** This is the most
  likely rejection on the list and neither of us had it on the radar. The app
  shows other people's posts, comments, photos and avatars, and `CommentsApi`
  is `list` / `add` / `remove` (own comments only): there is no report-content,
  no block-user, no mute. `bevs.report` is catalog moderation (duplicates, wrong
  info), not UGC. Apple asks social apps for content filtering, a way to report
  objectionable content, a way to block abusive users, and published developer
  contact. My half if IS-7 says yes: the contract fields, the RPCs and the RLS
  for report-and-block; Matt's half is IM-13.
- **Alcohol.** The catalog has beer, wine, spirits and cocktails; `profiles`
  carries `birth_date`, `can_see_alcohol` is derived from it server-side, and
  the three alcoholic categories are hidden when it is false. That server-side
  enforcement is what makes the age rating defensible — confirm it holds for
  every RPC the demo account hits, and settle the demo account's age in IS-3.
- **Privacy policy and support URLs.** `app/public/privacy.md` exists but is
  served by the web app. If web stays (IS-1) the URL is free; if web is dropped,
  both URLs still have to live somewhere, so web cannot be deleted before a
  replacement exists. Note the in-app Privacy screen has its own problem, in
  Matt's IM-4.
- **Account deletion** must be reachable without contacting support — it is.

---

### IA-9 — Release engineering

- `.github/workflows/ios.yml`: on a tag or a manual dispatch, `eas build
  --platform ios --profile production` then `eas submit`. Mirror `app.yml`
  (Node 22, `npm ci`, the route-types step). Keep `app.yml`'s web export job
  exactly as it is if web stays, and add the CI step for Matt's native jest
  project when IM-11 lands.
- **Run the forbidden-string scan over the native bundle.**
  `app/scripts/check-bundle.mjs` is what keeps `src/testing/**` — the FakeApi,
  the fixture people, `tester-pass-1`, `test-invite`, the old mock's plaintext
  passwords — out of a shipped bundle, and it is wired only into
  `app/vercel.json` and `app.yml`'s web export. Nothing equivalent runs for an
  iOS build, so today a test double could ship to the App Store.
  `test-double-isolation.test.ts` is a typecheck-time guard, not a bundle guard.
  Add the same scan over `npx expo export --platform ios` (or the EAS bundle) in
  `ios.yml`.
- **Pin the toolchain in `ios.yml`.** The EAS build image decides the Xcode
  version, and it has to match what the Expo SDK on `main` expects. `main` is
  on SDK 57 while SDK 58 is now npm `latest`, so the image is pinned to what 57
  wants and moves in the same PR as Matt's SDK upgrade (IM-1), never on its own.
- **Which backend does a TestFlight build talk to?** A real decision (IS-2):
  `bevi-dev` means we can break things, `bevi-prod` means the build we test is
  the build we ship. Recommendation: `preview` → dev, `production` → prod, with
  the profile name visible on the settings screen so a tester can tell.
- **External vs internal TestFlight.** Internal testers must be users on the
  App Store Connect team, each with an Apple ID and a seat. Anyone else is an
  **external** tester, and the first build for external testers needs **Beta
  App Review** (a day or two) plus a beta app description and a feedback email —
  judged against the same guidelines. So either add our testers as ASC users, or
  accept that G3 is a review gate and that IS-7 and the privacy manifest have to
  be settled before it, not before G4.
- **`expo-updates` channels** map to the same two environments, and an OTA
  update must never cross a native boundary (never push JS needing a native
  module the installed binary lacks). The runtime version policy in `eas.json`
  is Matt's file; the rule is shared. The guideline limit is in §0.
- **Staged rollout and the gated user.** `minAppVersion` is never raised above
  a version installable on every iOS we support (see the deployment target in
  Matt's IM-1): the App Store serves an older device the last compatible build,
  and a non-dismissible gate would brick it forever. The blocking screen always
  shows a way to reach us. First releases go out with Phased Release (or manual
  release) on; an OTA fix goes out at a rollout percentage before 100%
  (`eas update --rollout-percentage`, `eas update:rollback`). A bad *native*
  binary can only be fixed by an OTA JS revert or an expedited review — know
  which before submitting.
- **Version policy:** `version` is the marketing version, `buildNumber` must
  increase on every upload. Automate `buildNumber` in EAS rather than
  hand-editing, and tag the repo per release so IA-3's matrix has something to
  test against.
- **The free-tier pause gotcha gets worse, and the keepalive is new work.**
  `DEVELOPMENT-ARJUN.md` §2.3: a free project pauses after a week of
  inactivity. Today that strands friends who know to text us; with a store
  build it is a one-star review. There is **no** Supabase keepalive —
  `graph-keepalive.yml` pings Neo4j Aura with `NEO4J_*` secrets and has no
  Supabase credential. So: a `ping()` RPC migration plus a
  `supabase-keepalive.yml` hitting both hosted projects, and revisit Pro on prod
  before submission.

---

### IA-10 — Deferred, on purpose

Say these out loud so neither of us quietly assumes the other is doing them:

- **Push notifications.** Needs an APNs key, a device-token table, an Edge
  Function sender and a permission prompt. Not in v1. The token table is an
  additive migration and the prompt is Matt's, whenever we want it.
- **Android.** Not in v1. Nothing here forecloses it; `expo prebuild` generates
  both and most of IM-3/IM-4 is platform-agnostic.
- **In-app purchases.** None, so Guideline 3.1 does not apply.
- **Sign in with Apple.** Not required: we have no third-party login (4.8 only
  bites when you offer one). `DEVELOPMENT-MATT.md:1092` already marks the old
  G1 task obsolete and it stays obsolete.
- **App Tracking Transparency.** Not needed — no IDFA, no ad or attribution
  SDK, and Sentry is not tracking. It must *stay* that way, because the App
  Privacy answers (IM-12) will say "not used for tracking".

## 3. Open decisions (need both of us)

| # | Decision | Why it blocks | Default if we do not decide |
|---|---|---|---|
| IS-1 | Does the web app stay? | Decides whether every native path is a `.ios.tsx` split or a replacement, and whether the privacy/support URLs are free | Keep web. It hosts the policy URLs, keeps instant deploys, and keeps the bug reporter alive |
| IS-2 | Which backend does TestFlight hit? | Shapes `eas.json`, EAS secrets and `ios.yml` | `preview` → `bevi-dev`, `production` → `bevi-prod` |
| IS-3 | The demo account's age, and whether alcohol is visible to review | Changes the age-rating questionnaire answers and what the reviewer sees | Over 21, alcohol visible, rated 17+ |
| IS-4 | Crash reporting on device | Today the only error channels are the internal bug reporter (web-only, IM-10) and Vercel logs, which do not exist for a binary. We would be blind | Add one (`@sentry/react-native`): my account and `SENTRY_AUTH_TOKEN`, Matt wires the SDK and the config plugin, and dSYM/source-map upload is part of it or the reports are useless |
| ~~IS-5~~ | Bundle id | — | **Decided 2026-11-17: `app.bevi.ios`** (explicit App ID, team prefix `9NA45GL4CJ`). Must match `ios.bundleIdentifier` exactly |
| IS-6 | `react-native-maps` (Google) or `expo-maps` (Apple Maps option) | Decides whether IA-7 exists at all, and raises the iOS deployment target | Spike at IM-7; do not pre-commit |
| IS-7 | Do we ship report-content + block-user for v1? | Guideline 1.2 for a social app. Yes = contract + RPCs + RLS (me) and a report/block sheet (IM-13). No = the argument is invite-only, follows-only visibility and no public discovery, written into the review notes — and expect to be asked anyway | Ship it. It is small, and it is the difference between one review round and three |
| IS-8 | Where the conformance suite lives, so a compat matrix can run it | IA-3's matrix cannot exist while the suite's only runner is jest-expo inside `app/`, and `app/` is Matt's lane | Extract `packages/conformance` (option B in IA-3): the suite moves verbatim, `app`'s FakeApi test becomes an import, `packages/api` gets a live run |

## 4. Not colliding with Matt

- **`shared/src/` only through `contract/*` PRs**, and **one `CONTRACT_VERSION`
  bump in flight at a time.** Two open PRs that both bump it always conflict
  (#221 vs #222). Post to `#agents` before merging a bump. IA-2 and IA-4 are
  both bumps: see §5 for the order.
- **I never edit `app/`.** When a native change needs a contract field, I ship
  the contract and the `packages/api` half, Slack it, and Matt adopts. The one
  place this bites: IA-2 and IA-4 both need `app/src/testing/` updated to stay
  green, and that is Matt's. Pre-agree it in the thread or land them an hour
  apart.
- **Matt never edits `supabase/` or `packages/api/`.** A missing field is a
  request to me, not a client-side workaround. That includes
  `bugs.canReport()`, which is a server method — IM-10 gates the reporter at its
  call sites in `app/`, not in my code.
- **`.github/workflows/` and root docs are `chore/*` PRs** with the other's
  approval. When IM-11 adds jest projects, the CI step is mine.
- Branches: `feat/ia-2-app-config-gate`, `chore/ia-9-ios-ci`. Ticket id in the
  branch and the PR title, as always.

## 5. Order of work

```
IA-1 ──── IM-1 ── IM-2 ──────────────────────── G1: it launches on a device

IA-4 (contract bump 1) ── IM-5 ──┐
IA-5, IA-6 ──────────────────────┴───────────── G2: every core flow works
IA-3 (continuous, from now on)

IA-2 (contract bump 2) ── IM-9 ──┐
IA-9, IS-4, IS-7 ────────────────┴───────────── G3: TestFlight
IA-7 ── IM-7 (needs IS-6)

IA-8 ── IM-12 ───────────────────────────────── G4: submitted
```

**IA-4 before IA-2**, because the bumps are serialized and IM-5 (G2) is needed
earlier than IM-9 (G3).

Gates, so "are we close?" has an answer:

- **G1 — it launches.** A development build opens on a registered iPhone, signs
  in, and shows the feed. Map and bug reporter stubbed. IA-1, IM-1, IM-2.
- **G2 — it is usable.** Every core flow works on device: rank, create a Bev
  with a photo, lists, search, profile, delete account. IA-4, IA-5, IA-6,
  IM-3 → IM-6.
- **G3 — TestFlight.** With crash reporting live, on the backend IS-2 chose. If
  any tester is external this is a review gate, so IS-7 and the privacy manifest
  land here. IA-9, IA-8's demo credentials, IS-4.
- **G4 — submitted.** Store assets, questionnaires, seeded demo data, review
  notes. IA-8, IM-12.

I do not move anything to Done, and a merged PR is not a verified fix: G1–G4 are
confirmed on a phone, by one of us.
