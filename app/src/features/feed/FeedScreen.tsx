import type { FeedItem } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  flattenPages,
  useAddWantToTry,
  useFeatured,
  useFeed,
  useMe,
  useRemoveWantToTry,
  useStats,
  useToggleLike,
} from '@/api/hooks';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { SearchBar } from '@/components/SearchBar';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { categoryById } from '@/lib/categories';
import { spacing, useTheme } from '@/theme';

import { FeaturedCarousel } from './FeaturedCarousel';
import { FeedPostItem } from './FeedPostItem';
import { likeErrorMessage } from './likeError';

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
 * Feed (§6.4): the filled search bar (opens Add Bev), Featured Bevs, then YOUR FEED: followed users'
 * rankings, newest first, 20 per page, each with a heart (tap it, or double-tap the post, to like).
 * Following nobody → "Follow friends to see their Bevs" under YOUR FEED while Featured stays.
 */
export function FeedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  const stats = useStats();
  const feed = useFeed();
  const featured = useFeatured();
  const add = useAddWantToTry();
  const remove = useRemoveWantToTry();
  const like = useToggleLike();
  const toggleLike = like.mutate;
  // The latest like tap failed and its post went back: say so on that post until the next tap.
  const failedLikeId = like.isError ? like.variables?.id : undefined;
  const failedLikeMessage = like.isError && like.variables ? likeErrorMessage(like.error, like.variables.like) : null;
  const posts = useMemo(() => flattenPages(feed.data), [feed.data]);

  const meId = me.data?.id;
  const canSeeAlcohol = me.data?.canSeeAlcohol ?? false;
  const followingNobody = stats.data?.following === 0;

  const findPeople = useCallback(() => router.push({ pathname: '/add', params: { tab: 'people' } }), [router]);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      const you = item.actor.id === meId;
      // §6.17: a friend's beer still shows, but under 21 there's no plus-circle. Your own ranking is already ranked.
      const rankable = !(categoryById(item.bev.categoryId)?.isAlcoholic && !canSeeAlcohol) && !(you && item.type === 'RANKING');
      return (
        <FeedPostItem
          item={item}
          you={you}
          onRank={rankable ? () => router.push({ pathname: '/rank/[bevId]', params: { bevId: item.bev.id } }) : undefined}
          onSave={() =>
            item.inMyWantToTry
              ? remove.mutate(item.bev.id)
              : add.mutate({ bevId: item.bev.id, viaUserId: you ? undefined : item.actor.id })
          }
          onLike={() => toggleLike({ id: item.id, like: !item.likedByMe })}
          likeError={failedLikeId === item.id ? failedLikeMessage : null}
          onOpenBev={() => router.push({ pathname: '/bev/[id]', params: { id: item.bev.id } })}
          onOpenActor={() =>
            you ? router.push('/profile') : router.push({ pathname: '/user/[id]', params: { id: item.actor.id } })
          }
        />
      );
    },
    [add, remove, toggleLike, failedLikeId, failedLikeMessage, router, meId, canSeeAlcohol],
  );

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
        onPress={() => router.push('/add')}
        accessibilityRole="search"
        accessibilityLabel={SEARCH_PLACEHOLDER}
        style={styles.search}
      >
        {/* The bar is a doorway to Add Bev's search: it never takes focus itself. */}
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <SearchBar variant="filled" placeholder={SEARCH_PLACEHOLDER} />
        </View>
      </Pressable>
      <FeaturedCarousel />
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
          void featured.refetch();
          void stats.refetch();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  foot: { height: spacing.xxl },
});
