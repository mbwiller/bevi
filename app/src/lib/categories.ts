import type { CategoryId } from '@bevi/shared';

import type { IconName } from '@/components/Icon';

// The 15 drink categories, mirroring the design system's `Bevi.categories` (design/system/src/core.jsx):
// labels in the interface's sentence case, one Lucide icon each, and the alcoholic flag. Ids match
// data/catalog/categories.json (checked by lib/__tests__/categories.test.ts).

export type { CategoryId };

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  icon: IconName;
  isAlcoholic: boolean;
}

export const CATEGORIES: readonly CategoryInfo[] = [
  { id: 'soda', label: 'Soda', icon: 'cup-soda', isAlcoholic: false },
  { id: 'diet_soda', label: 'Diet soda', icon: 'candy-off', isAlcoholic: false },
  { id: 'juice', label: 'Juice', icon: 'citrus', isAlcoholic: false },
  { id: 'water', label: 'Water', icon: 'glass-water', isAlcoholic: false },
  { id: 'sparkling_water', label: 'Sparkling water', icon: 'droplets', isAlcoholic: false },
  { id: 'energy', label: 'Energy', icon: 'zap', isAlcoholic: false },
  { id: 'coffee', label: 'Coffee', icon: 'coffee', isAlcoholic: false },
  { id: 'tea', label: 'Tea', icon: 'leaf', isAlcoholic: false },
  { id: 'boba', label: 'Boba', icon: 'milk', isAlcoholic: false },
  { id: 'sports', label: 'Sports drink', icon: 'dumbbell', isAlcoholic: false },
  { id: 'smoothie', label: 'Smoothie', icon: 'banana', isAlcoholic: false },
  { id: 'beer', label: 'Beer', icon: 'beer', isAlcoholic: true },
  { id: 'wine', label: 'Wine', icon: 'wine', isAlcoholic: true },
  { id: 'spirits_cocktails', label: 'Spirits & cocktails', icon: 'martini', isAlcoholic: true },
  { id: 'other', label: 'Other', icon: 'globe', isAlcoholic: false },
];

const BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, CategoryInfo>;

export function categoryById(id: CategoryId): CategoryInfo {
  return BY_ID[id];
}

/** Category → Lucide icon name. Always use this rather than picking icons by hand. */
export const CATEGORY_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon])) as Record<CategoryId, IconName>;

export function categoryIcon(id: CategoryId): IconName {
  return CATEGORY_ICON[id] ?? 'globe';
}

/** The categories a user may see: the alcoholic three are hidden when `canSeeAlcohol` is false. */
export function visibleCategories(canSeeAlcohol: boolean): readonly CategoryInfo[] {
  return canSeeAlcohol ? CATEGORIES : CATEGORIES.filter((c) => !c.isAlcoholic);
}
