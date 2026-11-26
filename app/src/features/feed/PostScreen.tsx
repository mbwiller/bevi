import { isApiError } from '@bevi/shared';
import { useLocalSearchParams } from 'expo-router';
import { useContext, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context';

import { usePost } from '@/api/hooks';
import { Announce } from '@/components/Announce';
import { Arrive, useArrival } from '@/components/Arrive';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Header } from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { useBack } from '@/lib/useBack';
import { spacing, type, useTheme } from '@/theme';

import { SafetyFlow } from '../safety/SafetyFlow';
import { OwnPostSheet } from './OwnPostSheet';
import { PostCommentsSheet } from './PostCommentsSheet';
import { useFeedPostActions } from './useFeedPostActions';

export const POST_GONE_TITLE = 'This post is gone';
export const POST_GONE_BODY = 'It was removed or re-ranked, or you can no longer see it.';

/**
 * One post (`/post/[id]`, T-31): what a like or comment notification opens. The post is drawn and
 * behaves exactly as on the Feed (`useFeedPostActions`: like, comments, Want to Try, Rank it, More),
 * and `?comments=1` opens its comments once it has loaded (once: closing them leaves them closed).
 *
 * A post that is gone ('not_found': removed, re-ranked, or no longer the caller's to see) says so,
 * with Back. So does one that goes while it is open: a 'not_found' from its comments or a like
 * reloads it (`postGone`), and blocking its author takes it out of the cache.
 */
export function PostScreen() {
  const { colors } = useTheme();
  // A pushed screen has no tab bar: its scroll end clears the home indicator itself.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const back = useBack();
  const { id, comments } = useLocalSearchParams<{ id: string; comments?: string }>();
  const query = usePost(id);
  const { renderItem, commentsFor, openComments, closeComments, postGone, notice, safety, ownPost } = useFeedPostActions();
  const arrival = useArrival(query.isPending);
  const post = query.data;

  // `?comments=1`: up once the post is here, never again after the person closes them.
  const commentsOpened = useRef(false);
  useEffect(() => {
    if (comments !== '1' || !post || commentsOpened.current) return;
    commentsOpened.current = true;
    openComments(post.id);
  }, [comments, post, openComments]);

  const gone = post === null || (isApiError(query.error) && query.error.code === 'not_found');

  let body;
  if (query.isPending) {
    body = <Skeleton variant="post" />;
  } else if (gone) {
    // Before the post: a refetch that answers 'not_found' keeps the last post in `data`.
    body = <EmptyState icon="file-text" title={POST_GONE_TITLE} body={POST_GONE_BODY} />;
  } else if (post) {
    body = renderItem({ item: post });
  } else {
    body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <Header title="Post" onBack={back} />
      <Announce text={notice} />
      {notice && !gone ? (
        <Text style={[type.body, styles.notice, { color: colors.textSecondary }]} role="alert" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl + bottomInset }}>
        {query.isPending ? body : <Arrive progress={arrival}>{body}</Arrive>}
      </ScrollView>
      <PostCommentsSheet eventId={post && !gone ? commentsFor : null} onClose={closeComments} onGone={postGone} />
      {/* Blocking the author takes the post with them: back to where it was opened from. */}
      <SafetyFlow {...safety} onBlocked={back} />
      {/* Deleting your own post leaves nothing to show: back, once its sheet has closed. */}
      <OwnPostSheet {...ownPost} onDeleted={back} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  notice: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.sm },
});
