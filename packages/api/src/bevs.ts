import type { SupabaseClient } from '@supabase/supabase-js';
import { MIN_N_USER, RANKING_VERSION, predictScore } from '@bevi/ranking';
import {
  ApiError,
  type Bev,
  type BevPrediction,
  type BevsApi,
  type BevSummary,
  type CategoryId,
  type CreateBevInput,
  type FindDuplicatesInput,
  type FriendScore,
  type Page,
} from '@bevi/shared';
import {
  bucketFromDb,
  mapBev,
  mapBevSummary,
  mapProfile,
  type BevRow,
  type BevSummaryRow,
  type FlavorProfileRow,
  type MyRankingRow,
  type ProfileViewRow,
} from './mappers';
import { fetchFollowIds } from './follows';
import type { SnapshotCache } from './snapshot';
import { mapError } from './errors';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

interface SearchBevRpcRow {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  category_id: string;
  photo_path: string | null;
  thumb_path: string | null;
  price_tier: number;
  price_estimated: boolean;
  rating_count: number;
  avg_score: number | null;
  bayes_score: number | null;
}

function mapSearchRow(client: SupabaseClient, row: SearchBevRpcRow): BevSummary {
  return mapBevSummary(client, {
    ...row,
    photo_path: row.thumb_path ?? row.photo_path,
    bev_stats: { rating_count: row.rating_count, avg_score: row.avg_score, score_stddev: null, bayes_score: row.bayes_score },
  });
}

interface FindSimilarRpcRow {
  bev_id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  thumb_path: string | null;
  category_id: string;
  price_tier: number;
  price_estimated: boolean;
  rating_count: number;
  bayes_score: number | null;
}

interface GetBevRpcRow {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  category_id: string;
  photo_path: string | null;
  nutrition_label_path: string | null;
  price_tier: number;
  price_estimated: boolean;
  status: string;
  is_starter: boolean;
  created_at: string;
  created_by_id: string | null;
  created_by_handle: string | null;
  rating_count: number;
  avg_score: number | null;
  score_stddev: number | null;
  bayes_score: number | null;
}

