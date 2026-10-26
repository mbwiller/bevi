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

import {
  aliasesOf,
  FLAVOR_BASES,
  FLAVOR_SERVES,
  loadBevRows,
  loadCategories,
  loadFlavorProfileRows,
  type Category,
} from "./catalog.ts";

function main(): void {
  const errors: string[] = [];

  const warnings: string[] = [];
  const categories: Category[] = loadCategories();
  const categoryById = new Map<string, Category>();
  for (const c of categories) {
    if (categoryById.has(c.id)) {
      errors.push(`categories.json: duplicate category id "${c.id}"`);
    }
    categoryById.set(c.id, c);
  }

  // ---------------------------------------------------------------------------
  // The category tree (A-13 / D-04)
  // ---------------------------------------------------------------------------
  // Exactly two levels, because that is what the contract, `category_is_alcoholic`
  // and `treeSimilarity`'s Wu-Palmer depths all assume. The database enforces the
  // same thing with `categories_depth_guard`; this catches it before a migration
  // is ever generated.
  for (const c of categories) {
    if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(c.id)) {
      errors.push(`categories.json: id "${c.id}" must be snake_case`);
    }
    if (c.parentId === null) {
      // A root carries the emoji the app draws; a leaf inherits its root's.
      if (!c.emoji) errors.push(`categories.json: root "${c.id}" has no emoji`);
      continue;
    }
    if (c.parentId === c.id) {
      errors.push(`categories.json: "${c.id}" is its own parent`);
      continue;
    }
    const parent = categoryById.get(c.parentId);
    if (!parent) {
      errors.push(`categories.json: "${c.id}" has unknown parent "${c.parentId}"`);
      continue;
    }
    if (parent.parentId !== null) {
      errors.push(
        `categories.json: "${c.id}" is three levels deep (parent "${c.parentId}" is itself a leaf); the taxonomy is exactly two levels`,
      );
    }
    // The age gate walks up exactly one hop, so a leaf that disagreed with its
    // root would make `category_is_alcoholic` depend on which id it was handed.
    if (c.isAlcoholic !== parent.isAlcoholic) {
      errors.push(
        `categories.json: leaf "${c.id}" has isAlcoholic=${c.isAlcoholic} but its root "${c.parentId}" has ${parent.isAlcoholic}; a leaf inherits its root's flag`,
      );
    }
    if (c.emoji !== null) {
      errors.push(`categories.json: leaf "${c.id}" has an emoji; only a root carries one`);
    }
  }

  const rows = loadBevRows();

  const seenNaturalKeys = new Map<string, number>(); // key -> first line number
  const seenSlugs = new Map<string, number>(); // slug -> first line number
  const aliasOwners = new Map<string, string[]>(); // alias -> slugs
  const seenUpcs = new Map<string, number>(); // upc -> first line number

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

    // length limits of the bevs columns (name 1-80, brand and flavor <= 80)
    for (const [col, value] of [["name", row.name], ["brand", row.brand], ["flavor", row.flavor]] as const) {
      if (value.trim().length > 80) {
        errors.push(`line ${line}: ${col} is longer than 80 characters (slug=${row.slug})`);
      }
    }

    // upc: optional, 8-14 digits (bevs.upc check), unique
    if (row.upc.trim() !== "") {
      if (!/^[0-9]{8,14}$/.test(row.upc.trim())) {
        errors.push(`line ${line}: upc must be 8-14 digits, got "${row.upc}" (slug=${row.slug})`);
      }
      const firstUpcLine = seenUpcs.get(row.upc.trim());
      if (firstUpcLine !== undefined) {
        errors.push(`line ${line}: duplicate upc "${row.upc}" already seen at line ${firstUpcLine} (slug=${row.slug})`);
      } else {
        seenUpcs.set(row.upc.trim(), line);
      }
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
      // A Bev's `category` is always a ROOT (A-13): `bevs.category_id` keeps
      // meaning one of the 15, and the finer placement lives in `leaf`.
      if (category.parentId !== null) {
        errors.push(
          `line ${line}: category "${row.category}" is a leaf under "${category.parentId}"; put the root in \`category\` and the leaf in \`leaf\` (slug=${row.slug})`,
        );
      }
    }

    // leaf: empty, or a real child of this row's category (A-13)
    if (row.leaf.trim() !== "") {
      const leaf = categoryById.get(row.leaf);
      if (!leaf) {
        errors.push(`line ${line}: unknown leaf "${row.leaf}" (slug=${row.slug})`);
      } else if (leaf.parentId === null) {
        errors.push(
          `line ${line}: leaf "${row.leaf}" is a root, not a leaf (slug=${row.slug})`,
        );
      } else if (leaf.parentId !== row.category) {
        errors.push(
          `line ${line}: leaf "${row.leaf}" sits under "${leaf.parentId}", not under this row's category "${row.category}" (slug=${row.slug})`,
        );
      }
    } else if (category && categories.some((c) => c.parentId === row.category)) {
      // Not an error: a Bev may sit on a parent (D-04 section 3, the shape
      // rule), and a user-created Bev always will until someone relabels it.
      // But for a SEEDED Bev under a split root it means the taxonomy grew a
      // leaf that nobody assigned, which is the one case worth surfacing.
      warnings.push(
        `line ${line}: no leaf, but "${row.category}" has leaves (slug=${row.slug})`,
      );
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

  // -------------------------------------------------------------------------
  // flavor-profiles.csv (A-17)
  // -------------------------------------------------------------------------
  // The graph's `profile` edge term reads these, so a wrong value is a wrong
  // recommendation rather than a crash -- which is why every field is checked
  // strictly and every slug must be accounted for in both directions.

  const profileRows = loadFlavorProfileRows();
  const profileBySlug = new Map<string, number>();
  const bases = new Set<string>(FLAVOR_BASES);
  const serves = new Set<string>(FLAVOR_SERVES);

  for (const row of profileRows) {
    const line = row.__line;

    const firstLine = profileBySlug.get(row.slug);
    if (firstLine !== undefined) {
      errors.push(`flavor-profiles.csv line ${line}: duplicate slug "${row.slug}" already seen at line ${firstLine}`);
    } else {
      profileBySlug.set(row.slug, line);
    }

    if (!seenSlugs.has(row.slug)) {
      errors.push(`flavor-profiles.csv line ${line}: slug "${row.slug}" is not in bevs.csv`);
    }

    if (!bases.has(row.base)) {
      errors.push(
        `flavor-profiles.csv line ${line}: base must be one of ${FLAVOR_BASES.join("|")}, got "${row.base}" (slug=${row.slug})`
      );
    }

    for (const [col, value] of [
      ["carbonated", row.carbonated],
      ["dairy", row.dairy],
      ["alcohol", row.alcohol],
    ] as const) {
      if (value !== "true" && value !== "false") {
        errors.push(
          `flavor-profiles.csv line ${line}: ${col} must be exactly "true" or "false", got "${value}" (slug=${row.slug})`
        );
      }
    }

    for (const [col, value] of [
      ["caffeine", row.caffeine],
      ["sweetness", row.sweetness],
    ] as const) {
      if (!/^[0-3]$/.test(value)) {
        errors.push(
          `flavor-profiles.csv line ${line}: ${col} must be an integer 0-3, got "${value}" (slug=${row.slug})`
        );
      }
    }

    if (!serves.has(row.serve)) {
      errors.push(
        `flavor-profiles.csv line ${line}: serve must be one of ${FLAVOR_SERVES.join("|")}, got "${row.serve}" (slug=${row.slug})`
      );
    }

    // The parser splits on commas with no quoting, so a comma anywhere would
    // silently shift every later column. Caught here with the slug named.
    for (const [col, value] of Object.entries(row)) {
      if (typeof value === "string" && value.includes(",")) {
        errors.push(`flavor-profiles.csv line ${line}: ${col} contains a comma, which this CSV cannot encode (slug=${row.slug})`);
      }
    }

    // A profile whose alcohol flag disagrees with its category is a labelling
    // mistake, not a judgement call: the category's is_alcoholic drives the
    // age gate, so the two must agree.
    const bevRow = rows.find((r) => r.slug === row.slug);
    if (bevRow) {
      const category = categoryById.get(bevRow.category);
      if (category && category.isAlcoholic !== (row.alcohol === "true")) {
        errors.push(
          `flavor-profiles.csv line ${line}: alcohol="${row.alcohol}" disagrees with category "${bevRow.category}" (is_alcoholic=${category.isAlcoholic}) (slug=${row.slug})`
        );
      }
    }
  }

  for (const [slug, line] of seenSlugs) {
    if (!profileBySlug.has(slug)) {
      errors.push(`bevs.csv line ${line}: slug "${slug}" has no row in flavor-profiles.csv`);
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

  console.log(
    `validated ${rows.length} Bev rows and ${profileRows.length} flavour profiles, 0 errors, ${warnings.length} warning(s)`
  );
  process.exit(0);
}

main();
