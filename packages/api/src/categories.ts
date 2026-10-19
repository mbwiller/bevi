import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Category, type CategoriesApi } from '@bevi/shared';
import { mapError } from './errors';
import { mapCategory, type CategoryProgressRow, type CategoryRow } from './mappers';

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
  };
}
