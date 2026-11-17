// Fills `BevSummary.iconUrl` with a Bev's GENERATED icon, so a created icon
// takes the same slot as an authored catalogue one everywhere in the app.
//
// Why here and not in SQL. A summary arrives from about a dozen RPCs
// (`get_feed`, `get_explore`, `search_bevs`, `get_bev_leaderboard`, ...), and
// none of them returns `bevs.generated_icon_path`: appending a column to all
// of them means re-creating eleven security-definer functions, and they freeze
// the moment they merge. `get_bev_icons` (20261114000200) already answers for
// up to 500 ids in one call, which is what it was built for -- the contract
// says so in `BevIcon` -- so one batch call per API call fills the field
// instead, and the SQL is left alone.
//
// Why a decorator and not a line in each method. A missed method is invisible:
// the Bev just keeps showing its creator's photograph, on one screen and not
// another. Wrapping the composed `BeviApi` once means a method added later is
// covered without anyone remembering this file exists.
import type { BeviApi, BevIcon, BevSummary } from '@bevi/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapBevIcon, type GeneratedBevIconRow } from './mappers';

/** `get_bev_icons` rejects a longer array as the caller's bug; it is not one. */
const MAX_IDS_PER_CALL = 500;

/**
 * A `BevSummary` among a method's results.
 *
 * `iconLabelBand` is the test because no other type in the contract has it,
 * and every summary the mappers build sets it (to null) even when the Bev has
 * no band -- so the key is present exactly on the objects this should fill.
 */
function isBevSummary(value: unknown): value is BevSummary {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && 'iconLabelBand' in row && 'photoStatus' in row && 'iconUrl' in row;
}

/**
 * Every `BevSummary` reachable from a method's result, whatever wraps it: a
 * bare summary, an array, a `Page`, a `FeedItem.bev`, a `Ranking.bev`, the
 * `Map` the snapshot cache returns. `seen` keeps a result that refers to the
 * same object twice -- or to itself -- from being walked twice.
 */
function collectSummaries(value: unknown, found: BevSummary[], seen: Set<object>): void {
  if (typeof value !== 'object' || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (isBevSummary(value)) {
    found.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSummaries(item, found, seen);
    return;
  }
  if (value instanceof Map) {
    for (const item of value.values()) collectSummaries(item, found, seen);
    return;
  }
  if (value instanceof Set) {
    for (const item of value) collectSummaries(item, found, seen);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectSummaries(item, found, seen);
  }
}

function chunk<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += MAX_IDS_PER_CALL) out.push(items.slice(i, i + MAX_IDS_PER_CALL));
  return out;
}

/**
 * Replaces `iconUrl` with the Bev's own generated icon, and sets
 * `iconLabelBand` so the caller can draw the wordmark across it.
 *
 * Only a COMPLETED generation counts. A Bev whose icon is pending, failed or
 * never eligible keeps whatever the RPC gave it, which is how its creator's
 * photograph goes on showing until the icon exists. `BevIcon.fallbackIconUrl`
 * is deliberately NOT used: a borrowed catalogue icon belongs to another
 * drink, and showing it in place of this Bev's photograph would be a downgrade.
 *
 * The summaries are mutated in place. They were built by the mappers inside
 * the call this decorates and have not been handed to anyone yet.
 *
 * Fails soft, by design: a failure here costs a nicer picture, never the
 * screen. An anonymous caller (the RPC raises `BEVI_UNAUTHORIZED`), a database
 * without 20261114000200, a transient error -- in each case the summaries keep
 * the authored icon or the photograph, which is what they showed before this
 * file existed. Nothing is applied unless every chunk answered.
 */
export async function applyGeneratedIcons(
  client: SupabaseClient,
  summaries: readonly BevSummary[],
): Promise<void> {
  const ids = [...new Set(summaries.map((summary) => summary.id))];
  if (ids.length === 0) return;

  const icons = new Map<string, BevIcon>();
  for (const ids_ of chunk(ids)) {
    const { data, error } = await client.rpc('get_bev_icons', { p_bev_ids: ids_ });
    if (error) return;
    for (const row of (data ?? []) as GeneratedBevIconRow[]) {
      const icon = mapBevIcon(client, row);
      if (icon.generatedIconUrl) icons.set(icon.bevId, icon);
    }
  }

  for (const summary of summaries) {
    const icon = icons.get(summary.id);
    if (!icon?.generatedIconUrl) continue;
    summary.iconUrl = icon.generatedIconUrl;
    summary.iconLabelBand = icon.labelBand;
  }
}

/**
 * The same `BeviApi`, with every async method's result passed through
 * `applyGeneratedIcons` first.
 *
 * A method whose result holds no summary costs one walk of its own return
 * value and no round trip. A synchronous method is returned untouched: none of
 * them answers with a Bev, and awaiting one here would change `meta` and the
 * auth listeners from sync to async.
 */
export function withGeneratedIcons(client: SupabaseClient, api: BeviApi): BeviApi {
  const wrapValue = (value: unknown): unknown => {
    if (typeof value === 'function') {
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown)(...args);
        if (!(result instanceof Promise)) return result;
        return result.then(async (resolved) => {
          const found: BevSummary[] = [];
          collectSummaries(resolved, found, new Set());
          if (found.length > 0) await applyGeneratedIcons(client, found);
          return resolved;
        });
      };
    }
    // A namespace (`api.bevs`, `api.feed`, ...): wrap its methods too. Depth
    // stops here because `BeviApi` is two levels deep by construction.
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
          key,
          typeof inner === 'function' ? wrapValue(inner) : inner,
        ]),
      );
    }
    return value;
  };

  // The entries are `BeviApi`'s own, each wrapped in a function of the same
  // shape, so the result satisfies the interface -- which `Object.fromEntries`
  // cannot express.
  return Object.fromEntries(
    Object.entries(api).map(([key, value]) => [key, wrapValue(value)]),
  ) as unknown as BeviApi;
}
