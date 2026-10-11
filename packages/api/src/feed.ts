import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  type CategoryId,
  type FeaturedBev,
  type FeedApi,
  type FeedItem,
  type Page,
  type PageParams,
  type PriceTier,
  type Profile,
} from '@bevi/shared';
import { mapError } from './errors';
import { mapFeedItem, mapProfile, publicUrl, type FeedRpcRow, type ProfileViewRow } from './mappers';
import { clampLimit, decodeCursor, encodeCursor } from './paging';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

interface FeedCursor {
  beforeId: number;
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
}

export function createFeedApi(client: SupabaseClient): FeedApi {
  return {
    async getFeed(page?: PageParams): Promise<Page<FeedItem>> {
      await requireUserId(client);
      const limit = clampLimit(page?.limit);
      const { beforeId } = decodeCursor<FeedCursor>(page?.cursor) ?? { beforeId: undefined as unknown as number };

      const { data, error } = await client.rpc('get_feed', { p_limit: limit, p_before_id: beforeId ?? null });
      if (error) throw mapError(error);
      const rows = data as FeedRpcRow[];

      const actorIds = [...new Set(rows.map((r) => r.actor_id))];
      const actorById = new Map<string, Profile>();
      if (actorIds.length > 0) {
        const { data: actorRows, error: actorError } = await client.from('profiles_view').select('*').in('id', actorIds);
        if (actorError) throw mapError(actorError);
        for (const row of actorRows as ProfileViewRow[]) actorById.set(row.id, mapProfile(client, row));
      }

      const items = rows.map((row) => {
        const actor = actorById.get(row.actor_id);
        if (!actor) throw new ApiError('unknown', `get_feed row ${row.id} has no matching profile for actor ${row.actor_id}`);
        return mapFeedItem(client, row, actor);
      });

      const last = rows[rows.length - 1];
      const nextCursor = rows.length === limit && last ? encodeCursor({ beforeId: last.id } satisfies FeedCursor) : null;
      return { items, nextCursor };
    },

    async getFeatured(): Promise<FeaturedBev[]> {
      await requireUserId(client);
      const { data, error } = await client.rpc('get_featured');
      if (error) throw mapError(error);
      return ((data ?? []) as FeaturedRpcRow[]).map((row) => ({
        bev: {
          id: row.bev_id,
          name: row.bev_name,
          brand: row.bev_brand,
          flavor: row.bev_flavor,
          categoryId: row.bev_category_id as CategoryId,
          photoUrl: publicUrl(client, 'bev-photos', row.bev_thumb_path),
          photoStatus: 'ready',
          priceTier: 1 as PriceTier,
          priceEstimated: true,
          ratingCount: 0,
          bayesScore: null,
        },
        // Admin-curated content is expected to always have an image; '' is
        // a defensive fallback, not an expected value.
        heroImageUrl: publicUrl(client, 'bev-photos', row.image_path) ?? '',
        tagline: row.blurb,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      }));
    },
  };
}
