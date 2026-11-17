import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type CategoryId, type LeaderboardApi, type Page, type PageParams, type UserLeaderboardRow } from '@bevi/shared';
import { mapError } from './errors';
import {
  mapBevLeaderboardRow,
  mapFriendsLeaderboardRow,
  mapUserLeaderboardRow,
  type BevLeaderboardRpcRow,
  type FriendsLeaderboardRpcRow,
  type UserLeaderboardRpcRow,
} from './mappers';
import { decodeCursor, encodeCursor } from './paging';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

interface OffsetCursor {
  offset: number;
}

/** get_friends_leaderboard's own bounds: 50 by default, 1..100. */
const FRIENDS_DEFAULT_LIMIT = 50;
const FRIENDS_MAX_LIMIT = 100;

function friendsLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return FRIENDS_DEFAULT_LIMIT;
  return Math.min(Math.trunc(limit), FRIENDS_MAX_LIMIT);
}

export function createLeaderboardApi(client: SupabaseClient): LeaderboardApi {
  return {
    async bevs(params?: { categoryId?: CategoryId; page?: PageParams }) {
      const uid = await requireUserId(client);
      const { data, error } = await client.rpc('get_bev_leaderboard', {
        p_category_id: params?.categoryId ?? null,
        p_limit: params?.page?.limit ?? 50,
      });
      if (error) throw mapError(error);
      const rows = (data ?? []) as BevLeaderboardRpcRow[];

      const ids = rows.map((r) => r.id);
      const myScores = new Map<string, number>();
      if (ids.length > 0) {
        const { data: mine, error: mineError } = await client.from('rankings').select('bev_id, score').eq('user_id', uid).in('bev_id', ids);
        if (mineError) throw mapError(mineError);
        for (const r of mine ?? []) {
          const row = r as { bev_id: string; score: number };
          myScores.set(row.bev_id, Number(row.score));
        }
      }

      // Not paginated yet (see the migration's note above search_bevs/
      // get_bev_leaderboard/get_user_leaderboard) -- rank is just this
      // single unpaginated batch's position.
      return {
        items: rows.map((row, i) => mapBevLeaderboardRow(client, row, i + 1, myScores.get(row.id) ?? null)),
        nextCursor: null,
      };
    },

    async users(page?: PageParams): Promise<Page<UserLeaderboardRow>> {
      await requireUserId(client);
      const { data, error } = await client.rpc('get_user_leaderboard', { p_limit: page?.limit ?? 50 });
      if (error) throw mapError(error);
      const rows = (data ?? []) as UserLeaderboardRpcRow[];
      // bevi_rank is already the real competition rank from SQL (rank()
      // over (order by points desc)), not this page's row position.
      return { items: rows.map((row) => mapUserLeaderboardRow(client, row)), nextCursor: null };
    },

    async friends(page?: PageParams): Promise<Page<UserLeaderboardRow>> {
      await requireUserId(client);
      const limit = friendsLimit(page?.limit);
      // A cursor that does not hold a non-negative offset starts over, the
      // same way `decodeCursor` treats one it cannot parse.
      const decoded = decodeCursor<OffsetCursor>(page?.cursor);
      const offset = decoded && Number.isInteger(decoded.offset) && decoded.offset >= 0 ? decoded.offset : 0;

      const { data, error } = await client.rpc('get_friends_leaderboard', { p_limit: limit, p_offset: offset });
      if (error) throw mapError(error);
      const rows = (data ?? []) as FriendsLeaderboardRpcRow[];
      // friend_rank is the rank within the caller's whole set, computed in SQL
      // before the page is cut, so it stays right on page 2.
      return {
        items: rows.map((row) => mapFriendsLeaderboardRow(client, row)),
        nextCursor: rows.length === limit ? encodeCursor({ offset: offset + rows.length } satisfies OffsetCursor) : null,
      };
    },
  };
}
