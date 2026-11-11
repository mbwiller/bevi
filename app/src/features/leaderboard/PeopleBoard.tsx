import type { Profile, UserLeaderboardRow } from '@bevi/shared';
import type { ViewToken } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  flattenPages,
  useFollow,
  useFollowing,
  useLeaderboardFriends,
  useLeaderboardUsers,
  useMe,
  useStats,
  useUnfollow,
} from '@/api/hooks';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { SectionHeader } from '@/components/SectionHeader';
import { Sheet } from '@/components/Sheet';
import { UserRow } from '@/components/UserRow';
import { PeopleSkeleton } from '@/features/people/PeopleList';
import { formatCount } from '@/lib/format';
import { spacing, type, useTheme } from '@/theme';

import { BOARD_EMPTY, pointsRules } from './copy';
import { DEFAULT_POINTS_SCOPE, type PointsScope } from './pointsScope';
import { useAllPages, useToggleSet } from './useToggleSet';

export type { PointsScope } from './pointsScope';

/** "212 pts · 84 Bevs". */
export function pointsMeta(points: number, bevsRanked: number): string {
  return `${formatCount(points)} pts · ${formatCount(bevsRanked)} ${bevsRanked === 1 ? 'Bev' : 'Bevs'}`;
}

export interface PointsRankingOptions {
  /** Which board. Default 'friends'. */
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
  | { kind: 'rank-empty'; key: string; reason: EmptyReason };

/**
 * Why the section has no rows, or (`noFollows`, under your own row) why it has only you:
 * `everyone` — nobody on Bevi has ranked; `friends` — you follow people but none of you has ranked;
 * `noFollows` — on Friends you follow nobody.
 */
export type EmptyReason = 'everyone' | 'friends' | 'noFollows';

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
  /** Pull to refresh: the board in view and your stats (the pinned row's fallback). It also lets go of held rows. */
  refresh: () => void;
  refreshing: boolean;
  /**
   * Follow or unfollow, optimistically. Ranking rows flip at once (they derive Follow from your
   * Following list, as the board's rows don't carry `isFollowing`), and `useFollow` patches every
   * cached ProfileRow list, so the host's own rows (suggestions, search) flip with them. The Friends
   * board is refetched once the server has the change (`settleFollow`), never optimistically.
   */
  toggleFollow: (userId: string, following: boolean) => void;
}

const VIEWABILITY = { itemVisiblePercentThreshold: 50 };

const HEADER: PointsRankingItem = { kind: 'rank-header', key: 'rank-header' };
const SLOT: PointsRankingItem = { kind: 'rank-slot', key: 'rank-slot' };

/**
 * The board for a scope. Both queries stay mounted so each keeps its own pages and cache; only the
 * one in view is enabled, so a change to the other (a follow invalidates Friends) refetches it when
 * the reader switches to it, not behind their back.
 */
function useBoardQuery(scope: PointsScope) {
  const everyone = useLeaderboardUsers({ enabled: scope === 'everyone' });
  const friends = useLeaderboardFriends({ enabled: scope === 'friends' });
  return scope === 'friends' ? friends : everyone;
}

/**
 * The points ranking as a section of a host list (§6.12, §8.13): "Ranked by points" with the "How
 * points work" sheet, the host's header slot (the Friends | Everyone pills), then UserRows by points
 * with Bevs ranked and the streak, paged. Your own row is tinted in the list, and pinned under the
 * list whenever it isn't on screen (on Everyone from your stats when you're past the loaded pages;
 * on Friends only when the board has you). The People screen (`/people`) puts it under its
 * suggestions in one FlashList, its only host.
 *
 * Friends changes with your follows. A follow or unfollow anywhere refetches it once the server has
 * it, but a press on one of its own rows holds the rows as they were (the unfollowed person stays,
 * now with Follow) until pull to refresh, a switch of scope, or a search, so a row never leaves from
 * under the finger that pressed it.
 */
