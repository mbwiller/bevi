import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Category, type CategoriesApi } from '@bevi/shared';
import { mapError } from './errors';
import { mapCategory, type CategoryProgressRow, type CategoryRow } from './mappers';

export function createCategoriesApi(client: SupabaseClient): CategoriesApi {
  return {
    async list(): Promise<Category[]> {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw new ApiError('unauthorized', 'Not signed in');

      const [{ data: rows, error }, { data: me, error: meError }, { data: progress, error: progressError }] = await Promise.all([
        client.from('categories').select('*').order('sort_order'),
        client.from('profiles_view').select('can_see_alcohol').eq('id', userData.user.id).maybeSingle(),
        // `bevCount` is the same active count `stats.getCategoryProgress()` returns as `total`.
        client.rpc('get_category_progress'),
      ]);
      if (error) throw mapError(error);
      if (meError) throw mapError(meError);
      if (progressError) throw mapError(progressError);
      const totals = new Map((progress as CategoryProgressRow[]).map((p) => [p.category_id, p.total]));

      // `categories_select` RLS doesn't age-filter -- the contract says
      // this method does, so alcoholic categories are dropped here for a
      // caller who can't see alcohol.
      const canSeeAlcohol = (me as { can_see_alcohol: boolean } | null)?.can_see_alcohol ?? false;
      return (rows as CategoryRow[])
        .filter((row) => !row.is_alcoholic || canSeeAlcohol)
        .map((row) => mapCategory(row, totals.get(row.id) ?? 0));
    },
  };
}
