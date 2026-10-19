import { describe, expect, it } from 'vitest';
import { BUCKET_ORDER } from '@bevi/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bucketFromDb,
  bucketToDb,
  feedKindFromDb,
  mapBevOfPeriod,
  mapCategory,
  mapCategoryProgress,
  mapFlavorProfile,
  type BevOfPeriodRpcRow,
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
