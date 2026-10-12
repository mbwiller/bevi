/**
 * Catalog validator for data/catalog/categories.json + data/catalog/bevs.csv
 *
 * Run with (Node 22, no build step / no extra deps):
 *   node --experimental-strip-types scripts/catalog/validate.ts
 *
 * Also runnable via the root package.json script:
 *   npm run catalog:validate
 *
 * (If preferred, this also runs fine under tsx: `npx tsx scripts/catalog/validate.ts`)
 *
 * NOTE on CSV parsing: this is a deliberately minimal, dependency-free parser.
 * It splits each line on commas and does NOT handle quoted fields with
 * embedded commas. That's fine as long as no field value in bevs.csv
 * contains a comma -- which is the convention this catalog follows.
 */

import { aliasesOf, loadBevRows, loadCategories, type Category } from "./catalog.ts";

function main(): void {
  const errors: string[] = [];

  const warnings: string[] = [];
  const categories: Category[] = loadCategories();
  const categoryById = new Map<string, Category>();
  for (const c of categories) {
    categoryById.set(c.id, c);
  }

  const rows = loadBevRows();

  const seenNaturalKeys = new Map<string, number>(); // key -> first line number
  const seenSlugs = new Map<string, number>(); // slug -> first line number
  const aliasOwners = new Map<string, string[]>(); // alias -> slugs

  for (const row of rows) {
    const line = row.__line;

    // slug: present, url-safe, unique (it becomes the Bev's id, see catalogBevId)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug)) {
      errors.push(`line ${line}: slug must be lowercase letters, digits and single hyphens, got "${row.slug}"`);
    }
    const firstSlugLine = seenSlugs.get(row.slug);
    if (firstSlugLine !== undefined) {
      errors.push(`line ${line}: duplicate slug "${row.slug}" already seen at line ${firstSlugLine}`);
    } else {
      seenSlugs.set(row.slug, line);
    }

    // is_starter must be exactly "true"/"false"
    if (row.is_starter !== "true" && row.is_starter !== "false") {
      errors.push(`line ${line}: is_starter must be exactly "true" or "false", got "${row.is_starter}" (slug=${row.slug})`);
    }

    for (const alias of aliasesOf(row)) {
      aliasOwners.set(alias, [...(aliasOwners.get(alias) ?? []), row.slug]);
    }

    // missing name
    if (!row.name || row.name.trim() === "") {
      errors.push(`line ${line}: missing name (slug=${row.slug || "<blank>"})`);
    }

    // unknown category
    const category = categoryById.get(row.category);
    if (!category) {
      errors.push(`line ${line}: unknown category "${row.category}" (slug=${row.slug})`);
    } else {
      // isAlcoholic=true categories are allowed; just don't crash on them.
      void category.isAlcoholic;
    }

    // price_tier must be numeric 1-4
    const priceTierNum = Number(row.price_tier);
    if (
      row.price_tier === undefined ||
      row.price_tier.trim() === "" ||
      !Number.isFinite(priceTierNum) ||
      !Number.isInteger(priceTierNum) ||
      priceTierNum < 1 ||
      priceTierNum > 4
    ) {
      errors.push(
        `line ${line}: price_tier must be an integer 1-4, got "${row.price_tier}" (slug=${row.slug})`
      );
    }

    // price_estimated must be exactly "true"/"false"
    if (row.price_estimated !== "true" && row.price_estimated !== "false") {
      errors.push(
        `line ${line}: price_estimated must be exactly "true" or "false", got "${row.price_estimated}" (slug=${row.slug})`
      );
    }

    // duplicate natural key: category, lowercased brand, lowercased name, lowercased flavor
    const naturalKey = [
      row.category.trim().toLowerCase(),
      row.brand.trim().toLowerCase(),
      row.name.trim().toLowerCase(),
      row.flavor.trim().toLowerCase(),
    ].join("||");
    const firstSeenLine = seenNaturalKeys.get(naturalKey);
    if (firstSeenLine !== undefined) {
      errors.push(
        `line ${line}: duplicate natural key (category="${row.category}", brand="${row.brand}", name="${row.name}", flavor="${row.flavor}") already seen at line ${firstSeenLine} (slug=${row.slug})`
      );
    } else {
      seenNaturalKeys.set(naturalKey, line);
    }
  }

  // An alias shared by several Bevs can't point at one of them (bev_aliases is keyed by alias): the
  // seed migration drops it, so say which ones.
  for (const [alias, slugs] of aliasOwners) {
    if (slugs.length > 1) warnings.push(`alias "${alias}" is shared by ${slugs.join(", ")}; the seed migration skips it`);
  }
  for (const w of warnings) console.warn(`  warning: ${w}`);

  if (errors.length > 0) {
    console.error(`catalog validation FAILED with ${errors.length} error(s):`);
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log(`validated ${rows.length} rows, 0 errors, ${warnings.length} warning(s)`);
  process.exit(0);
}

main();
