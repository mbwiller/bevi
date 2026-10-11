import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CATEGORIES, categoryIcon, visibleCategories } from '../categories';

const catalog: { id: string; isAlcoholic: boolean; sortOrder: number }[] = JSON.parse(
  readFileSync(join(__dirname, '../../../../data/catalog/categories.json'), 'utf8'),
);

it('matches the catalog ids, order and alcohol flags', () => {
  const sorted = [...catalog].sort((a, b) => a.sortOrder - b.sortOrder);
  expect(CATEGORIES.map((c) => c.id)).toEqual(sorted.map((c) => c.id));
  expect(CATEGORIES.map((c) => c.isAlcoholic)).toEqual(sorted.map((c) => c.isAlcoholic));
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
