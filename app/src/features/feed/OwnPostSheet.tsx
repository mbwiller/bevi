import type { FeedItem } from '@bevi/shared';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useRemoveRanking } from '@/api/hooks';
import { Announce } from '@/components/Announce';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { SheetOption } from '@/features/lists/SheetOption';
import { actionErrorMessage } from '@/lib/errorCopy';
import { spacing, type, useTheme } from '@/theme';

export const DELETE_POST = 'Delete post';
export const DELETE_TITLE = 'Delete this Bev?';
export const DELETE_BODY = 'Its post, likes and comments go too.';

/**
 * The More menu on the viewer's own post (TICKET-32): Delete post, then a confirm. A post is its
 * ranking (`FeedEventKind` is only 'RANKING'), so deleting it is `rankings.removeRanking`, which
 * takes the post and its likes and comments with it, and shifts the bucket's other Bevs up.
 * `onDeleted` runs once the sheet has finished closing after a delete (the Post screen goes back):
 * navigating under a Modal that is still dismissing leaves iOS with a stuck screen.
 */
export function OwnPostSheet({ post, onClose, onDeleted }: { post: FeedItem | null; onClose: () => void; onDeleted?: () => void }) {
  const { colors } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveRanking();
  const deleted = useRef(false);

  const postId = post?.id;
  useEffect(() => {
    // A new post resets the sheet (deliberately keyed on the post only).
    setConfirming(false);
    remove.reset();
  }, [postId]);

  return (
    <Sheet
      open={!!post}
      title={confirming ? DELETE_TITLE : (post?.bev.name ?? '')}
      snap={40}
      onClose={onClose}
      onClosed={() => {
        if (!deleted.current) return;
        deleted.current = false;
        onDeleted?.();
      }}
    >
      {post && !confirming ? <SheetOption label={DELETE_POST} icon="x" destructive onPress={() => setConfirming(true)} /> : null}

      {post && confirming ? (
        <View style={styles.pad}>
          <Text style={[type.bodyLarge, { color: colors.text }]}>{DELETE_BODY}</Text>
          <Announce text={remove.error ? actionErrorMessage(remove.error) : null} />
          {remove.error ? (
            <Text style={[type.body, { color: colors.scoreLow }]} accessibilityRole="alert">
              {actionErrorMessage(remove.error)}
            </Text>
          ) : null}
          <View style={styles.buttons}>
            <Button variant="outlined" onPress={() => setConfirming(false)} style={styles.grow}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={remove.isPending}
              style={styles.grow}
              accessibilityLabel={`Delete ${post.bev.name}`}
              onPress={() =>
                remove.mutate(post.bev.id, {
                  onSuccess: () => {
                    deleted.current = true;
                    onClose();
                  },
                })
              }
            >
              Delete
            </Button>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, gap: spacing.lg },
  buttons: { flexDirection: 'row', gap: spacing.md },
  grow: { flex: 1 },
});
