// embed: computes the `gte-small` embedding of one or more Bevs and upserts it
// into `public.bev_embeddings` (A-16 (1), step 2 of TASKS.md's "Steps" list,
// decision 30).
//
// NEO4J IS NOT INVOLVED. This half of the pipeline is Postgres-only: it reads
// `bevs` and writes `bev_embeddings`, both in Supabase. Copying the vector onto
// `(:Bev).embedding` is the sync job's business, not this function's, so
// nothing here needs the Aura instance that has never been reachable.
//
// Callers, and only these two:
//   1. the `bevs` trigger from 20261023000100_embed_webhook.sql, one id per
//      fired row, over pg_net;
//   2. `scripts/graph/backfill-embeddings.ts`, run by a maintainer, in batches
//      of at most MAX_BATCH.
//
// ---------------------------------------------------------------------------
// AUTHORISATION: verify_jwt is OFF (config.toml), and this function checks a
// shared secret itself. The reasoning, because "off" reads like the weaker
// choice and is not:
//
//   * verify_jwt = true would NOT keep an anonymous caller out. It only proves
//     the request carries a key the project issued, and the publishable key is
//     shipped in every copy of the app -- graph-query's own header comment
//     says exactly that ("any holder of the publishable key passes
//     verify_jwt"). graph-query can live with it because it is read-only. This
//     function writes as the service role and runs model inference per call,
//     so "anyone who installed the app" is precisely the wrong audience.
//   * Neither real caller holds a user JWT anyway: pg_net sends whatever header
//     the trigger builds, and the backfill runs as the service role. So
//     verify_jwt buys nothing even for the legitimate traffic.
//   * The gate is therefore a shared secret compared here, in code a reviewer
//     can read, rather than a gateway setting that happens to accept a public
//     key: a request must present EMBED_WEBHOOK_SECRET -- or, when that is
//     unset, the service-role key -- as `Authorization: Bearer <token>`. Both
//     are credentials the app never sees. Everything else gets 401 before any
//     row is read and before the model is loaded, so an anonymous caller on
//     the public internet cannot make this function do any work.
//   * With no secret configured at all it refuses every request (500) rather
//     than falling open.
// ---------------------------------------------------------------------------
//
// Secrets come from the environment only -- never a literal in this repo.
// Edge Functions get SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY injected;
// EMBED_WEBHOOK_SECRET is optional and set with `supabase secrets set`.
//
// Deno conventions follow graph-query: no remote imports (`deno.json` has an
// empty import map) and plain `fetch` against PostgREST rather than
// @supabase/supabase-js, so CI's `deno check` type-checks this file without
// resolving a single module off the network.

import { DIMENSIONS, embeddingText, MAX_BATCH, MODEL } from "./text.ts";

// `Supabase.ai` exists only in the deployed Edge Runtime -- it is not in
// Deno's lib and there is no module to import it from. graph-query needed no
// such declaration (it uses only `fetch` and `Deno.env`), so this is the
// repo's first.
//
// It is typed as an optional property of `globalThis` rather than declared as
// a bare `const`, which does two things a `declare const Supabase` or a
// `@ts-ignore` would not: `deno check` type-checks the call site against the
// real shape, AND reading it cannot throw where the runtime does not provide
// it (a bare undeclared identifier is a ReferenceError, and optional chaining
// does not save you from that -- a property lookup on globalThis just gives
// undefined). The "not deployed" case then becomes the 503 below.
interface SupabaseAiSession {
  run(
    input: string,
    options: { mean_pool: boolean; normalize: boolean },
  ): Promise<number[]>;
}

interface SupabaseAi {
  Session: new (model: string) => SupabaseAiSession;
}

function supabaseAi(): SupabaseAi | undefined {
  return (globalThis as { Supabase?: { ai?: SupabaseAi } }).Supabase?.ai;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  /** The canonical form: one or more Bev ids. */
  bevIds?: unknown;
  /** Convenience for a single id. */
  bevId?: unknown;
  /** Accepted so a stock Supabase database-webhook payload also works. */
  record?: { id?: unknown } | null;
}

