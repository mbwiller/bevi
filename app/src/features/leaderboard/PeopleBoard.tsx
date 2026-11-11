import type { Profile, UserLeaderboardRow } from '@bevi/shared';
import type { ViewToken } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { flattenPages, useFollow, useFollowing, useLeaderboardUsers, useMe, useStats, useUnfollow } from '@/api/hooks';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { SectionHeader } from '@/components/SectionHeader';
import { Sheet } from '@/components/Sheet';
import { UserRow } from '@/components/UserRow';
import { PeopleSkeleton } from '@/features/people/PeopleList';
import { formatCount } from '@/lib/format';
import { spacing, type, useTheme } from '@/theme';

import { pointsRules } from './copy';
import { useAllPages, useToggleSet } from './useToggleSet';

/** "212 pts · 84 Bevs". */
export function pointsMeta(points: number, bevsRanked: number): string {
  return `${formatCount(points)} pts · ${formatCount(bevsRanked)} ${bevsRanked === 1 ? 'Bev' : 'Bevs'}`;
}

/**
 * Whom the points ranking ranks: everyone on Bevi (`leaderboard.users`). The friends board
 * (`leaderboard.friends`, contract 2.12.0) joins this union in `ui/social-context`.
 */
export type PointsScope = 'everyone';

export interface PointsRankingOptions {
  /** Which board. Default 'everyone'. */
  scope?: PointsScope;
  /** Content between the "Ranked by points" header and the rows (the Friends | Everyone pills). */
  header?: ReactElement | null;
  /**
   * False while the host list shows something else in the section's place (People search): the
   * pinned own row is hidden and the next page isn't asked for. Default true.
   */
  active?: boolean;
}

/** One entry of the ranking section in a host FlashList. Every kind starts with `rank-`. */
export type PointsRankingItem =
  | { kind: 'rank-header'; key: string }
  | { kind: 'rank-slot'; key: string }
  | { kind: 'rank-row'; key: string; row: UserLeaderboardRow }
  | { kind: 'rank-loading'; key: string }
  | { kind: 'rank-error'; key: string }
  | { kind: 'rank-empty'; key: string };

export function isPointsRankingItem(item: { kind: string }): item is PointsRankingItem {
  return item.kind.startsWith('rank-');
}

export interface PointsRanking {
  /** The section: its header, the header slot, then the rows or one loading, error or empty entry. */
  items: PointsRankingItem[];
  renderItem: (item: PointsRankingItem) => ReactElement | null;
  /** Your own row, for under the list while it's off screen; null otherwise. */
  pinned: ReactElement | null;
  /** The "How points work" sheet: render it once, outside the list. */
  sheet: ReactElement;
  /** The host list's `onViewableItemsChanged` (stable); it picks out the section's own rows. */
  onViewableItemsChanged: (info: { viewableItems: ViewToken<{ kind: string }>[] }) => void;
  viewabilityConfig: typeof VIEWABILITY;
  /** The host list's footer while the section is showing: skeleton rows while the next page loads. */
  footer: ReactElement;
  /** The host list's `onEndReached` while the section is showing. */
  loadMore: () => void;
  /** Pull to refresh: the board and your stats (the pinned row's fallback). */
  refresh: () => void;
  refreshing: boolean;
  /**
   * Follow or unfollow, optimistically. Ranking rows flip at once (they derive Follow from your
   * Following list, as the board's rows don't carry `isFollowing`), and `useFollow` patches every
   * cached ProfileRow list, so the host's own rows (suggestions, search) flip with them.
   */
  toggleFollow: (userId: string, following: boolean) => void;
}

const VIEWABILITY = { itemVisiblePercentThreshold: 50 };

const HEADER: PointsRankingItem = { kind: 'rank-header', key: 'rank-header' };
const SLOT: PointsRankingItem = { kind: 'rank-slot', key: 'rank-slot' };

/** The board for a scope. One case today; `ui/social-context` adds friends here. */
function useBoardQuery(_scope: PointsScope) {
  return useLeaderboardUsers();
}

/**
 * The points ranking as a section of a host list (§6.12, §8.13): "Ranked by points" with the "How
 * points work" sheet, then UserRows by points with Bevs ranked and the streak, paged. Your own row
 * is tinted in the list, and pinned under the list (from your stats when you're past the loaded
 * pages) whenever it isn't on screen. The People screen (`/people`) puts it under its suggestions
 * in one FlashList, its only host.
 */
