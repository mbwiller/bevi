import { MIN_N_USER } from '@bevi/ranking';
import type { Bucket, Recommendation } from '@bevi/shared';

import { categoryById } from '@/lib/categories';

// Copy shared by Your Lists and Bev detail, in the design system's voice.

/** Short bucket names for filters and "#4 in Loved" (the gut-check phrases are `BUCKET_LABEL`). */
export const BUCKET_SHORT: Readonly<Record<Bucket, string>> = {
  LOVED: 'Loved',
  FINE: 'Fine',
  DISLIKED: "Didn't like",
};

/** Below this confidence a predicted bubble shows a lock instead of a number (contract `BevPrediction.confidence`). */
export const MIN_CONFIDENCE = 0.25;

/** "Rank 3 Bevs to see recommendations", from the ranking package's threshold. */
export const RECS_LOCKED_TITLE = `Rank ${MIN_N_USER} Bevs to see recommendations`;
export const PREDICTION_LOCKED = `Rank ${MIN_N_USER} Bevs to see your prediction`;

/** The meta line under a recommended Bev. */
export function reasonText(rec: Pick<Recommendation, 'reason' | 'isExploration' | 'bev'>): string {
  if (rec.isExploration) return 'Something different';
  switch (rec.reason) {
    case 'CATEGORY': {
      const cat = categoryById(rec.bev.categoryId);
      return cat && cat.id !== 'other' ? `You love ${cat.label.toLowerCase()}` : 'Like Bevs you love';
    }
    case 'SIMILAR':
      return 'Like Bevs you love';
    case 'NEIGHBOURS':
      return 'People who rank like you';
    case 'POPULAR':
      return 'Popular on Bevi';
  }
}

/** "1 Bev" / "4 Bevs". */
export function bevCount(n: number): string {
  return `${n} Bev${n === 1 ? '' : 's'}`;
}
