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
 * navigating under a Modal that is still dismissing leaves iOS with a stuck screen. It still runs
 * when the sheet was dismissed while the delete was in flight.
 */
export function OwnPostSheet({ post, onClose, onDeleted }: { post: FeedItem | null; onClose: () => void; onDeleted?: () => void }) {
  const { colors } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveRanking();
  // A delete succeeded and `onDeleted` waits for the sheet to finish closing.
  const deleted = useRef(false);
  // The sheet has finished closing (or never opened): a delete that lands now goes straight on.
  const gone = useRef(true);
  // The post the sheet last opened on, so it keeps its content while it slides closed.
  const last = useRef<FeedItem | null>(null);
  if (post) last.current = post;
  const shown = post ?? last.current;

  const postId = post?.id;
  useEffect(() => {
    // Opening on a post starts at the menu with no old error. Only on open, never on mount or close:
    // a reset on close would drop the in-flight delete's onSuccess, and one on mount notifies the
    // mutation's observer for nothing on every screen that hosts this sheet.
    if (postId == null) return;
    gone.current = false;
    setConfirming(false);
    if (!remove.isIdle) remove.reset();
  }, [postId]);

  return (
    <Sheet
      open={!!post}
      title={confirming ? DELETE_TITLE : (shown?.bev.name ?? '')}
      snap={40}
      onClose={onClose}
      onClosed={() => {
        gone.current = true;
        if (!deleted.current) return;
        deleted.current = false;
        onDeleted?.();
      }}
    >
      {shown && !confirming ? <SheetOption label={DELETE_POST} icon="x" destructive onPress={() => setConfirming(true)} /> : null}

      {shown && confirming ? (
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
              accessibilityLabel={`Delete ${shown.bev.name}`}
              onPress={() =>
                remove.mutate(shown.bev.id, {
                  onSuccess: () => {
                    if (gone.current) {
                      onDeleted?.();
                      return;
                    }
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
