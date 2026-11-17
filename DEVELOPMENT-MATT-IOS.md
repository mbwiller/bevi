# Bevi — iOS development plan: Matt (the app on a real device)

Companion to `DEVELOPMENT-MATT.md`. That document still governs the design
system, the screens and `packages/ranking`; this one covers only what changes
because the app stops being a web page added to the home screen and becomes a
native binary on the App Store.

Written 2026-11-17, when the decision of 2026-10-11 ("Bevi is a web app only")
was reversed. Arjun's half is `DEVELOPMENT-ARJUN-IOS.md`. Milestones here are
`IM-n`, Arjun's are `IA-n`, shared ones `IS-n`; a new namespace, nothing in
`TASKS.md` is renumbered.

## 0. The good news first

Nothing about this app is architecturally web-bound. It is Expo SDK 57 on React
Native 0.86 with Expo Router, which is a native stack that happens to be
exported for the web. There is no rewrite here. The work is three things:

1. **Config that was deliberately never written** — `app.config.ts` is 19 lines
   with a comment saying native builds will never happen, there is no
   `eas.json`, no `icon` key and no splash. Mechanical, about a day.
2. **Places where a web implementation is the only implementation** — the
   session in `localStorage`, the map on the Google Maps *JavaScript* API, the
   bug reporter on `html2canvas`, sharing on `window.location`, the Privacy
   screen on `fetch('/privacy.md')`, the offline state on `navigator.onLine`.
   These are the project.
3. **Native behaviour you have never had to care about** — real safe areas,
   real blur, real haptics, keyboard avoidance, permission denials, VoiceOver.

About ten files need real attention. Do not go by the `Platform.OS` count: the
two worst couplings (the Privacy screen and `useOnline`) contain no
`Platform.OS` at all, so the guards understate the sweep rather than bound it.
IM-4 lists what actually needs doing.

## 1. Lane, unchanged

Mine: `app/` (now including `app.config.ts`, `eas.json`, icons, splash, every
native path and everything under `app/src/testing/`), `packages/ranking/`,
`design/`.

Arjun's: `supabase/`, `packages/api/`, `data/catalog/`, `scripts/`, every secret
and hosted account, `.github/workflows/`.

In practice for this project: Arjun hands me **values** (bundle id, EAS project
id, Apple team id, registered device UDIDs, the iOS Maps key, the Sentry DSN)
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

## 2. Milestones

Ordered. IM-1 and IM-2 are the critical path; everything from IM-3 on can be
parallel branches as usual, one concern per branch.

---

### IM-1 — Build config, and a build that exists

Blocked on **IA-1** for the real values and the registered device UDIDs (a
device build will not install on an unregistered phone). You can start on the
simulator.

`app/app.config.ts` needs:

- `ios: { bundleIdentifier, buildNumber, supportsTablet: false, config: { googleMapsApiKey }, infoPlist: { … } }`
- `icon: './assets/icon.png'`. The asset is already 1024×1024, 8-bit RGB with
  no alpha, so it complies — the gap is that the config sets only
  `web.favicon`, so a prebuild today would ship Expo's default icon. Check the
  corners are square (Apple applies the rounding and rejects pre-rounded art).
- A splash config. `expo-splash-screen` is already a dependency and is **not**
  in `plugins`.
- `infoPlist` usage strings, each shown verbatim to the user and a rejection
  risk if vague:
  - `NSCameraUsageDescription` — one string covers both uses, so it has to
    name both: "Bevi uses the camera to photograph a drink you're adding and to
    scan a barcode."
  - `NSPhotoLibraryUsageDescription` — for `launchImageLibraryAsync`.
  - `NSLocationWhenInUseUsageDescription` — the map's locate button only; say it
    is never stored, because it is not.
  - `ITSAppUsesNonExemptEncryption: false` — otherwise every *build upload* to
    App Store Connect stalls on an export-compliance question.
