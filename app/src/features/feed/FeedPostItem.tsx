import type { FeedItem } from '@bevi/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FeedPost } from '@/components/FeedPost';
import { spacing, type, useTheme } from '@/theme';

export interface FeedPostItemProps {
  item: FeedItem;
  /** The viewer's own post ("You Bev'd …"). */
  you: boolean;
  /** Omitted when the viewer can't rank this Bev (alcohol under 21, or it's their own ranking). */
  onRank?: () => void;
  onSave: () => void;
  /** Toggles the like (the heart); a double-tap calls it only when the post isn't liked yet. */
  onLike: () => void;
  /** Shown under the actions when the last like or unlike on this post failed and was undone. */
  likeError?: string | null;
  /** Opens the post's comments (the comment bubble and "View all N comments"). */
  onComment: () => void;
  onOpenBev: () => void;
  onOpenActor: () => void;
}

/** FeedPost draws a 60pt avatar at the post's top-left padding; the actor target sits over it. */
const AVATAR = 60;

/**
 * One feed post. FeedPost has no actor handler yet (see the PR's contract/component gaps), so a
 * 60pt transparent target over the avatar opens the actor's profile. The divider is drawn here so a
 * like error sits inside the post, above it.
 */
export const FeedPostItem = memo(function FeedPostItem({
  item,
  you,
  onRank,
  onSave,
  onLike,
  likeError,
  onComment,
  onOpenBev,
  onOpenActor,
}: FeedPostItemProps) {
  const { colors } = useTheme();
  return (
    <View testID={`feed-post-${item.id}`} style={[styles.item, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <FeedPost
        actor={item.actor}
        you={you}
        bev={item.bev}
        score={item.score}
        bucket={item.bucket}
        note={item.note}
        time={item.createdAt}
        saved={item.inMyWantToTry}
        liked={item.likedByMe}
        likeCount={item.likeCount}
        onLike={onLike}
        comments={item.comments}
        commentCount={item.commentCount}
        onComment={onComment}
        onRank={onRank}
        onSave={onSave}
        onOpen={onOpenBev}
        divider={false}
      />
      {likeError ? (
        <Text style={[type.body, styles.error, { color: colors.scoreLow }]} accessibilityLiveRegion="polite" role="alert">
          {likeError}
        </Text>
      ) : null}
      <Pressable
        onPress={onOpenActor}
        accessibilityRole="link"
        accessibilityLabel={you ? 'Your profile' : `${item.actor.displayName}, @${item.actor.handle}`}
        style={styles.actor}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  item: { borderBottomWidth: 1 },
  error: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.md },
  actor: { position: 'absolute', top: spacing.lg, left: spacing.gutter, width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
});
