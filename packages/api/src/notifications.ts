// The notifications inbox (T-31, contract 3.7.0) over the RPCs in
// 20261126000100_notifications.sql. The rows are written by triggers on
// follows, post_likes and post_comments, and every read-time rule (an unfollow,
// an unlike, a deleted comment or a block hides a row) is the database's:
// nothing here filters anything.
//
// A database without that migration answers PGRST202 for each RPC. That is the
// state between this client shipping and the migration being pushed, if they
// happen in that order, and the contract says what an older backend answers:
// an empty inbox, a badge of 0, and a markRead that does nothing. Every other
// error is thrown.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Notification, type NotificationsApi, type Page, type PageParams } from '@bevi/shared';
import { requireUserId } from './currentUser';
import { mapError } from './errors';
import { mapNotification, type NotificationRpcRow } from './mappers';
import { clampLimit, decodeCursor, encodeCursor } from './paging';

/** PostgREST's "no such function in the schema cache": the database predates the function's migration. */
const POSTGREST_NO_SUCH_FUNCTION = 'PGRST202';

/**
 * A notification id is a `bigint` identity, so anything but digits would come back as a raw 22P02.
 * Fifteen digits keeps `Number()` exact.
 */
const ID_RE = /^\d{1,15}$/;

/** Keyset on the row's id (the newest notification in it), as `comments.ts` pages. */
interface NotificationCursor {
  beforeId: number;
}

function isMissingFunction(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === POSTGREST_NO_SUCH_FUNCTION;
}

export function createNotificationsApi(client: SupabaseClient): NotificationsApi {
  return {
    async list(page?: PageParams): Promise<Page<Notification>> {
      await requireUserId(client);
      const limit = clampLimit(page?.limit);
      const cursor = decodeCursor<NotificationCursor>(page?.cursor);
      // A cursor that does not hold a numeric id starts over, the way
      // `decodeCursor` treats one it cannot even parse.
      const beforeId = cursor && Number.isSafeInteger(cursor.beforeId) && cursor.beforeId > 0 ? cursor.beforeId : null;

      const { data, error } = await client.rpc('get_notifications', { p_limit: limit, p_before_id: beforeId });
      if (error) {
        if (isMissingFunction(error)) return { items: [], nextCursor: null };
        throw mapError(error);
      }

      const rows = (data ?? []) as NotificationRpcRow[];
      const items = rows.map((row) => mapNotification(client, row));
      const last = rows[rows.length - 1];
      const nextCursor =
        rows.length === limit && last ? encodeCursor({ beforeId: last.id } satisfies NotificationCursor) : null;
      return { items, nextCursor };
    },

    async unreadCount(): Promise<number> {
      await requireUserId(client);
      const { data, error } = await client.rpc('get_unread_notification_count');
      if (error) {
        if (isMissingFunction(error)) return 0;
        throw mapError(error);
      }
      const count = Number(data ?? 0);
      return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
    },

    async markRead(upToId?: string): Promise<void> {
      await requireUserId(client);
      if (upToId !== undefined && !ID_RE.test(upToId)) {
        throw new ApiError('validation', 'That is not a notification id', { field: 'upToId' });
      }
      const { error } = await client.rpc('mark_notifications_read', {
        p_up_to_id: upToId ? Number(upToId) : null,
      });
      if (error) {
        if (isMissingFunction(error)) return;
        throw mapError(error);
      }
    },
  };
}
