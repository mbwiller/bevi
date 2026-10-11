import type { FeedItem } from '@bevi/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FeedPost } from '@/components/FeedPost';
import { spacing } from '@/theme';

export interface FeedPostItemProps {
  item: FeedItem;
  /** The viewer's own post ("You Bev'd …"). */
  you: boolean;
  /** Omitted when the viewer can't rank this Bev (alcohol under 21, or it's their own ranking). */
  onRank?: () => void;
  onSave: () => void;
  onOpenBev: () => void;
  onOpenActor: () => void;
}

/** FeedPost draws a 60pt avatar at the post's top-left padding; the actor target sits over it. */
const AVATAR = 60;

/**
 * One feed post. FeedPost has no actor handler yet (see the PR's contract/component gaps), so a
 * 60pt transparent target over the avatar opens the actor's profile.
 */
export const FeedPostItem = memo(function FeedPostItem({ item, you, onRank, onSave, onOpenBev, onOpenActor }: FeedPostItemProps) {
  const saved = item.type === 'SAVED';
  return (
    <View>
      <FeedPost
        actor={item.actor}
        you={you}
        verb={saved ? 'saved' : 'ranked'}
        bev={item.bev}
        score={saved ? undefined : item.score}
        bucket={saved ? undefined : item.bucket}
        note={saved ? undefined : item.note}
        time={item.createdAt}
        saved={item.inMyWantToTry}
        onRank={onRank}
        onSave={onSave}
        onOpen={onOpenBev}
      />
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
  actor: { position: 'absolute', top: spacing.lg, left: spacing.gutter, width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
});
