/**
 * Shared catalog loading for scripts/catalog/*: paths, the CSV parser, and the deterministic Bev ids
 * the seed migration uses. Node 22, no build step, no extra deps (run with
 * `node --experimental-strip-types`).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CATALOG_DIR = join(__dirname, "..", "..", "data", "catalog");
export const CATEGORIES_PATH = join(CATALOG_DIR, "categories.json");
export const BEVS_CSV_PATH = join(CATALOG_DIR, "bevs.csv");
export const FLAVOR_PROFILES_CSV_PATH = join(CATALOG_DIR, "flavor-profiles.csv");

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isAlcoholic: boolean;
  emoji: string;
}

export interface BevRow {
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

export function parseCsv(raw: string): BevRow[] {
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

// ---------------------------------------------------------------------------
// Flavour profiles (A-17)
// ---------------------------------------------------------------------------

/**
 * One row of data/catalog/flavor-profiles.csv, keyed by a bevs.csv slug.
 *
 * Field names are the contract with `FlavorProfile` in `shared/` and
 * `profileSimilarity` in `@bevi/ranking` (S-14). Renaming one means
 * relabelling 378 rows.
 */
export interface FlavorProfileRow {
  slug: string;
  base: string;
  carbonated: string;
  caffeine: string;
  sweetness: string;
  dairy: string;
  alcohol: string;
  serve: string;
  notes: string;
  __line: number;
}

/** Mirrors `FlavorBase` in shared/src/enums.ts and the `base` check constraint. */
export const FLAVOR_BASES = [
  "cola", "citrus", "lemon-lime", "berry", "tropical", "apple",
  "grape", "orange", "ginger", "root-beer", "cream",
  "coffee", "tea", "matcha", "chai", "chocolate", "nut",
  "herbal", "mineral", "hop", "wine", "agave", "grain", "other",
] as const;

/** Mirrors `FlavorServe` in shared/src/enums.ts. */
export const FLAVOR_SERVES = ["hot", "cold", "either"] as const;

const FLAVOR_PROFILE_HEADER = [
  "slug",
  "base",
  "carbonated",
  "caffeine",
  "sweetness",
  "dairy",
  "alcohol",
  "serve",
  "notes",
];

export function parseFlavorProfileCsv(raw: string): FlavorProfileRow[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("flavor-profiles.csv is empty");

  const header = lines[0]!.split(",");
  if (
    header.length !== FLAVOR_PROFILE_HEADER.length ||
    !header.every((h, i) => h.trim() === FLAVOR_PROFILE_HEADER[i])
  ) {
    throw new Error(
      `flavor-profiles.csv header does not match expected columns.\n  expected: ${FLAVOR_PROFILE_HEADER.join(",")}\n  got:      ${header.join(",")}`
    );
  }

  const rows: FlavorProfileRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",");
    const lineNo = i + 1;
    // Same dependency-free parser as bevs.csv: no quoted fields, so no field
    // may contain a comma. The validator enforces that rather than leaving it
    // to this error.
    if (cols.length !== FLAVOR_PROFILE_HEADER.length) {
      throw new Error(
        `flavor-profiles.csv line ${lineNo}: expected ${FLAVOR_PROFILE_HEADER.length} columns, got ${cols.length} (did a field contain an unescaped comma?)\n  line: ${lines[i]}`
      );
    }
    rows.push({
      slug: cols[0]!,
      base: cols[1]!,
      carbonated: cols[2]!,
      caffeine: cols[3]!,
      sweetness: cols[4]!,
      dairy: cols[5]!,
      alcohol: cols[6]!,
      serve: cols[7]!,
      notes: cols[8]!,
      __line: lineNo,
    });
  }
  return rows;
}

export function loadFlavorProfileRows(): FlavorProfileRow[] {
  return parseFlavorProfileCsv(readFileSync(FLAVOR_PROFILES_CSV_PATH, "utf8"));
}

export function loadCategories(): Category[] {
  return JSON.parse(readFileSync(CATEGORIES_PATH, "utf8")) as Category[];
}

export function loadBevRows(): BevRow[] {
  return parseCsv(readFileSync(BEVS_CSV_PATH, "utf8"));
}

/** A row's aliases: `|`-separated, trimmed, lowercased, de-duplicated. */
export function aliasesOf(row: BevRow): string[] {
  return [...new Set(row.aliases.split("|").map((a) => a.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Namespace for catalog Bev ids. Never change it: every catalog Bev's id in every database is
 * `uuidv5(CATALOG_NAMESPACE, slug)`, so the same slug always maps to the same row.
 */
export const CATALOG_NAMESPACE = "b0866972-7959-4b6e-a8b5-6edf3ea452a8";

/** RFC 4122 version-5 UUID (SHA-1) of `name` in `namespace`. */
export function uuidv5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The database id of the catalog Bev with this slug (e.g. `modelo-especial`). */
export function catalogBevId(slug: string): string {
  return uuidv5(slug, CATALOG_NAMESPACE);
}
