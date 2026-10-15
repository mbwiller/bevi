import { useQueryClient } from '@tanstack/react-query';
import { isApiError, type Comment } from '@bevi/shared';
import { useEffect, useMemo, useState } from 'react';

import { flattenPages, useAddComment, useComments, useMe, useRemoveComment } from '@/api/hooks';
import { keys } from '@/api/keys';
import { CommentsSheet } from '@/components/CommentsSheet';

import { commentErrorMessage } from './commentError';

export interface PostCommentsSheetProps {
  /** The feed post whose comments are open; null closes the sheet. */
  eventId: string | null;
  onClose: () => void;
  /** The post is gone or hidden ('not_found' from the thread or from posting): close and say so. */
  onGone: () => void;
}

const isGone = (e: unknown) => isApiError(e) && e.code === 'not_found';

/**
 * CommentsSheet over a feed post's thread. `comments.list` pages come newest first; the sheet reads
 * oldest first, so the pages are flattened and reversed, and "Load earlier comments" at the top
 * fetches the next (older) page. Posting and deleting go through useAddComment / useRemoveComment,
 * which update the thread and the post in the feed.
 */
export function PostCommentsSheet({ eventId, onClose, onGone }: PostCommentsSheetProps) {
  // Keep showing the last post's thread while the sheet animates closed.
  const [shownId, setShownId] = useState(eventId);
  if (eventId && eventId !== shownId) setShownId(eventId);
  const qc = useQueryClient();

  const me = useMe();
  const thread = useComments(shownId);
  const add = useAddComment();
  const remove = useRemoveComment();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string[]>([]);

  // Each opening starts without the last one's error.
  useEffect(() => {
    if (eventId) setError(null);
  }, [eventId]);

  const comments = useMemo(() => {
    const seen = new Set<string>();
    const out: Comment[] = [];
    for (const c of flattenPages(thread.data)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out.reverse();
  }, [thread.data]);

  const gone = !!eventId && isGone(thread.error);
  useEffect(() => {
    if (!gone || !shownId) return;
    // Drop the failed thread so the error can't greet a later opening.
    qc.removeQueries({ queryKey: keys.comments(shownId) });
    onGone();
  }, [gone, shownId, onGone, qc]);

  const post = async (body: string): Promise<boolean> => {
    if (!shownId) return false;
    setError(null);
    try {
      await add.mutateAsync({ eventId: shownId, body });
      return true;
    } catch (e) {
      if (isGone(e)) onGone();
      else setError(commentErrorMessage('post', e));
      return false;
    }
  };

  const del = async (id: string) => {
    if (!shownId) return;
    setError(null);
    setDeleting((d) => [...d, id]);
    try {
      await remove.mutateAsync({ eventId: shownId, id });
    } catch (e) {
      // 'not_found': it's already gone (the hook refetches the thread); nothing to say.
      if (!isGone(e)) setError(commentErrorMessage('delete', e));
    } finally {
      setDeleting((d) => d.filter((x) => x !== id));
    }
  };

  return (
    <CommentsSheet
      open={!!eventId}
      comments={comments}
      me={me.data}
      onClose={onClose}
      onPost={post}
      onDelete={(id) => void del(id)}
      error={error}
      posting={add.isPending}
      deleting={deleting}
      loading={thread.isPending && !!shownId}
      loadError={thread.isError && !thread.data && !isGone(thread.error) ? thread.error : undefined}
      onRetry={() => void thread.refetch()}
      hasEarlier={thread.hasNextPage}
      loadingEarlier={thread.isFetchingNextPage}
      onLoadEarlier={() => {
        if (thread.hasNextPage && !thread.isFetchingNextPage) void thread.fetchNextPage();
      }}
    />
  );
}