export function createBevsApi(client: SupabaseClient, snapshots: SnapshotCache): BevsApi {
  async function search(params: { q: string; categoryId?: CategoryId; limit?: number; cursor?: string }): Promise<Page<BevSummary>> {
    await requireUserId(client);
    const { data, error } = await client.rpc('search_bevs', {
      p_query: params.q,
      p_category_id: params.categoryId ?? null,
      p_limit: params.limit ?? 20,
    });
    if (error) throw mapError(error);
    // Ordered by similarity, not a stable key -- no cursor yet (see the
    // migration's note above search_bevs).
    return { items: ((data ?? []) as SearchBevRpcRow[]).map((row) => mapSearchRow(client, row)), nextCursor: null };
  }

  // Defined as a standalone function (not an object-literal method) so
  // `create` below can call it directly instead of through `this`, which
  // would break if a caller ever destructures `const { create } = api.bevs`.
  async function get(id: string): Promise<Bev> {
    const uid = await requireUserId(client);
    const { data, error } = await client.rpc('get_bev', { p_bev_id: id }).maybeSingle();
    if (error) throw mapError(error);
    if (!data) throw new ApiError('not_found', `No Bev ${id}`);
    const row = data as GetBevRpcRow;
    // Started now, alongside the reads below; only used if the caller hasn't
    // ranked this Bev. Never rejects (predictionFor catches).
    const prediction = predictionFor(uid, id);

    // Read straight from the table rather than widening get_bev: the profile
    // has a select policy for authenticated, and changing an RPC's `returns
    // table` means dropping and recreating it.
    const [rankingRes, wantRes, followeeIds, profileRes] = await Promise.all([
      client.from('rankings').select('bucket, position, score, note').eq('user_id', uid).eq('bev_id', id).maybeSingle(),
      client.from('want_to_try').select('user_id').eq('user_id', uid).eq('bev_id', id).maybeSingle(),
      fetchFollowIds(client, 'follows', 'follower_id', uid),
      client.from('bev_flavor_profiles').select('*').eq('bev_id', id).maybeSingle(),
    ]);
    if (rankingRes.error) throw mapError(rankingRes.error);
    if (wantRes.error) throw mapError(wantRes.error);
    if (profileRes.error) throw mapError(profileRes.error);

    let myRanking: MyRankingRow | null = null;
    if (rankingRes.data) {
      const r = rankingRes.data as { bucket: number; position: number; score: number; note: string | null };
      const { count, error: countError } = await client
        .from('rankings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', uid)
        .eq('bucket', r.bucket);
      if (countError) throw mapError(countError);
      myRanking = { ...r, bucket_size: count ?? 0 };
    }

    let friends: FriendScore[] = [];
    if (followeeIds.length > 0) {
      const { data: friendRankings, error: frError } = await client
        .from('rankings')
        .select('user_id, score, bucket')
        .eq('bev_id', id)
        .in('user_id', followeeIds);
      if (frError) throw mapError(frError);
      const rows = (friendRankings ?? []) as Array<{ user_id: string; score: number; bucket: number }>;
      if (rows.length > 0) {
        const { data: friendProfiles, error: fpError } = await client
          .from('profiles_view')
          .select('*')
          .in('id', rows.map((r) => r.user_id));
        if (fpError) throw mapError(fpError);
        const byId = new Map((friendProfiles as ProfileViewRow[]).map((p) => [p.id, p]));
        friends = rows
          .map((r) => {
            const profileRow = byId.get(r.user_id);
            if (!profileRow) return null;
            return { profile: mapProfile(client, profileRow), score: Number(r.score), bucket: bucketFromDb(r.bucket) };
          })
          .filter((f): f is FriendScore => f !== null);
      }
    }

    const bevRow: BevRow = {
      id: row.id,
      name: row.name,
      brand: row.brand,
      flavor: row.flavor,
      category_id: row.category_id,
      photo_path: row.photo_path,
      price_tier: row.price_tier,
      price_estimated: row.price_estimated,
      bev_stats: {
        rating_count: row.rating_count,
        avg_score: row.avg_score,
        score_stddev: row.score_stddev,
        bayes_score: row.bayes_score,
      },
      status: row.status,
      nutrition_label_path: row.nutrition_label_path,
      created_at: row.created_at,
      created_by: row.created_by_id && row.created_by_handle ? { id: row.created_by_id, handle: row.created_by_handle } : null,
      is_starter: row.is_starter,
    };
    return mapBev(client, bevRow, {
      myRanking,
      inWantToTry: wantRes.data !== null,
      friends,
      flavorProfile: profileRes.data as FlavorProfileRow | null,
      prediction: myRanking ? null : await prediction,
    });
  }

  // The contract's `Bev.prediction`: null when the caller ranked the Bev or has
  // fewer than MIN_N_USER rankings, else predictScore over their snapshot. A
  // prediction is a nice-to-have on the detail screen, so a failure to build
  // it leaves it null instead of failing the whole Bev.
  async function predictionFor(uid: string, bevId: string): Promise<BevPrediction | null> {
    try {
      const { snapshot, viewer } = await snapshots.get(uid);
      if (viewer.rankingCount < MIN_N_USER || !snapshot.bevs[bevId]) return null;
      const p = predictScore(snapshot, uid, bevId);
      return { score: Math.round(p.score * 100) / 100, confidence: p.confidence, generatedAt: snapshot.generatedAt, rankingVersion: RANKING_VERSION };
    } catch {
      return null;
    }
  }

  async function findLikelyDuplicates(input: FindDuplicatesInput): Promise<BevSummary[]> {
    await requireUserId(client);
    const { data, error } = await client.rpc('find_similar_bevs', {
      p_name: input.name,
      p_brand: input.brand ?? null,
      p_category_id: input.categoryId ?? null,
      p_flavor: input.flavor ?? null,
      p_limit: 5,
    });
    if (error) throw mapError(error);
    return ((data ?? []) as FindSimilarRpcRow[]).map((row) =>
      mapBevSummary(client, {
        id: row.bev_id,
        name: row.name,
        brand: row.brand,
        flavor: row.flavor,
        category_id: row.category_id,
        photo_path: row.thumb_path,
        price_tier: row.price_tier,
        price_estimated: row.price_estimated,
        bev_stats: { rating_count: row.rating_count, avg_score: null, score_stddev: null, bayes_score: row.bayes_score },
      }),
    );
  }

  async function create(input: CreateBevInput): Promise<Bev> {
    await requireUserId(client);
    const { data, error } = await client
      .rpc('create_bev', {
        p_name: input.name,
        p_brand: input.brand ?? null,
        p_flavor: input.flavor ?? null,
        p_category_id: input.categoryId,
        p_price_tier: input.priceTier,
        p_price_estimated: input.priceEstimated,
        p_photo_asset_id: input.photoAssetId,
        p_label_asset_id: input.labelAssetId ?? null,
      })
      .single();
    if (error) throw mapError(error);
    snapshots.invalidate();
    const created = data as { id: string };
    return get(created.id);
  }

  async function report(id: string, reason: string): Promise<void> {
    await requireUserId(client);
    const { error } = await client.rpc('report_bev', { p_bev_id: id, p_reason: reason });
    if (error) throw mapError(error);
  }

  async function getStarterCandidates(): Promise<BevSummary[]> {
    await requireUserId(client);
    // `bevs_select` RLS already age-filters; `is_starter` Bevs are
    // seeded active, so no extra filtering needed here.
    const { data, error } = await client.from('bevs').select('*, bev_stats(*)').eq('is_starter', true).eq('status', 'active');
    if (error) throw mapError(error);
    return (data ?? []).map((row) => mapBevSummary(client, row as unknown as BevSummaryRow));
  }

  return { search, get, findLikelyDuplicates, create, report, getStarterCandidates };
}
