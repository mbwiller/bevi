// The real catalog (data/catalog/bevs.csv + categories.json), read straight from disk for the
// FakeApi. TEST-ONLY: this runs under jest (Node), never in the app bundle, so there is no mirror to
// keep in sync with the CSV.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CategoryId, PriceTier } from '@bevi/shared';

const CATALOG_DIR = resolve(__dirname, '../../../../data/catalog');

export interface CatalogCategory {
  id: CategoryId;
  name: string;
  sortOrder: number;
  isAlcoholic: boolean;
}

/**
 * One node of the two-level taxonomy (A-13/D-04): the 15 roots plus the 60
 * leaves, exactly as `categories.json` carries them. `CatalogCategory` above
 * stays the roots-only shape the fake's `categories.list()` serves.
 */
export interface CatalogCategoryNode {
  id: string;
  name: string;
  parentId: CategoryId | null;
  sortOrder: number;
  isAlcoholic: boolean;
  emoji: string | null;
}

export interface CatalogBev {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  categoryId: CategoryId;
  /** A-13: the Bev's leaf under `categoryId`, null when it sits on the parent. */
  leafCategoryId: string | null;
  priceTier: PriceTier;
  priceEstimated: boolean;
  isStarter: boolean;
  aliases: string[];
}

/** RFC 4180-ish: quoted fields with commas and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
  }
  return rows;
}

function loadCategoryNodes(): CatalogCategoryNode[] {
  return JSON.parse(readFileSync(resolve(CATALOG_DIR, 'categories.json'), 'utf8')) as CatalogCategoryNode[];
}

/** The 15 roots, which is what `categories.list()` serves. */
function loadCategories(nodes: readonly CatalogCategoryNode[]): CatalogCategory[] {
  return nodes
    .filter((c) => c.parentId === null)
    .map(({ id, name, sortOrder, isAlcoholic }) => ({ id: id as CategoryId, name, sortOrder, isAlcoholic }));
}

function loadBevs(categoryIds: ReadonlySet<string>): CatalogBev[] {
  const [header = [], ...records] = parseCsv(readFileSync(resolve(CATALOG_DIR, 'bevs.csv'), 'utf8'));
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`bevs.csv has no "${name}" column`);
    return i;
  };
  const C = {
    slug: col('slug'), name: col('name'), brand: col('brand'), flavor: col('flavor'), category: col('category'),
    tier: col('price_tier'), est: col('price_estimated'), starter: col('is_starter'), aliases: col('aliases'),
    leaf: col('leaf'),
  };
  return records.map((r) => {
    const get = (i: number) => r[i] ?? '';
    const tier = Number(get(C.tier));
    if (!categoryIds.has(get(C.category))) throw new Error(`${get(C.slug)}: unknown category ${get(C.category)}`);
    if (![1, 2, 3, 4].includes(tier)) throw new Error(`${get(C.slug)}: bad price_tier ${get(C.tier)}`);
    return {
      id: get(C.slug),
      name: get(C.name),
      brand: get(C.brand) || null,
      flavor: get(C.flavor) || null,
      categoryId: get(C.category) as CategoryId,
      leafCategoryId: get(C.leaf) || null,
      priceTier: tier as PriceTier,
      priceEstimated: get(C.est) === 'true',
      isStarter: get(C.starter) === 'true',
      aliases: get(C.aliases) ? get(C.aliases).split('|').map((a) => a.trim()).filter(Boolean) : [],
    };
  });
}

/**
 * A row of `data/catalog/flavor-profiles.csv` (A-17), keyed by the same slug as `bevs.csv`. The
 * fields are exactly @bevi/ranking's `FlavorProfile` (the subset eq. 17 uses), so
 * `profileSimilarity` takes one of these unchanged; `serve` and `notes` are dropped because the
 * formula ignores them.
 */
export interface CatalogFlavorProfile {
  base: string;
  carbonated: boolean;
  caffeine: 0 | 1 | 2 | 3;
  sweetness: 0 | 1 | 2 | 3;
  dairy: boolean;
  alcohol: boolean;
}

function loadFlavorProfiles(bevIds: ReadonlySet<string>): Map<string, CatalogFlavorProfile> {
  const [header = [], ...records] = parseCsv(readFileSync(resolve(CATALOG_DIR, 'flavor-profiles.csv'), 'utf8'));
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`flavor-profiles.csv has no "${name}" column`);
    return i;
  };
  const C = {
    slug: col('slug'), base: col('base'), carbonated: col('carbonated'), caffeine: col('caffeine'),
    sweetness: col('sweetness'), dairy: col('dairy'), alcohol: col('alcohol'),
  };
  const out = new Map<string, CatalogFlavorProfile>();
  for (const r of records) {
    const get = (i: number) => r[i] ?? '';
    const slug = get(C.slug);
    if (!bevIds.has(slug)) throw new Error(`flavor-profiles.csv: unknown slug ${slug}`);
    const level = (raw: string, field: string) => {
      const n = Number(raw);
      if (![0, 1, 2, 3].includes(n)) throw new Error(`${slug}: bad ${field} ${raw}`);
      return n as 0 | 1 | 2 | 3;
    };
    out.set(slug, {
      base: get(C.base),
      carbonated: get(C.carbonated) === 'true',
      caffeine: level(get(C.caffeine), 'caffeine'),
      sweetness: level(get(C.sweetness), 'sweetness'),
      dairy: get(C.dairy) === 'true',
      alcohol: get(C.alcohol) === 'true',
    });
  }
  return out;
}

export const CATALOG_CATEGORY_NODES: readonly CatalogCategoryNode[] = loadCategoryNodes();
export const CATALOG_CATEGORIES: readonly CatalogCategory[] = loadCategories(CATALOG_CATEGORY_NODES);
export const CATALOG_BEVS: readonly CatalogBev[] = loadBevs(new Set(CATALOG_CATEGORIES.map((c) => c.id)));

/**
 * child leaf id -> root id, the fake's `category_root()`. Also the taxonomy
 * `treeSimilarity` takes, so `graph.ts` no longer passes `{}`.
 */
export const CATALOG_TAXONOMY: Readonly<Record<string, string | null>> = Object.freeze(
  Object.fromEntries(CATALOG_CATEGORY_NODES.map((c) => [c.id, c.parentId])),
);
export const CATALOG_FLAVOR_PROFILES: ReadonlyMap<string, CatalogFlavorProfile> = loadFlavorProfiles(
  new Set(CATALOG_BEVS.map((b) => b.id)),
);
