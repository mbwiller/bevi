# Nutrition read off the label, on the device

`docs/barcode-nutrition.md` covers the barcode route: scan a UPC, look it up in
Open Food Facts, confirm, store. It is instant and free and stays the first
thing the app offers. It also has no answer for a drink the database has never
heard of, which is a great many of them — a local soda, a bubble tea, a
kombucha. This is the other half: the app reads the Nutrition Facts panel out
of a photo of the package.

A reading is **a draft transcription of the person's own photo, confirmed by
them**. Not a database match, not verified, not attributed to anyone else.

## It runs on the phone

There is **no service, no credential and no per-scan cost**, and the photo
never leaves the device. Apple's Vision framework — the engine behind Live Text
— does the recognition, and a parser in the app turns its text into values.

This was not the first design. The first design sent the photo to an Edge
Function that called a hosted vision model, which meant an API key, a cost per
scan, a network round trip, and users' photographs going to a third party. The
platform turned out to already ship the thing we needed, so that whole half was
deleted: no `nutrition-ocr` function, no `claim_label_ocr`, no rate limit (there
is no spending to meter), and no `NutritionApi.scanLabel`. Contract 3.10.0 keeps
only what the snapshot itself needs — `source`, and a nullable
`barcode`/`sourceUrl`.

| Piece | Where |
|---|---|
| Contract 3.10.0 | `shared/src/`: `NutritionPreview.source` (`'openfoodfacts' \| 'label-ocr'`), nullable `barcode`/`sourceUrl`. No new API method. |
| Text recognition | `app/src/features/create-bev/textRecognition.ts` → a local Expo module over `VNRecognizeTextRequest`. `textRecognition.web.ts` reports unavailable. |
| The parser | `app/src/features/create-bev/nutritionPanel.ts` |
| Persistence | `public.create_bev_with_nutrition_v2(...)`, `bev_nutrition.source` widened |
| Reading it back | `packages/api/src/mappers.ts` (`mapNutrition`) |
| Screen | `NutritionScan.tsx`, `NutritionCard.tsx` |

Web keeps barcode scanning and the plain label-photo upload; it does not offer
the label read, because `react-native-web` has no Vision and a button that
cannot work is worse than no button.

## What the parser will and will not say

The governing rule is that **being wrong is worse than being blank**. A value
the label does not clearly state stays null and renders as "Not listed". A
basis that cannot be pinned down fails the whole reading, rather than pair
per-serving numbers with the wrong quantity. `bevs.upc` is never touched by a
reading: a photo read must not claim product identity, so it cannot collide
with another Bev's barcode or reach the duplicate-merge path, and
`create_bev_with_nutrition_v2` refuses a `label-ocr` snapshot that arrives
without its label photo.

It was written against the real output of eight labels photographed through
this app, kept as `__tests__/visionFixtures.ts` — the recognised text and its
geometry only; the photographs show hands and rooms and stay out of the repo.
Four of the eight were checked value by value against the physical package:
**27 of 27 correct**, including two correct refusals.

Four things those photos taught, none of which a made-up fixture would have:

- **Vision misreads words confidently.** "Serving size" came back as "Selving
  size" and "Protein 0g" as "Protein Og", both at **confidence 1.00**. So
  confidence does not flag a character substitution, exact matching is the
  wrong tool, and every phrase in the parser is matched by edit distance.
- **It misreads units.** "Total Carbohydrate 0g" came back as "0mg". Those
  nutrients are always grams on a US panel, so an implausible unit is an OCR
  error, not a measurement — and quietly dividing by 1000 would have turned a
  misread "46g" into a believable, wrong "0.05g".
- **Panels abbreviate**: "Total Carb. <1g". A bound is not a number, so that
  one reads as "Not listed"; 0 and 1 would both be inventions.
- **Dual-column panels** carry per-serving and per-container figures on the
  same row. The per-serving column is the left one; taking the other doubles
  every number while looking entirely plausible.

## Rollout

Only the migration needs applying, and CI does not do it — `backend.yml`'s
deploy job is stubbed on purpose ("enabling db push needs a backup step
first"):

```
supabase db push     # before any client that calls create_bev_with_nutrition_v2
```

A client calling v2 before the migration exists falls back to plain
`create_bev` and the snapshot is silently dropped. There is nothing else to
deploy: no function, no secret.

The app half needs a native build, because the recogniser is a local Expo
module — it cannot reach a phone through the web deploy.

## Verification

- `npm run typecheck`, `npm test -w app`, `npm test -w packages/api`: see the
  PR.
- `supabase db reset && supabase test db`: 58 files, 2,518 tests, PASS (merged
  with main on 2026-11-26).
- `nutrition.live.test.ts` against a local stack: a label read created and read
  back through `get_bev_nutrition`.
- The parser: 16 tests over the eight real panels and the refusal rules.

**What the recogniser is given.** The prepared photo, not the original: the
JPEG `preparePhoto` writes, quality 0.85, longest edge at most 1,600 px
(`PHOTO_MAX_EDGE`). Whether the command-line harness that produced
`visionFixtures.ts` read those prepared files or the camera originals is not
recorded, so the 27-of-27 check holds for the engine on these panels and may
not hold at 1,600 px for a panel that is small in the frame. The device check
below is what settles it.

## Installed binaries

Every build cut before contract 3.10.0 reads `bev_nutrition` with a table
select, types `sourceUrl` as a string, and passes it to `Linking.openURL`
unguarded. A label read's null `sourceUrl` would crash that press. So the
table's select policy shows Open Food Facts rows only, and 3.10.0 reads both
kinds through `get_bev_nutrition()` (`20261130000100_nutrition_label_ocr.sql`,
section 3). An old build shows a label-read Bev with no nutrition. Widening the
policy back is a deprecation-ledger row (`DEVELOPMENT-ARJUN.md` section 15).

**The native module has never been compiled.** The machine this was written on
has Command Line Tools but no Xcode, so there is no simulator and no way to
build it here. The Swift was validated only as Swift; Apple's recogniser was
exercised through a standalone command-line harness on the same eight photos,
which is how we know the engine reads these panels — but not that the module
wiring, the permission prompts or the picker work inside the app.

## Required before release

A real iPhone check. There is no simulator camera, so none of this has been
seen working:

- **Read 5 real drinks**, chosen to be awkward: a curved can, a small bottle
  with a wrapped label, a matte carton, a two-column panel, and one listing
  per-serving *and* per-container. Check every number against the package. A
  wrong number that looks plausible is the failure mode that matters.
- **A drink with no barcode entry at all** — the case this exists for.
- **Missing values stay "Not listed"**, never 0.
- **The reveal** on a device, in light and dark, and with Reduce Motion on.
- **A deliberately bad photo**: blurred, half the panel, the front of the can.
  Each must give its own honest message.
- **Camera and photo-library permission denied**, and denied-then-granted.
- **HEIC**, which is what an iPhone shoots by default — the picker's photo goes
  through `preparePhoto` first, so the recogniser sees a JPEG; confirm that
  conversion on a real HEIC.
- **A small panel in a whole-can shot**, at the 1,600 px the recogniser gets.
- **A big photo**: confirm the read does not block the UI noticeably.
- **A reading, then replace the label photo** — the reading must drop rather
  than be saved against the wrong photo.
- **Save and reload**: the Bev page shows the label, says it was read from a
  label photo, and offers no Open Food Facts link.
- **An older TestFlight build** opening that Bev: no nutrition panel, and no
  crash.

The fallback for a failed reading is the barcode scan, or adding the Bev with
no nutrition at all.
