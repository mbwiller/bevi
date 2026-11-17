import type { ExplorePost } from '@bevi/shared';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { FeedPost } from '@/components/FeedPost';
import { useTheme } from '@/theme';

import { ActorLink, actorLabel } from './FeedPostItem';

export interface ExplorePostItemProps {
  item: ExplorePost;
  /** The viewer followed the author from this list (Explore only ever serves people you don't follow). */
  following: boolean;
  onFollow: () => void;
  onOpenBev: () => void;
  onOpenActor: () => void;
}

/**
 * One Explore post (M-04): the plain, read-only FeedPost a stranger's Activity shows (D-15), so no
 * heart, counts, comments, Rank it or Want to Try, and no double-tap; tapping the photo opens the
 * Bev, the avatar opens the author's profile, and the author's Follow pill leads the action row.
 */
export const ExplorePostItem = memo(function ExplorePostItem({ item, following, onFollow, onOpenBev, onOpenActor }: ExplorePostItemProps) {
  const { colors } = useTheme();
  return (
    <View testID={`explore-post-${item.id}`} style={[styles.item, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <FeedPost
        actor={item.actor}
        bev={item.bev}
        score={item.score}
        bucket={item.bucket}
        note={item.note}
        time={item.createdAt}
        following={following}
        onFollow={onFollow}
        onOpen={onOpenBev}
        divider={false}
      />
      <ActorLink label={actorLabel(item.actor)} onPress={onOpenActor} />
    </View>
  );
});

const styles = StyleSheet.create({
  item: { borderBottomWidth: 1 },
});
