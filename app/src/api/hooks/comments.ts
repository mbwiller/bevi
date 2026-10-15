import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { isApiError, type Comment, type FeedItem, type Page } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { FEED_ITEM_PREFIXES } from './feed';
import { cursorPaging, mapCachedItems } from './util';

/** `FeedItem.comments` holds the post's first this-many comments, oldest first (contract). */
export const FEED_ITEM_COMMENTS = 7;

/** Comments per `comments.list` page. */
export const COMMENTS_PAGE = 20;

/**
 * A post's thread, NEWEST first, 20 per page (as `comments.list` returns it); the next page is older.
 * The sheet reverses it to read oldest first. Throws 'not_found' when the post is gone or hidden.
 */
export function useComments(eventId: string | null) {
  return useInfiniteQuery({
    queryKey: keys.comments(eventId ?? ''),
    queryFn: ({ pageParam }) => api.comments.list(eventId!, { cursor: pageParam, limit: COMMENTS_PAGE }),
    enabled: !!eventId,
    ...cursorPaging,
  });
}

type Thread = InfiniteData<Page<Comment>, string | undefined>;

/** Applies `fn` to the post `eventId` in every FeedItem cache. */
function updatePost(qc: QueryClient, eventId: string, fn: (item: FeedItem) => FeedItem): void {
  for (const queryKey of FEED_ITEM_PREFIXES) {
    qc.setQueriesData({ queryKey }, (data: unknown) => mapCachedItems<FeedItem>(data, (item) => (item.id === eventId ? fn(item) : item)));
  }
}

function invalidatePosts(qc: QueryClient): Promise<unknown> {
  return Promise.all(FEED_ITEM_PREFIXES.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export interface AddCommentVars {
  eventId: string;
  body: string;
}

/**
 * Posts a comment. Not optimistic: the composer keeps the text until the server has it, so a
 * 'validation', 'rate_limited' or 'network' failure leaves the draft to retry. networkMode 'always'
 * makes an offline tap fail at once with 'network' instead of waiting, paused, for a connection.
 *
 * On success the comment goes to the newest end of the thread (the first page) and to the post in
 * every FeedItem cache: `commentCount` + 1, and appended to `comments` while it holds fewer than seven
 * (the contract's first seven, oldest first, so a newer comment never displaces one of them).
 */
export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, body }: AddCommentVars) => api.comments.add(eventId, body),
    networkMode: 'always',
    onSuccess: (comment, { eventId }) => {
      qc.setQueryData<Thread>(keys.comments(eventId), (data) => {
        if (!data?.pages.length || data.pages.some((p) => p.items.some((c) => c.id === comment.id))) return data;
        const [first, ...rest] = data.pages;
        return { ...data, pages: [{ ...first!, items: [comment, ...first!.items] }, ...rest] };
      });
      updatePost(qc, eventId, (item) =>
        item.comments.some((c) => c.id === comment.id)
          ? item
          : {
              ...item,
              commentCount: item.commentCount + 1,
              comments: item.comments.length < FEED_ITEM_COMMENTS ? [...item.comments, comment] : item.comments,
            },
      );
    },
  });
}

export interface RemoveCommentVars {
  /** The post the comment is on. */
  eventId: string;
  /** The comment's id. */
  id: string;
}

/**
 * Deletes one of your comments (idempotent). On success it leaves the thread and the post in every
 * FeedItem cache: `commentCount` − 1 and out of `comments`. When that leaves the post's first seven
 * short of what the post has, the feed refetches to refill them; when no cache held the comment (so
 * the count can't be trusted to move), the feed refetches instead. 'not_found' (not yours, or never
 * existed) refetches the thread and the feed.
 */
export function useRemoveComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: RemoveCommentVars) => api.comments.remove(id),
    networkMode: 'always',
    onSuccess: (_data, { eventId, id }) => {
      let inThread = false;
      qc.setQueryData<Thread>(keys.comments(eventId), (data) => {
        if (!data) return data;
        inThread = data.pages.some((p) => p.items.some((c) => c.id === id));
        return inThread ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((c) => c.id !== id) })) } : data;
      });
      let refill = false;
      updatePost(qc, eventId, (item) => {
        const inline = item.comments.some((c) => c.id === id);
        if (!inThread && !inline) {
          refill = true;
          return item;
        }
        const comments = item.comments.filter((c) => c.id !== id);
        const commentCount = Math.max(0, item.commentCount - 1);
        if (inline && commentCount > comments.length) refill = true;
        return { ...item, commentCount, comments };
      });
      if (refill) void invalidatePosts(qc);
    },
    onError: (error, { eventId }) => {
      if (!isApiError(error) || error.code !== 'not_found') return;
      void qc.invalidateQueries({ queryKey: keys.comments(eventId) });
      void invalidatePosts(qc);
    },
  });
}
