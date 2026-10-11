#!/usr/bin/env node
// Builds the mock API's catalog seed from the real catalog:
//   data/catalog/bevs.csv + data/catalog/categories.json → app/src/api/mock/seed/catalog.json
// Run from anywhere: `node app/scripts/build-mock-seed.mjs`. Commit the output.
// The output belongs to the removable mock (app/src/api/mock/); delete this script with it.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const csvPath = resolve(repo, 'data/catalog/bevs.csv');
const categoriesPath = resolve(repo, 'data/catalog/categories.json');
const outPath = resolve(here, '../src/api/mock/seed/catalog.json');

/** RFC 4180-ish: handles quoted fields with commas and doubled quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

const [header, ...records] = parseCsv(readFileSync(csvPath, 'utf8'));
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`bevs.csv has no "${name}" column`);
  return i;
};
const C = {
  slug: col('slug'), name: col('name'), brand: col('brand'), flavor: col('flavor'), category: col('category'),
  tier: col('price_tier'), est: col('price_estimated'), starter: col('is_starter'), aliases: col('aliases'),
};

const categories = JSON.parse(readFileSync(categoriesPath, 'utf8')).map(({ id, name, sortOrder, isAlcoholic }) => ({
  id, name, sortOrder, isAlcoholic,
}));
const categoryIds = new Set(categories.map((c) => c.id));

const bevs = records.map((r) => {
  const tier = Number(r[C.tier]);
  if (!categoryIds.has(r[C.category])) throw new Error(`${r[C.slug]}: unknown category ${r[C.category]}`);
  if (![1, 2, 3, 4].includes(tier)) throw new Error(`${r[C.slug]}: bad price_tier ${r[C.tier]}`);
  return {
    id: r[C.slug],
    name: r[C.name],
    brand: r[C.brand] || null,
    flavor: r[C.flavor] || null,
    categoryId: r[C.category],
    priceTier: tier,
    priceEstimated: r[C.est] === 'true',
    isStarter: r[C.starter] === 'true',
    aliases: r[C.aliases] ? r[C.aliases].split('|').map((a) => a.trim()).filter(Boolean) : [],
  };
});
if (new Set(bevs.map((b) => b.id)).size !== bevs.length) throw new Error('duplicate slugs in bevs.csv');

writeFileSync(outPath, `${JSON.stringify({ source: 'data/catalog', categories, bevs }, null, 2)}\n`);
console.log(`wrote ${bevs.length} Bevs and ${categories.length} categories to ${outPath}`);
