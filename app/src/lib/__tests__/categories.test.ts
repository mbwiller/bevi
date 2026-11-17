import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CATEGORIES, categoryIcon, visibleCategories } from '../categories';

const catalog: { id: string; parentId: string | null; isAlcoholic: boolean; sortOrder: number }[] = JSON.parse(
  readFileSync(join(__dirname, '../../../../data/catalog/categories.json'), 'utf8'),
);

// Since A-13 the catalog carries 75 nodes: the 15 roots and D-04's 60 leaves.
// `CATEGORIES` is the app's table of the ROOTS -- the ids `CategoryId` is a
// closed union of, the ones that have an icon and an emoji, and the only ones
// `Bev.categoryId` ever holds. A leaf reaches the app through
// `categories.tree()` and `bevs.leaves()`, never through this table.
const roots = catalog.filter((c) => c.parentId === null);

it('matches the catalog root ids, order and alcohol flags', () => {
  const sorted = [...roots].sort((a, b) => a.sortOrder - b.sortOrder);
  expect(CATEGORIES.map((c) => c.id)).toEqual(sorted.map((c) => c.id));
  expect(CATEGORIES.map((c) => c.isAlcoholic)).toEqual(sorted.map((c) => c.isAlcoholic));
});

it('has no leaf in the app table, and every leaf inherits its root alcohol flag', () => {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const appIds = new Set<string>(CATEGORIES.map((c) => c.id));
  for (const node of catalog) {
    if (node.parentId === null) continue;
    // A leaf must never leak into the app's exhaustive `Record<CategoryId, ...>` maps.
    expect(appIds.has(node.id)).toBe(false);
    const parent = byId.get(node.parentId);
    expect(parent).toBeDefined();
    // Exactly two levels, and the flag the age gate reads agrees either way up.
    expect(parent!.parentId).toBeNull();
    expect(node.isAlcoholic).toBe(parent!.isAlcoholic);
  }
});

it('matches the design system icons', () => {
  const core = readFileSync(join(__dirname, '../../../../design/system/src/core.jsx'), 'utf8');
  for (const c of CATEGORIES) {
    expect(core).toContain(`{ id: '${c.id}', label: '${c.label}', icon: '${c.icon}'`);
    expect(categoryIcon(c.id)).toBe(c.icon);
  }
});

it('hides the alcoholic categories for under-21 users', () => {
  expect(visibleCategories(false).map((c) => c.id)).not.toEqual(expect.arrayContaining(['beer']));
  expect(visibleCategories(false)).toHaveLength(12);
  expect(visibleCategories(true)).toHaveLength(15);
});
