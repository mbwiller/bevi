// Blocking (IS-7, App Store Guideline 1.2) over the RPCs in
// 20261118220000_user_blocks_and_reports.sql. The filtering a block causes is
// the database's (20261118220100_block_filtering.sql): nothing here hides
// anything.
//
// Deliberately absent: any way to ask whether someone has blocked the caller.
// `private.is_blocked` is two-way and lives outside PostgREST's schemas for
// exactly that reason, and `user_blocks` is readable only by the blocker.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type BlockedUser, type BlocksApi, type Page, type PageParams } from '@bevi/shared';
import { requireUserId } from './currentUser';
import { mapError } from './errors';
import { mapBlockedUser, type BlockedUserRpcRow } from './mappers';
import { clampLimit, decodeCursor, toPage } from './paging';

// `block_user` and `unblock_user` take a `uuid`, so anything else would come
// back as a raw 22P02 (invalid_text_representation) that `mapError` reads as
// `unknown`. An id that cannot be a profile is answered here, as the contract
// answers an id that is nobody's, without the round trip (as `venues.get` does).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OffsetCursor {
  offset: number;
}

export function createBlocksApi(client: SupabaseClient): BlocksApi {
  return {
    async block(userId: string): Promise<void> {
      await requireUserId(client);
      // No such user: what the RPC's BEVI_NOT_FOUND maps to.
      if (!UUID_RE.test(userId)) throw new ApiError('not_found', 'No such user');
      const { error } = await client.rpc('block_user', { p_user_id: userId });
      if (error) throw mapError(error);
    },

    async unblock(userId: string): Promise<void> {
      await requireUserId(client);
      // Nobody with such an id was ever blocked, and unblocking someone who
      // was never blocked resolves: the contract has no 'not_found' here.
      if (!UUID_RE.test(userId)) return;
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