export function usePointsRanking({ scope = DEFAULT_POINTS_SCOPE, header = null, active = true }: PointsRankingOptions = {}): PointsRanking {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const stats = useStats();
  const query = useBoardQuery(scope);
  const fresh = useMemo(() => flattenPages(query.data), [query.data]);
  const meId = me.data?.id;
  const [explainer, setExplainer] = useState(false);
  // The Friends rows as they were when the reader pressed Follow on one of them (see above).
  const [held, setHeld] = useState<UserLeaderboardRow[] | null>(null);
  const rows = held ?? fresh;

  const following = useFollowing(meId);
  useAllPages(following);
  const followingIds = useMemo(() => flattenPages(following.data).map((p) => p.id), [following.data]);
  const followingKnown = following.isError || (following.isSuccess && !following.hasNextPage);
  const followsNobody = following.isSuccess && !following.hasNextPage && followingIds.length === 0;
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

  const followOnBoard = useCallback(
    (userId: string, isFollowing: boolean) => {
      if (scope === 'friends') setHeld((h) => h ?? fresh);
      toggleFollow(userId, isFollowing);
    },
    [scope, fresh, toggleFollow],
  );

  // Unknown until the list first reports what's on screen, so the pinned row never flashes over a
  // visible own row. Unknown again whenever the section comes back from behind a search or switches
  // board. Held rows are let go at the same moments.
  // Reset while rendering, not in an effect: the list's first report can land in its own effects,
  // which run before this component's.
  const [selfVisible, setSelfVisible] = useState<boolean | null>(null);
  const [wasActive, setWasActive] = useState(active);
  const [wasScope, setWasScope] = useState(scope);
  if (wasActive !== active || wasScope !== scope) {
    if (wasScope !== scope || active) setSelfVisible(null);
    setWasActive(active);
    setWasScope(scope);
    setHeld(null);
  }

  // With no rows, which empty state. While the Friends board refetches (after a follow, say) the last
  // answer stands, so the Following list landing first can't flash the other one.
  const settledReason = useRef<EmptyReason>('friends');
  if (scope === 'friends' && !query.isFetching && followingKnown) settledReason.current = followsNobody ? 'noFollows' : 'friends';
  const emptyReason: EmptyReason = scope === 'everyone' ? 'everyone' : settledReason.current;
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

  // Friends with no follows can still have rows (just you, at 1): the nudge goes under them.
  const nudge = scope === 'friends' && followsNobody;
  const items = useMemo<PointsRankingItem[]>(() => {
    const head = header ? [HEADER, SLOT] : [HEADER];
    if (rows.length > 0) {
      const ranked = rows.map((row): PointsRankingItem => ({ kind: 'rank-row', key: `rank:${row.profile.id}`, row }));
      return nudge ? [...head, ...ranked, { kind: 'rank-empty', key: 'rank-empty', reason: 'noFollows' }] : [...head, ...ranked];
    }
    // On Friends the empty state depends on whether you follow anyone, so wait for that too.
    if (query.isPending || (scope === 'friends' && !query.isError && !followingKnown)) return [...head, { kind: 'rank-loading', key: 'rank-loading' }];
    if (query.isError) return [...head, { kind: 'rank-error', key: 'rank-error' }];
    return [...head, { kind: 'rank-empty', key: 'rank-empty', reason: emptyReason }];
  }, [header, rows, nudge, query.isPending, query.isError, scope, followingKnown, emptyReason]);

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
        case 'rank-empty': {
          const copy = BOARD_EMPTY[item.reason];
          return <EmptyState icon={item.reason === 'noFollows' ? 'users' : 'trophy'} title={copy.title} body={copy.body} />;
        }
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
              onFollow={() => followOnBoard(id, isFollowing)}
              onPress={() => openUser(row.profile)}
            />
          );
        }
      }
    },
    [header, error, refetch, meId, isFollowed, followOnBoard, openUser],
  );

  // Your row as the board has it, else from your stats (you may be past the loaded pages). The
  // stats rank is your rank among everyone, so it only stands in on that board: on Friends, with no
  // row of your own (you haven't ranked a Bev), nothing is pinned.
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
    setHeld(null);
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