- **`ios.privacyManifests`.** The plugins generate Info.plist usage strings;
  they do **not** declare required-reason APIs, which are the app's own. With
  AsyncStorage as the session store (IM-3) and `expo-constants` reading it, the
  binary touches `NSUserDefaults` → declare
  `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`; `expo-updates`
  and the image picker add file-timestamp (`C617.1`) and disk-space (`E174.1`).
  Without a `PrivacyInfo.xcprivacy`, App Store Connect answers the upload with
  **ITMS-91053, "Missing API declaration"**, and the build is not
  distributable. Also confirm each third-party pod ships its own privacy
  manifest and signature (Sentry does; verify whichever map library IS-6
  picks). Budget one throwaway build for this.
- **State the iOS deployment target explicitly.** Nothing in the repo says it:
  `app/package.json`'s `browserslist` `iOS >= 16` is a web statement. It decides
  which friends' phones can install at all, it is the floor for `minAppVersion`
  (IA-9), and it constrains IS-6 — `expo-maps`' map views need a notably newer
  iOS than `react-native-maps`. Verify SDK 57 / RN 0.86's default with
  `npx expo config --type introspect` after a prebuild, and raise it only
  through `expo-build-properties`.
- `scheme: 'bevi'` for deep links (IM-8).
- **Name the toolchain, and do not change two things at once.** `main` is on
  Expo SDK 57; SDK 58 is now npm `latest`. Do the first native build on **57**
  and take SDK 58 as its own PR afterwards, so a native failure is never
  ambiguous between "the port" and "the upgrade". Matt's Mac has Xcode 27.2, and
  SDK 57's changelog has a "Staying on SDK 57 with Xcode 27" opt-in (scene
  support) that nobody here has tested — try it early, because if it does not
  hold, the SDK 58 upgrade stops being optional and moves ahead of G1. The EAS
  build image in `ios.yml` is pinned to match whichever SDK is current (IA-9).
- Keep `web` exactly as it is if IS-1 keeps the web app.

New files and dependencies:

- `app/eas.json` — `development` (with `"ios": { "simulator": true }`, or the
  build wants registered devices), `preview` (TestFlight, dev backend),
  `production` (TestFlight → store, prod backend). Which backend each profile
  points at is **IS-2**.
- `expo-updates` — not installed. Install it now rather than after submission;
  it changes the release discipline and it is how a JS bug gets fixed without a
  review cycle. Set the runtime version policy so an OTA update can never land
  on a binary missing a native module it needs, and read IA-9's note on what
  guidelines 2.5.2 / 3.1.1 allow OTA to change.
- **Order matters: dependency PR first, then the plugin entry.** A `plugins`
  entry for a package that is not installed fails config resolution and
  `expo-doctor` — which is IM-1's own check. That applies to `expo-location`,
  `expo-updates` and the Sentry plugin, each of which gets its own small PR
  (§4).
- `app/.gitignore` already ignores `ios/` and `android/` under a
  Continuous-Native-Generation comment: nothing to change, prebuild on the build
  server, never commit the native projects.
- `app/.env.example` gains the iOS Maps key, noted as an **EAS** env var.

**Check:** `npx expo-doctor` clean from `app/` (note CI runs it with `EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK=1` and the version check `continue-on-error`, so local and CI differ), and `eas build --platform ios --profile development` installs on the simulator.

---

### IM-2 — First boot on a real iPhone (gate G1)

Expect import-time crashes, not runtime bugs. Stub the two big web-only
subsystems and get everything else up:

- Gate the bug reporter on `Platform.OS === 'web'` at its three call sites —
  `app/src/app/_layout.tsx:127`, `app/src/app/settings/index.tsx:21`,
  `app/src/app/report-bug.tsx:16`, all via `useCanReportBug` — so `ReportHost`
  never mounts natively. `bugs.canReport()` itself is Arjun's and does not
  change. Note this puts IM-2 in `src/app/_layout.tsx`, the single-owner file
  IM-9 also needs: sequence them, do not run them in parallel.
- Leave `MapView.tsx` as the placeholder it already is, so nothing loads
  Google's JS.
- **G1 is not blocked on IM-3.** `webAuthStorage()` falls back to an in-memory
  `Map` when `localStorage` is undefined, so one launch signs in fine — it just
  will not persist. Get to the feed first, then fix persistence properly.

