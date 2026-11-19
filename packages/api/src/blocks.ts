// Blocking (IS-7, App Store Guideline 1.2) over the RPCs in
// 20261118220000_user_blocks_and_reports.sql. The filtering a block causes is
// the database's (20261118220100_block_filtering.sql): nothing here hides
// anything.
//
// Deliberately absent: any way to ask whether someone has blocked the caller.
// `private.is_blocked` is two-way and lives outside PostgREST's schemas for
// exactly that reason, and `user_blocks` is readable only by the blocker.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlockedUser, BlocksApi, Page, PageParams } from '@bevi/shared';
import { requireUserId } from './currentUser';
import { mapError } from './errors';
import { mapBlockedUser, type BlockedUserRpcRow } from './mappers';
import { clampLimit, decodeCursor, toPage } from './paging';

interface OffsetCursor {
  offset: number;
}

export function createBlocksApi(client: SupabaseClient): BlocksApi {
  return {
    async block(userId: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('block_user', { p_user_id: userId });
      if (error) throw mapError(error);
    },

    async unblock(userId: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('unblock_user', { p_user_id: userId });
      if (error) throw mapError(error);
    },

    async list(page?: PageParams): Promise<Page<BlockedUser>> {
      await requireUserId(client);
      // clampLimit's 50 is inside the RPC's own cap of 100.
      const limit = clampLimit(page?.limit);
      // The RPC clamps a negative or null offset to 0 itself.
      const { offset } = decodeCursor<OffsetCursor>(page?.cursor) ?? { offset: 0 };
      const { data, error } = await client.rpc('list_blocked_users', { p_limit: limit, p_offset: offset });
      if (error) throw mapError(error);
      const items = ((data ?? []) as BlockedUserRpcRow[]).map((row) => mapBlockedUser(client, row));
      return toPage(items, limit, () => ({ offset: offset + limit }) satisfies OffsetCursor);
    },
  };
}
