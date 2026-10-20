import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  type BevOfPeriod,
  type ExplorePost,
  type FeaturedBev,
  type FeedApi,
  type FeedItem,
  type Page,
  type PageParams,
  type Profile,
} from '@bevi/shared';
import { mapError } from './errors';
import {
  mapBevOfPeriod,
  mapBevSummary,
  mapExplorePost,
  mapFeedItem,
  mapProfile,
  publicUrl,
  type BevOfPeriodRpcRow,
  type ExploreRpcRow,
  type FeedRpcRow,
  type ProfileViewRow,
} from './mappers';
import { clampLimit, decodeCursor, encodeCursor } from './paging';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

interface FeedCursor {
  beforeId: number;
}

/**
 * Explore pages by offset over an ordering frozen per sequence: `before` is
 * the snapshot instant page 1 was built from, which every later page sends
 * back so decaying scores cannot reshuffle the rows underneath the reader
 * (get_explore, 20261019000300). It holds no like counts and no score, so it
 * carries nothing about another user (D-15).
 */
interface ExploreCursor {
  before: string;
  offset: number;
}

interface FeaturedRpcRow {
  id: string;
  title: string;
  blurb: string | null;
  image_path: string | null;
  starts_at: string;
  ends_at: string | null;
  bev_id: string;
  bev_name: string;
  bev_brand: string | null;
  bev_flavor: string | null;
  bev_category_id: string;
  bev_thumb_path: string | null;
  bev_price_tier: number;
  bev_price_estimated: boolean;
  bev_rating_count: number;
  bev_bayes_score: number | null;
}

/** The actors of these rows, joined from profiles_view in one round trip. */
async function loadActors(client: SupabaseClient, rows: { actor_id: string }[]): Promise<Map<string, Profile>> {
  const actorIds = [...new Set(rows.map((r) => r.actor_id))];
  const actorById = new Map<string, Profile>();
  if (actorIds.length > 0) {
    const { data: actorRows, error: actorError } = await client.from('profiles_view').select('*').in('id', actorIds);
    if (actorError) throw mapError(actorError);
    for (const row of actorRows as ProfileViewRow[]) actorById.set(row.id, mapProfile(client, row));
  }
  return actorById;
}

function actorOf(actorById: Map<string, Profile>, rpc: string, row: { id: number; actor_id: string }): Profile {
  const actor = actorById.get(row.actor_id);
  if (!actor) throw new ApiError('unknown', `${rpc} row ${row.id} has no matching profile for actor ${row.actor_id}`);
  return actor;
}

/** get_feed and get_user_feed rows (same columns) → a page of FeedItems, actors joined from profiles_view. */
async function toFeedPage(client: SupabaseClient, rpc: string, rows: FeedRpcRow[], limit: number): Promise<Page<FeedItem>> {
  const actorById = await loadActors(client, rows);
  const items = rows.map((row) => mapFeedItem(client, row, actorOf(actorById, rpc, row)));

  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last ? encodeCursor({ beforeId: last.id } satisfies FeedCursor) : null;
  return { items, nextCursor };
}

export function createFeedApi(client: SupabaseClient): FeedApi {
  return {
    async getFeed(page?: PageParams): Promise<Page<FeedItem>> {
      await requireUserId(client);
      const limit = clampLimit(page?.limit);
      const { beforeId } = decodeCursor<FeedCursor>(page?.cursor) ?? { beforeId: undefined as unknown as number };

      const { data, error } = await client.rpc('get_feed', { p_limit: limit, p_before_id: beforeId ?? null });
      if (error) throw mapError(error);
      return toFeedPage(client, 'get_feed', data as FeedRpcRow[], limit);
    },

    async listUser(userId: string, page?: PageParams): Promise<Page<FeedItem>> {
      await requireUserId(client);
      const limit = clampLimit(page?.limit);
      const { beforeId } = decodeCursor<FeedCursor>(page?.cursor) ?? { beforeId: undefined as unknown as number };

      const { data, error } = await client.rpc('get_user_feed', {
        p_user_id: userId,
        p_limit: limit,
        p_before_id: beforeId ?? null,
      });
      if (error) throw mapError(error);
      return toFeedPage(client, 'get_user_feed', data as FeedRpcRow[], limit);
    },

    async getExplore(page?: PageParams): Promise<Page<ExplorePost>> {
      await requireUserId(client);
      const limit = clampLimit(page?.limit);
      // A new sequence snapshots this client's clock; get_explore measures
      // every age from it and ignores anything created after it, so every
      // later page of the sequence reuses the same ordering. The server
      // tolerates a few minutes of clock skew. A cursor that does not hold a
      // timestamp and a non-negative offset starts the sequence over, the same
      // way `decodeCursor` treats one it cannot even parse.
      const decoded = decodeCursor<ExploreCursor>(page?.cursor);
      const cursor =
        decoded && !Number.isNaN(Date.parse(decoded.before)) && Number.isInteger(decoded.offset) && decoded.offset >= 0
          ? decoded
          : undefined;
      const before = cursor?.before ?? new Date().toISOString();
      const offset = cursor?.offset ?? 0;

      const { data, error } = await client.rpc('get_explore', { p_limit: limit, p_before: before, p_offset: offset });
      if (error) throw mapError(error);

      const rows = (data ?? []) as ExploreRpcRow[];
      const actorById = await loadActors(client, rows);
      const items = rows.map((row) => mapExplorePost(client, row, actorOf(actorById, 'get_explore', row)));
      const nextCursor =
        rows.length === limit ? encodeCursor({ before, offset: offset + rows.length } satisfies ExploreCursor) : null;
      return { items, nextCursor };
    },

    async getFeatured(): Promise<FeaturedBev[]> {
      await requireUserId(client);
      const { data, error } = await client.rpc('get_featured');
      if (error) throw mapError(error);
      return ((data ?? []) as FeaturedRpcRow[]).map((row) => ({
        bev: mapBevSummary(client, {
          id: row.bev_id,
          name: row.bev_name,
          brand: row.bev_brand,
          flavor: row.bev_flavor,
          category_id: row.bev_category_id,
          photo_path: row.bev_thumb_path,
          price_tier: row.bev_price_tier,
          price_estimated: row.bev_price_estimated,
          bev_stats: { rating_count: row.bev_rating_count, avg_score: null, score_stddev: null, bayes_score: row.bev_bayes_score },
        }),
        // Hero images live in the `featured` bucket. With none, '' makes the
        // card fall back to the Bev's own art.
        heroImageUrl: publicUrl(client, 'featured', row.image_path) ?? '',
        tagline: row.blurb,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      }));
    },

    async getBevOfPeriod(): Promise<BevOfPeriod> {
      await requireUserId(client);
      const { data, error } = await client.rpc('get_bev_of_period');
      if (error) throw mapError(error);
      return mapBevOfPeriod(client, (data ?? []) as BevOfPeriodRpcRow[]);
    },

    async like(id: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('like_post', { p_event_id: Number(id) });
      if (error) throw mapError(error);
    },

    async unlike(id: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('unlike_post', { p_event_id: Number(id) });
      if (error) throw mapError(error);
    },
  };
}
