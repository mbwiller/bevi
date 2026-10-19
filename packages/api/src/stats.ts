import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type CategoryProgress, type ProfileStats, type StatsApi } from '@bevi/shared';
import { mapError } from './errors';
import { mapCategoryProgress, type CategoryProgressRow } from './mappers';

interface ProfileStatsRow {
  followers: number;
  following: number;
  bevd_count: number;
  want_count: number;
  rank_on_bevi: number | null;
  rank_points: number;
  current_streak: number;
  longest_streak: number;
  streak_alive_today: boolean;
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

// One RPC (20261012000500): counts, the live "rank on Bevi" and points (the
// same helper the People leaderboard uses, so they always agree), and the
// streak as it stands today in the user's timezone.
async function fetchStats(client: SupabaseClient, userId: string): Promise<ProfileStats> {
  const { data, error } = await client.rpc('get_profile_stats', { p_user_id: userId }).maybeSingle();
  if (error) throw mapError(error);
  const row = data as ProfileStatsRow | null;
  if (!row) throw new ApiError('not_found', `No profile for user ${userId}`);
  return {
    followers: row.followers,
    following: row.following,
    bevdCount: row.bevd_count,
    wantToTryCount: row.want_count,
    rankOnBevi: row.rank_on_bevi,
    rankPoints: row.rank_points,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    streakAliveToday: row.streak_alive_today,
  };
}

export function createStatsApi(client: SupabaseClient): StatsApi {
  return {
    async getMine(): Promise<ProfileStats> {
      const uid = await requireUserId(client);
      return fetchStats(client, uid);
    },
    async getUser(id: string): Promise<ProfileStats> {
      await requireUserId(client);
      return fetchStats(client, id);
    },
    // 20261018000200: one row per category the caller can see, in sort order.
    async getCategoryProgress(): Promise<CategoryProgress[]> {
      await requireUserId(client);
      const { data, error } = await client.rpc('get_category_progress');
      if (error) throw mapError(error);
      return (data as CategoryProgressRow[]).map(mapCategoryProgress);
    },
  };
}
