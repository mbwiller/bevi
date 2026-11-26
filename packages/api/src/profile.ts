import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  type CategoryId,
  type CheckHandleResult,
  type Page,
  type Profile,
  type ProfileApi,
  type ProfileRow,
  type UpdateMeInput,
} from '@bevi/shared';
import { mapError } from './errors';
import { requireUserId } from './currentUser';
import { mapProfile, mapProfileRow, type ProfileViewRow } from './mappers';
import { clampLimit, decodeCursor, toPage } from './paging';

async function fetchProfileView(client: SupabaseClient, id: string): Promise<ProfileViewRow> {
  const { data, error } = await client.from('profiles_view').select('*').eq('id', id).maybeSingle();
  if (error) throw mapError(error);
  if (!data) throw new ApiError('not_found', `No profile for user ${id}`);
  return data as ProfileViewRow;
}

async function isFollowing(client: SupabaseClient, selfId: string, targetId: string): Promise<boolean> {
  if (selfId === targetId) return false;
  const { data, error } = await client
    .from('follows')
    .select('follower_id')
    .eq('follower_id', selfId)
    .eq('followee_id', targetId)
    .maybeSingle();
  if (error) throw mapError(error);
  return data !== null;
}

interface SearchOffsetCursor {
  offset: number;
}

// DELIVERABLE-44: one row of `user_category_picks` (20261128000200), and of what
// `set_category_picks` returns -- the same two columns, so one mapper serves both.
interface CategoryPickRow {
  category_id: string;
  rank: number;
}

// Favourite first. The RPC and the select both order by rank already; sorting
// here as well means neither has to be trusted to have kept it through PostgREST.
function mapCategoryPicks(rows: CategoryPickRow[] | null): CategoryId[] {
  return [...(rows ?? [])].sort((a, b) => a.rank - b.rank).map((row) => row.category_id as CategoryId);
}

