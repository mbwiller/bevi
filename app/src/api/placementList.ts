// What the ranking flow searches (M-21, anchored placement, LaTeX §10.1): the bucket's ordered ids
// and, when the catalog can say what kind each Bev is, a tier per id for `startPlacement`. The tiers
// are a heuristic layered on the plain search, so every extra read degrades instead of failing:
//
//   rankings.listBucketBevs fails → rankings.listBucket (today's path), no tiers.
//   bevs.leaves fails             → no tiers: exactly the plain binary search.
//   bevs.similarities fails, or is slower than SIMILARITIES_TIMEOUT_MS → taxonomy tiers only.
//
// Only a failure of the list itself (both list reads) reaches the caller, as before M-21.
// Nothing here is cached across placements: the list must be fresh to avoid a `conflict`.

import { placementTiers, type PlacementTier } from '@bevi/ranking';
import type { BeviApi, Bev, Bucket } from '@bevi/shared';

export interface PlacementList {
  /** The bucket, best first: `listBucket`'s ids (it may still contain the Bev on a re-rank). */
  orderedIds: string[];
  /** One tier per entry of `orderedIds` (`placementTiers`), or absent for the plain search. */
  tiers?: PlacementTier[];
}

/** How long the first question may wait for `bevs.similarities` before going on without edges. */
export const SIMILARITIES_TIMEOUT_MS = 800;

/** `bevs.leaves` and `bevs.similarities` take at most 500 ids per call. */
const BULK_MAX = 500;

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += BULK_MAX) out.push(xs.slice(i, i + BULK_MAX));
  return out;
}

/** The leaf per id; an id the server omitted (not visible, not active) has none. */
async function fetchLeaves(api: BeviApi, ids: readonly string[]): Promise<Map<string, string | null>> {
  const rows = (await Promise.all(chunks(ids).map((c) => api.bevs.leaves(c)))).flat();
  return new Map(rows.map((r) => [r.bevId, r.leafCategoryId]));
}

/** Stored edge weights from `bevId` to `others`, or undefined if they fail or don't arrive in time. */
function fetchWeights(api: BeviApi, bevId: string, others: readonly string[], timeoutMs: number): Promise<Map<string, number> | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  const weights = Promise.all(chunks(others).map((c) => api.bevs.similarities(bevId, c)))
    .then((parts) => new Map(parts.flat().map((s) => [s.bevId, s.weight])))
    .catch(() => undefined);
  return Promise.race([weights, late]).finally(() => clearTimeout(timer));
}

export async function loadPlacementList(
  api: BeviApi,
  bucket: Bucket,
  bev: Pick<Bev, 'id' | 'categoryId'>,
  options: { similaritiesTimeoutMs?: number } = {},
): Promise<PlacementList> {
  let rows;
  try {
    rows = await api.rankings.listBucketBevs(bucket);
  } catch {
    return { orderedIds: await api.rankings.listBucket(bucket) };
  }
  const orderedIds = rows.map((r) => r.id);
  const others = orderedIds.filter((id) => id !== bev.id);
  if (others.length === 0) return { orderedIds };

  // In parallel with the leaves: the weights only refine tier 3, so they hold the first question up by
  // at most SIMILARITIES_TIMEOUT_MS beyond the leaves round-trip, and a failure or timeout means no weights.
  const weightsP = fetchWeights(api, bev.id, others, options.similaritiesTimeoutMs ?? SIMILARITIES_TIMEOUT_MS);
  let leaves: Map<string, string | null>;
  try {
    leaves = await fetchLeaves(api, [bev.id, ...others]);
  } catch {
    return { orderedIds };
  }
  const weights = await weightsP;
  const leaf = (id: string) => leaves.get(id) ?? null;
  const tiers = placementTiers(
    { categoryId: bev.categoryId, leafCategoryId: leaf(bev.id) },
    rows.map((r) => ({ id: r.id, categoryId: r.categoryId, leafCategoryId: leaf(r.id) })),
    weights,
  );
  return { orderedIds, tiers };
}
