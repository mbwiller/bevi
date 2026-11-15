> Historical proof-of-concept notes. See [the current implementation and release checklist](../barcode-nutrition.md).

# Barcode nutrition proof of concept

Branch: `ui/barcode-nutrition-poc`. Worktree: `/tmp/bevi-barcode-poc`.

Enable with `EXPO_PUBLIC_NUTRITION_SCAN_POC=1` when starting/exporting the app.
In Add a new Bev, go to Details → Nutrition label → Scan barcode.
Photo upload remains available. No OCR, database writes, or nutrition persistence.
The preview stays on the Details step after the two-second reveal but is discarded
when that step unmounts. Product name is displayed so the tester can confirm the match;
it does not overwrite the Bev form.

Lookup uses Open Food Facts API v2 through BeviApi. Only barcode digits leave the
phone; video is decoded on-device with ZXing. Results include source attribution
and explicit serving/100 g or 100 ml basis. Missing nutrients are “Not listed”,
never zero. Camera requires HTTPS (localhost works on the development computer,
but plain HTTP over a LAN IP does not work on iPhone).

## Run locally

From this worktree, `npm ci`, then provide the two public Supabase configuration
values as documented in `app/.env.example`. Run:

```
EXPO_PUBLIC_NUTRITION_SCAN_POC=1 npm start -w app -- --web
```

For iPhone, serve an exported build on HTTPS or deploy this branch to an isolated
preview with the opt-in variable set. Do not merge or deploy to production for this test.
A production data backend is still used if configured; completing the New Bev form
creates a real Bev, so testing the scanner does not require submitting the form.

## iPhone checklist

Test Safari first, then the home-screen install if available:

- Allow rear camera; scan 3–5 drinks with different packaging, including water
  (zero calories), a sugary drink, and an energy drink. Record barcode, matched
  product, lookup delay, missing fields, serving basis, and comparison to package.
- Enter the same barcode manually to distinguish camera decoding from lookup coverage.
- Confirm card fades in, holds fully visible for two seconds, fades out, and remains
  readable on the Details step. Repeat with Reduce Motion enabled.
- Unknown barcode or missing nutrition: clear message and existing photo upload.
- Deny camera: manual digits still work; close and use photo upload.
- Close while scanning, while permission is pending, and during lookup: camera
  indicator turns off; late results do not reopen the sheet.
- Background/lock the phone and use browser Back: camera stops and can be restarted.
- Repeat scans; check portrait/landscape, large text, dark mode and VoiceOver.

## Deliberately deferred

Saving structured nutrition, associating it with a Bev, product mismatch correction,
editing nutrient values, QR codes, barcode photo decoding, and OCR. Any production
persistence should be a separate contract/backend change after coverage is proven.
The API addition is additive (contract 3.1.0) and must be split into a contract PR
before integration, per repository lane rules.

## Local verification

- `npm run typecheck`: all workspaces and scripts.
- `npm test -w packages/api`: includes parsing, missing nutrients, zero values,
  serving basis, grams-to-milligrams conversion, invalid codes and provider errors.
- `npm test -w app -- --runInBand --silent`: scanner lifecycle, animation timing,
  cancellation and existing app regressions.
- `EXPO_PUBLIC_NUTRITION_SCAN_POC=1 EXPO_PUBLIC_SUPABASE_URL=https://ci-placeholder.supabase.co EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci npx expo export --platform web --clear`
  from `app/`: compile with the same placeholder configuration used in CI.
  These are build-only placeholders, not working backend credentials.
- `EXPO_PUBLIC_SUPABASE_URL=https://ci-placeholder.supabase.co node app/scripts/check-bundle.mjs`.
- Live GET for barcode `5449000000996` returned Coca-Cola Original, a 330 ml serving,
  145 kcal and 36 g sugar. Response included `Access-Control-Allow-Origin: *`.
  This verifies one lookup and CORS headers, not iPhone camera behavior or general coverage.

No deployment or physical-device test has been performed. Local public Supabase
settings were subsequently recovered from the published app and written to ignored
`app/.env.local`. The prototype is enabled there. No linked Vercel project is present.
The local server runs on port 8087; an HTTPS preview is still needed for iPhone camera testing.

Verification results: all 105 app suites / 773 tests passed; API had 88 passed
and 20 live tests skipped without a configured stack. Workspace/script typechecking,
web export and bundle scan passed. Initial new tests exposed test-harness issues
(async render and Jest dynamic import handling); these were corrected before the
passing full run. The first cached export failed the URL-inlining guard; rebuilding
with `--clear` passed. Physical-device checks above remain outstanding.

For a standalone demo without sign-in, also set `EXPO_PUBLIC_NUTRITION_SCAN_DEMO=1`.
This renders only the nutrition demo instead of the authenticated app shell.
The local prototype server has both flags enabled; open http://localhost:8087.

Visual iteration: Bevi wordmark, spring entrance, staggered nutrient rows and a
one-shot fizz animation, with reduced-motion fallbacks. Entrance allowance is
450 ms, full visibility is 2 seconds, exit is 250 ms. The standalone demo has
“Try a sample” to replay a real lookup without opening the camera.
Camera requests an ideal 1920×1080 feed, contains the full frame in the preview,
and enables ZXing TRY_HARDER. The app does not mirror its video preview. These
changes have not been verified against a physical Mac/iPhone barcode scan.
Targeted shell, scanner and animation checks: 28 tests passed.

Latest motion preference: opacity-only card and nutrient-row fades. Removed the
spring, scale, slide and rising fizz. Timing is 250 ms in, 2 seconds held, 250 ms out.

Selected design: gallery option 04, Purple masthead, for both light and dark mode.
Applied to NutritionCard using primary/onPrimary for the header, primary rules and
calorie typography, theme surface for the panel, and theme text for nutrient rows.
The card retains the printed label hierarchy and opacity-only reveal.
