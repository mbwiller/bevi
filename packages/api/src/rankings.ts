import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  type Bucket,
  type CategoryId,
  type Page,
  type PageParams,
  type RankedBev,
  type RankingsApi,
  type SubmitRankingInput,
  type SubmitRankingResult,
} from '@bevi/shared';
import { mapError } from './errors';
import { bucketToDb, mapBevSummary, mapRanking, type BevSummaryRow, type RankingRow } from './mappers';
import { clampLimit, decodeCursor, toPage } from './paging';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

interface RankingWithBevRow extends RankingRow {
  bevs: (BevSummaryRow & { category_id: string }) | Array<BevSummaryRow & { category_id: string }>;
}

function mapRankedBev(client: SupabaseClient, row: RankingWithBevRow): RankedBev {
  const bevRow = Array.isArray(row.bevs) ? row.bevs[0] : row.bevs;
  if (!bevRow) throw new ApiError('unknown', `Ranking ${row.id} has no Bev`);
  return { ...mapRanking(row), bev: mapBevSummary(client, bevRow) };
}

interface OffsetCursor {
  offset: number;
}

async function fetchRankedBevs(client: SupabaseClient, userId: string, bucket?: Bucket): Promise<RankedBev[]> {
  let query = client.from('rankings').select('*, bevs(*, bev_stats(*))').eq('user_id', userId);
  if (bucket) query = query.eq('bucket', bucketToDb(bucket));
  const { data, error } = await query;
  if (error) throw mapError(error);
  return (data as RankingWithBevRow[]).map((row) => mapRankedBev(client, row));
}

export function createRankingsApi(client: SupabaseClient): RankingsApi {
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

    async submitRanking(input: SubmitRankingInput): Promise<SubmitRankingResult> {
      await requireUserId(client);
      const { data, error } = await client
        .rpc('submit_ranking', {
          p_bev_id: input.bevId,
          p_bucket: bucketToDb(input.bucket),
          p_insert_index: input.insertIndex,
          p_expected_bucket_size: input.expectedBucketSize,
          p_comparisons: input.comparisons,
          p_note: input.note ?? null,
        })
        .single();
      if (error) throw mapError(error);
      const row = data as { ranking: RankingRow; bucket_size: number };
      return { ranking: mapRanking(row.ranking), bucketSize: row.bucket_size };
    },

    async rerankBev(input: SubmitRankingInput): Promise<SubmitRankingResult> {
      await requireUserId(client);
      const { data, error } = await client
        .rpc('rerank_bev', {
          p_bev_id: input.bevId,
          p_bucket: bucketToDb(input.bucket),
          p_insert_index: input.insertIndex,
          p_expected_bucket_size: input.expectedBucketSize,
          p_comparisons: input.comparisons,
          p_note: input.note ?? null,
        })
        .single();
      if (error) throw mapError(error);
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
    },
  };
}
