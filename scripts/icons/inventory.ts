/**
 * Rebuild the research inventory (not the production asset manifest):
 *   node --experimental-strip-types scripts/icons/inventory.ts
 *
 * Local catalog inputs only. No database calls, package guesses, or credentials.
 * Keep researched references and finished asset records in separate files: this
 * generated snapshot is deliberately replaced on each run.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogBevId, loadBevRows, loadFlavorProfileRows } from '../catalog/catalog.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sources = [
  'data/catalog/bevs.csv',
  'data/catalog/flavor-profiles.csv',
  'design/taxonomy/bev-leaves.csv',
  'design/taxonomy/categories-tree.json',
];
const output = resolve(root, 'design/beverage-icons/catalog-inventory.json');

function uniqueMap<T>(rows: T[], key: (row: T) => string, label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    if (!id || map.has(id)) throw new Error(`${label}: missing or duplicate key ${id}`);
    map.set(id, row);
  }
  return map;
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

const bevs = loadBevRows();
const bySlug = uniqueMap(bevs, (row) => row.slug, 'catalog');
const profiles = uniqueMap(loadFlavorProfileRows(), (row) => row.slug, 'flavor profiles');
const [header, ...lines] = readFileSync(resolve(root, sources[2]!), 'utf8').trim().split(/\r?\n/);
if (header !== 'slug,category,leaf') throw new Error('Unexpected taxonomy assignment header');
const assignments = uniqueMap(lines.map((line) => {
  const fields = line.split(',');
  if (fields.length !== 3 || fields.some((value) => !value.trim())) {
    throw new Error(`Invalid taxonomy assignment: ${line}`);
  }
  return { slug: fields[0]!, category: fields[1]!, leaf: fields[2]! };
}), (row) => row.slug, 'taxonomy assignments');
type CategoryNode = { id: string; parentId: string | null };
const tree = uniqueMap(
  JSON.parse(readFileSync(resolve(root, sources[3]!), 'utf8')) as CategoryNode[],
  (row) => row.id,
  'taxonomy tree',
);

for (const [label, map] of [['profiles', profiles], ['taxonomy', assignments]] as const) {
  if (map.size !== bevs.length || [...map.keys()].some((slug) => !bySlug.has(slug))) {
    throw new Error(`${label} must cover exactly the catalog slugs`);
  }
}

const beverages = bevs.map((bev) => {
  const planned = assignments.get(bev.slug)!;
  const node = tree.get(planned.leaf);
  if (!node || (node.parentId ?? node.id) !== planned.category) {
    throw new Error(`Invalid planned category/leaf for ${bev.slug}`);
  }
  const profile = profiles.get(bev.slug)!;
  const sourceFields = {
    upc: bev.upc || null,
    imageSourceUrl: bev.image_source_url || null,
    imageLicense: bev.image_license || null,
    imageAttribution: bev.image_attribution || null,
  };
  return {
    bevId: catalogBevId(bev.slug),
    slug: bev.slug,
    name: bev.name,
    brand: bev.brand,
    flavor: bev.flavor,
    currentCategory: bev.category,
    plannedCategory: planned.category,
    plannedLeaf: planned.leaf,
    categoryChangePending: planned.category !== bev.category,
    flavorProfile: { base: profile.base, serve: profile.serve },
    isStarter: bev.is_starter === 'true',
    catalogSource: sourceFields,
    missingSourceFields: Object.entries(sourceFields).filter(([, value]) => value === null).map(([key]) => key),
    research: {
      status: 'pending',
      packageFamily: null,
      packageSize: null,
      market: null,
      verifiedReferences: [],
      visualConfidence: 'unverified',
    },
    liveGraphStatus: 'unverified',
    liveCatalogStatus: 'unverified',
  };
});
uniqueMap(beverages, (row) => row.bevId, 'beverage UUIDs');

const inventory = {
  schemaVersion: 1,
  provenance: {
    scope: 'repository-catalog-only',
    liveGraphVerified: false,
    liveCatalogVerified: false,
    warning: 'This is not a live database export or an asset manifest. Seed identity conflicts and live-only beverages require reconciliation before claiming full coverage.',
    generatedBy: 'node --experimental-strip-types scripts/icons/inventory.ts',
    sources: sources.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex'),
    })),
  },
  summary: {
    beverages: beverages.length,
    uniqueBevIds: new Set(beverages.map((row) => row.bevId)).size,
    brands: new Set(beverages.map((row) => row.brand)).size,
    starters: beverages.filter((row) => row.isStarter).length,
    pendingCategoryChanges: beverages.filter((row) => row.categoryChangePending).length,
    byCurrentCategory: counts(beverages.map((row) => row.currentCategory)),
    byPlannedCategory: counts(beverages.map((row) => row.plannedCategory)),
    byBrand: counts(beverages.map((row) => row.brand)),
    missingSourceFields: counts(beverages.flatMap((row) => row.missingSourceFields)),
    pendingReferenceResearch: beverages.filter((row) => row.research.status === 'pending').length,
  },
  beverages,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Wrote ${output}: ${beverages.length} unique catalog beverages; live graph and catalog unverified.`);
