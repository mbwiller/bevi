import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type CategoryId, type LeaderboardApi, type Page, type PageParams, type UserLeaderboardRow } from '@bevi/shared';
import { mapError } from './errors';
import { mapBevLeaderboardRow, mapUserLeaderboardRow, type BevLeaderboardRpcRow, type UserLeaderboardRpcRow } from './mappers';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
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
  };
}
