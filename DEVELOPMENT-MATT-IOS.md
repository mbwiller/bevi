# Bevi — iOS development plan: Matt (the app on a real device)

Companion to `DEVELOPMENT-MATT.md`. That document still governs the design
system, the screens and `packages/ranking`; this one covers only what changes
because the app stops being a web page added to the home screen and becomes a
native binary on the App Store.

Written 2026-11-17, when the decision of 2026-10-11 ("Bevi is a web app only")
was reversed. Arjun's half is `DEVELOPMENT-ARJUN-IOS.md`. Milestones here are
`IM-n`, Arjun's are `IA-n`, shared ones `IS-n`; a new namespace, nothing in
`TASKS.md` is renumbered.

**Status last brought up to date: 2026-11-19, night, against the branch
`integration/bev-27-ios` (draft PR #276 into `main`).** §0.1 is the one-page
answer to "where are we"; each milestone below carries its own Status line,
and where a Status line and §0.1 disagree, §0.1 is the newer.

**One agent, both lanes, since 2026-11-19 evening.** The founders decided that
a single session runs the remaining iOS work across `app/` and the backend,
because two lanes had made the work too granular. The lane rules in §1 and §4
still describe who reviews what; they no longer describe who types. The
single-owner files (`app.config.ts`, `eas.json`, the two `_layout.tsx`) are
that session's while it runs.

## 0. The good news first

Nothing about this app is architecturally web-bound. It is Expo SDK 57 on React
Native 0.86 with Expo Router, which is a native stack that happens to be
exported for the web. There is no rewrite here. The work is three things:

1. **Config that was deliberately never written.** Done: `app.config.ts` has
   the iOS block, `eas.json` exists with four profiles and a pinned build
   image, the icon and a launch screen are set (#243, #244, #250, #257).
2. **Places where a web implementation is the only implementation.** Mostly
   done. The session, the offline state, the Privacy screen, field focus,
   reduced transparency and recent searches have native files (#247, #248,
   #251), and since 2026-11-19 so do photos (#269), the share link (#267) and
   the session's foreground refresh (#266). Still web-only: the barcode scan
   (IM-5), the bug reporter (IM-10) and the real map (IM-7, deferred).
3. **Native behaviour you have never had to care about** — real safe areas,
   real blur, real haptics, keyboard avoidance, permission denials, VoiceOver.
   Not started as a milestone (IM-6); a few pieces arrived early with #248 and
   #251 because the simulator showed them, and the first permission denial (the
   camera) with #269.

Do not go by the `Platform.OS` count: the two worst couplings (the Privacy
screen and `useOnline`) contained no `Platform.OS` at all, so the guards
understate the sweep rather than bound it.

### 0.1 Where it stands (2026-11-19, night)

**On a phone:** TestFlight build 0.1.0 (3), cut from `e1f0b1f` on the
`production` profile on 2026-11-19. It opens, signs in and shows the feed
(G1). It predates everything below.

**On `main`:** #243 to #271. Nothing since #271.

**On `integration/bev-27-ios`, not on `main` and not on a phone:** the rest of
the iOS work, each piece its own PR, summed in draft PR #276. It is one branch
because the pieces depend on each other and the session that built them could
not merge to `main`. Merge #276 with a merge commit, not a squash, so the PRs
inside it are recorded as merged. The whole app suite passes on it (187
suites, 1,765 tests), as do `packages/api` and `packages/ranking`, typecheck,
and the web and iOS exports with the bundle check. **None of it has run on a
device**: there is no Xcode on the machine it was built on.

| Milestone | State | Where | What is left |
|---|---|---|---|
| IM-1 build config | Done | `main`; #272, #274 on integration | The next EAS build is the first to compile `expo-application`, `expo-camera`, `expo-updates` and `react-native-view-shot`. The SDK 58 upgrade. What App Store Connect said about the privacy manifest |
| IM-2 first boot | **G1 reached** on build 3 | `main` | Nothing |
| IM-3 session | Done in code, including an offline launch with an expired token (#283) | `main`; #283 | The phone checks: force-quit, overnight, reinstall, offline launch |
| IM-4 web assumptions | Done | `main`; #278 | Device checks |
| IM-5 photos + barcode | Done in code. The scanner is `expo-camera` on native (#273) | `main`; #273, #278 | Every photo and scan check on a phone |
| IM-6 native polish | The part that can be decided by reading the code is done: double screen animation, dark tab flash, timestamps, keyboard avoidance, sheets, list refresh jumps, VoiceOver announcements and states (#278, #288) | integration | Everything that needs eyes on a device: haptics and glass (still unused), Dynamic Type, the VoiceOver sweep |
| IM-7 map | v1 scope done: an "In progress" page | `main` | The real map, after v1 |
| IM-8 sharing + links | Share link fixed. The web host serves the app-site-association file (#279). The app's half is draft #281, held | `main`; #279 | #281 needs the Associated Domains capability on the App ID first, and a decision on the host |
| IM-9 version gate | Done in code, reading the real row (#275, #280) | integration | The App Store id and a support address (`src/lib/appStore.ts`); the maintenance flip on a phone |
| IM-10 bug reporter | Stage 1 on native done in code: button, window screenshot, note (#285, contract 3.3.0) | integration | Device checks; stage 2 (select element, record steps) |
| IM-11 tests | Layer 1 grew with each piece. Layer 4 exists: `docs/ios-device-checklist.md`. The Feed suite's memory failure is fixed at its cause (#287) | integration | Layer 2 (a web jest project) and layer 3 (simulator flows): not started |
| IM-12 store assets | Drafted as text: `docs/app-store-submission.md` | docs branch | Screenshots, the founders' read of every line, the forms |
| IM-13 report + block | Done in code, both halves (#261 contract 3.1.0, #277) | integration | Device checks. Who reads the reports, and a published contact |
| IM-14 test-run interface | Not started | | After layer 3 exists |
| IS-4 crash reporting | Sentry was added and removed the same night (#284, #286): the decision is an in-house reporter, **not built**. A root error boundary and a `captureError` seam with nothing behind it remain | integration | The reporter. Until then native crashes show only in Apple's reports |

Things to know before picking up the next branch:

- **The contract is 3.3.0 on the integration branch**, 3.0.0 on `main`:
  3.1.0 blocks and reports (#261), 3.2.0 the app-config fields (#275), 3.3.0
  bug-report evidence as bytes (#285). All additive; the backend did not
  change. BEV-13 (`feat/bev-13-ondevice-ocr`, pushed, still numbered 2.16.0)
  and BEV-22 (local) are not in it. BEV-22 is out of v1. BEV-13 is not a
  launch gate, and its Swift module has never been compiled: fold it in only
  after one good build of this branch, so a compile failure there cannot cost
  the build that carries everything else.
- **Builds come from Arjun's machine, by hand**, and are recorded in
  `#agents`: builds 2 and 3 are both `e1f0b1f`, `production` profile. No `ios`
  GitHub Environment exists, so `ios.yml` cannot build yet. Tag the commit a
  build is cut from.
- **Over-the-air updates are configured** (#274): `runtimeVersion` is the
  native project's fingerprint, and `preview` and `production` builds name
  their channel. No update has been published; the first build from this
  branch is the first that can receive one.
- **A test that mounts the app no longer exhausts the heap** (#287). React
  Native's jest preset made `performance.now` a recording mock, which kept a
  record of millions of calls per Feed test. If a suite's heap climbs again,
  `app/jest.config.js` says how to measure it.
- **Also on `main` but not on the hosted database:** the six icon migrations
  of #221 and #227 (`20261119185800` to `20261119192921`). Nothing in the app
  calls them yet.

## 1. Lane, unchanged

Mine: `app/` (now including `app.config.ts`, `eas.json`, icons, splash, every
native path and everything under `app/src/testing/`), `packages/ranking/`,
`design/`.

Arjun's: `supabase/`, `packages/api/`, `data/catalog/`, `scripts/`, every secret
and hosted account, `.github/workflows/`.

One correction to that, found on 2026-11-18: the repository is `mbwiller/bevi`
and Arjun has push but **not admin**, so he cannot create a GitHub environment
or set any repository secret — both 403. "Every secret" is therefore not
achievable as written: either Matt grants admin, or every CI secret is a
request to Matt. Unsettled, and now concrete: the `ios` environment and its
four secrets (`EXPO_TOKEN`, `ASC_API_KEY_P8_BASE64`, `ASC_KEY_ID`,
`ASC_ISSUER_ID`) are the first case. Still open on 2026-11-19, and not
blocking: builds run from Arjun's machine for now (§0.1), so the environment
is only needed the day a build should come from CI.

In practice for this project: Arjun hands me **values** (bundle id, EAS project
id, Apple team id, registered device UDIDs, the iOS Maps key)
and I commit them to `app.config.ts` / `eas.json`. I never add a migration or
touch `packages/api`; a missing field is a request to Arjun, not a client-side
workaround. `shared/src/` only moves through `contract/*` PRs, one
`CONTRACT_VERSION` bump in flight at a time (two open bumps always conflict —
#221 vs #222).

Two corrections worth carrying, because both docs used to get them wrong:
`AuthStorageAdapter` is `@bevi/api`'s type (`packages/api/src/client.ts:4`), not
the contract's, so changing it is Arjun's ordinary PR and does not move
`CONTRACT_VERSION`. And `bugs.canReport()` is a **server** method
(`shared/src/api.ts:857`): gating the reporter is a change at its call sites in
`app/`, never in Arjun's code.

**The file-split rule, as adopted in #244** (`app/CLAUDE.md`): the bare file is
the native one and the web one sits beside it as `Thing.web.ts`. Not
`Thing.ios.tsx`. Twelve pairs exist today: `authStorage`, `queryLifecycle`,
`sessionRefresh`, `BelowOfflineNotice`, `recents`, `focusField`, `loadHost`,
`MapView`, `glass`, `useOnline`, `profileLink`, `photo`. Written this way,
removing the web build later is deleting the `.web` files. When two platform
files share more than a line, the shared part gets its own module that both
re-export (`photoCommon.ts`), so callers keep one import path.

## 2. Milestones

Ordered. IM-1 and IM-2 are the critical path; everything from IM-3 on can be
parallel branches as usual, one concern per branch.

---

### IM-1 — Build config, and a build that exists

**Status: done, except the items under "Left". The check below is half met.**

Landed in `app/app.config.ts` (#244, #250):

- `ios.bundleIdentifier: 'app.bevi.ios'`, `buildNumber`, `supportsTablet:
  false`, `deploymentTarget: '16.4'` (Expo SDK 57's own floor, stated so it is
  a decision: it is the oldest iOS a friend can install on, and `minAppVersion`
  may never be raised above a version this target can run).
- `icon: './assets/icon.png'` (1024×1024, square corners, no alpha) and a
  wordmark launch screen in light and dark through the `expo-splash-screen`
  plugin, matching the in-app Splash.
- The camera and photo-library strings, through the `expo-image-picker`
  plugin, with the microphone string switched off.
- `ios.config.usesNonExemptEncryption: false`, so an upload does not stall on
  the export-compliance question.
- `ios.privacyManifests` with four required-reason declarations: UserDefaults
  `CA92.1`, file timestamp `C617.1`, disk space `E174.1`, system boot time
  `35F9.1`. **Unproven until a build is uploaded**: App Store Connect's answer
  (ITMS-91053 or silence) is the only real check. Budget one throwaway build.
- `scheme: 'bevi'`, `owner: 'bevi'`, `extra.eas.projectId` (the EAS project
  `@bevi/bevi` exists).
- `expo-build-properties` with `ios.enableSceneSupport: true`: the iOS 27 SDK
  (my Mac's Xcode 27.2) only launches apps on the UIKit scene life cycle, and
  SDK 57 adopts it only when asked. It works: `npx expo run:ios` builds and
  boots. Drop the option in the SDK 58 PR, where it becomes the default.

Landed in `app/eas.json` (#244, #257): `development` (simulator),
`development-device`, `preview`, `production`, all extending a `base` profile
that pins `ios.image` to `macos-tahoe-26.5-xcode-26.6` (the image for SDK 57).
`appVersionSource: "remote"` with `autoIncrement`, so nobody hand-edits a build
number. The image moves in the same PR as an SDK upgrade, never by itself.

Deliberately not in the config, each for a reason:

- **No location string and no Maps key.** The map is an "In progress" page in
  v1 (IS-6), so the binary asks for nothing it does not use. Both come back
  with the real map (IM-7).
- **No `infoPlist` block.** The plugins and `ios.config` cover everything so
  far.

Left:

- ~~A first real EAS build.~~ Done on Arjun's side on 2026-11-19: TestFlight
  shows 0.1.0 (3), so three builds have run on EAS and one was uploaded. None
  came from `ios.yml` or from my Mac. What they showed about the pinned image
  and about the privacy manifest (App Store Connect's ITMS-91053 mail, or
  silence) is his to report; I have not seen either.
- **`expo-updates`** — not installed. Install it before the first TestFlight
  build rather than after submission; it changes the release discipline and it
  is how a JS bug gets fixed without a review cycle (§6). Set the runtime
  version policy so an OTA update can never land on a binary missing a native
  module it needs, and read IA-9's note on what guidelines 2.5.2 / 3.1.1 allow
  OTA to change. Dependency PR first, then the plugin entry.
- **The SDK 58 upgrade**, as its own PR, with the image pin and the scene
  option changing in the same PR. Not urgent (Apple requires the iOS 27 SDK
  only from April 2027), and not before G1, so a native failure is never
  ambiguous between "the port" and "the upgrade".
- **`app/.env.example` says** "development and preview hold the dev backend's
  values, production the prod backend's". There is no dev backend (IS-2).
  Correct the comment when IS-2 is settled.
- ~~Sentry's config plugin (IS-4)~~: dropped with Sentry on 2026-11-19, nothing to add.

**Order still matters: dependency PR first, then the plugin entry.** A `plugins`
entry for a package that is not installed fails config resolution and
`expo-doctor`. And every new native dependency means the development build has
to be rebuilt (§6), so batch them where it is honest to: `expo-camera`,
`expo-application` (IM-9, on its branch), `expo-updates` and
`react-native-view-shot` are all still to come.
`expo-file-system` (#268) was the exception that needed no rebuild: `expo`
already depends on it, so it was in the binary before the app imported it.

**Check:** `npx expo-doctor` from `app/` (CI runs it with
`EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK=1` and the version check
`continue-on-error`, so local and CI differ; locally it was failing only the
advisory patch-version check on 2026-11-18). `npx expo run:ios` installs on the
simulator: **met**. An EAS build that installs on a phone: **met** (TestFlight
0.1.0 (3), from Arjun's machine). `eas build` from my Mac or from CI: **not
yet run**.

---

### IM-2 — First boot on a real iPhone (gate G1)

**Status: G1 reached on 2026-11-19.** TestFlight build 0.1.0 (3), uploaded
from Arjun's machine that day, opens on my iPhone, signed in, and shows the
feed on the real backend. It got there by TestFlight rather than by the
development build on a registered device that this section planned.

What it took, which was less than expected:

- **The bug reporter was closed on native** by `REPORTER_SUPPORTED`
  (`features/bug-report/supported.ts`) when G1 was reached; stage 1 of IM-10
  part 2 turns it on for iOS (`REPORTER_SUPPORTED` is now `web` or `ios`, and
  `loadHost.ts` is one file for both). Until that merges, `canReport` is never
  asked on native (`api/hooks/bugs.ts`). `bugs.canReport()` itself
  is Arjun's and did not change. The iOS bundle went from 7.0 MB to 6.3 MB with
  `html2canvas` gone from it.
- **The Map tab is `MapInProgressScreen`**, on both builds.
- **Find Bev is deleted** (`features/find-bev`, its CSS-module jest mapper),
  `CLEANUP.md` rows F-07 and F-10 with it.

Seen in the simulator: Feed, Lists, Add Bev, the new-Bev wizard, Search, Map,
Profile and Settings render on fixture data; sign-in and the feed work on the
real backend.

Left, none of it for the gate:

1. Write down which commit and which profile build 3 was made from. Nothing in
   the repository records it (§0.1).
2. A development build on my phone (`development-device`), for work that wants
   Metro on a real device (IM-6). That still needs my iPhone registered
   (`eas device:create`, IA-1; only Arjun can do identifiers and certificates
   on this account) and my Expo login added to the `bevi` org.

What the TestFlight build does not have, by design: the bug reporter (IM-10).
TestFlight's own Send Feedback is the stand-in for now.

**Gate G1 is:** the app opens on a registered physical iPhone, signs in with
username + password, and shows the feed.

---

### IM-3 — Session and everything else that assumed `localStorage`

**Status: done in code. The session persists (#247) and is refreshed when the
app returns to the front (#266). Three checks on a phone are left.**

Landed:

- `app/src/api/authStorage.ts` is the native adapter and it uses the
  **Keychain** (`expo-secure-store`), not AsyncStorage: one item per key,
  readable after first unlock, with an in-memory copy so reads do not wait.
  `authStorage.web.ts` is the old `localStorage` adapter under a new name.
- **The reinstall rule.** The Keychain outlives an uninstall, so a marker in
  AsyncStorage tells a fresh install from a relaunch; when the marker is
  missing the old session is wiped before anything reads it.
- Both adapters are tested explicitly (the native one in
  `api/__tests__/authStorage.test.ts`, 14 cases; the web one in
  `config.test.ts`, which imports `../authStorage.web` by name), which was the
  regression risk: jest resolves as iOS, so every existing suite moved onto the
  native adapter the moment the file was split.
- Recent searches persist in AsyncStorage on iOS (`features/add-bev/recents.ts`,
  #248).
- `clearLegacyStorage.ts` needed nothing, as predicted.
- **The foreground refresh (#266).** `app/src/api/sessionRefresh.ts` is one
  `AppState` listener: `startAutoRefresh()` from `@bevi/api` when the app is
  `active`, `stopAutoRefresh()` otherwise, and the current state applied once
  when it connects. `sessionRefresh.web.ts` does nothing. It is connected from
  `api/client.ts` right after `createBeviApi`, not from `queryLifecycle.ts` as
  first planned: the refresh has nothing to act on until the api exists, and
  only `client.ts` knows when that is. Those two controls are the one thing
  the app takes from `@bevi/api` outside `client.ts`.

Left:

- `features/bug-report/draft.ts` and `store.ts` assumed browser storage; stage 1
  of IM-10 part 2 gives them `draftStorage.ts` (AsyncStorage) beside
  `draftStorage.web.ts`.
- Three checks only a phone can give, on a build that contains #266: still
  signed in after a force-quit (swipe the app away in the app switcher), after
  a night in the background, and signed out after delete + reinstall. Jest
  replaces `client.ts` with the FakeApi, so the line that connects the refresh
  is proven by these and by nothing else.

Known and accepted (#247): a corrupt Keychain index would skip the reinstall
wipe; a full disk could repeat the wipe on each launch.

**Check:** sign in, force-quit, reopen — still signed in (**met in the
simulator**, real backend; on the phone, build 3 stays signed in after leaving
the app and coming back, a true force-quit **not yet tried**). Background it
overnight, reopen — still signed in (**not yet tried**).

---

### IM-4 — The sweep: web assumptions, guarded and unguarded

**Status: done (#248, #251, and Arjun's follow-up #255, merged 2026-11-19).**

| File | What it did on web | Native, as landed |
|---|---|---|
| `src/app/settings/privacy.tsx` | `fetch('/privacy.md')` | **Done.** Renders a copy bundled at build time (`scripts/gen-privacy-text.mjs` → `features/settings/privacyText.generated.ts`), no fetch; a test fails if the copy drifts from `public/privacy.md` |
| `useOnline` | `navigator.onLine` + `window` listeners | **Done**, and moved to `src/lib/`. NetInfo on iOS; only a missing connection counts as offline, not a failed reachability probe |
| `src/features/auth/focusField.ts` | focused a DOM input | **Done** through a small registry (`components/fieldFocus.ts`). Wired on sign-in, sign-up and the onboarding profile only; the New Bev details and other forms are not |
| `src/features/search/keyboardLift.ts` | visual-viewport maths | **Done.** Pure maths now; `lib/useKeyboardInset.ts` supplies the inset from the keyboard events on iOS |
| `src/features/search/SearchPanel.tsx` | `window.innerHeight` | Was already correct off the web. The real fix here was FlashList (below) |
| `src/lib/glass.ts` | `matchMedia` for reduced transparency | **Done.** `AccessibilityInfo` on iOS, `glass.web.ts` for the browser |
| `src/components/StatusBarClearance.tsx` | compensates for the home-screen status-bar hack | **Unchanged.** It returns 0 off the web, so it is harmless natively; what is left is IM-6's check that every top edge is right on a real phone |
| `src/features/ranking/Compare.tsx:61` | keyboard shortcuts | correctly web-only already; left |
| `src/lib/column.ts` | 480pt centred column on wide windows | no change. With `supportsTablet: false` there is no iPad build, only iPhone compatibility mode |
| ~~`src/features/find-bev/`~~ | CSS modules | **Deleted** (#245) |

Three things the table did not predict, all found by running the app:

- **React Query has to be told about the connection and the foreground**
  (`api/queryLifecycle.ts`, NetInfo and `AppState`). A browser tells it by
  itself; React Native does not, so a read that failed offline kept its error
  after the connection came back.
- **An app-wide "You're offline" strip** (`components/OfflineNotice.tsx`, #251)
  and **saves that fail at once offline** (mutations run with
  `networkMode: 'always'`). Both were decisions made after trying the build
  with Wi-Fi off. iOS does not always deliver "back online", so
  `lib/connectionStore.ts` is the one source for the strip and for React Query:
  it believes NetInfo's "offline" at once, and while offline sends a `HEAD` to
  our own backend every 5 seconds. The launch check runs again when the
  connection returns (`useSessionBootstrap`).
- **FlashList v2 keeps rows in place when rows arrive above them.** Recents
  loading from storage after Popular was showing landed out of sight; the
  search list turns `maintainVisibleContentPosition` off. Expect the same in
  any list that gains rows at the top.

Known, and carried into IM-6: a full-screen modal on iOS (the ranking flow,
New Bev, the photo viewer) covers the strip; the screens keep the old top inset
for about a frame when the strip appears or goes; the birthdate field's number
pad has no return key on iPhone.

**#255** (Arjun's, in `app/src/features/add-bev/`, merged 2026-11-19): a slow
storage read or write could publish an older Recents list over a newer edit.

`src/app/(tabs)/map/index.tsx` was rewritten by #245 and is rewritten again
when the real map lands; a one-owner file until then.

---

### IM-5 — Photos and the barcode scan, for real

**Status: the photo half is merged (#268, #269, 2026-11-19) and not yet proven
on a phone. The barcode half is not started.**

#### Photos (merged)

The pipeline was written around the browser: a file input, `fetch(objectURL)`
for a `Blob`, a canvas fallback. A React Native `Blob` handed to supabase-js
Storage uploads zero bytes with no error, so since contract 2.15.0
`media.upload` refuses one off the web, which meant that until #269 every photo
upload on a phone failed. As landed:

- `features/create-bev/photo.ts` is the native file: the picker, then
  `expo-image-manipulator` (fit to 1600px, or 512px for a profile photo, JPEG
  q0.85), then the saved file's bytes through `expo-file-system`'s
  `File.bytes()`. The upload gets a `Uint8Array`. `photo.web.ts` is the old
  browser code, unchanged; `photoCommon.ts` is what both share.
- It re-encodes every time, including when no resize is needed, because the
  re-encode is what drops EXIF and GPS. An image the decoder cannot handle is
  rejected (`UnsupportedImageError`), never uploaded as it came.
- `PreparedPhoto.blob` is now `PreparedPhoto.file: UploadPayload`. The bug
  reporter's evidence stays a `Blob` (web only) and checks for one at runtime.
- **A refused camera is a state.** `pickImage('camera')` asks for the camera
  first; a refusal sets `pickError` on the photo slot, keeps any photo already
  chosen, and `PhotoStatusLine` shows a line with an Open Settings button
  (`Linking.openSettings()`). The library asks for nothing: on iOS it is the
  system picker, which runs outside the app and needs no permission.
- The profile photo (`features/profile/useAvatarUpload.ts`) goes the same way.

Not done: the picker's cache copy and the saved JPEG are never deleted on
native. iOS clears its cache by itself; tidying them after an upload is a small
follow-up.

Owed on a phone, on a build that contains #269, because jest mocks every native
module on this path:

- the stored object is not 0 bytes;
- a HEIC photo straight from the iPhone camera decodes and uploads;
- the uploaded JPEG carries no location (download it and read its metadata:
  quietly uploading friends' home coordinates is exactly what the privacy
  questionnaire asks about);
- the camera prompt, the refused state, and Open Settings landing on Bevi's
  page in Settings.

#### The barcode scan (not started)

**It is the other half of this milestone, and it is a full rewrite rather than
a port.** `src/features/create-bev/BarcodeCamera.tsx` is
`getUserMedia` plus ZXing: it opens a `MediaStream`, draws frames and decodes
them in JavaScript. None of that exists on native.

- Replace it with `expo-camera`, which does barcode scanning on-device through
  AVFoundation — faster and more reliable than ZXing on frames, and it removes
  ZXing from the native bundle (it is still in there today). New dependency,
  own PR (§4), and a rebuild of the development build.
- `barcodeReader.ts` is worth reading before deciding what to keep: whatever in
  it is pure UPC handling stays, and only the frame-grabbing goes.
- The scanned UPC then flows exactly as it does today — into `bevs.upc` after
  creation, never passed through to `create_bev`.
- `__tests__/BarcodeCamera.test.tsx` mocks `getUserMedia`, so it belongs to the
  web project once IM-11 splits them, and the native path needs its own test.
- This is the path that shipped in #224 and whose **iPhone camera scan was never
  tested** — on web it was behind iOS Safari's HTTPS requirement. A native build
  is the first time it can actually be verified.
- **The simulator has no camera.** Library photos can be tested there
  (`xcrun simctl addmedia`); taking a photo and scanning a can cannot.
- **Coordinate before starting.** Arjun's BEV-13 (nutrition labels read on the
  device) is unpushed work in the same folder: `NutritionScan`,
  `NutritionCard`, `DetailsStep`, and a native text-recognition module under
  `app/modules/` that has never been compiled. Read that branch first, and
  batch `expo-camera` with it and with `expo-application` (IM-9) into one new
  build if the timing allows.

**Check:** take a photo on a device, add a Bev, confirm the image appears at the right size — and that the stored object is not 0 bytes (**not yet tried**: needs a build with #269). Scan a real can's barcode and confirm the UPC lands on the Bev (**not started**).

---

### IM-6 — Native chrome, polish, accessibility

**Status: not started. Wants a phone, so it follows G1.**

Everything here "works" on day one and looks wrong until it is done.

- **Safe areas.** Delete the `public/index.html` status-bar reasoning from your
  mental model; safe-area-context gives true insets. Re-check every screen
  bottom edge and the tab bar, which were tuned against that hack. Already
  learned: a native `SafeAreaView` takes its inset from the nearest
  `SafeAreaProvider`, which is how `BelowOfflineNotice` works.
- **`expo-glass-effect` and `expo-haptics` are installed and nothing imports
  either** (checked 2026-11-18). So this is not an audit of call sites: it is a
  decision about where real blur and real haptics belong, starting from none.
  Check glass against the design system with reduce-transparency on and off.
  With haptics, too many is worse than none.
- **Sheets.** `src/components/Sheet.tsx` is a React Native `Modal` plus
  Reanimated, chosen partly because `@gorhom/bottom-sheet`'s web support was
  unproven. On native, Modal presentation, backdrop and dismiss gestures behave
  differently, and the z-index coordination with `public/index.html` is
  meaningless. The component most likely to need real changes.
- **Full-screen modals cover whatever the root layout draws**, the offline
  strip included (#251). Anything meant to sit above everything has to be
  presented above the modals, not above the screens.
- **Keyboard.** `KeyboardAvoidingView` behaviour, `keyboardDismissMode`, and iOS
  keyboard events rather than the browser's visual viewport. Finish the return
  key: only the three auth forms move focus to the next field.
- **Scroll feel.** FlashList on native has real recycling and real bounce;
  re-check the long lists (YourLists is heaviest, per the jest heap notes) and
  any list that gains rows at the top (IM-4).
- **`hitSlop` is now available.** `app/CLAUDE.md` bans it because
  react-native-web ignores it. That rule was web-driven; relax it carefully, so
  the 44pt rule stays enforced one way.
- **A VoiceOver sweep on device:** focus order, the tab bar, sheets (focus
  trapping differs from the web dialog), and every `accessibilityLabel` read
  aloud. Plus Dynamic Type and dark mode on a real phone, not a browser at 375px.

---

### IM-7 — The map, natively

**Status: v1 scope is done. The Map tab is an "In progress" page (#245,
decided 2026-11-18), IS-6 is deferred and IA-7 (the iOS Maps key) is parked.
Everything below is for after v1.**

One thing to keep in hand for submission: Apple can reject a placeholder screen
under 2.1. The decision stands; keep the tab trivially hideable for the
submitted build so it is a one-line change if review asks.

`app/src/features/map/MapView.web.tsx` is 441 lines of Google Maps JavaScript
API driven by `@googlemaps/js-api-loader`, with `pinContent.ts` building DOM
nodes for Advanced Markers. None of that has a native equivalent.

- Add the native `MapView.tsx` (the bare file, per §1's split rule). **IS-6:**
  `react-native-maps` is older and better documented and does Apple or Google;
  `expo-maps` on iOS is Apple Maps only, alpha, and needs a notably newer iOS
  than our 16.4 target. Spike both briefly rather than pre-committing. Either
  way it is a new dependency with its own small PR.
- What survives untouched: `filters.ts`, `reconcile.ts`, `mapOptions.ts`'s
  constants, `attribution.ts`, `VenueList.tsx`, `VenuePanel.tsx`,
  `MapFilters.tsx`, `MapNotice.tsx`. The pure logic was written to be pure and
  it pays off here.
- Rewritten: marker rendering (`pinContent.ts` builds DOM), the single-instance
  re-parenting trick (a native map does not need it, and its billing reason
  changes), the full-screen transition, and `src/app/(tabs)/map/index.tsx`.
- `locate.ts` → `expo-location`. The `LocateResult` union and the timeout logic
  are pure and stay; only the provider changes. The copy does too: "Turn it on
  in your browser settings" becomes an iOS Settings path, with
  `Linking.openSettings()`. The location usage string goes into
  `app.config.ts` in the same PR. Keep **not** storing the position — IM-12's
  privacy answers depend on it.
- **Scope.** The map tab is no longer the parked Bev Maps port: as of
  2026-11-16 it is a Google map of where you and your friends have Bev'd. Build
  that natively rather than porting the web venue map, and settle the scope with
  Arjun first, because it decides which RPCs you need.

---

### IM-8 — Sharing and deep links

**Status: the share link is fixed (#267, 2026-11-19). Links into the app are
not started.**

- **Done.** `profileUrl()` returned `''` off the web, so Share profile on iOS
  opened the share sheet with nothing in it. Now `src/lib/webOrigin.ts` holds
  one constant, `WEB_ORIGIN` (`https://bevi-gamma.vercel.app`, until Bevi has a
  domain of its own), `features/profile/profileLink.ts` builds
  `WEB_ORIGIN/user/<id>` and hands it to the share sheet as a URL, and
  `profileLink.web.ts` keeps the page's own origin and the clipboard. The real
  share sheet has not been seen on a phone yet.
- `scheme: 'bevi'` handles `bevi://` (in the config since #244). For `https://`
  links to open the app you need three concrete things:
  `ios.associatedDomains: ['applinks:<domain>']` in `app.config.ts`; the AASA
  file served at `/.well-known/apple-app-site-association` as
  `application/json` with no redirect; and a check that `app/vercel.json`'s
  catch-all rewrite (`"/(.*)" → "/"`) and `expo export`'s `public/` copying
  actually leave it reachable. That last one is a real trap with the current
  `vercel.json`. The Associated Domains capability on the App ID is Arjun's to
  switch on.
- Expo Router handles routing once the link arrives; verify `/user/[id]`,
  `/bev/[id]` and the tab routes resolve from a **cold** start, not just warm.
- **When the web app is archived** (IS-1's plan once iOS works), the AASA file,
  the privacy URL and the support URL all need a new host first, and so does
  `WEB_ORIGIN`: every profile link already shared points at it.

---

### IM-9 — The update/maintenance gate

**Status: the screen is built and in review (below); the real read is blocked
on the second half of IA-2.** #240 landed the `app_config` table and
`get_app_config()`, and both are on the hosted database since 2026-11-19.
Still on `main`: `packages/api/src/meta.ts`
returns the hardcoded placeholder, and `AppConfig` is `{ minAppVersion,
maintenance }` with no `minContractVersion` or `maintenanceMessage`. Both rows
are seeded `'0.0.0'`, so the gate is decorative until a release raises it.

Mostly scaffolded already: `app/src/api/hooks/feed.ts:210` defines
`useAppConfig()` with a 5-minute `staleTime` and has no callers. The screen can
be built now against the FakeApi and the two fields added when the contract PR
lands.

**2026-11-19: the screen is built on a local branch
(`ui/bev-27-im-9-version-gate`), in review, not merged.** As built there: a
pure `gateFor()` that blocks only on a successful read (maintenance, or a
`minAppVersion` above the installed one) and is open for everything else; the
installed version read through `expo-application`, a new native module, with a
web file that reports none; maintenance laid over the app, which stays mounted
underneath; "update required" replacing the app; and FakeApi controls for the
config. Until IA-2's second half lands it is still decorative, since `meta.ts`
returns the placeholder. Two values it needs from us and does not invent: the
app's App Store id (App Store Connect, App Information, Apple ID) and a support
address to show. Both are null constants in `src/lib/appStore.ts` on the
branch.

- Add a blocking screen in `src/app/_layout.tsx` (single-owner file — claim it,
  land it, release it; #251 added the offline strip's host there) for two
  states: `maintenance`, and "your version is too old".
- **Read the native version, not the manifest one.** Compare
  `Constants.nativeAppVersion` / `nativeBuildVersion` (or `expo-application`)
  against `minAppVersion`, never `Constants.expoConfig.version`: with
  `expo-updates` installed, an OTA'd bundle's manifest version diverges from the
  installed binary exactly in the situation the gate exists for. Also compare
  `CONTRACT_VERSION` against `minContractVersion`.
- **The gate fails open.** If `meta.getAppConfig()` errors or has not resolved
  yet, render the app. Only a successful read showing `maintenance` or a
  too-old version blocks. A fail-closed gate plus a paused free Supabase project
  (`DEVELOPMENT-ARJUN.md` §2.3) bricks every installed binary at once.
- The too-old screen needs a working App Store link, no way past it, and a way
  to reach us. It is the only lever we have over a binary we cannot update — and
  see IA-9 on never raising `minAppVersion` above what every supported iOS can
  install.
- `app/src/testing/fakeApi/FakeApi.ts:2329` and
  `packages/conformance/src/index.ts:110` need the new `AppConfig` fields the hour
  Arjun's contract PR lands, or `npm test -w app` goes red.

---

### IM-10 — The bug reporter

**Status: part 1 (off on native) is done in #245. Part 2 stage 1 is built on
`ui/bev-27-im-10-native-reporter` (2026-11-19), not merged and unproven on a
phone; stage 2 is not started.**

`src/features/bug-report/` is ~6,500 lines built *on* the DOM: `html2canvas-pro`
redraws the page to a canvas, `pick.ts` / `pickMode.ts` / `trail.ts` hit-test
real elements, the layer is a portal appended to `<body>`, components are tagged
`data-report-ui`, and the whole `metro.minify.js` + `scripts/check-bundle.mjs`
component-name contract exists to serve it.

#### Part 1 — off on native (done; superseded for iOS by stage 1 below)

`REPORTER_SUPPORTED` closed it (IM-2). Consequences, which stage 1 changes as
noted:

- The web app keeps the reporter, so `metro.minify.js` and `check-bundle.mjs`
  stay exactly as they are.
- `check-bundle.mjs` is also what keeps `src/testing/**` out of a shipped
  bundle. Arjun's `ios.yml` now runs the same scan over a native export (#253).
- With no reporter and no Vercel logs, **a crash on a device is invisible**
  to us, apart from what Apple collects. That is **IS-4**: Sentry was dropped
  on 2026-11-19 and the in-house reporter that replaces it is not built. The
  next section says what exists meanwhile.
- **Done with stage 1:** `docs/bug-workflow.md` has a section on reporting from
  the iOS app, including what it does not do and that TestFlight's own
  screenshot feedback remains for accounts that are not internal reporters.

#### IS-4 — crash reporting (Sentry dropped; a seam and a boundary, no reporter)

**Decided 2026-11-19: no Sentry.** `@sentry/react-native` was wired on a
branch, merged into the integration branch, and taken out again the same day
in favour of an in-house crash reporter. **That reporter is not built**, and
what it will be is being decided elsewhere, not here. Nothing in the app
depends on Sentry now: no package, no config plugin, no environment value, no
build secret.

What that leaves **today**:

- **A native crash is visible only through Apple.** The crash reports Apple
  collects itself: TestFlight's crash feedback, App Store Connect, and Xcode's
  Organizer. Nothing of ours records one.
- **A JavaScript error the app catches is not recorded anywhere.** It
  reaches the seam below and stops there, because nothing is listening.

What is in the app, and stays whatever the reporter turns out to be:

- **A root error boundary.** The root layout exports `ErrorBoundary`
  (`src/components/RootError.tsx`), so a screen that throws while it renders
  shows "Something went wrong" with Try again in place of the whole app,
  instead of closing it. It renders outside every provider the layout sets
  up, so it uses none.
- **One seam, `captureError(error, context?)`** in
  `src/lib/crashReporting.ts`, called from two places: the boundary, once per
  error, and the query client (`src/api/queryClient.ts`) for a read or a save
  React Query gave up on. A reporter plugs in with `setCrashSink(fn)`. **No
  sink is registered**, so today `captureError` returns at its first line.
- **The rules a sink cannot get around**, because they are applied before it
  is called: an error the app expects is never handed over (every `ApiError`
  code but `unknown`: `isExpectedError`); the sink gets a plain `CrashReport`
  (name, message, stack, where it was caught), never the error object and
  never an `ApiError`'s `detail`; headers, tokens and the query string of
  every URL are removed first (`src/lib/crashScrub.ts`); and of a query's key
  only the family is passed, never an id or what someone typed.

Not there, and not to be assumed: anything that catches an uncaught error
outside React (a rejected promise nobody awaited, an error in a timer), any
record of a native crash, any upload of symbols or source maps, and any way to
trigger a test crash from the app.

#### Part 2 — the native port (wanted)

Not a file-by-file port: the sheets and the board intake are React Native and
server code already, and four things are the DOM.

| Piece | Web | Native replacement |
|---|---|---|
| Capture | `html2canvas-pro` redraws the DOM | `react-native-view-shot` (a real screenshot of the window). New native dependency, own PR |
| The layer | a portal on `<body>` | An overlay presented **above modals**, since a full-screen iOS modal covers anything in the root layout (the lesson of #251) |
| Select element | DOM hit-testing on `data-report-ui` | A registry of measured, named targets (`measureInWindow`), or a fiber walk from the touch point. The hard part, and the one to do last |
| Record steps | DOM events (`trail.ts`) | Route changes from Expo Router plus touches |
| Drafts | `draft.ts`, `store.ts` on browser storage | AsyncStorage, same split as `recents` |
| Evidence upload | a canvas Blob | **Bytes**, never a Blob (IM-5's rule). `packages/api/src/bugs.ts` already measures either shape; confirm the contract side with Arjun before relying on it |

Two stages, so testers get something early:

1. **Screenshot and note.** A report button, a window screenshot, the one-field
   note, and what the app sends by itself (route, build, device, iOS version).
   Reuses `ReportNote`, `RankSheet`, `ReportsSheet` and the existing hooks. This
   is most of the value and none of the hard part.
2. **Select element and Record steps**, once stage 1 is in testers' hands.

##### Stage 1, as built (2026-11-19)

Branch `ui/bev-27-im-10-native-reporter`. Contract 3.3.0 (the one commit that
touches `shared/` and `packages/api`): `BugReportInput.evidence[].file` is an
`UploadPayload`, `bugs.report` runs `toUploadBody` on each file before staging
anything (an RN `Blob` is refused with `'validation'`). Nothing in
`supabase/` changed: the `bug-report` function only ever sees uploaded objects
and accepts a native report as built (no element, no steps; `stepsSource`
defaults to `'typed'`, `targets` and `reproductionSteps` to empty).

| Piece | How |
|---|---|
| On/off | `REPORTER_SUPPORTED` is `web` or `ios`. `canReport()` is asked once the session is ready, as on the web; an ordinary account never mounts the reporter (`loadHost.ts`, one lazy `import()`). Metro puts it in the one bundle, so it is not evaluated rather than not downloaded |
| What each platform can do | `capabilities.ts` (iOS: no select, no steps, a screenshot first, no sheets over a full-screen flow) and `capabilities.web.ts` |
| Capture | `capture.ts`: `react-native-view-shot` `captureScreen`, JPEG q0.85, long side at most 1,600 px, bytes read with `expo-file-system`, a `Uint8Array`. `capture.web.ts` is the old `html2canvas-pro` file, unchanged |
| Capture timing | `layerHidden.ts`: the reporter's layer hides itself (opacity 0), says so from an effect, two frames pass, then the shutter; it shows again right after. A new note opens only after the picture (`store.openBlankNote`); a failed picture still opens the note, with a line saying so |
| The layer | `ReportLayer.tsx`: `FullWindowOverlay` from `react-native-screens`, a container added to the key window above any presented full-screen modal, passing touches outside its children to the app; not an accessibility modal. The note, the button and the toast are in it. `ReportLayer.web.tsx` is the old portal |
| The sheets | Filed reports and the rank sheet are the app's `Sheet` (a `Modal`), drawn beside the layer, and **closed over a full-screen flow** (`sheetsOverFullScreen: false`, `FULL_SCREEN_ROUTES`) with a line in the note. Unproven whether a second `Modal` over a presented screen would work; the guard can go if a phone says it does |
| Select / steps | `pickMode.ts` and `trail.ts` (iOS) have none: `startPickMode` and `startStepRecording` throw, which the engine answers as "not available"; the note does not draw the two actions. `pick.ts`, `pickMode.web.ts`, `trail.web.ts` and `componentFiles.generated.ts` are not in the iOS bundle |
| What is sent | `context.ts` (iOS) and `context.web.ts`; `contextCommon.ts` is shared. The environment allow-list has no field for a device model, an update or a runtime, so they ride in `platform` and `build` (see `docs/bug-workflow.md`). A new field would be a contract and server change |
| Drafts | `draftStorage.ts` (AsyncStorage read into memory once, written through in order; the host waits for it before restoring) and `draftStorage.web.ts` (`localStorage`). Only text, type, marks' details and the key are stored, never a picture |
| Tests | `nativeReporter.test.tsx` (the whole app as iOS), `nativeStore.test.ts`, `capture.test.ts`, `layerHidden.test.tsx`, `context.test.ts`, `trail.test.ts`, `draftStorage.test.ts`, `nativeEngine.test.ts`. The older reporter suites stay web suites: `jest.setup.js` gives them `supported: true` and the web's capabilities, and three were renamed `*.web.test.ts` because they test `.web` files |

Device checks only a phone can give (none has been run): the screenshot really
excludes the button and the note and includes a modal; the overlay passes a tap
beside the note to the app; scrolling the app under the layer; the keyboard and
the note's position inside the overlay; VoiceOver reaches the app around the
note; the note over the ranking flow, New Bev and the photo viewer; Filed
reports over a full-screen flow (the guard); a relaunch restores the text; what
the `build` line reads on a TestFlight build and on an OTA update.

Sequencing: after G2 and before the second TestFlight wave (friends). For the
first wave, the two of us, Apple's own crash reports plus TestFlight's built-in
feedback have to be enough (IS-4), and the reporter must not delay G1–G3. If it should ship in the first
store build rather than after, say so and it moves ahead of IM-12.

---

### IM-11 — A full iOS test suite

**Status: the existing suite is larger and more native than it looks (161
suites, 1,484 tests on `main` at `6ee7300`, all resolving as iOS). What does
not exist is anything that runs the real app. Asked for on 2026-11-18: a full
suite for iOS.**

The premise is the opposite of what it looks like. `jest-expo` inherits
`@react-native/jest-preset`'s `haste.defaultPlatform: 'ios'` with
`platforms: ['android','ios','native']` — 'web' is not among them. So **jest
already loads the native file of every pair, and the uncovered branch is web.**
But jest renders through a test renderer with every native module mocked. It
cannot see the Keychain, the camera, a real keyboard, a real safe area, a
modal's presentation or a real request. "A full iOS suite" is therefore four
layers, and only the first exists.

**Layer 1 — jest, as iOS (exists).** Keep the rule the last two days followed:
a native file is not done until it has a suite (`authStorage`, `queryLifecycle`,
`connectionStore`, `recents`, `useOnline`, `glass`, `fieldFocus`,
`OfflineNotice`, and since 2026-11-19 `sessionRefresh`, `profileLink` and
`photo`, all have one; the photo suite asserts the upload is bytes and not a
Blob). Add as milestones land: the `expo-camera` scan, the version gate
(fail-open especially), report and block.

**Layer 2 — a web jest project.** Nine `.web` files, and they are covered only
where a suite imports the `.web` file by name (`recents.web.test.ts`,
`MapView.web.test.tsx`, the web session adapter in `config.test.ts`); two more
suites flip `Platform.OS` for a single test (`MapChrome.test.tsx`,
`StatusBarClearance.test.tsx`). While the web build ships from the same
`main`, it needs the jsdom-flavoured `jest-expo/web` preset as a second
project. `getByRole('link')` / `href` assertions and
`__tests__/BarcodeCamera.test.tsx` (it mocks `getUserMedia`) belong to that
project only. Keep the heap tuning (`workerIdleMemoryLimit: '1GB'`): doubling
the projects makes it more relevant, and its comment is worth re-reading first.
This layer is deleted with the web build.

**Layer 3 — flows on the simulator (new).** The app, built, launched and
driven: sign in → feed; rank a Bev; create a Bev with a library photo; lists;
search and recents; profile and share; Settings › Privacy; delete account; the
offline strip; a relaunch that stays signed in; later the version gate and
report/block. Three decisions come with it:

- *The tool.* Maestro is the default choice for an Expo app: YAML flows, driven
  through the accessibility tree, no test code inside the app. Confirm it
  drives Xcode 27.2's simulator before committing: there is no Simulator.app
  on this Mac, the window is DeviceHub, and tools that assume the old app can
  break. `idb` is already proven here (`../bevi-wt/ios-tools/README.md`) and is
  the fallback.
- *The data.* **Flows must not run against the real backend**: there is one
  Supabase project and it is the live one (IS-2), so a flow that ranks, posts
  or deletes an account would do it to real data. Run them against the FakeApi.
  Today that is `ios-tools/harness-on.py`, a hand patch that must never be
  committed. Step one of this layer is making it a real, flagged build variant
  that `check-bundle.mjs` still guarantees is absent from a shipped bundle.
- *Where it runs.* It needs a Mac and a built app. Locally first. In CI it is a
  macOS runner, which is free while the repository is public and billed at a
  multiple of Linux minutes once it is private (the plan after iOS works), and
  the native build has to be cached so a JS-only change does not rebuild it.
  The workflow file is Arjun's (`chore/*`).

What layer 3 does not prove: `@bevi/api` on Hermes against Postgres. That is
the conformance suite's job (IA-3, IS-8) and the device gates'.

**Layer 4 — a device checklist.** What only a phone proves, written down so
G1–G4 are the same walk each time: camera and barcode, HEIC, a zero-byte
check in the bucket, the Keychain across a reinstall, a night in the
background, cellular and airplane mode, haptics, VoiceOver, Dynamic Type.
A short `docs/` page, walked by one of us per gate.

**I deliver `app/jest.config.js`, the suites and the flows; Arjun adds the
matching CI steps** in `chore/*` PRs once they land (`.github/` is his lane).

This matters more than usual: there are **no Vercel preview deploys** on this
repo, so CI and TestFlight are the only things between a branch and a phone.
And the suite showed its first flake the day it mattered (#258): a suite that
is sometimes red for no reason is one nobody reads. The second came a day
later (#270, open): `ReportButton.test.tsx` mounts the whole app for every
test, and its slowest test ran past 30 s on a busy runner with nothing wrong.
The lesson from both is the same: a test waits on the thing it asserts, not on
a fixed number of timer ticks or renders. The suites that mount the real route
tree are the slow ones (about five times slower on the CI runner than on a
laptop), so they are where the next one will come from.

---

### IM-12 — Store assets and submission (gate G4)

**Status: not started.**

Not code, but mine, and always underestimated:

- Screenshots at the required iPhone sizes (6.9" and 6.5"), from Arjun's seeded
  demo account (IA-8, merged as #259: `npm run demo:seed`) so they look alive.
  No iPad set needed while `supportsTablet: false`.
- Description, keywords, subtitle, promotional text, support URL, marketing URL.
- **Age rating questionnaire.** Beer, wine, spirits and cocktails in the
  catalog, so the alcohol question is a yes. Apple's tiers changed: as checked
  on 2026-11-18 they are 4+ / 9+ / 13+ / 16+ / 18+ and 17+ no longer exists, so
  "expect 17+" in the older notes means one of the top two; the questionnaire
  decides. The server-side `can_see_alcohol` gate is what makes a lower rating
  arguable — **IS-3**, decided with Arjun, not unilaterally.
- **App Privacy questionnaire.** Account data and photos are collected;
  location is used and never stored (and in v1 not used at all), which is a
  good answer to be able to give. "Not used for tracking" across the board,
  which is also why we need no ATT prompt (IA-10) — keep it that way.
- **TestFlight first (G3), and know which kind.** Decided 2026-11-18:
  **internal first**, the two of us as App Store Connect users; friends are a
  second wave, external, which needs **Beta App Review** plus a beta
  description and a feedback email. So report/block (IM-13) and a proven
  privacy manifest are needed before the second wave, not before the first.
- Review notes carry the demo username, password and a live invite code (IA-8),
  plus a line on the invite-only model, and a line about the Map tab if it is
  still an "In progress" page (IM-7).

---

### IM-13 — Report and block

**Status: decided for v1 (IS-7, 2026-11-18). Blocked on the contract half.**
The database half is merged and on the hosted database (#254, and #262 so a
post shown in Explore can be reported): 8 RLS policies, 1 view and 12 functions
now filter per viewer. The contract and `packages/api` half is **#261**, open:
`blocks.block / unblock / list` and `reports.report` (post, comment or
profile, with a reason), with the FakeApi to match. It was numbered 2.16.0 and
conflicts with `main`, which is 3.0.0 (§0.1), so it needs a rebase and a new
number on Arjun's side; its FakeApi half is mine to review. Then this.

Guideline 1.2: an app showing user-generated content needs content filtering, a
way to report objectionable content, a way to block abusive users, and published
developer contact. This is the most likely rejection on the whole list.

My half: a report/block sheet reachable from a post, a comment and a profile; a
Blocked accounts screen in Settings (`list_blocked_users` exists for it); and a
check that the blocked user's content actually disappears from the feed,
comments, search and followers lists. Most of the disappearing is done in the
database, so my lists mostly need to cope with a person who is no longer there.
One thing #254 leaves to me on purpose: a third party's profile can read
"following 2" above a list of one, because the counters stay instance-wide.
Decide whether that needs words.

The sheets can be built against the FakeApi before the contract lands, as long
as the shape is agreed in `#agents` first. Small screens, but they touch a lot
of lists — do not leave it to the week before submission.

---

### IM-14 — A place to watch the tests run

**Status: new, asked for on 2026-11-18. Not started, and it follows IM-11's
layer 3, because a page that replays a four-minute jest run is not worth
building; a page that shows the app being driven is.**

What it is for: when either of us pushes, one page shows that push being
tested, as it happens. Per run: the commit, the branch and who pushed; the jest
suites turning green or red as they finish; each simulator flow step by step
with its screenshots (or a recording); and the link to the Actions run. Across
runs: history per test, so a flake shows up as a pattern instead of a surprise.

How it works, in three parts that each stand alone:

1. **Emit.** A jest reporter and a wrapper around the flow runner post small
   events (run started, suite finished, step finished, screenshot) to one
   ingest endpoint. Nothing here needs a UI to be useful: the events are also
   the flake history.
2. **Store and push.** A table plus a realtime channel.
3. **Show.** A page subscribed to that channel.

Open, and worth settling before any code:

- **Where it lives.** The founders' board is the natural home: it is private,
  it already signs the two of us in, and it has its own Supabase project with
  realtime, so parts 2 and 3 are a "Tests" tab there, in the board's
  repository rather than this one. The alternative is to build nothing and use
  GitHub's own run page (it streams logs live) plus a job summary; that costs
  an afternoon and gives no step-by-step view of a flow.
- **The ingest secret** is a CI secret, so it runs into §1's admin question.
- **What may be shown.** Only FakeApi runs, so no real person's data is ever
  on the page. A flow against the live backend must never post screenshots.

---

## 3. Open decisions (need both of us)

Same list as Arjun's doc, from the app side:

| # | Decision | What it changes for me | Default |
|---|---|---|---|
| ~~IS-1~~ | Does the web app stay? | — | **Decided 2026-11-18: web stays for now**, and once iOS works the repository goes private and the web build is archived. So native code is written to let web be removed cleanly (§1's split rule), and until then the policy/support URLs and the AASA host stay free |
| IS-2 | Which backend does TestFlight hit? | `eas.json` profiles, env vars, and whether simulator flows may touch a backend at all (IM-11) | **Open, and the stated default is impossible.** There is one hosted Supabase project, not a dev/prod pair, and the org is at the free plan's two-project limit — so all three EAS environments point at the live database and a TestFlight tester writes to real data. Fine while it is the two of us; not fine for anyone else. The real fix costs money |
| IS-3 | Demo account age / alcohol visibility | The age-rating answers and what review sees | Over 21, alcohol visible, and whichever top tier the questionnaire gives (IM-12) |
| IS-4 | Crash reporting | Whether a device crash is visible at all | ~~Yes, `@sentry/react-native`~~ **Decided 2026-11-19: not Sentry.** It was wired and removed the same day in favour of an in-house reporter, which is **not built**. Today: a root error boundary and a `captureError` seam with scrubbing and no sink (IM-10, "IS-4 — crash reporting"); native crashes are visible only through Apple's own reports. Whether G3 waits for the reporter is open |
| ~~IS-5~~ | Bundle id | **Decided 2026-11-17: `app.bevi.ios`** — the exact string for `ios.bundleIdentifier` in `app.config.ts`, team prefix `9NA45GL4CJ` | settled |
| ~~IS-6~~ | `react-native-maps` or `expo-maps` | — | **Deferred 2026-11-18:** the Map tab is an "In progress" page in v1, so IM-7 shrinks to that and IA-7 (the iOS Maps key) is parked. Decide when the real map is built |
| ~~IS-7~~ | Report-content + block-user for v1? | — | **Decided 2026-11-18: ships in v1.** Database half merged (#254, #262); the contract and `packages/api` half is #261, open and waiting for a rebase onto 3.0.0; then IM-13 |
| ~~IS-8~~ | Where the conformance suite lives (Arjun's doc, IA-3) | `app/src/testing/conformance.ts` moves out of my lane into a shared `packages/conformance`; `app`'s FakeApi test becomes an import, and the FakeApi itself stays where it is | **Answered 2026-11-18: option B, the extraction**, posted in `#agents`. The move is PR #260, open; it conflicts with `main` because #221 changed the suite after the move was cut. Mine to review once it is rebased |
| IS-9 | *New here, not yet in Arjun's doc.* What simulator flows run against, and where | IM-11 layer 3 and IM-14 | The FakeApi build variant, on a Mac locally first, a macOS runner second |
| IS-10 | *New here.* Is the native bug reporter in the first store build? | Where IM-10 part 2 sits relative to IM-12 | Stage 1 before the friends wave, not a blocker for G1–G3 |

Not a numbered decision but it needs one of us to act: **the admin question in
§1.** Until it is settled, I create the `ios` environment and paste in the
secrets Arjun generates. Not done yet, and not needed while builds come from
his machine. Two smaller things in the same family, both mine to do: accept
the Expo org invite (until then my Mac cannot list or start a build), and hand
over the App Store id and a support address for IM-9's screen.

## 4. Not colliding with Arjun

- **One owner at a time for `src/app/_layout.tsx`** and
  `src/app/(tabs)/_layout.tsx`. IM-9 needs `_layout.tsx` next; the offline
  strip's host is already in it (#251). Other branches add routes as new files
  only.
- **`src/app/(tabs)/map/index.tsx`** is rewritten again by IM-7.
- **`app.config.ts` and `eas.json` are single-owner files for this project.**
  Every milestone wants to add a plugin or a permission string. When a later
  milestone must touch one, do it in a PR that touches nothing else.
- **New dependencies get their own small PR, before the plugin entry that needs
  them.** Installed so far: `expo-build-properties`, `expo-dev-client`,
  `expo-secure-store`, `@react-native-community/netinfo`, `expo-file-system`
  (#268). Still to come: `expo-application` (IM-9, on its branch),
  `expo-camera` (IM-5), `expo-updates`,
  `react-native-view-shot` (IM-10 part 2), and after v1 `expo-location` and the
  map library. One lockfile at the root, `npx expo install` from `app/`, never
  `npm install` inside `app/` without `-w`. **After a pull that changes the
  lockfile, run `npm ci`**: stale `node_modules` fail in ways that look like
  bugs (a missing `@react-native-community/netinfo` stops every jest suite at
  setup).
- **`shared/src/` only through `contract/*`**, one `CONTRACT_VERSION` bump in
  flight at a time, and post to `#agents` before merging a bump. #221 (contract
  3.0.0) landed on 2026-11-19. Bumps still to come, in a queue: IS-7's surface
  (#261), IA-2's fields, then BEV-13's and BEV-22's; the three that exist were
  each numbered 2.16.0 and need new numbers above 3.0.0 (§0.1). A breaking bump
  is cheap before the first store binary and expensive after it (IA-3's N, N-1,
  N-2 rule), and a TestFlight binary is already on a phone.
- `app/src/testing/` is mine but it is what keeps Arjun's contract PRs green.
  When a contract PR lands, the FakeApi and conformance update is urgent, not
  background.
- CI steps for suites I add are Arjun's `chore/*` PRs (IM-11).
- A PR that changes something a person can see on the web says so under
  "Visible on the web after merge": web still deploys from the same `main`.
- Branches as always: `ui/bev-27-im-5-photos`, ticket id in the branch and the
  PR title. Run `integrator-app` before opening a PR.

## 5. Order of work

```
done ─ IM-1 ── IM-2 ── IM-3 ── IM-4 ── IM-5 photos ── IM-8 share link
                  │
                  └─ TestFlight 0.1.0 (3), 2026-11-19 ─────── G1: it launches on a phone ✓

now, no phone needed:   merge #270 (flaky test) · review and land IM-9 (built, local)
                        review #260 and #261 once rebased · IM-13 sheets on the FakeApi
                        IM-5 barcode on expo-camera, after reading BEV-13's branch
needs a new build:      photo, share, camera-refused and session checks (IM-3, IM-5, IM-8)
needs a phone:          IM-5 barcode · IM-6 ─────────────────── G2: every core flow works

IM-9 (needs IA-2's contract half) ──┐
IS-4 (in-house) · expo-updates ─────┤
IM-11 layers 2–4 ───────────────────┴──────────────────────── G3: internal TestFlight

IM-13 (needs IS-7's contract) · IM-10 part 2 stage 1 ──────── second wave: friends
IM-12 ─────────────────────────────────────────────────────── G4: submitted

after v1:  IM-7 the real map · IM-10 part 2 stage 2 · IM-14 can start once layer 3 exists
```

IM-13 is needed for the friends wave rather than for G3, because the first
TestFlight build is internal (IM-12) and only an external build is reviewed.
IM-7's real map does not block anything in v1.

Nothing here is Done because a PR merged. G1–G4 are confirmed on a phone, by one
of us.

## 6. How a change reaches a phone now

On the web, a merge to `main` was a deploy: Vercel rebuilt, and both of us saw
the same thing at the same address minutes later. Git has not changed —
branches, PRs, squash merges, `app.yml` on every PR — and the web build still
deploys from `main` that way. What changed is that **a merge no longer puts
anything on a phone.** An iOS app is three things that travel separately:

| What changed | How it reaches a running app | Who sees it |
|---|---|---|
| JavaScript / TypeScript (nearly every PR) | A **development build** loads it live from Metro on the developer's own Mac. A TestFlight or store build has it baked in | Development: only the person running Metro, from whatever branch their checkout is on, committed or not. Everyone else: nobody, until a new build or an OTA update |
| Native code: a new native dependency, a plugin or permission in `app.config.ts`, an SDK upgrade | Only by building a new binary (`npx expo run:ios` locally, or EAS) | Whoever installs that binary. An old development build running new JS that needs a missing native module fails at launch |
| Data and backend (migrations, RPCs) | Immediately, as before | Both of us at once: there is one Supabase project (IS-2) |

So what I see in DeviceHub is **my Mac's simulator running my working tree**
(the worktree `../bevi-wt/ios`). It is not what Arjun sees. For him to see the
same code he pulls `main`, runs `npm ci`, and runs his own build and his own
Metro; if a native dependency changed since his last build, he rebuilds first.
What we do share instantly is data: a Bev I rank in the simulator on the real
backend is in his feed.

The ways two people get onto the *same* build, in the order they become
available:

1. **A development build each, same commit.** Today's state. Agreement is by
   git: same commit, same code.
2. **A device build from EAS** (`development-device`, after G1): one binary,
   installable on every registered phone, still loading JS from each person's
   Metro.
3. **TestFlight** (G3): `ios.yml` builds on a manual dispatch or a `v*` tag,
   one binary from one commit, and both of us install that exact build. This is
   the real replacement for "it is on Vercel", but it is per build, not per
   merge: tens of minutes, build minutes that cost money, then Apple's
   processing. **Where this stands on 2026-11-19:** TestFlight is in use, but
   by hand. Build 0.1.0 (3) was built and uploaded from Arjun's machine, not by
   `ios.yml`, with no tag. So "which commit is on my phone" has no answer in
   the repository yet; until the workflow makes the builds, tag the commit a
   build was cut from, or write it in `#agents`.
4. **`expo-updates`** (not installed yet): a JS-only change published to a
   channel reaches every installed build with the same runtime version, in
   minutes and without a review. The nearest thing to a Vercel redeploy, with
   two limits: it cannot carry native changes, and the guidelines only allow it
   for fixes, not for changing what the app does.

What "a version" means now:

- **`version`** in `app.config.ts` (0.1.0): the marketing version a person sees.
  Changed by hand, in a PR.
- **Build number**: EAS increments it on every build (`appVersionSource:
  remote`, `autoIncrement`). Never edited by hand.
- **A git tag `v*`** per release build, which is what triggers `ios.yml`.
- **`CONTRACT_VERSION`** and its `contract/x.y.z` tags: what the backend
  promises. A binary on someone's phone keeps calling the contract it was built
  with for months, so the backend supports the current minor and the two before
  it (IA-3), and anything older is told to update by the gate (IM-9).
- **Runtime version** (with `expo-updates`): which binaries a given JS update
  is allowed to land on.

The discipline that follows: merging stays cheap, releasing becomes deliberate.
A release is a tag on a commit whose checks are green, built once, tested as
that build, and promoted; it is not rebuilt from a later commit because
something small changed.
