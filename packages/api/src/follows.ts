import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type FollowsApi, type Page, type PageParams, type ProfileRow } from '@bevi/shared';
import { mapError } from './errors';
import { mapProfileRow, type ProfileViewRow } from './mappers';
import { clampLimit, decodeCursor, toPage } from './paging';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

interface OffsetCursor {
  offset: number;
}

export async function fetchFollowIds(client: SupabaseClient, table: 'follows', column: 'follower_id' | 'followee_id', value: string): Promise<string[]> {
  const otherColumn = column === 'follower_id' ? 'followee_id' : 'follower_id';
  const { data, error } = await client.from(table).select(otherColumn).eq(column, value);
  if (error) throw mapError(error);
  return (data ?? []).map((row) => (row as Record<string, string>)[otherColumn]);
}

async function fetchProfileRows(
  client: SupabaseClient,
  selfId: string,
  ids: string[],
  limit: number,
  offset: number
): Promise<ProfileRow[]> {
  if (ids.length === 0) return [];
  const page = ids.slice(offset, offset + limit);
  if (page.length === 0) return [];

  const [{ data: profiles, error: profilesError }, { data: following, error: followingError }] = await Promise.all([
    client.from('profiles_view').select('*').in('id', page),
    client.from('follows').select('followee_id').eq('follower_id', selfId).in('followee_id', page),
  ]);
  if (profilesError) throw mapError(profilesError);
  if (followingError) throw mapError(followingError);

  const followingSet = new Set((following ?? []).map((row) => (row as { followee_id: string }).followee_id));
  const byId = new Map((profiles as ProfileViewRow[]).map((row) => [row.id, row]));
  // Preserve the caller's requested order (newest-follow-first from the DB
  // query), not whatever order `.in()` happened to return.
  return page
    .map((id) => byId.get(id))
    .filter((row): row is ProfileViewRow => row !== undefined)
    .map((row) => mapProfileRow(client, row, row.id === selfId ? false : followingSet.has(row.id)));
}

export function createFollowsApi(client: SupabaseClient): FollowsApi {
  return {
    async follow(id: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('follow_user', { p_user_id: id });
      if (error) throw mapError(error);
    },

    async unfollow(id: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('unfollow_user', { p_user_id: id });
      if (error) throw mapError(error);
    },

    async listFollowers(id: string, page?: PageParams): Promise<Page<ProfileRow>> {
      const uid = await requireUserId(client);
      const limit = clampLimit(page?.limit);
      const { offset } = decodeCursor<OffsetCursor>(page?.cursor) ?? { offset: 0 };
      const ids = await fetchFollowIds(client, 'follows', 'followee_id', id);
      const rows = await fetchProfileRows(client, uid, ids, limit, offset);
      return toPage(rows, limit, () => ({ offset: offset + limit }) satisfies OffsetCursor);
    },

    async listFollowing(id: string, page?: PageParams): Promise<Page<ProfileRow>> {
      const uid = await requireUserId(client);
      const limit = clampLimit(page?.limit);
      const { offset } = decodeCursor<OffsetCursor>(page?.cursor) ?? { offset: 0 };
      const ids = await fetchFollowIds(client, 'follows', 'follower_id', id);
      const rows = await fetchProfileRows(client, uid, ids, limit, offset);
      return toPage(rows, limit, () => ({ offset: offset + limit }) satisfies OffsetCursor);
    },

    async suggested(): Promise<ProfileRow[]> {
      const uid = await requireUserId(client);
      const alreadyFollowing = new Set(await fetchFollowIds(client, 'follows', 'follower_id', uid));
      alreadyFollowing.add(uid);

      // "Most rankings" the caller doesn't already follow. user_stats is
      // public-read, so this is a plain select, not an RPC.
      const { data, error } = await client
        .from('user_stats')
        .select('user_id, rating_count')
        .order('rating_count', { ascending: false })
        .limit(50);
      if (error) throw mapError(error);

      const candidateIds = (data ?? [])
        .map((row) => (row as { user_id: string }).user_id)
        .filter((id) => !alreadyFollowing.has(id))
        .slice(0, 10);

      return fetchProfileRows(client, uid, candidateIds, candidateIds.length, 0);
    },
  };
}
