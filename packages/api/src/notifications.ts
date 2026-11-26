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
//
// Release 2 (contract 3.8.0, 20261127000100) adds push settings, post
// subscriptions and device tokens. The same tolerance where nothing is lost by
// it -- the default settings, an empty people list, a token quietly not
// recorded -- and none where the user changed something: `updateSettings` and
// `setPostNotification` throw on an older backend rather than let the app say
// it was saved.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  type Notification,
  type NotificationSettings,
  type NotificationsApi,
  type Page,
  type PageParams,
  type PostNotificationPerson,
} from '@bevi/shared';
import { requireUserId } from './currentUser';
import { mapError } from './errors';
import {
  mapNotification,
  mapNotificationSettings,
  mapPostNotificationPerson,
  type NotificationRpcRow,
  type NotificationSettingsRpcRow,
  type PostNotificationPersonRpcRow,
} from './mappers';
import { clampLimit, decodeCursor, encodeCursor, toPage } from './paging';

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

/** `get_post_notification_people` pages by offset, as `blocks.list` does. */
interface OffsetCursor {
  offset: number;
}

/** What `getSettings` answers for someone who never saved any, and what an older backend answers. */
const DEFAULT_SETTINGS: NotificationSettings = { paused: false, follows: true, likes: true, comments: true, posts: false };

const SETTING_FIELDS = ['paused', 'follows', 'likes', 'comments', 'posts'] as const;

/** `set_post_notification` takes a `uuid`, so anything else would come back as a raw 22P02 (see blocks.ts). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The RPCs answer one row as a one-element array; take it, or fail loudly. */
function oneSettingsRow(data: unknown, fn: string): NotificationSettings {
  const row = (Array.isArray(data) ? data[0] : data) as NotificationSettingsRpcRow | null | undefined;
  if (!row) throw new ApiError('unknown', `${fn} returned no row`);
  return mapNotificationSettings(row);
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

    async getSettings(): Promise<NotificationSettings> {
      await requireUserId(client);
      const { data, error } = await client.rpc('get_notification_settings');
      if (error) {
        if (isMissingFunction(error)) return { ...DEFAULT_SETTINGS };
        throw mapError(error);
      }
      return oneSettingsRow(data, 'get_notification_settings');
    },

    async updateSettings(settings: NotificationSettings): Promise<NotificationSettings> {
      await requireUserId(client);
      // The RPC refuses a null too; a non-boolean would otherwise be coerced by
      // PostgREST ('yes' -> true), so it is refused here, naming the field.
      for (const field of SETTING_FIELDS) {
        if (typeof settings?.[field] !== 'boolean') {
          throw new ApiError('validation', `${field} must be true or false`, { field });
        }
      }
      // No PGRST202 tolerance: the user changed a switch, and an older backend
      // cannot keep it, so this must not resolve as if it had.
      const { data, error } = await client.rpc('update_notification_settings', {
        p_paused: settings.paused,
        p_follows: settings.follows,
        p_likes: settings.likes,
        p_comments: settings.comments,
        p_posts: settings.posts,
      });
      if (error) throw mapError(error);
      return oneSettingsRow(data, 'update_notification_settings');
    },

    async listPostNotificationPeople(params?: PageParams & { q?: string }): Promise<Page<PostNotificationPerson>> {
      await requireUserId(client);
      const limit = clampLimit(params?.limit);
      const { offset } = decodeCursor<OffsetCursor>(params?.cursor) ?? { offset: 0 };
      const q = params?.q?.trim() ? params.q.trim() : null;
      const { data, error } = await client.rpc('get_post_notification_people', {
        p_q: q,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) {
        if (isMissingFunction(error)) return { items: [], nextCursor: null };
        throw mapError(error);
      }
      const items = ((data ?? []) as PostNotificationPersonRpcRow[]).map((row) => mapPostNotificationPerson(client, row));
      return toPage(items, limit, () => ({ offset: offset + limit }) satisfies OffsetCursor);
    },

    async setPostNotification(userId: string, on: boolean): Promise<void> {
      await requireUserId(client);
      if (!UUID_RE.test(userId)) {
        // Nobody has such an id: turning on is the RPC's BEVI_NOT_FOUND, and
        // turning off someone who never was on resolves.
        if (on) throw new ApiError('not_found', 'No such user');
        return;
      }
      // No PGRST202 tolerance, as updateSettings.
      const { error } = await client.rpc('set_post_notification', { p_user_id: userId, p_on: on === true });
      if (error) throw mapError(error);
    },

    async registerPushToken(token: string): Promise<void> {
      await requireUserId(client);
      // The platform is left to the RPC's default, 'ios': the only binary that
      // has a token to register.
      const { error } = await client.rpc('register_push_token', { p_token: token });
      if (error) {
        if (isMissingFunction(error)) return;
        throw mapError(error);
      }
    },

    async unregisterPushToken(token: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('unregister_push_token', { p_token: token });
      if (error) {
        if (isMissingFunction(error)) return;
        throw mapError(error);
      }
    },
  };
}
