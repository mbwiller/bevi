import type { FeedItem, Profile } from '@bevi/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FeedPost, POST_AVATAR } from '@/components/FeedPost';
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
  /** Omitted on the actor's own profile, where the avatar has nowhere to go. */
  onOpenActor?: () => void;
}

/**
 * One feed post. FeedPost has no prop for opening the actor, so a transparent target over its
 * avatar (`POST_AVATAR`, 44pt, at the post's top-left padding) opens the actor's profile. The
 * divider is drawn here so a like error sits inside the post, above it.
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
        alsoBevdBy={alsoBevdProfiles(item)}
        alsoBevdCount={item.alsoBevdCount}
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
      {onOpenActor ? <ActorLink label={you ? 'Your profile' : actorLabel(item.actor)} onPress={onOpenActor} /> : null}
    </View>
  );
});

/**
 * "Bev'd it too": the people FeedPost names, from the post's `alsoBevdBy` (people you follow who
 * ranked the Bev, newest first). FeedPost draws their names and avatars, not their scores.
 */
const alsoBevdProfiles = (item: FeedItem) => item.alsoBevdBy.map((f) => f.profile);

/** The actor link's accessible name: "Friend A, @friend_a". */
export const actorLabel = (actor: Pick<Profile, 'displayName' | 'handle'>) => `${actor.displayName}, @${actor.handle}`;

/** The transparent target over a FeedPost's avatar that opens the actor's profile. Inside the post's wrapper View. */
export function ActorLink({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={label} style={styles.actor} />;
}

const styles = StyleSheet.create({
  item: { borderBottomWidth: 1 },
  error: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.md },
  actor: { position: 'absolute', top: spacing.lg, left: spacing.gutter, width: POST_AVATAR, height: POST_AVATAR, borderRadius: POST_AVATAR / 2 },
});
