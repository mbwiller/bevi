import type { Profile, UserLeaderboardRow } from '@bevi/shared';
import { FlashList, type ViewToken } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { flattenPages, useFollow, useFollowing, useLeaderboardUsers, useMe, useStats, useUnfollow } from '@/api/hooks';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { SectionHeader } from '@/components/SectionHeader';
import { Sheet } from '@/components/Sheet';
import { Skeleton } from '@/components/Skeleton';
import { UserRow } from '@/components/UserRow';
import { formatCount } from '@/lib/format';
import { size, spacing, type, useTheme } from '@/theme';

import { pointsRules } from './copy';
import { useAllPages, useToggleSet } from './useToggleSet';

/** "212 pts · 84 Bevs". */
export function pointsMeta(points: number, bevsRanked: number): string {
  return `${formatCount(points)} pts · ${formatCount(bevsRanked)} ${bevsRanked === 1 ? 'Bev' : 'Bevs'}`;
}

function PeopleSkeleton({ count }: { count: number }) {
  return (
    <View testID="people-skeleton" accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Skeleton variant="circle" width={size.target} />
          <Skeleton lines={2} />
        </View>
      ))}
    </View>
  );
}

const VIEWABILITY = { itemVisiblePercentThreshold: 50 };

/**
 * People board (§6.12, §8.13): UserRows by points with Bevs ranked and the streak. Your own row is
 * highlighted in the list, and pinned below it (from your stats) whenever it isn't on screen.
 */
export function PeopleBoard() {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const stats = useStats();
  const query = useLeaderboardUsers();
  const rows = useMemo(() => flattenPages(query.data), [query.data]);
  const meId = me.data?.id;
  const [explainer, setExplainer] = useState(false);

  const following = useFollowing(meId);
  useAllPages(following);
  const followingIds = useMemo(() => flattenPages(following.data).map((p) => p.id), [following.data]);
  const followed = useToggleSet(followingIds);
  const follow = useFollow();
  const unfollow = useUnfollow();

  // Unknown until FlashList first reports what's on screen, so the pinned row never flashes over a visible own row.
  const [selfVisible, setSelfVisible] = useState<boolean | null>(null);
  const meIdRef = useRef(meId);
  meIdRef.current = meId;
  // Stable for FlashList; reads the id through a ref.
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<UserLeaderboardRow>[] }) => {
    setSelfVisible(viewableItems.some((v) => v.item?.profile.id === meIdRef.current));
  }).current;

  const openUser = useCallback(
    (p: Profile) => (p.id === meId ? router.push('/profile') : router.push({ pathname: '/user/[id]', params: { id: p.id } })),
    [router, meId],
  );

  const renderItem = useCallback(
    ({ item }: { item: UserLeaderboardRow }) => {
      const id = item.profile.id;
      const self = id === meId;
      const isFollowing = followed.has(id);
      return (
        <UserRow
          user={item.profile}
          rank={item.rank}
          meta={pointsMeta(item.points, item.bevsRanked)}
          streak={item.currentStreak}
          self={self}
          following={self ? undefined : isFollowing}
          onFollow={() => {
            const undo = followed.set(id, !isFollowing);
            (isFollowing ? unfollow : follow).mutate(id, { onError: undo });
          }}
          onPress={() => openUser(item.profile)}
        />
      );
    },
    [meId, followed, follow, unfollow, openUser],
  );

  // Your row as the board has it, else from your stats (you may be past the loaded pages).
  const ownRow = rows.find((r) => r.profile.id === meId);
  const pinned =
    me.data && selfVisible === false && query.isSuccess && rows.length > 0 && (ownRow || stats.data) ? (
      <View style={[styles.pinned, { borderTopColor: colors.border }]} testID="pinned-self">
        <UserRow
          user={me.data}
          self
          divider={false}
          rank={ownRow?.rank ?? stats.data?.rankOnBevi ?? undefined}
          meta={
            ownRow
              ? pointsMeta(ownRow.points, ownRow.bevsRanked)
              : stats.data?.rankOnBevi != null
                ? pointsMeta(stats.data.rankPoints, stats.data.bevdCount)
                : 'Unranked'
          }
          streak={ownRow?.currentStreak ?? stats.data?.currentStreak}
          onPress={() => router.push('/profile')}
        />
      </View>
    ) : null;

  const empty = query.isPending ? (
    <PeopleSkeleton count={6} />
  ) : query.isError ? (
    <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  ) : (
    <EmptyState icon="trophy" title="No one's on the board yet" body="Rank a Bev to get on the board." />
  );

  return (
    <View style={styles.body}>
      <FlashList
        data={rows}
        renderItem={renderItem}
        keyExtractor={(r) => r.profile.id}
        ListHeaderComponent={
          <SectionHeader title="Ranked by points" action="How points work" actionLabel="How points work" onAction={() => setExplainer(true)} />
        }
        ListEmptyComponent={empty}
        ListFooterComponent={query.isFetchingNextPage ? <PeopleSkeleton count={2} /> : <View style={styles.foot} />}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        viewabilityConfig={VIEWABILITY}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshing={query.isRefetching && !query.isFetchingNextPage && !query.isPending}
        onRefresh={() => {
          void query.refetch();
          void stats.refetch();
        }}
      />
      {pinned}
      <Sheet open={explainer} title="How points work" onClose={() => setExplainer(false)}>
        <View style={styles.rules}>
          {pointsRules().map((line) => (
            <Text key={line} style={[type.body, { color: colors.text }]}>
              {line}
            </Text>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  foot: { height: spacing.xxl },
  rules: { gap: spacing.md, paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  pinned: { borderTopWidth: 1 },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.gutter,
  },
});
