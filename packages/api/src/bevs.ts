import type { SupabaseClient } from '@supabase/supabase-js';
import { MIN_N_USER, RANKING_VERSION, predictScore } from '@bevi/ranking';
import {
  ApiError,
  type Bev,
  type BevIcon,
  type BevLeaf,
  type BevPrediction,
  type BevsApi,
  type BevSimilarity,
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
  mapBevIcon,
  mapBevLeaf,
  mapBevSimilarity,
  mapBevSummary,
  mapNutrition,
  mapProfile,
  type GeneratedBevIconRow,
  type BevLeafRow,
  type BevRow,
  type BevSimilarityRow,
  type BevSummaryRow,
  type FlavorProfileRow,
  type MyRankingRow,
  type ProfileViewRow,
} from './mappers';
import { fetchFollowIds } from './follows';
import type { SnapshotCache } from './snapshot';
import { mapError } from './errors';
import { requireUserId } from './currentUser';

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
  /** 20261112000300; absent on a database without it. */
  icon_path?: string | null;
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
  /** 20261113000100; absent on a database without it, where it maps to a null iconUrl. */
  icon_path?: string | null;
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
  /** 20261112000300; absent on a database without it. */
  icon_path?: string | null;
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
    // get_bev follows a merge (20261101000500): asked for a Bev that was merged
    // into another, it returns the surviving Bev. Everything below is about the
    // Bev actually returned, so it keys off `row.id`, not the id asked for.
    const bevId = row.id;
    // Started now, alongside the reads below; only used if the caller hasn't
    // ranked this Bev. Never rejects (predictionFor catches).
    const prediction = predictionFor(uid, bevId);

    // Read straight from the table rather than widening get_bev: the profile
    // has a select policy for authenticated, and changing an RPC's `returns
    // table` means dropping and recreating it.
    const [rankingRes, wantRes, followeeIds, profileRes, nutritionRes] = await Promise.all([
      client.from('rankings').select('bucket, position, score, note').eq('user_id', uid).eq('bev_id', bevId).maybeSingle(),
      client.from('want_to_try').select('user_id').eq('user_id', uid).eq('bev_id', bevId).maybeSingle(),
      fetchFollowIds(client, 'follows', 'follower_id', uid),
      client
        .from('bev_flavor_profiles')
        .select('base, carbonated, caffeine, sweetness, dairy, alcohol, serve, source')
        .eq('bev_id', bevId)
        .maybeSingle(),
      client.from('bev_nutrition').select('nutrition').eq('bev_id', bevId).maybeSingle(),
    ]);
    if (rankingRes.error) throw mapError(rankingRes.error);
    if (wantRes.error) throw mapError(wantRes.error);
    if (profileRes.error) throw mapError(profileRes.error);
    // A migration-first rollout is required for writes. Older stacks still render Bev detail.
    if (nutritionRes.error && !['PGRST205', '42P01'].includes(nutritionRes.error.code)) throw mapError(nutritionRes.error);

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
        .eq('bev_id', bevId)
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
      icon_path: row.icon_path,
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
    // `mapNutrition` is what tolerates a snapshot stored before contract
    // 3.1.0 added `source` (mappers.ts); the missing-table check above is
    // what tolerates a backend with no `bev_nutrition` at all.
    return { ...mapBev(client, bevRow, {
      myRanking,
      inWantToTry: wantRes.data !== null,
      friends,
      flavorProfile: profileRes.data as FlavorProfileRow | null,
      prediction: myRanking ? null : await prediction,
    }), nutrition: mapNutrition(nutritionRes.data?.nutrition) };
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
        icon_path: row.icon_path,
        price_tier: row.price_tier,
        price_estimated: row.price_estimated,
        bev_stats: { rating_count: row.rating_count, avg_score: null, score_stddev: null, bayes_score: row.bayes_score },
      }),
    );
  }

  async function create(input: CreateBevInput): Promise<Bev> {
    await requireUserId(client);
    const args = {
      p_name: input.name,
      p_brand: input.brand ?? null,
      p_flavor: input.flavor ?? null,
      p_category_id: input.categoryId,
      p_price_tier: input.priceTier,
      p_price_estimated: input.priceEstimated,
      // Optional now. `null` is what makes the Bev 'pending_photo' and
      // INELIGIBLE for icon generation -- create_bev schedules a job only
      // when this is a real asset it can verify (20261119185800).
      p_photo_asset_id: input.photoAssetId ?? null,
      p_label_asset_id: input.labelAssetId ?? null,
    };
    // Both nutrition migrations are applied by hand after the backend deploy,
    // so `create` steps down one rung at a time on PGRST202 ("no such
    // function") rather than assuming either is there:
    //
    //   create_bev_with_nutrition_v2  -- takes both sources.
    //   -> create_bev_with_nutrition  -- an `openfoodfacts` snapshot only. v1
    //      requires a barcode, so handing it a `label-ocr` snapshot would not
    //      degrade, it would fail the whole creation.
    //   -> create_bev                 -- the Bev without its snapshot. The app
    //      already copes with this by telling the person the nutrition was not
    //      saved, which is why dropping it beats failing the creation.
    // v1 predates `source` and rejects any key outside its own ten
    // (20261115214237), so the rung that exists to degrade gracefully would
    // instead raise BEVI_VALIDATION -- not PGRST202, so the ladder would stop
    // and the whole creation would fail. Hand v1 the snapshot it understands.
    const v1Snapshot = input.nutrition && (({ source: _unused, ...rest }) => rest)(input.nutrition);
    const callRpc = (name: string) =>
      client.rpc(
        name,
        name === 'create_bev'
          ? args
          : { ...args, p_nutrition: name === 'create_bev_with_nutrition' ? v1Snapshot : input.nutrition },
      ).single();
    const fallbacks = !input.nutrition
      ? []
      : (input.nutrition.source ?? 'openfoodfacts') === 'openfoodfacts'
        ? ['create_bev_with_nutrition', 'create_bev']
        : ['create_bev'];
    let result = await callRpc(input.nutrition ? 'create_bev_with_nutrition_v2' : 'create_bev');
    for (const name of fallbacks) {
      if (result.error?.code !== 'PGRST202') break;
      result = await callRpc(name);
    }
    const { data, error } = result;
    if (error) throw mapError(error);
    snapshots.invalidate();
    const created = data as { id: string };
    return get(created.id);
  }

  async function report(id: string, reason: string, opts?: { duplicateOfId?: string }): Promise<void> {
    await requireUserId(client);
    // report_bev (20261101000500) raises BEVI_VALIDATION with detail
    // 'duplicateOfId' for a self-reference or a Bev the caller cannot see, which
    // mapError turns into 'validation' with `detail.field = 'duplicateOfId'`.
    const { error } = await client.rpc('report_bev', {
      p_bev_id: id,
      p_reason: reason,
      p_duplicate_of: opts?.duplicateOfId ?? null,
    });
    if (error) throw mapError(error);
  }

  async function getStarterCandidates(): Promise<BevSummary[]> {
    await requireUserId(client);
    // `bevs_select` RLS already age-filters; `is_starter` Bevs are
    // seeded active, so no extra filtering needed here.
    const { data, error } = await client.from('bevs').select('*, bev_stats(*), bev_icons(path)').eq('is_starter', true).eq('status', 'active');
    if (error) throw mapError(error);
    return (data ?? []).map((row) => mapBevSummary(client, row as unknown as BevSummaryRow));
  }

  // --------------------------------------------------------------------------
  // The Bev graph (A-16 + S-14 part 2)
  // --------------------------------------------------------------------------
  // Both of these read the `bev_edges` mirror written by the nightly graph
  // sync. The sync does not exist yet, so the mirror is empty and both return
  // `[]`; the contract says so and the app has to cope either way, because a
  // pair without an edge is also the steady state (the sync keeps each Bev's
  // top EDGE_TOP_K above EDGE_MIN_WEIGHT, nothing more). Neither method
  // reimplements a weight -- the number comes out of SQL exactly as
  // `edgeWeight()` produced it.

  async function similarities(bevId: string, otherIds: readonly string[]): Promise<BevSimilarity[]> {
    await requireUserId(client);
    // No ids means no pairs: skip the round trip rather than ask the server for
    // the weights of an empty set.
    if (otherIds.length === 0) return [];
    const { data, error } = await client.rpc('get_bev_similarities', {
      p_bev_id: bevId,
      p_other_ids: [...otherIds],
    });
    if (error) throw mapError(error);
    return ((data ?? []) as BevSimilarityRow[]).map(mapBevSimilarity);
  }

  async function similar(bevId: string, n?: number): Promise<BevSummary[]> {
    await requireUserId(client);
    // p_limit is clamped server-side; passing it through unchanged keeps one
    // copy of the bound (in SQL) rather than two that can disagree.
    const { data, error } = await client.rpc('get_similar_bevs', { p_bev_id: bevId, p_limit: n ?? 10 });
    if (error) throw mapError(error);
    // get_similar_bevs returns search_bevs' columns, so the search mapper is
    // reused verbatim -- including its thumb-then-photo fallback.
    return ((data ?? []) as SearchBevRpcRow[]).map((row) => mapSearchRow(client, row));
  }

  // A-13: the same bulk shape as `similarities`, for the same reason -- M-21's
  // placement asks about a whole bucket at once. The leaf is the only piece of
  // the hierarchy that reaches the client per Bev; the structure comes from
  // `categories.tree()`.
  async function leaves(bevIds: readonly string[]): Promise<BevLeaf[]> {
    await requireUserId(client);
    // No ids means no rows: skip the round trip, as `similarities` does.
    if (bevIds.length === 0) return [];
    const { data, error } = await client.rpc('get_bev_leaves', { p_bev_ids: [...bevIds] });
    if (error) throw mapError(error);
    return ((data ?? []) as BevLeafRow[]).map(mapBevLeaf);
  }

  // The same bulk shape as `leaves`, and for the same reason: a feed page or
  // the profile collection asks about every Bev on screen in one call. Nothing
  // here writes, so drawing a screen can never start a generation job.
  async function icons(bevIds: readonly string[]): Promise<BevIcon[]> {
    await requireUserId(client);
    // No ids means no rows: skip the round trip, as `leaves` and `similarities` do.
    if (bevIds.length === 0) return [];
    const { data, error } = await client.rpc('get_bev_icons', { p_bev_ids: [...bevIds] });
    if (error) throw mapError(error);
    return ((data ?? []) as GeneratedBevIconRow[]).map((row) => mapBevIcon(client, row));
  }

  return { search, get, findLikelyDuplicates, create, report, getStarterCandidates, similarities, similar, leaves, icons };
}
