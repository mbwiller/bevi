# Beverage icon production checkpoint

2026-10-26. **12 reference-checked draft icons authored; 366 catalog entries remain.** Five of 43 starters are covered. All 12 are `needs-review`, not production-integrated or user-approved. Live Postgres inventory reconciliation is still pending; the inspected Neo4j database has no beverage nodes.

Open [the review gallery](index.html) or [the overview PNG](review/overview-01.png). Gallery controls filter by drink/brand/family, change tile size and switch light/dark/checkerboard surfaces. Individual cards link to masters, PNGs and product evidence. The gallery's markup, links and script syntax were checked; interactive browser execution was unavailable. The artwork itself was rasterized and visually inspected.

## Authored

- Jarritos Mandarin — clear glass, orange soda, open serving as in manufacturer photo.
- Generic Matcha Latte with Boba — unbranded glass, pale green milk tea, ice and pearls.
- FIJI Natural Artesian Water — 500mL square PET bottle.
- OLIPOP Vintage Cola — explicitly selected 9g-fiber US 12oz formula; catalog formulation remains ambiguous.
- Pure Leaf Unsweetened — US 18.5oz PET bottle, black cap and green/black label.
- Red Bull Original — US 250mL / 8.4oz slim can.
- Spindrift Lemon, Grapefruit and Raspberry Lime — each checked against its own 2026 manufacturer can image.
- Topo Chico Original — 12oz mineral-water bottle with yellow cap/label, green-tinted glass.
- Vita Coco Original — 1L carton, blue cap.
- Yakult Original — US 80mL cream bottle with red foil cap.

## Files and repeatable commands

- `scripts/icons/style.mjs`: shared rendering primitives, version `bevi-dimensional-v1`.
- `scripts/icons/families/*.mjs`: editable product recipes and durable reference evidence. These are the source of truth for authored icons. Do not edit generated assets or manifest directly.
- `svg/`: editable SVG masters with text.
- `portable-svg/`: outlined text, no font dependency. Use these for portable SVG delivery; use as external images, or namespace IDs per instance if inlining.
- `png/`: transparent 600 × 780 exports generated from the outlined SVGs.
- `manifest.json`: UUID → assets, hashes, references, package choices and review status. Font hashes and renderer version record the export environment.
- `coverage.json`: remaining catalog UUIDs/slugs and starter flags. Inventory regeneration never overwrites authored references in the family modules.
- `review/`: full overview, small-size light/dark sheets and the visual-review record.

From the repository root:

```sh
npm install --prefix /tmp/bevi-icon-tools --cache /tmp/bevi-icon-npm-cache --no-save @resvg/resvg-js@2.6.2
node --experimental-strip-types scripts/icons/build.mjs
node scripts/icons/validate.mjs
python3 scripts/icons/review.py
```

Pillow is available in the current Python environment. Export uses explicitly listed macOS Arial/Georgia/Times fonts and records hashes. No runtime dependency was added to the app. Another OS needs an equivalent pinned font setup; existing outlined SVGs/PNGs remain portable.

Validation passed for 12 unique catalog mappings, complete authored/pending partition of 378 IDs, reference metadata, output hashes, parseable SVGs, transparent corners/nonempty pixels, dimensions and byte-identical PNG regeneration from outlined SVGs without fonts. Original `index.html` still matches its frozen SHA256.

Visual review covered all 12 icons against inspected product images, and 40/56/96/155px square tiles with 8% padding on light and dark backgrounds. Fine lettering is intentionally subordinate at small sizes. Label logos/illustrations are simplified interpretations; final aesthetic review and Expo/native behavior remain pending. Refined Red Bull can width and matcha pearl spacing after rendering. No database, app, photo, deployment or GitHub mutations were made in this production pass.

## Resume here

1. Inspect the overview and per-product reference URLs before extending a family. Resolve any user feedback without altering the original prototype.
2. Finish the remaining pilot families: Tiger Sugar branded boba, La Marca Prosecco and Generic Margarita. Coca-Cola/Diet Coke/Pepsi were assigned to a can worker but **not authored**.
3. Prioritize the 38 remaining starters in `coverage.json`, grouping actual package families. The existing Spindrift family demonstrates verified variant reuse, but do not automatically recolor uninspected flavors. Blackberry/cucumber may require historical packaging research.
4. Add disjoint family modules exporting `records`; the build collects them automatically and rejects duplicate/unknown slugs. Keep shared primitives coordinator-owned.
5. Rebuild, validate, inspect review sheets, and update the review record tied to exact asset hashes. Never promote an unresolved package choice to verified just to increase coverage.
6. Reconcile live Postgres IDs and establish UUID-based application image selection in a later integration pass; preserve real photo metadata.

The three parallel workers hit the account usage limit before delivering files. These 12 icons and tooling were completed directly afterward; there are no hidden worker results or ongoing batches to recover.
