# Bevi beverage icons

Start with the **complete [bevi-beverage-icons SKILL.md](skill/SKILL.md)**. It is the same full skill used to create this collection, included in the repository so another coding agent can follow the identical style and research workflow. No personal skill installation or database credentials are needed to author icons.

Codex discovers this workflow through `.agents/skills/bevi-beverage-icons`, which links to the maintained skill above. Invoke it in this repository with `$bevi-beverage-icons`, for example: “Use $bevi-beverage-icons to create the next 24 beverage icons, prioritizing remaining starters and related brand families.” If a running session does not show the new skill, restart Codex in this repository.

![Beverage icons — overview 1](review/overview-01.png)

[Overview 2](review/overview-02.png) · [Overview 3](review/overview-03.png) · [Overview 4](review/overview-04.png) · [Overview 5](review/overview-05.png) · [Overview 6](review/overview-06.png) · [Overview 7](review/overview-07.png) · [Overview 8](review/overview-08.png) · [Overview 9](review/overview-09.png)

The current collection contains 275 reference-checked drafts, including 39 starter drinks. [The manifest](manifest.json) maps catalog UUIDs to editable SVGs, font-independent SVGs and transparent PNGs. [The work queue](coverage.json) lists the 103 remaining catalog drinks. These counts describe the repository catalog; the publish job's report reconciles it against the live database (see [Publish to the backend](#publish-to-the-backend)). The app shows the icons (see [Ship to the app](#ship-to-the-app)).

Latest **4-icon starter recovery**: Tropicana Orange Juice Original, Jamba Mango-a-go-go, Bolthouse Farms Strawberry Banana and Kung Fu Tea Classic Milk Tea. These were drawn in the batch-3 branch that never merged; their recipes were rebuilt on `main` and every asset hash matches the original batch-3 review record. Starbucks Frappuccino Mocha was deliberately left out: the catalog row is `blended_coffee`, so the café-versus-bottled identity stays deferred in [identity-issues.json](identity-issues.json).

Previous **28-icon batch**: [sheet 1](review/large-batch-02-2026-11-02-01.png) · [sheet 2](review/large-batch-02-2026-11-02-02.png) · [sheet 3](review/large-batch-02-2026-11-02-03.png) · [sheet 4](review/large-batch-02-2026-11-02-04.png). Six deferred identities, including the Monster Peachy Keen product-line conflict, are retained in [identity-issues.json](identity-issues.json).

Earlier **29-icon batch**: [sheet 1](review/large-batch-2026-11-02-01.png) · [sheet 2](review/large-batch-2026-11-02-02.png) · [sheet 3](review/large-batch-2026-11-02-03.png) · [sheet 4](review/large-batch-2026-11-02-04.png). Deferred Starbucks/AriZona identities and inspected candidate evidence are retained in [identity-issues.json](identity-issues.json); those rows have no authored icons.

Latest **20 energy icons (2026-11-11)**: [large sheet 1](review/batch-08-large-2026-11-11-01.png) · [large sheet 2](review/batch-08-large-2026-11-11-02.png). All prior artwork retained; final aesthetic approval pending.

Latest **20 classic soda icons (2026-11-11)**: [large sheet 1](review/batch-09-large-2026-11-11-01.png) · [large sheet 2](review/batch-09-large-2026-11-11-02.png). Package-specific bottles and cans; all prior artwork retained.

Latest **20 Fresca, soda and juice icons (2026-11-12)**: [large sheet 1](review/batch-10-large-2026-11-12-01.png) · [large sheet 2](review/batch-10-large-2026-11-12-02.png). Includes both catalog Frescas: Original Grapefruit Citrus and Black Cherry Citrus. All prior artwork retained.

Latest **20 beer and refreshment icons plus Diet 7UP (2026-11-13)**: [large sheet 1](review/batch-11-large-2026-11-12-01.png) · [large sheet 2](review/batch-11-large-2026-11-12-02.png) · [large sheet 3](review/batch-11-large-2026-11-12-03.png). Includes both Hata Kosen Ramune varieties and the current 7UP Zero Sugar can mapped to the Diet 7UP catalog entry. Final aesthetic approval remains pending.

## Give this to your coding agent

```text
Read the entire design/beverage-icons/skill/SKILL.md and
design/beverage-icons/PROGRESS.md before generating artwork.
Inspect design/beverage-icons/style-reference/ and the current review sheets.
Use scripts/icons/style.mjs and the existing family recipes as the shared
rendering system. Research and visually inspect real product references.
Choose a disjoint group of remaining starter UUIDs from coverage.json,
add a family module, rebuild, validate, and visually review the batch.
Keep the same canvas, lighting, materials, baseline, scale and detail level.
Record unresolved product variants instead of guessing or marking them verified.
```

The full skill includes product-identity rules, reference requirements, shared drawing constraints, delegation contracts, and visual-review criteria. [PLAN.md](PLAN.md) explains the architecture; [PROGRESS.md](PROGRESS.md) records what exists and where to resume. The original root [index.html](../../index.html) and seven frozen reference SVGs are included as the visual masters.

## Preview without installing anything

