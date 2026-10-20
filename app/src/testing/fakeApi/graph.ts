// The FakeApi's stand-in for `bev_edges` (20261019000500), the Bev-graph mirror in Postgres.
// TEST-ONLY (src/testing/**).
//
// On the server the nightly graph sync builds this: it weights candidate pairs with `edgeWeight()`
// from @bevi/ranking and keeps each Bev's top `EDGE_TOP_K` above `EDGE_MIN_WEIGHT` (`topEdges()`).
// This file does exactly that over the fake's Bevs, importing both functions -- no weight formula is
// written here, and `packages/ranking/` is not touched.
//
// The four components of eq. (18), and where each one comes from:
//
//   tree     `treeSimilarity(catA, catB, {})`. The taxonomy is `{}` because today's 15 categories
//            are flat; `categories.parent_id` arrives with A-13, and when it does this is the one
//            line that changes.
//   content  `contentSimilarity(a, b)` over `BevFeatures` built from the Bev row. Only the catalog
//            half of `BevFeatures` matters (category, brand key, flavour tokens, price tier), so
//            the stats fields are zero and the mirror does not depend on the rankings table -- the
//            same reason the real `bev_edges` only changes when a Bev or a flavour profile does.
//   profile  `profileSimilarity(a, b)` over `data/catalog/flavor-profiles.csv` (A-17). A Bev with
//            no profile row -- any Bev a test creates -- contributes 0 for this term, which is what
//            the sync will do until D-11's inference fills it in.
//   emb      0. The fixtures carry no `gte-small` vectors and nothing in this repo can produce one
//            without an Edge Function call, so the embedding term is simply absent. Its weight is
//            0.30, so every weight here is up to 0.30 lower than production's; the ORDER is still
//            `edgeWeight`'s, which is what the app reads these for.
//
// Pair storage mirrors the SQL: one entry per unordered pair. A pair is kept when EITHER Bev's
// top-K kept it, which is what `get_similar_bevs` sees when it reads both of `bev_edges`'
// orientations.

import {
  EDGE_MIN_WEIGHT,
  contentSimilarity,
  edgeWeight,
  flavorTokens,
  normaliseBrand,
  profileSimilarity,
  topEdges,
  treeSimilarity,
  type BevFeatures,
  type EdgeCandidate,
  type Taxonomy,
} from '@bevi/ranking';
import type { CategoryId } from '@bevi/shared';

import { CATALOG_FLAVOR_PROFILES } from './catalog';
import type { FakeBev } from './db';

/** Today's categories are flat: every one is top-level, so `treeSimilarity` is "same category". */
const FLAT_TAXONOMY: Taxonomy = {};

/**
 * One unordered pair, canonically keyed, exactly as `src_bev_id < dst_bev_id` does in SQL. '|' is a
 * safe separator: a fake Bev id is either a catalog slug (lowercase, digits, '-') or `bev-<n>`.
 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function featuresOf(b: FakeBev, isAlcoholic: boolean): BevFeatures {
  return {
    id: b.id,
    categoryId: b.categoryId,
    brandKey: normaliseBrand(b.brand),
    flavorTokens: flavorTokens(b.name, b.flavor),
    priceTier: b.priceTier,
    // contentSimilarity reads none of these three; they are here because BevFeatures requires them.
    ratingCount: 0,
    mean: 0,
    stddev: 0,
    isAlcoholic,
  };
}

export interface EdgeMirror {
  /** The pair's weight, or null when the mirror has no row for it -- the common case. */
  weightOf(a: string, b: string): number | null;
  /** Every stored neighbour of `bevId`, heaviest first, ties by ascending id (as `topEdges` does). */
  neighboursOf(bevId: string): readonly EdgeCandidate[];
}

/**
 * Builds the mirror for one set of Bevs. O(n²) over the catalog (378 Bevs is 71k pairs, a few tens
 * of milliseconds), so the caller caches it and rebuilds only when a Bev is added.
 */
export function buildEdgeMirror(bevs: readonly FakeBev[], alcoholic: ReadonlySet<CategoryId>): EdgeMirror {
  const features = new Map(bevs.map((b) => [b.id, featuresOf(b, alcoholic.has(b.categoryId))]));
  const candidates = new Map<string, EdgeCandidate[]>();

  const add = (id: string, other: string, w: number) => {
    const list = candidates.get(id);
    if (list) list.push({ bevId: other, w });
    else candidates.set(id, [{ bevId: other, w }]);
  };

  for (let i = 0; i < bevs.length; i++) {
    const a = bevs[i] as FakeBev;
    const fa = features.get(a.id) as BevFeatures;
    const pa = CATALOG_FLAVOR_PROFILES.get(a.id);
    for (let j = i + 1; j < bevs.length; j++) {
      const b = bevs[j] as FakeBev;
      const fb = features.get(b.id) as BevFeatures;
      const pb = CATALOG_FLAVOR_PROFILES.get(b.id);
      const w = edgeWeight({
        tree: treeSimilarity(a.categoryId, b.categoryId, FLAT_TAXONOMY),
        content: contentSimilarity(fa, fb),
        emb: 0,
        profile: pa && pb ? profileSimilarity(pa, pb) : 0,
      });
      // topEdges applies the same floor; dropping the pair here just keeps the candidate lists
      // from holding all 377 of every Bev's non-neighbours.
      if (w < EDGE_MIN_WEIGHT) continue;
      add(a.id, b.id, w);
      add(b.id, a.id, w);
    }
  }

  // The top-K cut, per Bev, then back to a pair set: a pair survives if either end kept it.
  const kept = new Set<string>();
  for (const [id, list] of candidates) {
    for (const e of topEdges(list)) kept.add(pairKey(id, e.bevId));
  }

  const stored = new Map<string, number>();
  const adjacency = new Map<string, EdgeCandidate[]>();
  for (const [id, list] of candidates) {
    const mine = list.filter((e) => kept.has(pairKey(id, e.bevId)));
    // Same order as get_similar_bevs: weight desc, then the neighbour id ascending.
    mine.sort((x, y) => y.w - x.w || (x.bevId < y.bevId ? -1 : x.bevId > y.bevId ? 1 : 0));
    adjacency.set(id, mine);
    for (const e of mine) stored.set(pairKey(id, e.bevId), e.w);
  }

  return {
    weightOf: (a, b) => stored.get(pairKey(a, b)) ?? null,
    neighboursOf: (bevId) => adjacency.get(bevId) ?? [],
  };
}
