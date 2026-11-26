import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeedItem, Page } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { cursorPaging, rollback, snapshot } from './util';

/** Notifications per `notifications.list` page. */
export const NOTIFICATIONS_PAGE = 20;

/** How often the bell's count is read again while the app is in front. */
export const UNREAD_POLL_MS = 60_000;

/**
 * The inbox (T-31), newest first, 20 per page: follows, and likes (one row per post) and comments on
 * the caller's posts. `markRead` never refetches it, so the rows on screen keep their unread tint
 * until the Notifications screen is left (NotificationsScreen marks it stale then).
 */
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: keys.notifications.list(),
    queryFn: ({ pageParam }) => api.notifications.list({ cursor: pageParam, limit: NOTIFICATIONS_PAGE }),
    ...cursorPaging,
  });
}

/**
 * The bell's unread count. Read again every minute while the app is in front (React Query pauses the
 * interval in the background and offline, and the focus manager reads it on coming to the front).
 * `retry: false`, as `useAppConfig`: the poll is the retry, and a failed read shows no badge.
 */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: keys.notifications.unreadCount(),
    queryFn: () => api.notifications.unreadCount(),
    refetchInterval: UNREAD_POLL_MS,
    retry: false,
  });
}

/**
 * Marks everything up to `upToId` (the newest row on screen) read. Optimistic on the bell only: the
 * count is 0 at once and comes back on an error. The list is deliberately left alone (no
 * invalidation, no refetch), so what was new stays tinted while the person reads it.
 */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (upToId: string) => api.notifications.markRead(upToId),
    onMutate: async () => {
      const snap = await snapshot(qc, [keys.notifications.unreadCount()]);
      qc.setQueryData<number>(keys.notifications.unreadCount(), 0);
      return { snap };
    },
    onError: (_e, _id, ctx) => rollback(qc, ctx?.snap),
    // The count only: something new may have arrived meanwhile.
    onSettled: () => qc.invalidateQueries({ queryKey: keys.notifications.unreadCount() }),
  });
}

/**
 * One post (`feed.getPost`), as the feed shows it: what a notification opens. Cached under
 * `keys.post(id)` as a one-item `Page`, the shape `mapCachedItems` / `filterCachedItems` walk, so
 * liking, commenting, Want to Try and a block patch it with every other FeedItem cache; `select`
 * hands the screen the post itself, or null once a block has taken it out of the cache. Throws
 * 'not_found' when the post is gone or not the caller's to see.
 */
export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: keys.post(id ?? ''),
    queryFn: async (): Promise<Page<FeedItem>> => ({ items: [await api.feed.getPost(id!)], nextCursor: null }),
    select: (page) => page.items[0] ?? null,
    enabled: !!id,
  });
}
