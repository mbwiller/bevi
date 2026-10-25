import type { FeedItem, Profile, RankedBev } from '@bevi/shared';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useIsMutating } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactElement, type RefObject } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FOLLOW_MUTATION, flattenPages, useMe, useTasteProfile, useUserFeed, useUserRankings } from '@/api/hooks';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FeedPost } from '@/components/FeedPost';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { Skeleton } from '@/components/Skeleton';
import { TasteProfile } from '@/components/TasteProfile';
import { FeedPostItem } from '@/features/feed/FeedPostItem';
import { PostCommentsSheet } from '@/features/feed/PostCommentsSheet';
import { useFeedPostActions } from '@/features/feed/useFeedPostActions';
import { categoryById } from '@/lib/categories';
import { spacing, type, useTheme } from '@/theme';

import { tasteReadout } from './tasteReadout';

/** A row of the Activity list: a post (you and people you follow) or a plain ranking (anyone else). */
export type ActivityRow = RankedBev | FeedItem;

export type ProfileTab = 'activity' | 'taste';

const TABS = [
  { id: 'activity', label: 'Activity', icon: 'file-text' as const },
  { id: 'taste', label: 'Taste Profile', icon: 'chart-no-axes-column' as const },
];

export function parseProfileTab(v: string | string[] | undefined): ProfileTab {
  return v === 'taste' ? 'taste' : 'activity';
}

export interface ActivityListProps {
  /** Whose rankings: newest first, as FeedPosts. */
  profile: Profile;
  /** Your own profile: "You Bev'd …" and first-person empty copy. */
  self: boolean;
  /** The viewer follows this person. With `self`, Activity shows posts (hearts, comments); otherwise plain rankings. */
  following?: boolean;
  /** Everything above the tabs (hero, buttons, rows, stat cards); scrolls with the list. */
  header: ReactElement;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  /** The Activity empty state's action (your own profile: rank your first Bev). */
  onEmptyAction?: () => void;
  /** Pull to refresh: refetch the header's queries too. The rankings refetch here. */
  onRefresh?: () => unknown;
  /** For `scrollToIndex({ index: 0 })`: brings the first post up under the screen header. */
  listRef?: RefObject<FlashListRef<ActivityRow> | null>;
}

/**
 * The scrolling body of a profile: the header, Activity · Taste Profile tabs, then the user's
 * posts (`feed.listUser`, as the Feed shows them) for you and people you follow, else their rankings
 * (`rankings.listUser`) as plain FeedPosts; infinite scroll. Taste Profile shows `stats.getTasteProfile`:
 * the preference read-out over a TasteBar per category.
 */
export function ActivityList({ profile, self, following = false, header, tab, onTab, onEmptyAction, onRefresh, listRef }: ActivityListProps) {
  const { colors } = useTheme();
  const router = useRouter();
  // Posts for you and people you follow (feed.listUser returns nothing for anyone else); follow or
  // unfollow flips `following`, which swaps the query without a reload.
  // Not while a follow or unfollow of this person is in flight: the optimistic flag runs ahead of the server, and feed.listUser would come back empty.
  const followPending = useIsMutating({ mutationKey: FOLLOW_MUTATION, predicate: (m) => m.state.variables === profile.id }) > 0;
  const posts = self || (following && !followPending);
  const rankingsQuery = useUserRankings(posts ? undefined : profile.id);
  const postsQuery = useUserFeed(posts ? profile.id : undefined);
  const query = posts ? postsQuery : rankingsQuery;
  const items = useMemo<ActivityRow[]>(
    () => (posts ? flattenPages(postsQuery.data) : flattenPages(rankingsQuery.data)),
    [posts, postsQuery.data, rankingsQuery.data],
  );
  const data = tab === 'activity' ? items : [];
  // Taste Profile: fetched only while its tab is open. The server already drops the alcoholic three
  // unless viewer and owner are both 21+; dropping them here too keeps an under-21 viewer safe.
  const canSeeAlcohol = useMe().data?.canSeeAlcohol ?? false;
  const tasteQuery = useTasteProfile(tab === 'taste' ? profile.id : undefined);
  const first = profile.displayName.split(' ')[0] || `@${profile.handle}`;
  const tasteRows = useMemo(
    () => (tasteQuery.data ?? []).filter((r) => canSeeAlcohol || !categoryById(r.categoryId)?.isAlcoholic),
    [tasteQuery.data, canSeeAlcohol],
  );
  const readout = useMemo(() => tasteReadout(tasteRows, self ? undefined : first), [tasteRows, self, first]);
  const shown = tab === 'taste' ? tasteQuery : query;
  const { renderItem: renderPost, commentsFor, closeComments, postGone, notice } = useFeedPostActions({ linkActors: false });

  const renderItem = useCallback(
    ({ item }: { item: ActivityRow }) =>
      'actor' in item ? (
        renderPost({ item })
      ) : (
        <FeedPost
          actor={profile}
          you={self}
          bev={item.bev}
          score={item.score}
          bucket={item.bucket}
          note={item.note}
          time={item.createdAt}
          onOpen={() => router.push({ pathname: '/bev/[id]', params: { id: item.bev.id } })}
        />
      ),
    [profile, self, router, renderPost],
  );

  const listHeader = (
    <View>
      {header}
      <SegmentedTabs variant="underline-icon" tabs={TABS} value={tab} onChange={(id) => onTab(parseProfileTab(id))} />
    </View>
  );

  const empty =
    tab === 'taste' ? (
      tasteQuery.isPending ? (
        <View accessibilityLabel="Loading" testID="taste-skeleton" style={styles.tasteSkeleton}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </View>
      ) : tasteQuery.isError ? (
        <ErrorState error={tasteQuery.error} onRetry={() => void tasteQuery.refetch()} />
      ) : tasteRows.length > 0 ? (
        <TasteProfile rows={tasteRows} readout={readout} />
      ) : self ? (
        <EmptyState
          icon="chart-no-axes-column"
          title="No taste profile yet"
          body="Rank a few Bevs and your categories will show up here."
          action="Rank your first Bev"
          onAction={onEmptyAction}
        />
      ) : (
        <EmptyState icon="chart-no-axes-column" title="No taste profile yet" body="Their taste profile will show up here." />
      )
    ) : query.isPending ? (
      <View accessibilityLabel="Loading" testID="activity-skeleton">
        <Skeleton variant="post" />
        <Skeleton variant="post" />
      </View>
    ) : query.isError ? (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    ) : self ? (
      <EmptyState
        icon="file-text"
        title="Your rankings will show up here"
        body="Rank a Bev and it lands on your profile."
        action="Rank your first Bev"
        onAction={onEmptyAction}
      />
    ) : (
      <EmptyState icon="file-text" title={`${first} hasn't Bev'd anything yet`} body="Their rankings will show up here." />
    );

  return (
    <View style={styles.fill}>
      {notice ? (
        <Text style={[type.body, styles.notice, { color: colors.textSecondary }]} role="alert" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <FlashList
        ref={listRef}
        data={data}
        renderItem={renderItem}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={<>{empty}</>}
        ListFooterComponent={tab === 'activity' && query.isFetchingNextPage ? <Skeleton variant="post" /> : <View style={styles.foot} />}
        onEndReached={() => {
          if (tab === 'activity' && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={shown.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => {
          void shown.refetch();
          onRefresh?.();
        }}
      />
      <PostCommentsSheet eventId={commentsFor} onClose={closeComments} onGone={postGone} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  foot: { height: spacing.xxl },
  tasteSkeleton: { gap: spacing.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.gutter },
  notice: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.sm },
});
