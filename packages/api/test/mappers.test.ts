import { describe, expect, it } from 'vitest';
import { BUCKET_ORDER } from '@bevi/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bucketFromDb,
  bucketToDb,
  feedKindFromDb,
  mapBevLeaderboardRow,
  mapBevOfPeriod,
  mapBevSummary,
  mapCategory,
  mapCategoryProgress,
  mapFlavorProfile,
  mapExplorePost,
  mapTasteProfileRow,
  mapVenueDetail,
  type BevOfPeriodRpcRow,
  type BevSummaryRow,
  type ExploreRpcRow,
  type VenueDetailRow,
} from '../src/mappers.ts';

describe('bucket <-> smallint', () => {
  it('round-trips every Bucket value through the DB encoding', () => {
    for (const bucket of BUCKET_ORDER) {
      expect(bucketFromDb(bucketToDb(bucket))).toBe(bucket);
    }
  });

  it('matches the DB documented smallint mapping (3 LOVED, 2 FINE, 1 DISLIKED)', () => {
    expect(bucketToDb('LOVED')).toBe(3);
    expect(bucketToDb('FINE')).toBe(2);
    expect(bucketToDb('DISLIKED')).toBe(1);
  });

  it('throws on a value no bucket maps to', () => {
    expect(() => bucketFromDb(0)).toThrow();
    expect(() => bucketFromDb(4)).toThrow();
  });
});

describe('feedKindFromDb', () => {
  it('maps ranked and reranked to RANKING', () => {
    expect(feedKindFromDb('ranked')).toBe('RANKING');
    expect(feedKindFromDb('reranked')).toBe('RANKING');
  });

  it('throws on the kinds A-01 removed -- feed_events can no longer hold them', () => {
    expect(() => feedKindFromDb('want_to_try')).toThrow();
    expect(() => feedKindFromDb('followed')).toThrow();
  });
});

describe('mapFlavorProfile', () => {
  it('returns exactly the FlavorProfile contract fields, nothing from the table row besides', () => {
    const row = {
      bev_id: '00000000-0000-0000-0000-000000000000',
      base: 'cola',
      carbonated: true,
      caffeine: 1,
      sweetness: 3,
      dairy: false,
      alcohol: false,
      serve: 'cold',
      source: 'catalog',
      updated_at: '2026-10-14T00:00:00Z',
    };
    expect(mapFlavorProfile(row)).toStrictEqual({
      base: 'cola',
      carbonated: true,
      caffeine: 1,
      sweetness: 3,
      dairy: false,
      alcohol: false,
      serve: 'cold',
      source: 'catalog',
    });
  });
});

describe('mapBevOfPeriod', () => {
  // No photo paths, so publicUrl never touches the client.
  const client = {} as SupabaseClient;
  const row = (period: string, over: Partial<BevOfPeriodRpcRow> = {}): BevOfPeriodRpcRow => ({
    period,
    period_start: '2026-10-19',
    is_current: true,
    rankings_in_period: 2,
    bev_id: '00000000-0000-0000-0000-0000000000b1',
    bev_name: 'Mexican Coca-Cola',
    bev_brand: 'Coca-Cola',
    bev_flavor: null,
    bev_category_id: 'soda',
    bev_thumb_path: null,
    bev_price_tier: 2,
    bev_price_estimated: false,
    bev_rating_count: 1,
    bev_bayes_score: '6.00',
    ...over,
  });

  it('maps the day and week rows, carrying the score the winner was picked by', () => {
    const out = mapBevOfPeriod(client, [row('day', { period_start: '2026-10-21', is_current: false }), row('week')]);
    expect(out.day).toMatchObject({ periodStart: '2026-10-21', isCurrent: false, rankingsInPeriod: 2 });
    expect(out.day!.bev).toMatchObject({ id: '00000000-0000-0000-0000-0000000000b1', ratingCount: 1, bayesScore: 6, photoUrl: null });
    expect(out.week).toMatchObject({ periodStart: '2026-10-19', isCurrent: true });
  });

  it('maps a missing period to null', () => {
    expect(mapBevOfPeriod(client, [row('week')])).toMatchObject({ day: null });
    expect(mapBevOfPeriod(client, [])).toStrictEqual({ day: null, week: null });
  });
});

describe('category progress (S-07)', () => {
  it('mapCategory carries the bevCount it is given', () => {
    expect(mapCategory({ id: 'soda', name: 'Soda', sort_order: 1, is_alcoholic: false }, 61)).toStrictEqual({
      id: 'soda',
      name: 'Soda',
      sortOrder: 1,
      isAlcoholic: false,
      bevCount: 61,
    });
  });

  it('mapCategoryProgress renames the RPC columns', () => {
    expect(mapCategoryProgress({ category_id: 'soda', ranked: 4, total: 61 })).toStrictEqual({
      categoryId: 'soda',
      ranked: 4,
      total: 61,
    });
  });
});

describe('taste profile (S-12)', () => {
  it('renames the RPC columns and turns numeric strings into numbers', () => {
    expect(mapTasteProfileRow({ category_id: 'coffee', rating_count: 2, mean_score: '3.220', affinity_z: '-0.272' })).toStrictEqual({
      categoryId: 'coffee',
      rankingCount: 2,
      mean: 3.22,
      affinity: -0.272,
    });
  });
});

