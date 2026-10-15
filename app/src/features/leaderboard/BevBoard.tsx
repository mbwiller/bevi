import { isLeaderboardEligible, MIN_RATERS } from '@bevi/ranking';
import type { CategoryId, LeaderboardRow } from '@bevi/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactElement } from 'react';

import { flattenPages, useAddWantToTry, useLeaderboardBevs, useMe, useRemoveWantToTry, useWantToTry } from '@/api/hooks';
import { BevRow } from '@/components/BevRow';
import { EmptyState } from '@/components/EmptyState';
import { BevList } from '@/features/lists/BevList';
import { categoryById } from '@/lib/categories';
import { formatScore } from '@/lib/format';

import { useAllPages, useToggleSet } from './useToggleSet';

export interface BevBoardProps {
  categoryId: CategoryId | undefined;
  /** The scope dropdown: scrolls with the list. */
  header: ReactElement;
}

export function myScoreMeta(myScore: number | null): string {
  return myScore != null ? `Your score ${formatScore(myScore)}` : 'Not ranked yet';
}

/**
 * Bevs board (§6.12): numbered BevRows with the board's Bayesian score, "Your
 * score" in the meta line. Only Bevs with ≥ MIN_RATERS rankings are ranked (§8.7); the API returns just
 * those, and anything below is filtered out here too. The "New" strip has no endpoint yet, so it's left out.
 */
export function BevBoard({ categoryId, header }: BevBoardProps) {
  const router = useRouter();
  const query = useLeaderboardBevs(categoryId);
  const rows = useMemo(() => flattenPages(query.data).filter((r) => isLeaderboardEligible(r.ratingCount)), [query.data]);

  const canSeeAlcohol = useMe().data?.canSeeAlcohol ?? false;
  const wantToTry = useWantToTry();
  useAllPages(wantToTry);
  const savedIds = useMemo(() => flattenPages(wantToTry.data).map((w) => w.bev.id), [wantToTry.data]);
  const saved = useToggleSet(savedIds);
  const add = useAddWantToTry();
  const remove = useRemoveWantToTry();

  const renderItem = useCallback(
    ({ item }: { item: LeaderboardRow }) => {
      const id = item.bev.id;
      const isSaved = saved.has(id);
      // The server filters alcohol under 21 already; never offer to rank it regardless (§6.17).
      const rankable = item.myScore == null && !(categoryById(item.bev.categoryId)?.isAlcoholic && !canSeeAlcohol);
      return (
        <BevRow
          bev={item.bev}
          showImage
          number={item.rank}
          score={item.bayesScore}
          meta={myScoreMeta(item.myScore)}
          saved={isSaved}
          onPress={() => router.push({ pathname: '/bev/[id]', params: { id } })}
          onRank={rankable ? () => router.push({ pathname: '/rank/[bevId]', params: { bevId: id } }) : undefined}
          onSave={() => {
            const undo = saved.set(id, !isSaved);
            if (isSaved) remove.mutate(id, { onError: undo });
            else add.mutate({ bevId: id }, { onError: undo });
          }}
        />
      );
    },
    [add, remove, router, saved, canSeeAlcohol],
  );

  return (
    <BevList
      data={rows}
      query={query}
      renderItem={renderItem}
      keyExtractor={(r) => r.bev.id}
      header={header}
      empty={
        <EmptyState
          icon="trophy"
          title="Not enough rankings yet"
          body={`A Bev joins the leaderboard once ${MIN_RATERS} people have ranked it.`}
        />
      }
    />
  );
}
