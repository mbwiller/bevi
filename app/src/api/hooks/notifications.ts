import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeedItem, NotificationSettings, Page, PostNotificationPerson } from '@bevi/shared';

import { api } from '../client';
import { keys } from '../keys';
import { cursorPaging, mapCachedItems, rollback, snapshot } from './util';

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

/**
 * The push settings (T-31 Release 2): Pause all and the four kinds. What they mean for each other
 * is the app's rule (features/notifications/settingsRules.ts), never worked out here.
 */
export function useNotificationSettings() {
  return useQuery({ queryKey: keys.notifications.settings(), queryFn: () => api.notifications.getSettings() });
}

/** Every save of the push settings shares this key, so the last one to finish knows it is the last. */
export const NOTIFICATION_SETTINGS_MUTATION = ['bevi', 'notificationSettings'] as const;

/**
 * Saves all five settings at once (the server keeps exactly what it is sent). Optimistic: the
 * switches move at once and go back if the save fails. When the last save in a row has finished
 * the settings are read again, so quick taps never leave the screen out of step with the server.
 */
export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: NOTIFICATION_SETTINGS_MUTATION,
    mutationFn: (next: NotificationSettings) => api.notifications.updateSettings(next),
    onMutate: async (next) => {
      const snap = await snapshot(qc, [keys.notifications.settings()]);
      qc.setQueryData<NotificationSettings>(keys.notifications.settings(), next);
      return { snap };
    },
    onError: (_e, _next, ctx) => rollback(qc, ctx?.snap),
    onSettled: () => {
      if (qc.isMutating({ mutationKey: NOTIFICATION_SETTINGS_MUTATION }) <= 1) {
        void qc.invalidateQueries({ queryKey: keys.notifications.settings() });
      }
    },
  });
}

/**
 * Post notifications' list (T-31 Release 2): the people the caller follows, those already chosen
 * first, filtered by `q` on the server. 20 per page.
 */
export function usePostNotificationPeople(q: string) {
  return useInfiniteQuery({
    queryKey: keys.notifications.postPeople(q),
    queryFn: ({ pageParam }) => api.notifications.listPostNotificationPeople({ cursor: pageParam, q: q || undefined }),
    ...cursorPaging,
  });
}

/**
 * Chooses someone, or not, for post notifications. Optimistic on every cached search of the list,
 * and back if it fails. The lists are only marked stale afterwards: read again now they would put
 * the person just chosen at the top, under the finger. The "Choose people" count is read again.
 */
export function useSetPostNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, on }: { userId: string; on: boolean }) => api.notifications.setPostNotification(userId, on),
    onMutate: async ({ userId, on }) => {
      const snap = await snapshot(qc, [keys.notifications.postPeopleAll]);
      qc.setQueriesData({ queryKey: keys.notifications.postPeopleAll }, (data: unknown) =>
        mapCachedItems<PostNotificationPerson>(data, (p) => (p.id === userId ? { ...p, subscribed: on } : p)),
      );
      return { snap };
    },
    onError: (_e, _v, ctx) => rollback(qc, ctx?.snap),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications.postPeopleAll, refetchType: 'none' });
      void qc.invalidateQueries({ queryKey: keys.notifications.chosenCount() });
    },
  });
}

/** Where "Choose people" stops counting: past it the row reads "100+ people". */
export const CHOSEN_COUNT_CAP = 100;
/** The page size the count reads in (the API's largest). */
const CHOSEN_COUNT_PAGE = 50;

/** How many people are chosen, and whether there may be more than `CHOSEN_COUNT_CAP`. */
export interface ChosenCount {
  count: number;
  capped: boolean;
}

/**
 * Counts the people chosen for post notifications. The API has no count, but it lists the chosen
 * first, so this counts the chosen rows at the head of the list: it reads another page only while
 * the last one ended on a chosen row, and stops at `CHOSEN_COUNT_CAP`.
 */
export async function countChosenPeople(
  list: (cursor: string | undefined) => Promise<Page<PostNotificationPerson>>,
): Promise<ChosenCount> {
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await list(cursor);
    for (const person of page.items) {
      if (!person.subscribed) return { count, capped: false };
      count += 1;
      if (count >= CHOSEN_COUNT_CAP) return { count: CHOSEN_COUNT_CAP, capped: true };
    }
    if (!page.nextCursor || page.items.length === 0) return { count, capped: false };
    cursor = page.nextCursor;
  }
}

/** The "Choose people" row's count (`countChosenPeople`), read again when someone is chosen or not. */
export function useChosenPeopleCount() {
  return useQuery({
    queryKey: keys.notifications.chosenCount(),
    queryFn: () => countChosenPeople((cursor) => api.notifications.listPostNotificationPeople({ cursor, limit: CHOSEN_COUNT_PAGE })),
  });
}
