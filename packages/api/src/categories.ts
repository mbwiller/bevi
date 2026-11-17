import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Category, type CategoriesApi, type CategoryNode } from '@bevi/shared';
import { mapError } from './errors';
import {
  mapCategory,
  mapCategoryNode,
  type CategoryNodeRow,
  type CategoryProgressRow,
  type CategoryRow,
} from './mappers';

export function createCategoriesApi(client: SupabaseClient): CategoriesApi {
  return {
    async list(): Promise<Category[]> {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw new ApiError('unauthorized', 'Not signed in');

      const [{ data: rows, error }, { data: progress, error: progressError }] = await Promise.all([
        client.from('categories').select('*').order('sort_order'),
        // `bevCount` is the same active count `stats.getCategoryProgress()` returns as `total`.
        client.rpc('get_category_progress'),
      ]);
      if (error) throw mapError(error);
      if (progressError) throw mapError(progressError);
      const totals = new Map((progress as CategoryProgressRow[]).map((p) => [p.category_id, p.total]));

      // `categories_select` RLS doesn't age-filter -- the contract says this
      // method does. `get_category_progress()` returns exactly the categories
      // the caller may see (alcoholic ones only for an adult, via
      // `viewer_is_adult()`), so its rows decide visibility here too: one age
      // rule, and a category can never show with a made-up count of 0.
      return (rows as CategoryRow[]).flatMap((row) => {
        const bevCount = totals.get(row.id);
        return bevCount === undefined ? [] : [mapCategory(row, bevCount)];
      });
    },

    // A-13. A separate call rather than a shape change to `list()`, because
    // `list()` feeds the 15-item UI pickers and the app keys exhaustive
    // `Record<CategoryId, ...>` maps off those ids.
    //
    // `list()` above is leaf-proof without a filter of its own: it drops any
    // category `get_category_progress()` does not return, and that RPC returns
    // only roots (20261026000100 section 6).
    async tree(): Promise<CategoryNode[]> {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw new ApiError('unauthorized', 'Not signed in');

      // An RPC, not a table read: the age gate belongs to the server (a leaf of
      // an alcoholic root has to be hidden too, which is a join `categories_select`
      // does not do), and the order is total there.
      const { data, error } = await client.rpc('get_category_tree');
      if (error) throw mapError(error);
      return ((data ?? []) as CategoryNodeRow[]).map(mapCategoryNode);
    },
  };
}