interface BevRow {
  id: string;
  brand: string | null;
  name: string;
  flavor: string | null;
  category_id: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Constant-time comparison, so a wrong token leaks nothing by how long it took. */
function tokensMatch(presented: string, expected: string): boolean {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function bearer(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function collectIds(body: RequestBody): { ids: string[]; invalid: boolean } {
  const raw: unknown[] = Array.isArray(body.bevIds)
    ? body.bevIds
    : body.bevIds !== undefined
    ? [body.bevIds]
    : body.bevId !== undefined
    ? [body.bevId]
    : body.record && typeof body.record === "object"
    ? [body.record.id]
    : [];

  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !UUID_RE.test(value)) return { ids: [], invalid: true };
    const id = value.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid: false };
}

/**
 * pgvector's documented text input form. A JSON array of numbers also casts,
 * but this is the representation the type itself defines, so there is no
 * question of how PostgREST chose to render the value.
 */
function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Configuration first: a missing key is a loud 500, never a quiet success
  // and never an open door.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // `||`, not `??`: a blank EMBED_WEBHOOK_SECRET counts as absent, the same
  // way the trigger's `nullif(..., '')` and the backfill script treat a blank
  // value. Copying supabase/.env.example verbatim must not leave the door
  // open to the empty-string token.
  const webhookSecret = Deno.env.get("EMBED_WEBHOOK_SECRET") || serviceRoleKey;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "embed is misconfigured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected into " +
        "every deployed Edge Function and must both be present (locally: supabase/.env). " +
        "Refusing to run.",
    );
    return json({ error: "service_role_key_missing" }, 500);
  }
  if (!webhookSecret) {
    console.error(
      "embed is misconfigured: no EMBED_WEBHOOK_SECRET and no service-role key to fall back " +
        "on, so no caller could be authorised. Refusing to run.",
    );
    return json({ error: "embed_secret_missing" }, 500);
  }

  const token = bearer(req) ?? req.headers.get("x-embed-token");
  if (!token || !tokensMatch(token, webhookSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { ids, invalid } = collectIds(body);
  if (invalid) return json({ error: "invalid_bev_id" }, 400);
  if (ids.length === 0) {
    return json({ error: "no_bev_ids", hint: "send { \"bevIds\": [uuid, ...] }" }, 400);
  }
  if (ids.length > MAX_BATCH) {
    return json({ error: "batch_too_large", maxBatch: MAX_BATCH, received: ids.length }, 413);
  }

  const rest = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`;
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  // Read the Bevs. The service role bypasses RLS, which is the point: the
  // trigger fires on INSERT, when a user-created Bev is still `pending_photo`
  // and no `authenticated` policy would show it. `merged` rows are skipped --
  // their node and edges are being removed, not embedded (A-12).
  let rows: BevRow[];
  try {
    const response = await fetch(
      `${rest}/bevs?select=id,brand,name,flavor,category_id&id=in.(${ids.join(",")})&status=neq.merged`,
      { headers },
    );
    if (!response.ok) {
      console.error(`embed: reading bevs failed with ${response.status}: ${await response.text()}`);
      return json({ error: "read_failed", status: response.status }, 502);
    }
    rows = (await response.json()) as BevRow[];
  } catch (error) {
    console.error(`embed: reading bevs threw: ${error instanceof Error ? error.message : String(error)}`);
    return json({ error: "read_failed" }, 502);
  }

  // Ids the query did not return: either no such Bev, or a `merged` one. Named
  // in the response so a backfill run or a webhook log says which, rather than
  // reporting a count that silently disagrees with what was asked for. Not an
  // error: a Bev deleted between the trigger firing and this call is normal.
  const skipped = ids.filter((id) => !rows.some((row) => row.id.toLowerCase() === id));
  if (rows.length === 0) return json({ embedded: 0, model: MODEL, skipped }, 200);

  const ai = supabaseAi();
  if (!ai) {
    // Only the Edge Runtime provides `Supabase.ai`. Say so, rather than
    // crashing with something that reads like a bug in this file.
    console.error("embed: Supabase.ai is unavailable; this function only works on the Supabase Edge Runtime.");
    return json({ error: "ai_unavailable" }, 503);
  }

  // Mean-pooled and normalised, so the stored vectors are unit-norm and cosine
  // distance -- the HNSW index's operator class, and the metric §10.1 and
  // `embeddingSimilarity` in @bevi/ranking are written in -- is the right one.
  const session = new ai.Session(MODEL);
  const computedAt = new Date().toISOString();
  const payload: Array<{
    bev_id: string;
    embedding: string;
    model: string;
    computed_at: string;
  }> = [];

  for (const row of rows) {
    const text = embeddingText(row);
    let vector: number[];
    try {
      vector = await session.run(text, { mean_pool: true, normalize: true });
    } catch (error) {
      console.error(`embed: inference failed for ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      return json({ error: "inference_failed", bevId: row.id }, 500);
    }
    if (!Array.isArray(vector) || vector.length !== DIMENSIONS) {
      const got = Array.isArray(vector) ? `${vector.length} values` : typeof vector;
      console.error(`embed: ${MODEL} returned ${got}, expected ${DIMENSIONS}`);
      return json({ error: "bad_dimensions", expected: DIMENSIONS }, 500);
    }
    payload.push({
      bev_id: row.id,
      embedding: vectorLiteral(vector),
      model: MODEL,
      // Sent explicitly: the column default only fires on INSERT, and this is
      // an upsert whose UPDATE arm would otherwise keep the old timestamp --
      // and `computed_at` is the column the sync's "new or changed Bevs"
      // filter compares against `bevs.updated_at`.
      computed_at: computedAt,
    });
  }

  try {
    const response = await fetch(`${rest}/bev_embeddings?on_conflict=bev_id`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(`embed: upsert failed with ${response.status}: ${await response.text()}`);
      return json({ error: "write_failed", status: response.status }, 502);
    }
  } catch (error) {
    console.error(`embed: upsert threw: ${error instanceof Error ? error.message : String(error)}`);
    return json({ error: "write_failed" }, 502);
  }

  return json({ embedded: payload.length, model: MODEL, dimensions: DIMENSIONS, skipped }, 200);
});
