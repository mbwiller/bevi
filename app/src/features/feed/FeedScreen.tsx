import type { FeedItem } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { flattenPages, useFeed, useStats } from '@/api/hooks';
import { keys } from '@/api/keys';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { SearchBar } from '@/components/SearchBar';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { spacing, type, useTheme } from '@/theme';

import { BevOfPeriod } from './BevOfPeriod';
import { PostCommentsSheet } from './PostCommentsSheet';
import { POST_GONE, useFeedPostActions } from './useFeedPostActions';

// Kept exported from here for existing imports.
export { POST_GONE };

const SEARCH_PLACEHOLDER = 'Search a Bev or a person';

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
 * Feed (§6.4): the filled search bar (opens the Search tab with its panel up), Bev of the day and week (M-05), then YOUR FEED: followed users'
 * rankings, newest first, 20 per page, each with a heart (tap it, or double-tap the post, to like)
 * and a comment bubble that opens the post's comments in a sheet. Following nobody → "Follow friends to see their Bevs" under YOUR FEED while the Bev of the day and week stay.
 */
export function FeedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const stats = useStats();
  const feed = useFeed();
  const { renderItem, commentsFor, closeComments, postGone, notice } = useFeedPostActions();
  const qc = useQueryClient();

  const posts = useMemo(() => flattenPages(feed.data), [feed.data]);

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
      <SectionHeader title="Your feed" />
      {followingNobody && posts.length > 0 ? followPrompt : null}
    </View>
  );

  const empty = feed.isPending ? (
    <PostSkeletons count={3} />
  ) : feed.isError ? (
    <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
  ) : followingNobody ? (
    followPrompt
  ) : (
    <EmptyState icon="newspaper" title="No Bevs from friends yet" body="When people you follow Bev something, it shows up here." />
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header wordmark actions={[{ icon: 'user-plus', label: 'Find people', onPress: findPeople }]} />
      {notice ? (
        <Text style={[type.body, styles.notice, { color: colors.textSecondary }]} role="alert" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <FlashList
        data={posts}
        renderItem={renderItem}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={feed.isFetchingNextPage ? <PostSkeletons count={1} /> : <View style={styles.foot} />}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={feed.isRefetching && !feed.isFetchingNextPage && !feed.isPending}
        onRefresh={() => {
          void feed.refetch();
          void qc.invalidateQueries({ queryKey: keys.bevOfPeriod() });
          void stats.refetch();
        }}
      />
      <PostCommentsSheet eventId={commentsFor} onClose={closeComments} onGone={postGone} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  foot: { height: spacing.xxl },
  notice: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.sm },
});
