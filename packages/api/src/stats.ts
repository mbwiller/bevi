import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type ProfileStats, type StatsApi } from '@bevi/shared';
import { mapError } from './errors';

interface UserStatsRow {
  rating_count: number;
  mean_score: number | null;
  stddev_score: number | null;
  want_count: number;
  follower_count: number;
  following_count: number;
}

interface StreakRow {
  current_days: number;
  longest_days: number;
  last_ranked_on: string | null;
}

interface ProfileRankRow {
  bevi_rank: number | null;
  timezone: string;
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

function todayInTimezone(timezone: string): string {
  // en-CA gives YYYY-MM-DD directly, matching streaks.last_ranked_on's date type.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

async function fetchStats(client: SupabaseClient, userId: string): Promise<ProfileStats> {
  const [userStats, streak, profile] = await Promise.all([
    client.from('user_stats').select('*').eq('user_id', userId).maybeSingle(),
    client.from('streaks').select('*').eq('user_id', userId).maybeSingle(),
    client.from('profiles').select('bevi_rank, timezone').eq('id', userId).maybeSingle(),
  ]);
  if (userStats.error) throw mapError(userStats.error);
  if (streak.error) throw mapError(streak.error);
  if (profile.error) throw mapError(profile.error);
  if (!profile.data) throw new ApiError('not_found', `No profile for user ${userId}`);

  const us = (userStats.data as UserStatsRow | null) ?? {
    rating_count: 0,
    mean_score: null,
    stddev_score: null,
    want_count: 0,
    follower_count: 0,
    following_count: 0,
  };
  const st = (streak.data as StreakRow | null) ?? { current_days: 0, longest_days: 0, last_ranked_on: null };
  const p = profile.data as ProfileRankRow;

  return {
    followers: us.follower_count,
    following: us.following_count,
    bevdCount: us.rating_count,
    wantToTryCount: us.want_count,
    rankOnBevi: p.bevi_rank,
    // "rank on Bevi" points formula (bevs_ranked + 3*streak + 2*bevs_created)
    // isn't computed anywhere yet (no view/cron for it) -- bevi_rank itself
    // is the closest existing signal (populated by the same future cron).
    rankPoints: p.bevi_rank ?? 0,
    currentStreak: st.current_days,
    longestStreak: st.longest_days,
    streakAliveToday: st.last_ranked_on === todayInTimezone(p.timezone),
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
  };
}
