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

export interface CatalogBev {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  categoryId: CategoryId;
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

function loadCategories(): CatalogCategory[] {
  const raw = JSON.parse(readFileSync(resolve(CATALOG_DIR, 'categories.json'), 'utf8')) as CatalogCategory[];
  return raw.map(({ id, name, sortOrder, isAlcoholic }) => ({ id, name, sortOrder, isAlcoholic }));
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
      priceTier: tier as PriceTier,
      priceEstimated: get(C.est) === 'true',
      isStarter: get(C.starter) === 'true',
      aliases: get(C.aliases) ? get(C.aliases).split('|').map((a) => a.trim()).filter(Boolean) : [],
    };
  });
}

export const CATALOG_CATEGORIES: readonly CatalogCategory[] = loadCategories();
export const CATALOG_BEVS: readonly CatalogBev[] = loadBevs(new Set(CATALOG_CATEGORIES.map((c) => c.id)));