Open `design/beverage-icons/index.html` locally in a browser. Search by drink or brand, switch tile sizes, and compare light/dark/transparent backgrounds. Every card links to product evidence and downloadable files. GitHub displays the overview above; download or check out the repository to use the HTML gallery.

## Build and validate

The current authoring/export environment is **macOS, Node 22.6+ and Python 3.9+**. The renderer uses the Arial, Georgia and Times New Roman font files in `/System/Library/Fonts/Supplemental`; exact font hashes are recorded in the manifest. Other systems can use all committed PNGs and outlined SVGs without these fonts, and can run `validate.mjs`; rebuilding editable text requires the documented macOS font setup. Do not silently substitute fonts, which would change the artwork.

From the repository root:

```sh
# Isolated tool dependency; does not modify the app's package files.
npm install --prefix /tmp/bevi-icon-tools --cache /tmp/bevi-icon-npm-cache --no-save @resvg/resvg-js@2.6.2

node --experimental-strip-types scripts/icons/build.mjs
node scripts/icons/validate.mjs

# Optional: regenerate the visual review sheets in an isolated Python environment.
python3 -m venv /tmp/bevi-icon-review
/tmp/bevi-icon-review/bin/python -m pip install Pillow==11.3.0
/tmp/bevi-icon-review/bin/python scripts/icons/review.py
```

If the renderer is installed elsewhere, set `BEVI_RESVG_MODULE` to the absolute path of its `@resvg/resvg-js` package directory. The renderer must remain at 2.6.2.

## Ship to the app

From the repository root, after every batch (and after any redraw):

```sh
node scripts/icons/export-app.mjs          # copy the portable SVGs into the app and regenerate its map
node scripts/icons/export-app.mjs --check  # writes nothing; exits 1 when the app's copy is stale
```

The script reads `manifest.json`, copies each record's `portable-svg/<slug>.svg` byte for byte to `app/public/bev-icons/<slug>.svg`, removes icons no record claims, and writes `app/src/lib/bevIcons.generated.ts` (catalog bevId → `/bev-icons/<slug>.svg?v=<first 8 hex of the SVG's sha256>`, so a redraw busts caches). It fails on a duplicate bevId or slug, a missing source, or a hash that disagrees with the manifest, and a second run changes nothing. Commit `app/public/bev-icons/` and the generated map with the batch; never edit either by hand. In the app a Bev's image is photo > icon > category art: a real photo always wins, and an icon only replaces the placeholder silhouette.

The app's `src/lib/__tests__/bevIcons.test.ts` (part of `npm test -w app`) is the drift guard: it fails when the map or the shipped SVGs no longer match the manifest.

## Publish to the backend

The same icons also live in Supabase, where the app will read them once it stops bundling its own copy. Each portable SVG is an object in the public `bev-icons` Storage bucket at `<slug>.<first 16 hex of its sha256>.svg`; a redraw is a new object, never an overwrite, so every URL can be cached for a year. `public.bev_icons` links each Bev to its object (`supabase/migrations/20261112000200_bev_icons.sql`), and signed-in users can read a row exactly when they can see the Bev.

```sh
npm run icons:publish -- --dry-run   # no credentials; checks every hash and refuses unsafe SVG markup
npm run icons:publish                # needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY exported in the shell
```

Or run the manual **icons-sync** workflow, which is a dry run unless `dry_run` is unticked. A real run uploads only objects not yet published, then replaces `bev_icons` with the manifest in one call. Its report reconciles the manifest against the live database: Bevs it names that do not exist there, icons that followed a merge, and how many active Bevs have neither a photo nor an icon.

## Add a batch without changing the style

1. Select remaining UUIDs/slugs from `coverage.json`, prioritizing `isStarter`. Tell collaborators which brand/package family you own to avoid duplicate work.
2. Research each exact product. Record the selected package/market, reference page and image URL, inspection date, observed features and uncertainty. Category does not determine package shape.
3. Create a module under `scripts/icons/families/` exporting a `records` array. Follow `pilot.mjs` or `bottles-carton.mjs`; reuse the shared `wrap`, `shadow`, `ref` and `text` helpers from `style.mjs`. Each record includes `slug`, `family`, `packageChoice`, `references`, `uncertainty`, `status` and the full `svg` string. Each reference includes `pageUrl`, `imageUrl`, `inspectedAt`, `observations` and a truthful `visuallyInspected` value. Coordinate changes to shared primitives before altering them.
4. Rebuild and validate. The build rejects duplicate/unknown slugs and generates assets, the UUID manifest, coverage and gallery. Edit recipes, not generated output. `inventory.ts` rebuilds the separate repository inventory; it does not preserve research entered into that generated inventory file.
5. Inspect the resulting sheets at 40/56/96/155px on light and dark surfaces against the exact reference images. Keep drafts `needs-review` until the relevant review is complete. Update `review/review.json` with the reviewed asset hashes; the renderer does not automatically grant visual approval.
6. Commit the family recipe, generated SVG/PNG assets, manifest, coverage, gallery and review evidence together, plus the app's copy from `node scripts/icons/export-app.mjs` (see [Ship to the app](#ship-to-the-app)). Preserve the original prototype and frozen reference set.

The original prototype is a standalone design reference, not the deployed app. No icon authoring step requires changing Neo4j, Postgres, photos, or app behavior.
