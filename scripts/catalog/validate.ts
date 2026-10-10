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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = join(__dirname, "..", "..", "data", "catalog");
const CATEGORIES_PATH = join(CATALOG_DIR, "categories.json");
const BEVS_CSV_PATH = join(CATALOG_DIR, "bevs.csv");

interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isAlcoholic: boolean;
  emoji: string;
}

interface BevRow {
  slug: string;
  name: string;
  brand: string;
  flavor: string;
  category: string;
  price_tier: string;
  price_estimated: string;
  upc: string;
  is_starter: string;
  aliases: string;
  image_source_url: string;
  image_license: string;
  image_attribution: string;
  notes: string;
  __line: number;
}

const EXPECTED_HEADER = [
  "slug",
  "name",
  "brand",
  "flavor",
  "category",
  "price_tier",
  "price_estimated",
  "upc",
  "is_starter",
  "aliases",
  "image_source_url",
  "image_license",
  "image_attribution",
  "notes",
];

function parseCsv(raw: string): BevRow[] {
  // Split on \n or \r\n, drop trailing blank lines.
  const lines = raw.split(/\r?\n/).filter((line, idx, arr) => {
    // keep all non-empty lines; also keep if it's not the last element
    return line.length > 0 || idx !== arr.length - 1;
  });

  if (lines.length === 0) {
    throw new Error("bevs.csv is empty");
  }

  const header = lines[0].split(",");
  if (
    header.length !== EXPECTED_HEADER.length ||
    !header.every((h, i) => h.trim() === EXPECTED_HEADER[i])
  ) {
    throw new Error(
      `bevs.csv header does not match expected columns.\n  expected: ${EXPECTED_HEADER.join(",")}\n  got:      ${header.join(",")}`
    );
  }

  const rows: BevRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const cols = line.split(",");
    const lineNo = i + 1; // 1-indexed, header is line 1
    if (cols.length !== EXPECTED_HEADER.length) {
      throw new Error(
        `bevs.csv line ${lineNo}: expected ${EXPECTED_HEADER.length} columns, got ${cols.length} (did a field contain an unescaped comma?)\n  line: ${line}`
      );
    }
    rows.push({
      slug: cols[0],
      name: cols[1],
      brand: cols[2],
      flavor: cols[3],
      category: cols[4],
      price_tier: cols[5],
      price_estimated: cols[6],
      upc: cols[7],
      is_starter: cols[8],
      aliases: cols[9],
      image_source_url: cols[10],
      image_license: cols[11],
      image_attribution: cols[12],
      notes: cols[13],
      __line: lineNo,
    });
  }
  return rows;
}

function main(): void {
  const errors: string[] = [];

  const categories: Category[] = JSON.parse(readFileSync(CATEGORIES_PATH, "utf8"));
  const categoryById = new Map<string, Category>();
  for (const c of categories) {
    categoryById.set(c.id, c);
  }

  const csvRaw = readFileSync(BEVS_CSV_PATH, "utf8");
  const rows = parseCsv(csvRaw);

  const seenNaturalKeys = new Map<string, number>(); // key -> first line number

  for (const row of rows) {
    const line = row.__line;

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

  if (errors.length > 0) {
    console.error(`catalog validation FAILED with ${errors.length} error(s):`);
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log(`validated ${rows.length} rows, 0 errors`);
  process.exit(0);
}

main();
