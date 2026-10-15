import type { FeedItem } from '@bevi/shared';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  type LikeVars,
} from '@/api/hooks';
import { keys } from '@/api/keys';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { SearchBar } from '@/components/SearchBar';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { categoryById } from '@/lib/categories';
import { spacing, type, useTheme } from '@/theme';

import { FeaturedCarousel } from './FeaturedCarousel';
import { FeedPostItem } from './FeedPostItem';
import { likeErrorMessage } from './likeError';
import { PostCommentsSheet } from './PostCommentsSheet';

const SEARCH_PLACEHOLDER = 'Search a Bev or a person';

/** What the feed says when a post's comments turn out to be on a post that's gone. */
export const POST_GONE = "That post isn't here anymore.";
/** How long that notice stays. */
const NOTICE_MS = 6000;

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
 * rankings, newest first, 20 per page, each with a heart (tap it, or double-tap the post, to like)
 * and a comment bubble that opens the post's comments in a sheet. Following nobody → "Follow friends to see their Bevs" under YOUR FEED while Featured stays.
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
  const qc = useQueryClient();
  // Per post: its latest like tap failed and the heart went back. Said on that post until its next
  // tap, whichever post was tapped since (the mutation's own `error` only knows the latest call).
  const [likeErrors, setLikeErrors] = useState<Record<string, string>>({});
  const onLikeFailed = useCallback(
    (vars: LikeVars, error: unknown) => setLikeErrors((m) => ({ ...m, [vars.id]: likeErrorMessage(error, vars.like) })),
    [],
  );
  const { mutate: toggleLike } = useToggleLike({ onFailed: onLikeFailed });
  const like = useCallback(
    (vars: LikeVars) => {
      setLikeErrors((m) => {
        if (!(vars.id in m)) return m;
        const { [vars.id]: _cleared, ...rest } = m;
        return rest;
      });
      toggleLike(vars);
    },
    [toggleLike],
  );

  // The post whose comments are open, and the notice when one turned out to be gone.
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const openComments = useCallback((id: string) => {
    setNotice(null);
    setCommentsFor(id);
  }, []);
  const closeComments = useCallback(() => setCommentsFor(null), []);
  const postGone = useCallback(() => {
    setCommentsFor(null);
    setNotice(POST_GONE);
    void qc.invalidateQueries({ queryKey: keys.feed() });
  }, [qc]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

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
          onLike={() => like({ id: item.id, like: !item.likedByMe })}
          likeError={likeErrors[item.id] ?? null}
          onComment={() => openComments(item.id)}
          onOpenBev={() => router.push({ pathname: '/bev/[id]', params: { id: item.bev.id } })}
          onOpenActor={() =>
            you ? router.push('/profile') : router.push({ pathname: '/user/[id]', params: { id: item.actor.id } })
          }
        />
      );
    },
    [add, remove, like, likeErrors, openComments, router, meId, canSeeAlcohol],
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
          void featured.refetch();
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
