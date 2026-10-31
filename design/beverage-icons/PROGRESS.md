# Beverage icon production checkpoint

2026-10-31. **30 reference-checked draft icons authored; 348 catalog entries remain.** 21 of 43 starters are covered. The original 12 received positive user feedback; the next 18 were added in this batch. Records remain `needs-review` for final approval and native integration. Live Postgres inventory reconciliation is still pending; the inspected Neo4j database has no beverage nodes.

Open [the review gallery](index.html) or the overview sheets: [1](review/overview-01.png), [2](review/overview-02.png), [3](review/overview-03.png). Gallery controls filter by drink/brand/family, change tile size and switch light/dark/checkerboard surfaces. Individual cards link to masters, PNGs and product evidence. The gallery's markup, links and script syntax were checked; interactive browser execution was unavailable. The artwork itself was rasterized and visually inspected.

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

Validation passed for 30 unique catalog mappings, complete authored/pending partition of 378 IDs, reference metadata, output hashes, parseable SVGs, transparent corners/nonempty pixels, dimensions and byte-identical PNG regeneration from outlined SVGs without fonts. Original `index.html` still matches its frozen SHA256.

Visual review covered all 30 icons and 40/56/96/155px square tiles with 8% padding on light and dark backgrounds. Fine lettering remains supplementary at small sizes. Package lettering that wraps beyond the can face is intentionally clipped to its body, matching the inspected source. Final aesthetic approval of the new 18 and Expo/native behavior remain pending. The original 12 assets and root prototype are unchanged. No database, app or photo metadata was changed.

## Resume here

1. Inspect all three overview sheets and per-product evidence before extending a family. Preserve the original prototype and existing approved direction.
2. Complete the remaining branded-boba pilot: Tiger Sugar Brown Sugar Boba Milk Tea. Kung Fu Tea is another pending starter; both require actual café-specific serving references.
3. Prioritize the 22 remaining starters in `coverage.json`: Dr Pepper / Mountain Dew variants, juices, energy drinks, RTD coffees, smoothies, teas, boba, Gatorade and GT's Gingerade. None is claimed complete by this batch.
4. Assign disjoint UUID/slug groups. Add family modules exporting `records`; keep shared primitives coordinator-owned. Research each exact package instead of recoloring from a category assumption.
5. Rebuild, validate, inspect overview and small-size sheets, then update `review/review.json` with the exact reviewed hashes. Keep references and unresolved choices in recipes, not the generated inventory.
6. Reconcile live Postgres IDs and implement UUID-based application image selection in a later integration pass; preserve real photo metadata.

All resumed worker output is integrated into four new family modules (`colas`, `citrus-sodas`, `sparkling-starters`, `wine-cocktail`). No hidden worker batch remains to recover. The full reusable skill remains in `skill/SKILL.md`.
