import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Comment, type CommentsApi, type Page, type PageParams } from '@bevi/shared';
import { mapError } from './errors';
import { mapComment, type CommentRpcRow } from './mappers';
import { clampLimit, decodeCursor, encodeCursor } from './paging';

interface CommentCursor {
  beforeId: number;
}

export function createCommentsApi(client: SupabaseClient): CommentsApi {
  return {
    async list(eventId: string, page?: PageParams): Promise<Page<Comment>> {
      const limit = clampLimit(page?.limit);
      const cursor = decodeCursor<CommentCursor>(page?.cursor);

      const { data, error } = await client.rpc('get_comments', {
        p_event_id: Number(eventId),
        p_limit: limit,
        p_before_id: cursor?.beforeId ?? null,
      });
      if (error) throw mapError(error);

      const rows = data as CommentRpcRow[];
      const items = rows.map((row) => mapComment(client, row));
      const last = rows[rows.length - 1];
      const nextCursor =
        rows.length === limit && last ? encodeCursor({ beforeId: last.id } satisfies CommentCursor) : null;
      return { items, nextCursor };
    },

    async add(eventId: string, body: string): Promise<Comment> {
      const { data, error } = await client.rpc('add_comment', {
        p_event_id: Number(eventId),
        p_body: body,
      });
      if (error) throw mapError(error);

      const row = (data as CommentRpcRow[])[0];
      if (!row) throw new ApiError('unknown', 'add_comment returned no row');
      return mapComment(client, row);
    },

    async remove(id: string): Promise<void> {
      const { error } = await client.rpc('delete_comment', { p_id: Number(id) });
      if (error) throw mapError(error);
    },
  };
}
