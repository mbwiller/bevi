# Beverage icon production checkpoint

2026-11-01. **49 reference-checked draft icons authored; 329 catalog entries remain.** 40 of 43 starters have drafts. Batch 3 adds 19 icons to the previous 30. Records remain `needs-review` for user aesthetic approval and native integration. Three starter identities remain explicitly unresolved. Live Postgres inventory reconciliation is still pending; the earlier Neo4j inspection found no beverage nodes.

Open [the review gallery](index.html) or the overview sheets: [1](review/overview-01.png), [2](review/overview-02.png), [3](review/overview-03.png), [4](review/overview-04.png), [5](review/overview-05.png). Gallery controls filter by drink/brand/family, change tile size and switch light/dark/checkerboard surfaces. Individual cards link to masters, PNGs and product evidence. The gallery's markup, links and script syntax were checked; interactive browser execution was unavailable. The artwork itself was rasterized and visually inspected.

## Original 12

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

## Added in batch 2

- Coca-Cola Classic, Diet Coke and Coke Zero Sugar — US 12oz cans, individually inspected current color/lettering treatments.
- Pepsi, Diet Pepsi and Pepsi Zero Sugar — US 12oz cans with the current roundel wordmark; distinct blue, silver and black finishes.
- Sprite and Sprite Zero Sugar — green US 12oz cans with white and black lettering respectively.
- Fanta Orange — US 12oz can with angular blue/white mark and orange illustration.
- Starry Lemon Lime — explicitly selected US 16oz sleek can; Starry Zero Sugar — US 12oz standard can. The format difference follows the inspected manufacturer references.
- LaCroix Pamplemousse and Lime — independently inspected 12oz cans; custom script and flavor-specific brushwork.
- bubly Lime — green 12oz can with yellow-green bubbles and white wordmark.
- Liquid Death Mountain Water Still — white/navy/gold US 19.2oz tallboy, simplified melting skull and blackletter.
- S.Pellegrino Original — US 500mL green-glass bottle, shoulder medallion, blue lower label and red star.
- La Marca Prosecco — 750mL DOC bottle with silver foil and blue labels. The manufacturer image filename contains “DemiSec,” but its visible label and linking page identify flagship DOC; this discrepancy is recorded in the recipe.
- Generic Margarita — unbranded classic on-the-rocks lowball, pale cloudy liquid, ice, salt rim and lime garnish; one documented serving, not a frozen variation.

Workers owned disjoint family modules. A separate visual reviewer compared all 16 new soda/water icons to their source photos and reviewed every small-size sheet. The coordinator reviewed the wine/cocktail family and the combined gallery. Refined Fanta letter fit, Liquid Death lettering/skull, LaCroix script, Starry letter proportions, silver foil and the lime garnish. Manufacturer and retailer photos are reference evidence; only original vector artwork and exports are committed.

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

Validation passed for 49 unique catalog mappings, complete authored/pending partition of 378 IDs, reference metadata, output hashes, parseable SVGs, transparent corners/nonempty pixels, dimensions and byte-identical PNG regeneration from outlined SVGs without fonts. Original `index.html` still matches its frozen SHA256.

Visual review covered all 49 icons and 40/56/96/155px square tiles with 8% padding on light and dark backgrounds. Fine lettering remains supplementary at small sizes. Package lettering that wraps beyond the can face is intentionally clipped to its body, matching the inspected source. Final aesthetic approval of the latest batches and Expo/native behavior remain pending. The previous 30 assets and root prototype are unchanged. No database, app or photo metadata was changed.

## Resume here

1. Read the full skill, current recipes, `review/review.json`, and the batch 3 Astra report before extending a family. Preserve the original prototype and previous 30 asset hashes.
2. Resolve the three remaining starter identities in `coverage.json`: 5-hour Original (Berry Regular Strength unconfirmed), Lipton Iced Tea (formulation/flavor unspecified), and Tiger Sugar Brown Sugar Boba Milk Tea (signature fresh milk versus actual tea latte). Their durable `unresolved` records contain evidence and next steps; no placeholders were generated.
3. Continue remaining brand/package families from the 329-entry queue. Existing cans support brand batches after independent exact-flavor reference inspection. Do not count repository coverage as reconciled live coverage.
4. Give workers disjoint UUID groups and frozen primitives. Add family modules, rebuild, validate, inspect exact references and all required sizes/backgrounds, and retain final asset hashes in review evidence.
5. Integrate into the app and reconcile live Postgres in a separately authorized pass. Catalog metadata and real photos remain distinct from these illustration assets.

Batch 2 worker output was integrated into four family modules (`colas`, `citrus-sodas`, `sparkling-starters`, `wine-cocktail`). Batch 3 output is also integrated; no hidden worker batch remains to recover. The full reusable skill remains in `skill/SKILL.md`.

## Batch 3 — 19 new drafts

Parallel family workers authored Dr Pepper / Diet / Zero Sugar; Mountain Dew / Diet / Baja Blast; Monster Original; Celsius Sparkling Orange; Alani Nu Hawaiian Shaved Ice; Starbucks Frappuccino Mocha; Dunkin Original bottled iced coffee; AriZona Green Tea; Kung Fu Milk Tea; Tropicana Original orange juice; Welch's 100% Concord grape juice; Jamba Mango-a-go-go; and Bolthouse Strawberry Banana. The specifically requested **Astra 6 xhigh** reviewer independently compared exact sources and drawings, refined artwork, and authored Gatorade Lemon-Lime and GT's Gingerade as new package shapes.

Representative package choices are explicit in recipes: AriZona uses its documented slender 20oz PET bottle; Tropicana uses the named Original page's 46oz No Pulp flagship (catalog pulp level unspecified); Welch's uses 64oz; Gatorade uses the sculpted 28oz bottle; GT's uses the current official 16oz Synergy label; Bolthouse uses 15.2oz. Jamba and Kung Fu Tea use actual café servings, with no cup volume asserted. Kung Fu Tea has no added pearls because its inspected signature serving does not show them. Its photographed Chinese seal is exported as deterministic outlines with source-font identity/hash in the recipe.

Refinements include Dr Pepper logo fit, custom Mountain Dew lettering, narrower AriZona proportions, Alani script spacing, Celsius silver lower material, the Kung Fu Tea seal, Gatorade baseline/label clearance, GT's flower, and the exact asymmetric Baja Blast crest. New masters have unused gradient definitions removed. References live in recipes; source photos and source comparisons remain temporary research files rather than distributed artwork.

The builder now carries `unresolved` module records into `coverage.json`, preserving reference evidence, uncertainty and next steps without claiming artwork. Validation checks this identity state and the complete 378-UUID authored/pending partition. Final build/visual evidence is recorded in `review/review.json` and `review/astra-batch-03.json`. Final aesthetic approval, interactive/native behavior and live inventory reconciliation remain pending. The original prototype and all SVG/portable SVG/PNG hashes for the previous 30 icons are unchanged.
