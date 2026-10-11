import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Category, type CategoriesApi } from '@bevi/shared';
import { mapError } from './errors';
import { mapCategory, type CategoryRow } from './mappers';

export function createCategoriesApi(client: SupabaseClient): CategoriesApi {
  return {
    async list(): Promise<Category[]> {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) throw new ApiError('unauthorized', 'Not signed in');

      const [{ data: rows, error }, { data: me, error: meError }] = await Promise.all([
        client.from('categories').select('*').order('sort_order'),
        client.from('profiles_view').select('can_see_alcohol').eq('id', userData.user.id).maybeSingle(),
      ]);
      if (error) throw mapError(error);
      if (meError) throw mapError(meError);

      // `categories_select` RLS doesn't age-filter -- the contract says
      // this method does, so alcoholic categories are dropped here for a
      // caller who can't see alcohol.
      const canSeeAlcohol = (me as { can_see_alcohol: boolean } | null)?.can_see_alcohol ?? false;
      return (rows as CategoryRow[])
        .filter((row) => !row.is_alcoholic || canSeeAlcohol)
        .map(mapCategory);
    },
  };
}
