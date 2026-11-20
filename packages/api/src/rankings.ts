import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  type Bucket,
  type BevLocationSummary,
  type BucketBev,
  type CategoryId,
  type Page,
  type PageParams,
  type RankedBev,
  type RankingsApi,
  type SubmitRankingInput,
  type SubmitRankingResult,
  type Venue,
} from '@bevi/shared';
import { mapError } from './errors';
import { requireUserId } from './currentUser';
import {
  bucketToDb,
  mapBevSummary,
  mapBucketBev,
  mapRanking,
  mapVenue,
  type BevSummaryRow,
  type BucketBevRow,
  type RankingRow,
  type VenueJsonRow,
} from './mappers';
import { clampLimit, decodeCursor, toPage } from './paging';
import { loadUserVenues, loadVenuesForPairs, venueKey } from './places';
import type { SnapshotCache } from './snapshot';

export interface RankingWithBevRow extends RankingRow {
  bevs: (BevSummaryRow & { category_id: string }) | Array<BevSummaryRow & { category_id: string }>;
}

/** The embed every RankedBev read selects: the ranking, its Bev, the Bev's stats and icon. */
export const RANKED_BEV_SELECT = '*, bevs(*, bev_stats(*), bev_icons(path))';

export function mapRankedBev(client: SupabaseClient, row: RankingWithBevRow, venue: Venue | null): RankedBev {
  const bevRow = Array.isArray(row.bevs) ? row.bevs[0] : row.bevs;
  if (!bevRow) throw new ApiError('unknown', `Ranking ${row.id} has no Bev`);
  return { ...mapRanking(row), bev: mapBevSummary(client, bevRow), venue };
}

interface OffsetCursor {
  offset: number;
}

async function fetchRankedBevs(client: SupabaseClient, userId: string, bucket?: Bucket): Promise<RankedBev[]> {
  let query = client.from('rankings').select(RANKED_BEV_SELECT).eq('user_id', userId);
  if (bucket) query = query.eq('bucket', bucketToDb(bucket));
  // The places are a second read (places.ts): `bev_locations` has no client
  // policy, so they cannot be embedded in the select above.
  const [{ data, error }, venues] = await Promise.all([query, loadUserVenues(client, userId)]);
  if (error) throw mapError(error);
  return (data as RankingWithBevRow[]).map((row) => mapRankedBev(client, row, venues.get(row.bev_id) ?? null));
}