export function createProfileApi(client: SupabaseClient): ProfileApi {
  return {
    async getMe(): Promise<Profile> {
      const uid = await requireUserId(client);
      const row = await fetchProfileView(client, uid);
      return mapProfile(client, row);
    },

    async updateMe(patch: UpdateMeInput): Promise<Profile> {
      const uid = await requireUserId(client);

      if (patch.displayName !== undefined && patch.displayName.trim().length === 0) {
        throw new ApiError('validation', 'displayName cannot be empty', { field: 'displayName' });
      }
      if (patch.timezone !== undefined) {
        try {
          // Throws RangeError for an unknown IANA zone; Intl.supportedValuesOf
          // needs Node 18+ / a modern browser, both already required elsewhere.
          // Hermes (IA-5): `Intl` on iOS is backed by Apple's own ICU rather
          // than a bundled one, so this check is only as strict as the
          // platform's zone table. If a zone Apple accepts and Postgres does
          // not ever slips through, the write still fails server-side with a
          // mapped error -- this is a nicer message, not the authority. No
          // fallback added: `Intl.DateTimeFormat` itself exists on Hermes.
          new Intl.DateTimeFormat('en-US', { timeZone: patch.timezone });
        } catch {
          throw new ApiError('validation', `Unknown timezone: ${patch.timezone}`, { field: 'timezone' });
        }
      }

      if (patch.handle !== undefined) {
        const { error } = await client.rpc('set_handle', { p_handle: patch.handle });
        if (error) throw mapError(error);
      }

      if (patch.avatarAssetId !== undefined) {
        // avatar_path is pinned by protect_profile_columns (20261019000300):
        // only set_avatar() moves it, after checking the object is the
        // caller's own upload to `avatars`. null clears the photo.
        const { error } = await client.rpc('set_avatar', { p_path: patch.avatarAssetId });
        if (error) throw mapError(error);
      }

      const directPatch: Record<string, unknown> = {};
      if (patch.displayName !== undefined) directPatch.display_name = patch.displayName;
      if (patch.timezone !== undefined) directPatch.timezone = patch.timezone;
      if (patch.onboarded !== undefined) directPatch.onboarded = patch.onboarded;

      if (Object.keys(directPatch).length > 0) {
        const { error } = await client.from('profiles').update(directPatch).eq('id', uid);
        if (error) throw mapError(error);
      }

      const row = await fetchProfileView(client, uid);
      return mapProfile(client, row);
    },

    async setBirthDate(date: string): Promise<Profile> {
      const uid = await requireUserId(client);
      const { error } = await client.rpc('set_birth_date', { p_date: date });
      if (error) throw mapError(error);
      // set_birth_date returns the raw `profiles` row, which doesn't carry
      // `can_see_alcohol` -- re-fetch the properly shaped view row instead
      // of mapping that row directly.
      const row = await fetchProfileView(client, uid);
      return mapProfile(client, row);
    },

    async checkHandle(handle: string): Promise<CheckHandleResult> {
      const { data, error } = await client.rpc('check_handle', { p_handle: handle }).maybeSingle();
      if (error) throw mapError(error);
      if (!data) throw new ApiError('unknown', 'check_handle returned no row');
      const row = data as { available: boolean; reason: string | null };
      return { available: row.available, reason: (row.reason as CheckHandleResult['reason']) ?? undefined };
    },

    async getUser(id: string): Promise<ProfileRow> {
      const uid = await requireUserId(client);
      const row = await fetchProfileView(client, id);
      const following = await isFollowing(client, uid, id);
      return mapProfileRow(client, row, following);
    },

    async searchUsers(params: { q: string; limit?: number; cursor?: string }): Promise<Page<ProfileRow>> {
      const uid = await requireUserId(client);
      const limit = clampLimit(params.limit);
      const { offset } = decodeCursor<SearchOffsetCursor>(params.cursor) ?? { offset: 0 };

      // Two separate `.ilike()` calls (not a single `.or()` string) so the
      // caller's `q` never has to be escaped for PostgREST filter syntax.
      const [byHandle, byName] = await Promise.all([
        client.from('profiles_view').select('*').ilike('handle', `%${params.q}%`).order('handle').limit(offset + limit),
        client.from('profiles_view').select('*').ilike('display_name', `%${params.q}%`).order('handle').limit(offset + limit),
      ]);
      if (byHandle.error) throw mapError(byHandle.error);
      if (byName.error) throw mapError(byName.error);

      const merged = new Map<string, ProfileViewRow>();
      for (const row of [...(byHandle.data ?? []), ...(byName.data ?? [])] as ProfileViewRow[]) {
        merged.set(row.id, row);
      }
      const sorted = [...merged.values()].sort((a, b) => a.handle.localeCompare(b.handle));
      const page = sorted.slice(offset, offset + limit);

      const rows = await Promise.all(
        page.map(async (row) => mapProfileRow(client, row, await isFollowing(client, uid, row.id)))
      );
      return toPage(rows, limit, () => ({ offset: offset + limit }) satisfies SearchOffsetCursor);
    },

    async getCategoryPicks(): Promise<CategoryId[]> {
      const uid = await requireUserId(client);
      // Straight from the table, as want_to_try is read: user_category_picks_select
      // shows a caller their own rows and nobody else's, and the `user_id` filter
      // says so again rather than leaning on the policy alone.
      const { data, error } = await client
        .from('user_category_picks')
        .select('category_id, rank')
        .eq('user_id', uid)
        .order('rank', { ascending: true });
      if (error) throw mapError(error);
      return mapCategoryPicks(data as CategoryPickRow[] | null);
    },

    async setCategoryPicks(categoryIds: CategoryId[]): Promise<CategoryId[]> {
      await requireUserId(client);
      // Every rule (how many, top-level, no repeats, the age gate) is the RPC's:
      // BEVI_VALIDATION carries detail 'categoryIds', which mapError turns into
      // `{ field: 'categoryIds' }`, and BEVI_AGE_RESTRICTED maps to 'age_restricted'.
      const { data, error } = await client.rpc('set_category_picks', { p_category_ids: categoryIds });
      if (error) throw mapError(error);
      return mapCategoryPicks(data as CategoryPickRow[] | null);
    },
  };
}
