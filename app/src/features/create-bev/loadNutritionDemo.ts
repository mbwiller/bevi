import type { ComponentType } from 'react';

/** Keep the opt-in scanner demo in its own production chunk. */
export function loadNutritionDemo(): Promise<{ default: ComponentType }> {
  return import('./NutritionDemo')
    .then(({ NutritionDemo }) => ({ default: NutritionDemo }))
    .catch(() => ({ default: () => null }));
}