**Gate G1 is:** the app opens on a registered physical iPhone, signs in with
username + password, and shows the feed.

---

### IM-3 — Session and everything else that assumed `localStorage`

`app/src/api/authStorage.ts` is `webAuthStorage()`: a `localStorage` adapter
with an in-memory fallback for Safari private mode. On Hermes there is no
`localStorage`, so every launch is a cold, signed-out launch.

- Split it: keep `authStorage.web.ts` as is, add a native `authStorage.ts` on
  `@react-native-async-storage/async-storage` (already a dependency — no
  lockfile churn). `AuthStorageAdapter.getItem` already returns
  `string | null | Promise<string | null>`, so an async store needs no signature
  change anywhere. Consider `expo-secure-store` for the refresh token instead;
  AsyncStorage is unencrypted and the threat is a jailbroken or backed-up
  device. A sentence of thought, not a week.
- **Watch the test fallout.** `jest-expo` resolves with
  `defaultPlatform: 'ios'` (from `@react-native/jest-preset`), so the moment
  `authStorage.ts` becomes the native file, **every existing suite silently
  switches onto the AsyncStorage adapter**. That is the regression risk in a
  milestone that otherwise looks mechanical — see IM-11.
- Call Arjun's new refresh control (IA-5) from an `AppState` listener, so a
  session that sat backgrounded overnight refreshes on resume. Neither half
  works alone.
- Same sweep for the other storage users:
  `app/src/features/bug-report/draft.ts` and `store.ts`,
  `app/src/features/add-bev/recents.ts`.
- `app/src/lib/clearLegacyStorage.ts` is **already safe**: `defaultStorage()`
  returns null when `globalThis.localStorage` is undefined and everything is in
  a try/catch. Verify and leave it; there is no legacy storage on a fresh
  install to clear.

**Check:** sign in, force-quit, reopen — still signed in. Background it overnight, reopen — still signed in.

---

### IM-4 — The sweep: web assumptions, guarded and unguarded

