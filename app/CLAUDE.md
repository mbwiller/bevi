# app/ — the Bevi Expo app (Matt's lane)

Read before any change here: this file, `DEVELOPMENT-MATT.md` §3–§7 and the section for your screen in §6, and the design system (below). The `ui-screen` agent builds one screen or component per branch; run `integrator-app` before opening a PR.

## Sources of truth, in order

1. **Design system** — https://claude.ai/artifact/WAYjGiTd5Fu938F6vv6Dyn, mirrored in `design/system/project/`: `README.md` (rules, voice, colour use), `tokens.json`, `components/index.d.ts` (component names and props), `components/*/preview.html` (every state). It supersedes DEVELOPMENT-MATT §4/§5 where they differ. Don't edit `design/system/` by hand; the design changes in the artifact first and the mirror is re-synced.
2. **Contract** — `@bevi/shared` (`shared/src/`): `BeviApi`, domain types, enums, `ApiError`. Contract v0 is not merged yet; until it is, don't build anything that needs API or domain types (mock API, screens with data).
3. **Ranking maths** — `@bevi/ranking`: the placement state machine, scores, `bucketForScore`, band constants. Never reimplement a formula or a threshold in the app.

## Rules

- **Tokens only.** Colours, spacing, radii, sizes, type and motion come from `@/theme` (`app/src/theme/tokens.ts`). No raw hex, no magic numbers for anything a token names. Read colours through `useTheme()` so dark mode works. `tokens.test.ts` fails if `tokens.ts` (colours, spacing, radii, sizes, type, elevation) drifts from `design/system/project/tokens.json`; to change a token, change the design system, re-sync the mirror, then update `tokens.ts`.
- **Components keep the design system's names and props** (`ScoreBubble`, `BevRow`, `BucketButton`…) in `app/src/components/<Name>.tsx`, adapted to React Native (`onClick` → `onPress`, `className` dropped, `style` allowed). Where the design system's local types differ from the contract, the contract wins: use `@bevi/shared`'s `Bucket` (`'LOVED' | 'FINE' | 'DISLIKED'`, as `@bevi/ranking` uses and as requested in the contract v0 review) and its Bev field names.
- **Score colour** is `scoreColor(score, bucket?)` from `@/theme`: the bucket when known, else `bucketForScore` from `@bevi/ranking`. Scores display with `formatScore` (one decimal) from `@/lib/format`.
- **Types from `@bevi/shared` only.** Never define a local `Bev`, `Ranking`, `Profile` or API type. If a screen needs something the contract lacks, propose a `contract/*` PR; no workarounds.
- **Backend only through `BeviApi`** (`app/src/api/client.ts`, mock or real via `EXPO_PUBLIC_BEVI_API`). The app never imports `@supabase/supabase-js`.
- **Auth** is username + password (decided 2026-10-11): `signUp({ username, password, inviteCode })`, `signIn({ username, password })`, `getSession`, `onAuthChange`, `signOut`, `deleteAccount`. The username is the handle (handle rules apply on the sign-up form). No OAuth, no emails, no password-reset flow (an admin resets passwords). The session lives in `localStorage` via the `authStorage` adapter.
- **Icons:** `lucide-react-native`, names as in the design system README (category → icon map lives client-side). **Lists > 20 rows:** `@shopify/flash-list`. **Images:** `expo-image`. **Animation:** Reanimated, transform and opacity only, with reduced-motion fallbacks. **Sheets:** the app's `Sheet` component (`src/components/Sheet.tsx`: React Native `Modal` + Reanimated). Not `@gorhom/bottom-sheet`: its web support is unproven and no drag gestures are needed.
- **Accessibility:** every touchable has an `accessibilityLabel` and a 44pt hit area (`size.target`: `HitTarget` or `TARGET_MIN` from `src/components/HitTarget.tsx` if the visual is smaller; never `hitSlop`, which react-native-web ignores); never colour-only meaning; dense rows set `maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}`.
- **Copy** follows the design system's "Voice and copy": Bev / Bev'd / Want to Try, sentence case, no emoji, scores to one decimal.
- **One owner at a time** for `src/app/_layout.tsx` and `src/app/(tabs)/_layout.tsx`. Other branches add routes as new files only.
- **Alcohol:** the three alcoholic categories are hidden wherever `canSeeAlcohol` is false.

## Dependencies

One lockfile, at the root. Add packages with `npx expo install <pkg>` from `app/` (picks SDK-compatible versions and writes the root lockfile) or `npm install <pkg> -w app` from the root for non-native packages. Never run `npm install` inside `app/` without `-w`, and never commit `app/package-lock.json`. The core stack (Expo Router, TanStack Query, Zustand, FlashList, expo-image, Reanimated, Lucide, SVG, AsyncStorage, glass effect, haptics) is already installed so parallel branches don't collide on the lockfile; anything else gets its own small PR.

Expo SDK 57 (latest stable on 2026-10-10; 58 is canary). Routes live in `src/app/` (Expo Router picks it up; no config). Web only (decided 2026-10-11): no native builds, so `ios/` and `android/` are never generated (still ignored).

## Commands (from the repo root)

```
npm run typecheck -w app     # tsc
npm test -w app              # jest-expo: token parity, components, lib
npm start -w app             # Expo dev server (web is the target; Expo Go is not)
npx expo-doctor              # from app/: SDK version and config checks
npm start -w app -- --web    # the same app in a browser (react-native-web)
```

Bevi ships only as a web app (decided 2026-10-11): `npx expo export --platform web` (from `app/`) builds a single-page app into `app/dist/`. Vercel deploys it with `app/vercel.json` (project root directory `app`). Git auto-deploy is off (`git.deploymentEnabled: false`); deploys are manual with `vercel deploy --prod` from the repo root. `public/` holds the HTML shell, `manifest.json` and the home-screen icons, so it can be added to the iPhone home screen. No EAS, App Store, TestFlight or Android.

Native-only APIs need a web path or get dropped: `expo-glass-effect` → a translucent fallback; `expo-haptics` → no-op on web; session → `localStorage`; camera → `expo-image-picker` (file input with camera capture on web). Check each library on web as its component is built.
