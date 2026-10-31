---
name: bevi-beverage-icons
description: Research, create, and review product-specific Bevi beverage SVG icons in the soft dimensional style of Bevi's root index.html. Use for Bevi catalog icon batches and consistent brand or packaging variants, not generic UI icons or catalog photos.
---

# Bevi beverage icons

Work in the Bevi repository containing `data/catalog/bevs.csv`. Read `design/beverage-icons/PLAN.md` for the inventory/reconciliation workflow and inspect `design/beverage-icons/style-reference/index.html` plus relevant original SVGs. The root `index.html` is the user's preferred artwork; the app's existing flat `BevArt` is not the style master. Preserve the root prototype unless the user asks to edit it.

## Identity and references

- Key work by the canonical beverage UUID, never category or display name. Use `catalogBevId` in `scripts/catalog/catalog.ts` for seed rows. The live seed can skip conflicting IDs; reconcile live-only and conflicting products explicitly.
- `design/beverage-icons/catalog-inventory.json` is a generated repository worklist. Its regeneration erases pending research fields: keep actual research and reviewed artwork in a separate durable manifest. A repository row is not proof of live graph or live Postgres membership.
- Obtain and inspect a real reference for each product: manufacturer first, reputable retailer second, dated historical source for discontinued packaging. Record source page and image URLs, access date, exact flavor/formulation, package size, market, visible features and uncertainty. Search snippets alone do not verify appearance.
- Packaged brands use a documented real package; café products use their actual serving; `Generic` entries use an unbranded served drink. Do not infer shape from category, invent brand graphics or slogans, silently replace historical products, or treat sibling flavors as identical without checking.
- If size/market is unspecified, choose and record a representative US retail version when evidence supports it. Keep unresolved identity/formulation differences in `needs-identity-resolution`; an arbitrary choice must not become “verified.”

## Shared drawing language

Create SVG using shared geometry/material primitives and per-product recipes. This established vector system should be extended directly rather than regenerated as unrelated raster illustrations.

- Canvas `0 0 200 260`, transparent background; centered upright product, subtly visible top surface, elliptical rims; ground shadow centered near y=238–240.
- Soft dimensional gradients, restrained white highlights and realistic material translucency. Use the original cups' ice, liquid layers and pearls as rendering examples, not mandatory decoration.
- Real package proportions, label placement and identifying colors take priority over generic family defaults. Warm shading must not flatten every color into the same cream/olive palette.
- Share perspective, light direction, baseline and perceived scale. Let actual package shape vary. Do not bake UI rotation or a backdrop into the asset.
- Keep product-defining lettering legible at large sizes; simplify tiny filler text. No invented nutrition, certification or marketing text. Use deterministic lettering paths or pinned fonts in exports.
- Namespace gradient/clip IDs per inline instance, remove unused definitions, and avoid embedded remote images, scripts and remote fonts.

## Production and delegation

Start new families with a representative master and compare it against the original reference sheet. Freeze shared primitives before parallel batches. Give workers disjoint UUID assignments grouped by brand/package family, shared style/version, references, and explicit output paths. Workers return only their recipes/assets/reference records plus a contact sheet and unresolved issues. The coordinator owns shared primitive changes, manifest integration and cross-batch review.

Prioritize the catalog's starter beverages after pilot coverage of distinct families. Each record should progress through `needs-reference` / `needs-identity-resolution` → `ready-to-draw` → `draft` → `needs-review` → `verified`. Never count a placeholder or an uninspected reference as a completed icon.

Do not populate the database, overwrite photos, upload assets, or change app behavior solely because an icon batch was requested. Such work follows the scope actually authorized by the user. Postgres owns catalog metadata; Neo4j is derived and cannot be the only store for illustration URLs.

## Review and delivery

1. Compare every icon with its exact product reference: form, proportions, closure, brand/flavor colors and marks, liquid, toppings and distinguishing details.
2. Compare the whole batch to the style masters for lighting, perspective, baseline, perceived scale, shadow and detail density.
3. Render at 40/56/96/155 px square tiles with 8% padding and on light/dark backgrounds. Check clipping, transparency, tiny-size recognition and repeated inline IDs. Structural validity does not replace visual inspection; report unavailable rendering honestly.
4. Retain SVG masters. Generate transparent PNG derivatives deterministically if using the app's native image path; validate that path on representative assets before bulk export. Do not maintain separate hand-edited mobile paths.
5. Return manifest records with UUID/slug, reference evidence/date, package choice, style version, asset paths/hash and review status; plus contact sheets and separate completed/unresolved counts against the reconciled target inventory.

The current `BevImage` prioritizes a real photo and then generic art. Product icons need a deliberate UUID lookup and illustration/photo precedence when integration is requested. Keep illustrations distinct from photo metadata and account for direct photo consumers such as `GutCheck`.
