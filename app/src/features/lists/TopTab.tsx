import type { CategoryId } from '@bevi/shared';

import { BevBoard } from '@/features/leaderboard/BevBoard';

export interface TopTabProps {
  categoryId: CategoryId | undefined;
}

/**
 * Top: the Bevs leaderboard (§6.12), scoped by the Lists screen's category dropdown. The dropdown
 * sits above the tabs and is shared, so the board has no header of its own. Remounted per scope so
 * paging and scroll position start fresh.
 */
export function TopTab({ categoryId }: TopTabProps) {
  return <BevBoard key={categoryId ?? 'all'} categoryId={categoryId} />;
}
