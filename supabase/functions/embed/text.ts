// The embedded text template and the constants that go with it (A-16 (1),
// decision 30). Separate from index.ts for one reason: index.ts calls
// `Deno.serve` at module scope, so a test that imports it starts a server.
// This file is pure, so `test.ts` can check the template without one.

/** The model decision 30 fixes, and the value stored in `bev_embeddings.model`. */
export const MODEL = "gte-small";

/** `bev_embeddings.embedding` is `extensions.vector(384)`; a mismatch is a bug. */
export const DIMENSIONS = 384;

// The batch bound. TASKS.md A-16: "The Edge Function's 2s CPU budget covers
// one Bev; the batch work stays in the nightly job." The trigger sends one.
// The backfill sends more, so the bound is not 1 -- but it is small, because
// every id in a request shares that one CPU budget and a request that times
// out mid-batch wastes the whole batch. 16 at a time, and a larger request is
// rejected with the bound in the body rather than silently truncated.
export const MAX_BATCH = 16;

/** The columns of `bevs` the template reads, and nothing else. */
export interface EmbeddableBev {
  brand: string | null;
  name: string;
  flavor: string | null;
  category_id: string;
}

/**
 * THE EMBEDDED TEXT, in the order decision 30 writes it: "brand name flavour
 * category".
 *
 *     `${brand} ${name} ${flavor} ${category}`
 *
 * with
 *   * a missing or blank part omitted entirely (no empty slot, no
 *     placeholder), because `brand` and `flavor` are nullable in `bevs`;
 *   * `category` being `bevs.category_id` -- the slug, which is what the
 *     column holds -- with `_` and `-` turned into spaces, so
 *     `sparkling_water` embeds as the two words `sparkling water` rather than
 *     one token the model has never seen;
 *   * runs of whitespace collapsed to one space, and the whole thing trimmed.
 *
 * This function is the single definition of that template. Change it and every
 * stored vector is stale: re-run `npm run graph:backfill-embeddings -- --all`.
 */
export function embeddingText(bev: EmbeddableBev): string {
  const category = bev.category_id.replace(/[_-]+/g, " ");
  return [bev.brand, bev.name, bev.flavor, category]
    .map((part) => (typeof part === "string" ? part : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
