# Barcode nutrition for new Bevs

> This is the barcode route. A drink Open Food Facts has never heard of has its
> panel read off a photo instead, on the device, with no service and no
> credential: `docs/nutrition-label-ocr.md` (BEV-13, contract 3.1.0), which is
> why `NutritionPreview` now carries a `source` and why `barcode` and
> `sourceUrl` can be null.

Selected design: gallery option 04, Purple masthead, in both themes. The label
fades in for 250 ms, holds for two seconds, and fades out for 250 ms. No bounce,
scale, slide or ambient animation. The result remains readable after the reveal.

## Behavior

New Bev → Details → Scan barcode (UPC-A/EAN-8/EAN-13), or existing label photo
upload. The camera decodes on-device; only barcode digits go to Open Food Facts.
A successful lookup shows the product name and serving basis. “Use this label”
is required to attach nutrition to the draft; cancel or an unknown barcode does
not attach anything. Remove nutrition clears it. The selection survives moving
between the details and duplicate-check steps. Uploading a label photo still
works independently; it is never OCR-processed by this feature.

Creation stores a bounded, validated snapshot with the new Bev in one database
transaction. The Bev page shows the same themed label and source attribution.
Serving-based values are never mixed with per-100 g/ml values; missing values
stay null and render as “Not listed”; normalized sodium grams become mg. Daily
Values and nutrients absent from the provider are not invented. The stored data
is a user-confirmed database match, not a verified transcription of the package.

## Implementation and rollout

Merge in order (three separate reviews):

1. `contract/barcode-nutrition`: contract 2.14.0, NutritionPreview, optional
   nutrition capability, optional CreateBevInput.nutrition and Bev.nutrition.
2. `be/barcode-nutrition`: API lookup and persistence, migration
   `20261115214237_barcode_nutrition.sql`, pgTAP and API tests.
3. `ui/barcode-nutrition`: camera, confirmation, wizard state, saved-label UI,
   the selected design and app regression tests.

Apply the migration to the target environment before deploying the UI. The new
`create_bev_with_nutrition` wrapper preserves the old create_bev signature and
its quota, photo ownership, age gate and duplicate handling. It intentionally
passes no UPC to the old RPC, whose UPC shortcut could return an existing Bev.
The barcode is stored in the nutrition snapshot; this is not a product-identity
or automatic-merge feature. Old create callers still work. Bev reads tolerate
an older backend without the new table. If the create RPC migration is missing,
Bev creation retries without the nutrition snapshot and asks the user to acknowledge
that omission before leaving the result. Apply the migration before deploying the UI
to preserve nutrition during normal use.

The new table has RLS and SELECT only for authenticated viewers who can see the
parent Bev. No direct client INSERT/UPDATE/DELETE. Snapshot validation runs before
creation, and rejects missing/extra keys, invalid URLs, bad types and amounts,
empty nutrition, and oversized input. Only the fixed Open Food Facts product URL
for the supplied barcode is accepted.

There are no new secrets, backend services, or deployed Edge Functions. Lookup
is a browser request with timeout and cancellation; 429 has an explicit retry
message. The camera stops on capture, close, unmount, browser back and background.
The no-sign-in demo is guarded by `__DEV__` plus
`EXPO_PUBLIC_NUTRITION_SCAN_DEMO=1`. A production export does not bypass sign-in,
even with that flag set. Design-gallery HTML lives under docs, not public/.

## Verification

All tests below used an isolated local Supabase project, bevi-nutrition-test,
on ports 553xx. No production migration or catalog write was performed.

- `npm run typecheck`: all workspaces and scripts passed.
- `npm test -w app -- --maxWorkers=2 --silent`: 141 suites, 1,368 tests passed.
- `npm test -w packages/api`: 148 unit tests passed; live tests skip without local
  configuration. `nutrition.live.test.ts` was also run explicitly against the
  isolated API and passed (signup, upload, create, sign out/in, reload, validation).
- `supabase db reset` then `supabase test db` in the isolated test project:
  40 files, 1,818 tests passed, including the 23 nutrition/RLS/validation checks.
- `npx expo export --platform web --clear`: passed, including an export with
  the demo flag deliberately set. `node app/scripts/check-bundle.mjs`: passed.
- Headless Chromium against that production export: sign-in gate held; real
  photo upload → mocked provider lookup → confirmation → real local create
  persisted nutrition; reload showed the saved label; light/dark screenshots
  were inspected; no browser page errors. This used fake camera video and a
  provider fixture, not a real barcode scan.

Initial verification caught stale generated component metadata and two test
fixture assumptions (profile column name and an active Bev requiring a photo).
The fixtures and generated registry were corrected and the suites above rerun.

## Required before release

A real iPhone check is still required: Safari and a home-screen install,
rear-camera focus and barcode detection on 3–5 actual drinks, product/serving
match, light/dark/Reduce Motion, camera denied, close during a pending permission
request, background/lock/unlock and retry, camera indicator off after leaving.
Database coverage is not guaranteed; unknown/missing products must retain the
upload fallback. Browser automation does not establish iPhone scan reliability.

Do not merge/deploy the UI until this device check passes. To make the local
no-login demo reachable from an iPhone, start the web dev server (for example,
`npx expo start --web --port 8088`) and run a temporary HTTPS tunnel in a second
terminal (for example, `cloudflared tunnel --url http://localhost:8088`). Open
the HTTPS hostname printed by the tunnel while it is running. The hostname is
ephemeral and is not production hosting. The production build still requires
sign-in.
