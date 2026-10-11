import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Page, type PageParams, type Profile, type WantToTryApi, type WantToTryItem } from '@bevi/shared';
import { mapError } from './errors';
import { mapBevSummary, mapProfile, type BevSummaryRow, type ProfileViewRow } from './mappers';
import { clampLimit, decodeCursor, toPage } from './paging';

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('unauthorized', 'Not signed in');
  return data.user.id;
}

interface OffsetCursor {
  offset: number;
}

interface WantToTryRow {
  created_at: string;
  source_user_id: string | null;
  bevs: (BevSummaryRow & { category_id: string }) | Array<BevSummaryRow & { category_id: string }>;
}

export function createWantToTryApi(client: SupabaseClient): WantToTryApi {
  return {
    async list(page?: PageParams): Promise<Page<WantToTryItem>> {
      const uid = await requireUserId(client);
      const limit = clampLimit(page?.limit);
      const { offset } = decodeCursor<OffsetCursor>(page?.cursor) ?? { offset: 0 };

      const { data, error } = await client
        .from('want_to_try')
        .select('created_at, source_user_id, bevs(*, bev_stats(*))')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) throw mapError(error);
      const rows = data as WantToTryRow[];

      const viaIds = [...new Set(rows.map((r) => r.source_user_id).filter((id): id is string => id !== null))];
      const viaById = new Map<string, Profile>();
      if (viaIds.length > 0) {
        const { data: viaRows, error: viaError } = await client.from('profiles_view').select('*').in('id', viaIds);
        if (viaError) throw mapError(viaError);
        for (const row of viaRows as ProfileViewRow[]) viaById.set(row.id, mapProfile(client, row));
      }

      const items = rows.slice(offset, offset + limit).map((row) => {
        const bevRow = Array.isArray(row.bevs) ? row.bevs[0] : row.bevs;
        return {
          bev: mapBevSummary(client, bevRow),
          savedAt: row.created_at,
          via: row.source_user_id ? viaById.get(row.source_user_id) ?? null : null,
        };
      });
      return toPage(items, limit, () => ({ offset: offset + limit }) satisfies OffsetCursor);
    },

    async add(bevId: string, viaUserId?: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('add_want_to_try', {
        p_bev_id: bevId,
        p_source_ranking_id: null,
        p_via_user_id: viaUserId ?? null,
      });
      if (error) throw mapError(error);
    },

    async remove(bevId: string): Promise<void> {
      await requireUserId(client);
      const { error } = await client.rpc('remove_want_to_try', { p_bev_id: bevId });
      if (error) throw mapError(error);
    },
  };
}