export function usePointsRanking({ scope = 'everyone', header = null, active = true }: PointsRankingOptions = {}): PointsRanking {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const stats = useStats();
  const query = useBoardQuery(scope);
  const rows = useMemo(() => flattenPages(query.data), [query.data]);
  const meId = me.data?.id;
  const [explainer, setExplainer] = useState(false);

  const following = useFollowing(meId);
  useAllPages(following);
  const followingIds = useMemo(() => flattenPages(following.data).map((p) => p.id), [following.data]);
  const { has: isFollowed, set: setFollowed } = useToggleSet(followingIds);
  const { mutate: follow } = useFollow();
  const { mutate: unfollow } = useUnfollow();
  const toggleFollow = useCallback(
    (userId: string, isFollowing: boolean) => {
      const undo = setFollowed(userId, !isFollowing);
      (isFollowing ? unfollow : follow)(userId, { onError: undo });
    },
    [setFollowed, follow, unfollow],
  );

  // Unknown until the list first reports what's on screen, so the pinned row never flashes over a
  // visible own row. Unknown again whenever the section comes back from behind a search.
  // Reset while rendering, not in an effect: the list's first report can land in its own effects,
  // which run before this component's.
  const [selfVisible, setSelfVisible] = useState<boolean | null>(null);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (active) setSelfVisible(null);
  }
  const meIdRef = useRef(meId);
  meIdRef.current = meId;
  // Stable for FlashList; reads the id through a ref.
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<{ kind: string }>[] }) => {
    setSelfVisible(
      viewableItems.some((v) => v.item != null && v.item.kind === 'rank-row' && (v.item as RowItem).row.profile.id === meIdRef.current),
    );
  }).current;

  const openUser = useCallback(
    (p: Profile) => (p.id === meId ? router.push('/profile') : router.push({ pathname: '/user/[id]', params: { id: p.id } })),
    [router, meId],
  );

  const items = useMemo<PointsRankingItem[]>(() => {
    const head = header ? [HEADER, SLOT] : [HEADER];
    if (rows.length > 0) return [...head, ...rows.map((row): PointsRankingItem => ({ kind: 'rank-row', key: `rank:${row.profile.id}`, row }))];
    if (query.isPending) return [...head, { kind: 'rank-loading', key: 'rank-loading' }];
    if (query.isError) return [...head, { kind: 'rank-error', key: 'rank-error' }];
    return [...head, { kind: 'rank-empty', key: 'rank-empty' }];
  }, [header, rows, query.isPending, query.isError]);

  const { error, refetch } = query;
  const renderItem = useCallback(
    (item: PointsRankingItem): ReactElement | null => {
      switch (item.kind) {
        case 'rank-header':
          return (
            <SectionHeader title="Ranked by points" action="How points work" actionLabel="How points work" onAction={() => setExplainer(true)} />
          );
        case 'rank-slot':
          return header;
        case 'rank-loading':
          return <PeopleSkeleton count={6} />;
        case 'rank-error':
          return <ErrorState error={error} onRetry={() => void refetch()} />;
        case 'rank-empty':
          return <EmptyState icon="trophy" title="No one's on the board yet" body="Rank a Bev to get on the board." />;
        case 'rank-row': {
          const { row } = item;
          const id = row.profile.id;
          const self = id === meId;
          const isFollowing = isFollowed(id);
          return (
            <UserRow
              user={row.profile}
              rank={row.rank}
              meta={pointsMeta(row.points, row.bevsRanked)}
              streak={row.currentStreak}
              self={self}
              following={self ? undefined : isFollowing}
              onFollow={() => toggleFollow(id, isFollowing)}
              onPress={() => openUser(row.profile)}
            />
          );
        }
      }
    },
    [header, error, refetch, meId, isFollowed, toggleFollow, openUser],
  );

  // Your row as the board has it, else from your stats (you may be past the loaded pages). The
  // stats rank is your rank among everyone, so it only stands in on that board.
  const ownRow = rows.find((r) => r.profile.id === meId);
  const ownStats = scope === 'everyone' ? stats.data : undefined;
  const pinned =
    active && me.data && selfVisible === false && query.isSuccess && rows.length > 0 && (ownRow || ownStats) ? (
      <View style={[styles.pinned, { borderTopColor: colors.border }]} testID="pinned-self">
        <UserRow
          user={me.data}
          self
          divider={false}
          rank={ownRow?.rank ?? ownStats?.rankOnBevi ?? undefined}
          meta={
            ownRow
              ? pointsMeta(ownRow.points, ownRow.bevsRanked)
              : ownStats?.rankOnBevi != null
                ? pointsMeta(ownStats.rankPoints, ownStats.bevdCount)
                : 'Unranked'
          }
          streak={ownRow?.currentStreak ?? ownStats?.currentStreak}
          onPress={() => router.push('/profile')}
        />
      </View>
    ) : null;

  const sheet = (
    <Sheet open={explainer} title="How points work" onClose={() => setExplainer(false)}>
      <View style={styles.rules}>
        {pointsRules().map((line) => (
          <Text key={line} style={[type.body, { color: colors.text }]}>
            {line}
          </Text>
        ))}
      </View>
    </Sheet>
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (active && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [active, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refetchStats = stats.refetch;
  const refresh = useCallback(() => {
    void refetch();
    void refetchStats();
  }, [refetch, refetchStats]);

  return {
    items,
    renderItem,
    pinned,
    sheet,
    onViewableItemsChanged,
    viewabilityConfig: VIEWABILITY,
    footer: isFetchingNextPage ? <PeopleSkeleton count={2} /> : <View style={styles.foot} />,
    loadMore,
    refresh,
    refreshing: query.isRefetching && !isFetchingNextPage && !query.isPending,
    toggleFollow,
  };
}

type RowItem = Extract<PointsRankingItem, { kind: 'rank-row' }>;

const styles = StyleSheet.create({
  foot: { height: spacing.xxl },
  rules: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  pinned: { borderTopWidth: 1 },
});
