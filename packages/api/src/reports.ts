// Content reports (IS-7, App Store Guideline 1.2) over `report_content`
// (20261118220000_user_blocks_and_reports.sql). Catalog reports about a Bev
// are a different table and a different method (`bevs.report`).
//
// `resolve_content_report` is the operator's, service_role only, and is
// deliberately not reachable from here.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type ReportContentInput, type ReportContentResult, type ReportsApi } from '@bevi/shared';
import { requireUserId } from './currentUser';
import { mapError } from './errors';

/** Feed event and comment ids are bigints, carried as decimal strings. */
const BIGINT_ID = /^[1-9][0-9]{0,18}$/;

/** A profile id is a uuid, and `report_content` types `p_user_id` as one. */
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one `report_content` argument this target fills. Exactly one is sent:
 * the RPC infers the content kind from which one is set.
 */
function targetArgs(input: ReportContentInput): Record<string, string | number> {
  switch (input.kind) {
    case 'post':
    case 'comment': {
      // `Number('abc')` is NaN, which JSON sends as null, which the RPC would
      // read as "no target" -- a validation error about nothing the caller
      // wrote. An id that cannot be a row is simply no such content.
      if (!BIGINT_ID.test(input.id)) throw new ApiError('not_found', `No such ${input.kind}`);
      return input.kind === 'post' ? { p_feed_event_id: Number(input.id) } : { p_comment_id: Number(input.id) };
    }
    case 'profile':
      // Anything but a uuid would come back as a raw 22P02
      // (invalid_text_representation), which `mapError` reads as `unknown`.
      // As above, an id that cannot be a row is no such content.
      if (!UUID_ID.test(input.id)) throw new ApiError('not_found', 'No such profile');
      return { p_user_id: input.id };
    default:
      throw new ApiError('validation', 'Unknown report kind', { field: 'kind' });
  }
}

export function createReportsApi(client: SupabaseClient): ReportsApi {
  return {
    async report(input: ReportContentInput): Promise<ReportContentResult> {
      await requireUserId(client);
      const { data, error } = await client.rpc('report_content', {
        p_reason: input.reason,
        ...targetArgs(input),
        // The RPC trims, and treats blank as no note.
        p_note: input.note ?? null,
      });
      if (error) throw mapError(error);
      // `String(null)` is 'null', which would read as the id of a report.
      if (data === null || data === undefined) throw new ApiError('unknown', 'report_content returned no id');
      return { reportId: String(data) };
    },
  };
}