| File | What it does on web | Native |
|---|---|---|
| `src/app/settings/privacy.tsx:11` | `PRIVACY_URL = '/privacy.md'`, then `fetch`es it. No origin on native, so Settings › Privacy renders its error state — and it is a screen review will open | Bundle the markdown as an asset, or fetch the canonical https URL (the same base constant IM-8 needs) |
| `src/features/create-bev/useOnline.ts` | `navigator.onLine` + `window` listeners; on Hermes it reports online forever and the listeners never attach | `@react-native-community/netinfo` (new dependency, own PR), or derive from the `ApiError('network')` Arjun adds in IA-5 |
| `src/features/auth/focusField.ts` | focuses a DOM input | `TextInput` ref + `.focus()` |
| `src/features/search/keyboardLift.ts` | visual-viewport maths | delete the web path and use `src/lib/useKeyboardInset.ts`, which already has `keyboardWillShow`/`keyboardWillHide` listeners and a comment saying they are unused while the app is web-only |
| `src/features/search/SearchPanel.tsx:242` | `window.innerHeight` | **already** falls back to `height` from `useWindowDimensions` off the web — this is coverage, not implementation |
| `src/components/StatusBarClearance.tsx` | compensates for the `apple-mobile-web-app-status-bar-style` hack | delete the hack; `react-native-safe-area-context` reports real insets |
| `src/lib/glass.ts` | `matchMedia` for reduced transparency | `AccessibilityInfo.isReduceTransparencyEnabled` + `useColorScheme` |
| `src/features/ranking/Compare.tsx:61` | keyboard shortcuts | correctly web-only already; leave it |
| `src/lib/column.ts` | 480pt centred column on wide windows | no change. Drop the "still right on iPad" reasoning: with `supportsTablet: false` there is no iPad build, only iPhone compatibility mode (and if we ever want iPad, that is a decision that also changes IM-12's screenshot set) |
| `src/features/find-bev/` incl. `spike/overlay.module.css`, `SpikeOverlay.web.tsx` | CSS modules, which do not exist natively | **delete the feature** — Find Bev was dropped on 2026-11-16 |

The Find Bev deletion also rewrites `src/app/(tabs)/map/index.tsx`, whose whole
body is `MapTabWithSpike`, to render `MapView` directly — and that is the file
IM-7 replaces. **Land IM-4 before IM-7 starts**, or let IM-7 take the deletion.
`jest.config.js`'s `.module.css` mapper goes away with it.

---

### IM-5 — Photos and the barcode scan, for real

Blocked on **IA-4** (the contract widening `UploadMediaInput.file`).

`app/src/features/create-bev/photo.ts` is written around the browser:
`expo-image-picker` creating an `<input type="file">`, `fetch(objectURL)` for a
`Blob`, a canvas re-encode fallback, `revokeIfBlob`. Natively the picker returns
a `file://` URI and there is no `Blob` worth having — and a React Native `Blob`
handed to supabase-js Storage **uploads zero bytes with no error**, the nastiest
bug waiting in this project.

- Rework `photo.ts` around URIs: `expo-image-manipulator` resizes natively (the
  1600px / q0.85 constants are fine), and the upload passes bytes per the new
  contract shape.
- Drop the canvas fallback and `UnsupportedImageError`'s web reasoning on
  native; the native decoder either handles it or throws.
- **HEIC.** iPhones shoot HEIC by default. The server allows `image/heic`, but
  check what the picker hands you after manipulation and confirm the path end to
  end.
- **EXIF/GPS.** The web path strips location data as a side effect of the canvas
  re-encode. Native manipulation may not. Verify — quietly uploading friends'
  home coordinates is exactly what the privacy questionnaire asks about.
- **Permission denial** is a real state now, not a browser dialog: a user who
  taps "Don't Allow" needs copy and `Linking.openSettings()`.

**The barcode scan is the other half of this milestone, and it is a full
rewrite rather than a port.** `src/features/create-bev/BarcodeCamera.tsx` is
`getUserMedia` plus ZXing: it opens a `MediaStream`, draws frames and decodes
them in JavaScript. None of that exists on native.

- Replace it with `expo-camera`, which does barcode scanning on-device through
  AVFoundation — faster and more reliable than ZXing on frames, and it removes
  the ZXing dependency from the native bundle. New dependency, own PR (§4).
- `barcodeReader.ts` is worth reading before deciding what to keep: whatever in
  it is pure UPC handling stays, and only the frame-grabbing goes.
- The scanned UPC then flows exactly as it does today — into `bevs.upc` after
  creation, never passed through to `create_bev`.
- `__tests__/BarcodeCamera.test.tsx` mocks `getUserMedia`, so it belongs to the
  web project once IM-11 splits them, and the native path needs its own test.
- This is the path that shipped in #224 and whose **iPhone camera scan was never
  tested** — on web it was behind iOS Safari's HTTPS requirement. A native build
  is the first time it can actually be verified.

**Check:** take a photo on a device, add a Bev, confirm the image appears at the right size — and that the stored object is not 0 bytes. Scan a real can's barcode and confirm the UPC lands on the Bev.

---

### IM-6 — Native chrome, polish, accessibility

Everything here "works" on day one and looks wrong until it is done.

- **Safe areas.** Delete the `public/index.html` status-bar reasoning from your
  mental model; safe-area-context gives true insets. Re-check every screen
  bottom edge and the tab bar, which were tuned against that hack.
- **`expo-glass-effect`** now does real UIKit blur instead of the translucent
  fallback. Check against the design system, with reduce-transparency on and off.
- **`expo-haptics`** now actually fires. Audit every call site; what was a no-op
  is now a buzz, and too many is worse than none.
- **Sheets.** `src/components/Sheet.tsx` is a React Native `Modal` plus
  Reanimated, chosen partly because `@gorhom/bottom-sheet`'s web support was
  unproven. On native, Modal presentation, backdrop and dismiss gestures behave
  differently, and the z-index coordination with `public/index.html` is
  meaningless. The component most likely to need real changes.
- **Keyboard.** `KeyboardAvoidingView` behaviour, `keyboardDismissMode`, and iOS
  keyboard events rather than the browser's visual viewport.
- **Scroll feel.** FlashList on native has real recycling and real bounce;
  re-check the long lists (YourLists is heaviest, per the jest heap notes).
- **`hitSlop` is now available.** `app/CLAUDE.md` bans it because
  react-native-web ignores it. That rule was web-driven; relax it carefully, so
  the 44pt rule stays enforced one way.
- **A VoiceOver sweep on device:** focus order, the tab bar, sheets (focus
  trapping differs from the web dialog), and every `accessibilityLabel` read
  aloud. Plus Dynamic Type and dark mode on a real phone, not a browser at 375px.

---

### IM-7 — The map, natively

Blocked on **IS-6** and on **IA-7** if IS-6 picks Google.

`app/src/features/map/MapView.web.tsx` is 441 lines of Google Maps JavaScript
API driven by `@googlemaps/js-api-loader`, with `pinContent.ts` building DOM
nodes for Advanced Markers. None of that has a native equivalent.

- Add `MapView.ios.tsx`. **IS-6:** `react-native-maps` is older and better
  documented; `expo-maps` is newer, Expo-native, can render Apple Maps (which
  removes the Google key and the billing surface entirely) and raises the iOS
  deployment target. Spike both briefly rather than pre-committing. Either way
  it is a new dependency with its own small PR.
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
  `Linking.openSettings()`. Keep **not** storing the position — IM-12's privacy
  answers depend on it.
- **Scope.** The map tab is no longer the parked Bev Maps port: as of
  2026-11-16 it is a Google map of where you and your friends have Bev'd. Build
  that natively rather than porting the web venue map, and settle the scope with
  Arjun first, because it decides which RPCs you need.

---

### IM-8 — Sharing and deep links

- `src/features/profile/useShareProfile.ts` reads `window.location` and returns
  `''` off the web. Replace with a canonical https base URL constant plus React
  Native's `Share`.
- `scheme: 'bevi'` handles `bevi://`. For `https://` links to open the app you
  need three concrete things: `ios.associatedDomains: ['applinks:<domain>']` in
  `app.config.ts`; the AASA file served at
  `/.well-known/apple-app-site-association` as `application/json` with no
  redirect; and a check that `app/vercel.json`'s catch-all rewrite
  (`"/(.*)" → "/"`) and `expo export`'s `public/` copying actually leave it
  reachable. That last one is a real trap with the current `vercel.json`, and
  another reason IS-1 should keep the web app.
- Expo Router handles routing once the link arrives; verify `/user/[id]`,
  `/bev/[id]` and the tab routes resolve from a **cold** start, not just warm.

---

### IM-9 — The update/maintenance gate

Blocked on **IA-2**, and mostly scaffolded already:
`app/src/api/hooks/feed.ts:210` defines `useAppConfig()` with a 5-minute
`staleTime` and has no callers.

- Add a blocking screen in `src/app/_layout.tsx` (single-owner file — claim it,
  land it, release it; IM-2 touches it too) for two states: `maintenance`, and
  "your version is too old".
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
- `app/src/testing/fakeApi/FakeApi.ts:2405` and
  `app/src/testing/conformance.ts:110` need the new `AppConfig` fields the hour
  Arjun's contract PR lands, or `npm test -w app` goes red.

---

### IM-10 — The bug reporter: off on native for v1

`src/features/bug-report/` is ~6,400 lines built *on* the DOM: `html2canvas-pro`
redraws the page to a canvas, `pick.ts` / `pickMode.ts` / `trail.ts` hit-test
real elements, the layer is a portal appended to `<body>`, components are tagged
`data-report-ui`, and the whole `metro.minify.js` + `scripts/check-bundle.mjs`
component-name contract exists to serve it.

**Recommendation: ship v1 with it off on native** (the three call sites in
IM-2), and say so in `docs/bug-workflow.md` so a tester on a phone knows what
they have lost. Porting it means `react-native-view-shot` for capture and
fiber-walking from touch coordinates for picking — a project of its own.

Three consequences to accept out loud:

- The web app keeps the reporter, so `metro.minify.js` and `check-bundle.mjs`
  stay exactly as they are. Do not "simplify" them during IM-1.
- `check-bundle.mjs` is also the only thing keeping `src/testing/**` out of a
  shipped bundle, and it runs only on the **web** export. Arjun adds the same
  scan for the native bundle in `ios.yml` (IA-9); flag it if that step is not
  there before G4.
- With no reporter and no Vercel logs, **a crash on a device is invisible.**
  That is **IS-4**: crash reporting before TestFlight. Arjun owns the account and
  the build secret; I wire the SDK, its config plugin, and the dSYM/source-map
  upload — without which the reports are unsymbolicated and useless.

---

### IM-11 — Tests that would catch a native regression

The premise here is the opposite of what it looks like. `jest-expo` inherits
`@react-native/jest-preset`'s `haste.defaultPlatform: 'ios'` with
`platforms: ['android','ios','native']` — 'web' is not among them. That is
exactly why `MapView.tsx`'s comment says "this is what jest renders: the
placeholder". So **the suite already runs as iOS, and the uncovered branch is
web.** Only two suites flip the platform, for one test each and restored in a
`finally` (`MapChrome.test.tsx:124`, `FindBevScreen.test.tsx:44`, via
`Object.defineProperty`; `StatusBarClearance.test.tsx:60` assigns directly).

- Add a **web** jest project, which needs the jsdom-flavoured `jest-expo/web`
  preset — a bigger change than flipping a flag, and the reason this milestone
  is not a footnote.
- The urgent part is IM-3: splitting `authStorage.ts` silently moves every
  existing suite onto the native adapter. Cover both adapters explicitly.
- `getByRole('link')` / `href` assertions in those two suites are
  react-native-web semantics and do not exist in a native project — they belong
  to the web project only.
- `MapView.web.test.tsx` gets an `.ios` sibling (IM-7).
- Keep the heap tuning (`workerIdleMemoryLimit: '1GB'`): doubling the projects
  makes it more relevant, and the comment explaining it is worth re-reading
  before touching it.
- **I deliver `app/jest.config.js` and the suites; Arjun adds the matching CI
  step to `app.yml`** in a `chore/*` PR once they land (`.github/` is his lane).

This matters more than usual: there are **no Vercel preview deploys** on this
repo, so CI and TestFlight are the only things between a branch and a phone.

---

### IM-12 — Store assets and submission (gate G4)

Not code, but mine, and always underestimated:

- Screenshots at the required iPhone sizes (6.9" and 6.5"), from Arjun's seeded
  demo account (IA-8) so they look alive. No iPad set needed while
  `supportsTablet: false`.
- Description, keywords, subtitle, promotional text, support URL, marketing URL.
- **Age rating questionnaire.** Beer, wine, spirits and cocktails in the
  catalog, so the alcohol question is a yes; expect 17+. The server-side
  `can_see_alcohol` gate is what makes a lower rating arguable — **IS-3**,
  decided with Arjun, not unilaterally.
- **App Privacy questionnaire.** Account data and photos are collected;
  location is used and never stored, which is a good answer to be able to give,
  so do not let IM-7 start storing it. "Not used for tracking" across the board,
  which is also why we need no ATT prompt (IA-10) — keep it that way.
- **TestFlight first (G3), and know which kind.** Internal testers must be
  users on the App Store Connect team; anyone else is external, and the first
  external build needs **Beta App Review** plus a beta description and a
  feedback email. If our testers are external, G3 is a review gate: IS-7 and the
  privacy manifest have to be done by then.
- Review notes carry the demo username, password and a live invite code (IA-8),
  plus a line on the invite-only model.

---

### IM-13 — Report and block, if IS-7 says yes

Guideline 1.2: an app showing user-generated content needs content filtering, a
way to report objectionable content, a way to block abusive users, and published
developer contact. We have none of the first three — `CommentsApi` is `list` /
`add` / `remove` (own comments only), and `bevs.report` is catalog moderation,
not UGC. This is the most likely rejection on the whole list.

My half, once Arjun ships the contract, RPCs and RLS: a report/block sheet
reachable from a post, a comment and a profile, with the blocked user's content
actually disappearing from the feed, comments, search and followers lists. Small
screens, but they touch a lot of lists — do not leave it to the week before
submission.

## 3. Open decisions (need both of us)

Same list as Arjun's doc, from the app side:

| # | Decision | What it changes for me | Default |
|---|---|---|---|
| IS-1 | Does the web app stay? | `.ios.tsx` splits (keep) vs replacements and a big deletion (drop). Dropping also removes `react-native-web`, `html2canvas-pro`, `@googlemaps/js-api-loader` and most of IM-4 — but kills the bug reporter, the policy URLs and the AASA host | Keep web |
| IS-2 | Which backend does TestFlight hit? | `eas.json` profiles and env vars | `preview` → dev, `production` → prod |
| IS-3 | Demo account age / alcohol visibility | The age-rating answers and what review sees | Over 21, alcohol visible, 17+ |
| IS-4 | Crash reporting | Whether a device crash is visible at all. I wire the SDK, the config plugin and dSYM upload | Yes, `@sentry/react-native` |
| IS-5 | Bundle id | Unchangeable once registered | `com.bevi.app` |
| IS-6 | `react-native-maps` (Google) or `expo-maps` (Apple Maps option) | IM-7's whole implementation, whether IA-7's key exists, and the iOS deployment target | Spike at IM-7 |
| IS-7 | Report-content + block-user for v1? | IM-13 exists or does not | Ship it; it is the difference between one review round and three |

## 4. Not colliding with Arjun

- **One owner at a time for `src/app/_layout.tsx`** and
  `src/app/(tabs)/_layout.tsx`. IM-2 and IM-9 both need `_layout.tsx`:
  sequential, never parallel. Other branches add routes as new files only.
- **`src/app/(tabs)/map/index.tsx`** is touched by IM-4's deletion and rewritten
  by IM-7. Land IM-4 first.
- **`app.config.ts` and `eas.json` are single-owner files for this project.**
  Every milestone wants to add a plugin or a permission string. Batch them into
  IM-1 where possible; when a later milestone must touch it, do it in a PR that
  touches nothing else.
- **New dependencies get their own small PR, before the plugin entry that needs
  them:** `expo-updates`, `expo-location`, `expo-dev-client` (if we want the dev
  client rather than a plain debug build), `expo-camera` (IM-5's barcode scan),
  `@react-native-community/netinfo`, the map library, `@sentry/react-native`,
  possibly `expo-secure-store` and `expo-build-properties`. One lockfile at the root, `npx expo install` from
  `app/`, never `npm install` inside `app/` without `-w`.
- **`shared/src/` only through `contract/*`**, one `CONTRACT_VERSION` bump in
  flight at a time, and post to `#agents` before merging a bump. Arjun's order
  is IA-4 then IA-2.
- `app/src/testing/` is mine but it is what keeps Arjun's contract PRs green.
  When IA-4 or IA-2 lands, the FakeApi and conformance update is urgent, not
  background.
- CI steps for suites I add are Arjun's `chore/*` PRs (IM-11).
- Branches as always: `ui/im-3-native-session`, `ui/im-7-native-map`, ticket id
  in the branch and the PR title. Run `integrator-app` before opening a PR.

## 5. Order of work

```
IA-1 ── IM-1 ── IM-2 ───────────────────────────── G1: it launches on a device
                  │
                  ├── IM-3 ──┐
                  ├── IM-4 ──┤  (independent; four parallel branches)
                  ├── IM-5 ──┤  (IM-5 needs IA-4)
                  └── IM-6 ──┴───────────────────── G2: every core flow works

IM-9 (needs IA-2) ── IM-10 ── IM-11 ── IM-13 ───── G3: TestFlight + crash reporting
IM-7 (needs IS-6, IA-7) ── IM-8
IM-12 ──────────────────────────────────────────── G4: submitted
```

IM-3 through IM-6 are independent of each other and of the map. IM-7 is the long
pole after G2 and should not block G1, G2 or G3 — the placeholder map is an
acceptable TestFlight state as long as we tell the testers. IM-13 is at G3, not
G4, because an external TestFlight build is reviewed against the same
guidelines.

Nothing here is Done because a PR merged. G1–G4 are confirmed on a phone, by one
of us.
