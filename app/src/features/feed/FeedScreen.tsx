import type { ExplorePost, FeedItem } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { flattenPages, restartExplore, useFeed, useStats } from '@/api/hooks';
import { keys } from '@/api/keys';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { SearchBar } from '@/components/SearchBar';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { Skeleton } from '@/components/Skeleton';
import { spacing, type, useTheme } from '@/theme';

import { BevOfPeriod } from './BevOfPeriod';
import { PostCommentsSheet } from './PostCommentsSheet';
import { POST_GONE, useFeedPostActions } from './useFeedPostActions';
import { useExplorePosts } from './useExplorePosts';

// Kept exported from here for existing imports.
export { POST_GONE };

const SEARCH_PLACEHOLDER = 'Search a Bev or a person';

export type FeedSegment = 'feed' | 'explore';

const SEGMENTS = [
  { id: 'feed', label: 'Your feed' },
  { id: 'explore', label: 'Explore' },
];

/** `?segment=explore` opens Explore; anything else is Your feed. */
export function parseFeedSegment(v: string | string[] | undefined): FeedSegment {
  return v === 'explore' ? 'explore' : 'feed';
}

/** A row of the one list: a post in Your feed, or a read-only post in Explore. */
type Row = { kind: 'post'; item: FeedItem } | { kind: 'explore'; item: ExplorePost };

function PostSkeletons({ count }: { count: number }) {
  return (
    <View testID="feed-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} variant="post" />
      ))}
    </View>
  );
}

/**
 * Feed (§6.4): the filled search bar (opens the Search tab with its panel up), Bev of the day and week (M-05), then the
 * "Your feed · Explore" tabs (`?segment=explore`, M-04).
 *
 * Your feed: followed users' rankings, newest first, 20 per page, each with a heart (tap it, or
 * double-tap the post, to like) and a comment bubble that opens the post's comments in a sheet.
 * Following nobody → "Follow friends to see their Bevs" under the tabs while the Bev of the day and week stay.
 *
 * Explore: rankings by people you don't follow, most popular first, as plain read-only posts with
 * the author's Follow pill (`useExplorePosts`). Pull to refresh starts a fresh sequence.
 */
export function FeedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ segment?: string }>();
  const segment = parseFeedSegment(params.segment);
  const exploring = segment === 'explore';
  const stats = useStats();
  const feed = useFeed();
  const { renderItem: renderPost, commentsFor, closeComments, postGone, notice } = useFeedPostActions();
  const explore = useExplorePosts(exploring);
  const { renderItem: renderExplore } = explore;
  const qc = useQueryClient();

  const posts = useMemo(() => flattenPages(feed.data), [feed.data]);
  const rows = useMemo<Row[]>(
    () =>
      exploring
        ? explore.posts.map((item) => ({ kind: 'explore', item }))
        : posts.map((item) => ({ kind: 'post', item })),
    [exploring, explore.posts, posts],
  );
  const renderItem = useCallback(
    ({ item: row }: { item: Row }) => (row.kind === 'post' ? renderPost({ item: row.item }) : renderExplore(row.item)),
    [renderPost, renderExplore],
  );

  const followingNobody = stats.data?.following === 0;

  const findPeople = useCallback(() => router.push({ pathname: '/add', params: { tab: 'people' } }), [router]);

  const followPrompt = (
    <EmptyState
      icon="users"
      title="Follow friends to see their Bevs"
      body="Their rankings show up here."
      action="Find people"
      onAction={findPeople}
    />
  );

  const header = (
    <View>
      <Pressable
        onPress={() => router.push({ pathname: '/add', params: { focus: '1' } })}
        accessibilityRole="search"
        accessibilityLabel={SEARCH_PLACEHOLDER}
        style={styles.search}
      >
        {/* The bar is a doorway to the Search tab, which opens with its bar focused: it never takes focus itself. */}
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <SearchBar variant="filled" placeholder={SEARCH_PLACEHOLDER} />
        </View>
      </Pressable>
      <BevOfPeriod />
      <SegmentedTabs
        tabs={SEGMENTS}
        value={segment}
        onChange={(id) => router.setParams({ segment: parseFeedSegment(id) })}
      />
      {!exploring && followingNobody && posts.length > 0 ? followPrompt : null}
    </View>
  );

  const xq = explore.query;
  const empty = exploring ? (
    xq.isPending ? (
      <PostSkeletons count={3} />
    ) : xq.isError ? (
      <ErrorState error={xq.error} onRetry={() => void xq.refetch()} />
    ) : (
      <EmptyState icon="sparkles" title={EXPLORE_EMPTY_TITLE} body={EXPLORE_EMPTY_BODY} />
    )
  ) : feed.isPending ? (
    <PostSkeletons count={3} />
  ) : feed.isError ? (
    <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
  ) : followingNobody ? (
    followPrompt
  ) : (
    <EmptyState icon="newspaper" title="No Bevs from friends yet" body="When people you follow Bev something, it shows up here." />
  );

  // The segment's paging and refresh. Explore never asks for its next page while a fresh sequence is
  // loading: that page's cursor belongs to the old sequence.
  const footer = exploring ? (
    xq.isFetchingNextPage ? (
      <PostSkeletons count={1} />
    ) : xq.isFetchNextPageError ? (
      <ErrorState error={xq.error} onRetry={() => void xq.fetchNextPage()} />
    ) : (
      <View style={styles.foot} />
    )
  ) : feed.isFetchingNextPage ? (
    <PostSkeletons count={1} />
  ) : (
    <View style={styles.foot} />
  );
  const onEndReached = () => {
    if (exploring) {
      if (xq.hasNextPage && !xq.isFetching && !xq.isFetchNextPageError) void xq.fetchNextPage();
    } else if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  };
  const refreshing = exploring
    ? xq.isRefetching && !xq.isFetchingNextPage && !xq.isPending
    : feed.isRefetching && !feed.isFetchingNextPage && !feed.isPending;
  const onRefresh = () => {
    if (exploring) void restartExplore(qc);
    else {
      void feed.refetch();
      void stats.refetch();
    }
    void qc.invalidateQueries({ queryKey: keys.bevOfPeriod() });
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header wordmark actions={[{ icon: 'user-plus', label: 'Find people', onPress: findPeople }]} />
      {notice ? (
        <Text style={[type.body, styles.notice, { color: colors.textSecondary }]} role="alert" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <FlashList
        testID="feed-list"
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyOf}
        getItemType={typeOf}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
      <PostCommentsSheet eventId={commentsFor} onClose={closeComments} onGone={postGone} />
    </SafeAreaView>
  );
}

const keyOf = (r: Row) => `${r.kind}-${r.item.id}`;
const typeOf = (r: Row) => r.kind;

export const EXPLORE_EMPTY_TITLE = 'Nothing popular yet';
export const EXPLORE_EMPTY_BODY = "Popular Bevs from people you don't follow show up here.";

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  foot: { height: spacing.xxl },
  notice: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.sm },
});
