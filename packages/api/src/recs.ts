import type { SupabaseClient } from '@supabase/supabase-js';
import { MIN_N_USER, RANKING_VERSION, RECOMMEND_N, localDayKey, parseTimestamp, recommend } from '@bevi/ranking';
import type { Recommendation, RecommendationsResult, RecsApi } from '@bevi/shared';
import { requireUserId } from './currentUser';
import type { SnapshotCache } from './snapshot';

/**
 * The day the seed is for. Only the day's shuffle depends on it, so an unreadable timestamp or
 * timezone (an engine's date parser, an unknown zone) falls back rather than failing the whole
 * list. In order: the viewer's local day at `generatedAt`; else the UTC date of `generatedAt`;
 * else, when `generatedAt` itself cannot be read, today's UTC date. Never a constant, which
 * would give that person the same shuffle every day.
 */
export function seedDay(generatedAt: string, timeZone: string): string {
  try {
    return localDayKey(generatedAt, timeZone);
  } catch {
    const ms = parseTimestamp(generatedAt);
    return new Date(Number.isNaN(ms) ? Date.now() : ms).toISOString().slice(0, 10);
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// Recommendations are @bevi/ranking's recommend() over the caller's
// PredictionSnapshot (./snapshot.ts), run here in the client. The seed is the
// user and their local day, so the list is stable within a day and shuffles a
// little from one day to the next (DEVELOPMENT-MATT §8.11).
export function createRecsApi(client: SupabaseClient, snapshots: SnapshotCache): RecsApi {
  return {
    async getRecommendations(params = {}): Promise<RecommendationsResult> {
      const uid = await requireUserId(client);
      const { snapshot, summaries, viewer } = await snapshots.get(uid);
      const generatedAt = snapshot.generatedAt;
      const base = { generatedAt, basedOnCount: viewer.rankingCount, rankingVersion: RANKING_VERSION };
      if (viewer.rankingCount < MIN_N_USER) return { ...base, items: [] };
      const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? RECOMMEND_N)));
      const seed = `${uid}:${seedDay(generatedAt, viewer.timezone)}`;
      const items: Recommendation[] = recommend(snapshot, uid, { n: limit, seed }).flatMap((r) => {
        const bev = summaries.get(r.bevId);
        if (!bev) return [];
        return [{ bev, predictedScore: round2(r.score), confidence: r.confidence, reason: r.reason, isExploration: r.isExploration, generatedAt }];
      });
      return { ...base, items };
    },

    async refresh(): Promise<void> {
      await requireUserId(client);
      snapshots.invalidate();
    },
  };
}