// Contract 2.13.0: BevSummary.iconUrl from bev_icons.path (20261112000300).
// The path is an object key in the public `bev-icons` bucket; with no path --
// no icon, or a database whose RPCs predate the column -- iconUrl is null.
describe('iconUrl', () => {
  const ICON = 'diet-coke.350bbf29c1d2aa01.svg';
  // Records the bucket, so a URL in the wrong bucket fails.
  const client = {
    storage: {
      from: (bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${bucket}/${path}` } }) }),
    },
  } as unknown as SupabaseClient;
  const bevRow = (over: Partial<BevSummaryRow> = {}): BevSummaryRow => ({
    id: 'b1',
    name: 'Diet Coke',
    brand: 'Coca-Cola',
    flavor: null,
    category_id: 'soda',
    photo_path: null,
    price_tier: 1,
    price_estimated: false,
    ...over,
  });

  it('maps an RPC icon_path to a public URL in the bev-icons bucket', () => {
    expect(mapBevSummary(client, bevRow({ icon_path: ICON })).iconUrl).toBe(`https://cdn/bev-icons/${ICON}`);
  });

  it('maps a bev_icons embed, as an object or as an array', () => {
    expect(mapBevSummary(client, bevRow({ bev_icons: { path: ICON } })).iconUrl).toBe(`https://cdn/bev-icons/${ICON}`);
    expect(mapBevSummary(client, bevRow({ bev_icons: [{ path: ICON }] })).iconUrl).toBe(`https://cdn/bev-icons/${ICON}`);
  });

  it('is null with no icon: a null column, a null or empty embed, or no column at all', () => {
    expect(mapBevSummary(client, bevRow({ icon_path: null })).iconUrl).toBeNull();
    expect(mapBevSummary(client, bevRow({ bev_icons: null })).iconUrl).toBeNull();
    expect(mapBevSummary(client, bevRow({ bev_icons: [] })).iconUrl).toBeNull();
    expect(mapBevSummary(client, bevRow()).iconUrl).toBeNull();
  });

  it('leaves the photo alone: photoUrl stays in bev-photos, next to the icon', () => {
    const bev = mapBevSummary(client, bevRow({ photo_path: 'p.jpg', icon_path: ICON }));
    expect(bev.photoUrl).toBe('https://cdn/bev-photos/p.jpg');
    expect(bev.iconUrl).toBe(`https://cdn/bev-icons/${ICON}`);
  });

  it('maps bev_icon_path on a feed or Explore row, and its absence to null', () => {
    const row: ExploreRpcRow = {
      id: 1,
      kind: 'ranked',
      created_at: '2026-11-12T00:00:00Z',
      actor_id: 'u1',
      actor_handle: 'ana',
      actor_display_name: 'Ana',
      actor_avatar_path: null,
      bev_id: 'b1',
      bev_name: 'Diet Coke',
      bev_brand: 'Coca-Cola',
      bev_flavor: null,
      bev_category_id: 'soda',
      bev_thumb_path: null,
      bev_price_tier: 1,
      bev_price_estimated: false,
      bev_status: 'active',
      bev_rating_count: 1,
      bev_bayes_score: 7,
      score: 8,
      bucket: 3,
      note: null,
      in_my_want_to_try: false,
    };
    const actor = {} as Parameters<typeof mapExplorePost>[2];
    expect(mapExplorePost(client, { ...row, bev_icon_path: ICON }, actor).bev.iconUrl).toBe(`https://cdn/bev-icons/${ICON}`);
    expect(mapExplorePost(client, { ...row, bev_icon_path: null }, actor).bev.iconUrl).toBeNull();
    expect(mapExplorePost(client, row, actor).bev.iconUrl).toBeNull();
  });

  it('maps icon_path on a Bev leaderboard row', () => {
    const row = {
      id: 'b1',
      name: 'Diet Coke',
      brand: 'Coca-Cola',
      flavor: null,
      category_id: 'soda',
      photo_path: null,
      price_tier: 1,
      rating_count: 2,
      avg_score: 7,
      bayes_score: 7,
    };
    expect(mapBevLeaderboardRow(client, { ...row, icon_path: ICON }, 1, null).bev.iconUrl).toBe(`https://cdn/bev-icons/${ICON}`);
    expect(mapBevLeaderboardRow(client, row, 1, null).bev.iconUrl).toBeNull();
  });

  it('maps bev_icon_path on Bev of the day and a venue assortment', () => {
    const period: BevOfPeriodRpcRow = {
      period: 'day',
      period_start: '2026-11-12',
      is_current: true,
      rankings_in_period: 1,
      bev_id: 'b1',
      bev_name: 'Diet Coke',
      bev_brand: 'Coca-Cola',
      bev_flavor: null,
      bev_category_id: 'soda',
      bev_thumb_path: null,
      bev_price_tier: 1,
      bev_price_estimated: false,
      bev_rating_count: 1,
      bev_bayes_score: '7.00',
    };
    expect(mapBevOfPeriod(client, [{ ...period, bev_icon_path: ICON }]).day?.bev.iconUrl).toBe(`https://cdn/bev-icons/${ICON}`);
    expect(mapBevOfPeriod(client, [period]).day?.bev.iconUrl).toBeNull();

    const venue: VenueDetailRow = {
      venue_id: 'v1',
      name: 'Corner Deli',
      kind: 'deli',
      lat: 40.7,
      lng: -74,
      address: null,
      neighborhood: null,
      borough: null,
      hours_osm: null,
      hours_known: false,
      website: null,
      open_now: null,
      bev_id: 'b1',
      bev_name: 'Diet Coke',
      bev_brand: 'Coca-Cola',
      bev_flavor: null,
      bev_category_id: 'soda',
      bev_photo_path: null,
      bev_price_tier: 1,
      bev_price_estimated: false,
      bev_rating_count: 0,
      bev_bayes_score: null,
    };
    const detail = mapVenueDetail(client, [{ ...venue, bev_icon_path: ICON }, { ...venue, bev_id: 'b2' }]);
    expect(detail.bevs.map((b) => b.iconUrl)).toEqual([`https://cdn/bev-icons/${ICON}`, null]);
  });
});