export function createRankingsApi(client: SupabaseClient, snapshots: SnapshotCache): RankingsApi {
  return {
    async listMine(params): Promise<Page<RankedBev>> {
      const uid = await requireUserId(client);
      const limit = clampLimit(params?.page?.limit);
      const { offset } = decodeCursor<OffsetCursor>(params?.page?.cursor) ?? { offset: 0 };

      let rows = await fetchRankedBevs(client, uid, params?.bucket);
      if (params?.categoryId) {
        rows = rows.filter((r) => r.bev.categoryId === params.categoryId);
      }

      const sort = params?.sort ?? 'score';
      const bucketRank: Record<Bucket, number> = { LOVED: 3, FINE: 2, DISLIKED: 1 };
      if (sort === 'score') {
        rows.sort((a, b) => bucketRank[b.bucket] - bucketRank[a.bucket] || a.position - b.position);
      } else if (sort === 'recent') {
        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      } else {
        rows.sort((a, b) => a.bev.name.localeCompare(b.bev.name));
      }

      const page = rows.slice(offset, offset + limit);
      return toPage(page, limit, () => ({ offset: offset + limit }) satisfies OffsetCursor);
    },

    async listUser(id: string, page?: PageParams): Promise<Page<RankedBev>> {
      await requireUserId(client);
      const limit = clampLimit(page?.limit);
      const { offset } = decodeCursor<OffsetCursor>(page?.cursor) ?? { offset: 0 };

      const rows = await fetchRankedBevs(client, id);
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const slice = rows.slice(offset, offset + limit);
      return toPage(slice, limit, () => ({ offset: offset + limit }) satisfies OffsetCursor);
    },

    async listBucket(bucket: Bucket): Promise<string[]> {
      const uid = await requireUserId(client);
      const { data, error } = await client
        .from('rankings')
        .select('bev_id')
        .eq('user_id', uid)
        .eq('bucket', bucketToDb(bucket))
        .order('position');
      if (error) throw mapError(error);
      return (data ?? []).map((row) => (row as { bev_id: string }).bev_id);
    },

    // Deliberately an RPC and not a widened `listBucket`: the brand key is
    // `normaliseBrand`'s, which is a formula from @bevi/ranking rather than a
    // column, so it is derived in one place (list_bucket_bevs, 20261019000500)
    // instead of here and in the FakeApi.
    async listBucketBevs(bucket: Bucket): Promise<BucketBev[]> {
      await requireUserId(client);
      const { data, error } = await client.rpc('list_bucket_bevs', { p_bucket: bucketToDb(bucket) });
      if (error) throw mapError(error);
      return ((data ?? []) as BucketBevRow[]).map(mapBucketBev);
    },

    async submitRanking(input: SubmitRankingInput): Promise<SubmitRankingResult> {
      await requireUserId(client);
      const args = {
        p_bev_id: input.bevId,
        p_bucket: bucketToDb(input.bucket),
        p_insert_index: input.insertIndex,
        p_expected_bucket_size: input.expectedBucketSize,
        p_comparisons: input.comparisons,
        p_note: input.note ?? null,
      };
      // With a place, the wrapper that saves both in one transaction
      // (20261119193100). Without one, the function every older client calls,
      // so a ranking with no place does not depend on that migration.
      const { data, error } = await (
        input.venueId
          ? client.rpc('submit_ranking_with_location', { ...args, p_venue_id: input.venueId })
          : client.rpc('submit_ranking', args)
      ).single();
      if (error) throw mapError(error);
      snapshots.invalidate();
      const row = data as { ranking: RankingRow; bucket_size: number };
      return { ranking: mapRanking(row.ranking), bucketSize: row.bucket_size };
    },

    async rerankBev(input: SubmitRankingInput): Promise<SubmitRankingResult> {
      await requireUserId(client);
      const args = {
        p_bev_id: input.bevId,
        p_bucket: bucketToDb(input.bucket),
        p_insert_index: input.insertIndex,
        p_expected_bucket_size: input.expectedBucketSize,
        p_comparisons: input.comparisons,
        p_note: input.note ?? null,
      };
      // `venueId` left out keeps the place, which plain rerank_bev does by not
      // touching it. Given, a string replaces it and null removes it.
      const { data, error } = await (
        input.venueId === undefined
          ? client.rpc('rerank_bev', args)
          : client.rpc('rerank_bev_with_location', { ...args, p_venue_id: input.venueId })
      ).single();
      if (error) throw mapError(error);
      snapshots.invalidate();
      const row = data as { ranking: RankingRow; bucket_size: number };
      return { ranking: mapRanking(row.ranking), bucketSize: row.bucket_size };
    },

    async updateNote(bevId: string, note: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('update_ranking_note', { p_bev_id: bevId, p_note: note });
      if (error) throw mapError(error);
    },

    async removeRanking(bevId: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('remove_ranking', { p_bev_id: bevId });
      if (error) throw mapError(error);
      snapshots.invalidate();
    },

    async setVenue(bevId: string, venueId: string | null): Promise<Venue | null> {
      await requireUserId(client);
      const { data, error } = await client.rpc('set_bev_location', { p_bev_id: bevId, p_venue_id: venueId });
      if (error) throw mapError(error);
      return data ? mapVenue(data as VenueJsonRow) : null;
    },

    async getVenue(bevId: string): Promise<Venue | null> {
      const uid = await requireUserId(client);
      const venues = await loadVenuesForPairs(client, [{ userId: uid, bevId }]);
      return venues.get(venueKey(uid, bevId)) ?? null;
    },

    async locationSummary(): Promise<BevLocationSummary> {
      await requireUserId(client);
      const { data, error } = await client.rpc('bev_location_summary').single();
      if (error) throw mapError(error);
      const row = data as { ranked_count: number; located_count: number };
      return { rankedCount: row.ranked_count, locatedCount: row.located_count };
    },
  };
}
