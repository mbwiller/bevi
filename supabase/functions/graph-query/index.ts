// graph-query: read-only, on-demand exploration of the Bev graph (A-15).
//
// This is NOT on any hot path. The ranking flow, recommendations and Bev
// detail read `bev_edges` in Postgres, which the nightly `graph-edges` job
// writes; `graph-sync` then mirrors that table into the graph this reads.
// This function exists for "Bevs similar to X" style queries that want the
// graph directly, and it degrades to an error -- never to wrong data -- when
// the Aura instance is paused.
//
// Security: JWT-verified (config.toml sets verify_jwt = true, the default), and
// the client can only name a template. There is no path by which caller input
// reaches Cypher as text: every template is a fixed string, and every value is
// bound as a named parameter. Do not add a template that interpolates.
//
// Age gate: Postgres hides alcoholic Bevs from anyone not verified 21+ (the
// `bevs` select policy and `viewer_is_adult()`). This function runs as no user
// and any holder of the publishable key passes verify_jwt, so it cannot apply
// that check -- it fails closed instead and never returns an alcoholic Bev. A
// node without `isAlcoholic` counts as alcoholic, so a sync that forgets the
// property hides Bevs rather than leaking them. Serving adults the full graph
// means checking `viewer_is_adult()` with the caller's JWT first.

const TEMPLATES = {
  // Nearest neighbours by the nightly SIMILAR_TO weight. Read undirected: the
  // sync only ever writes the src.id < dst.id direction (schema.cypher).
  similar: `
    MATCH (b:Bev { id: $bevId })-[s:SIMILAR_TO]-(other:Bev)
    WHERE coalesce(b.isAlcoholic, true) = false
      AND coalesce(other.isAlcoholic, true) = false
    RETURN other.id AS id, other.name AS name, other.brand AS brand,
           s.w AS weight, s.tree AS tree, s.content AS content,
           s.emb AS emb, s.profile AS profile, s.cop AS cop
    ORDER BY s.w DESC
    LIMIT $limit
  `,
  // The Bev's own node, for checking what the sync actually wrote.
  // `categoryId` is the ROOT category and comes from the property: since the
  // sync (scripts/graph/sync.ts) IN_CATEGORY targets the Bev's LEAF when it has
  // one, so the relationship no longer answers "which of the 15".
  // `pagerank`, `community` and `bridge` are the graph signals the sync
  // computes inside its transaction (scripts/graph/analytics-core.ts).
  // `community` is an opaque id, never a Bev id: compare it for equality only.
  bev: `
    MATCH (b:Bev { id: $bevId })
    WHERE coalesce(b.isAlcoholic, true) = false
    OPTIONAL MATCH (b)-[:BY_BRAND]->(br:Brand)
    RETURN b.id AS id, b.name AS name, b.brand AS brand,
           b.categoryId AS categoryId, b.leafCategoryId AS leafCategoryId,
           br.key AS brandKey,
           b.pagerank AS pagerank, b.community AS community, b.bridge AS bridge
  `,
  // Why two Bevs are near each other: the attribute nodes they both hang from
  // (brand, flavour base, shared name/flavour tokens, the same category node),
  // plus the stored SIMILAR_TO weight when the pair has an edge. One row per
  // shared attribute; a visible pair that shares nothing is one row with a
  // null kind. The age gate is on BOTH Bevs: an alcoholic or unknown Bev on
  // either side returns no rows at all, exactly as if it did not exist.
  why: `
    MATCH (a:Bev { id: $bevId })
    MATCH (b:Bev { id: $otherId })
    WHERE coalesce(a.isAlcoholic, true) = false
      AND coalesce(b.isAlcoholic, true) = false
    OPTIONAL MATCH (a)-[s:SIMILAR_TO]-(b)
    WITH a, b, max(s.w) AS weight
    OPTIONAL MATCH (a)-[:BY_BRAND|TASTES_OF|HAS_NOTE|IN_CATEGORY]->(x)<-[:BY_BRAND|TASTES_OF|HAS_NOTE|IN_CATEGORY]-(b)
    WHERE x:Brand OR x:Flavor OR x:Note OR x:Category
    RETURN labels(x)[0] AS kind,
           coalesce(x.name, x.key, x.token, x.id) AS value,
           weight
    ORDER BY kind, value
  `,
  // When the sync last ran. The app has no use for this; it is here so a
  // human can check liveness without the Aura console.
  meta: `
    MATCH (m:Meta { key: 'singleton' })
    RETURN m.lastSyncAt AS lastSyncAt, m.lastKeepAliveAt AS lastKeepAliveAt
  `,
} as const;

type TemplateName = keyof typeof TEMPLATES;

const MAX_LIMIT = 50;

interface RequestBody {
  template?: string;
  bevId?: string;
  otherId?: string;
  limit?: number;
}

function queryApiUrl(uri: string, database: string): string {
  const host = uri.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  return `https://${host}/db/${database}/query/v2`;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const name = body.template;
  if (typeof name !== "string" || !Object.hasOwn(TEMPLATES, name)) {
    return json({ error: "unknown_template", allowed: Object.keys(TEMPLATES) }, 400);
  }
  const statement = TEMPLATES[name as TemplateName];

  const parameters: Record<string, unknown> = {};
  if (name === "similar" || name === "bev" || name === "why") {
    if (!isUuid(body.bevId)) return json({ error: "invalid_bev_id" }, 400);
    parameters.bevId = body.bevId;
  }
  if (name === "why") {
    // The second Bev is validated exactly as the first, and bound the same way.
    if (!isUuid(body.otherId)) return json({ error: "invalid_bev_id" }, 400);
    parameters.otherId = body.otherId;
  }
  if (name === "similar") {
    const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.trunc(body.limit) : 10;
    parameters.limit = Math.min(Math.max(limit, 1), MAX_LIMIT);
  }

  const uri = Deno.env.get("NEO4J_URI");
  const username = Deno.env.get("NEO4J_USERNAME");
  const password = Deno.env.get("NEO4J_PASSWORD");
  const database = Deno.env.get("NEO4J_DATABASE") ?? "neo4j";
  if (!uri || !username || !password) {
    return json({ error: "graph_not_configured" }, 503);
  }

  let upstream: Response;
  try {
    upstream = await fetch(queryApiUrl(uri, database), {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${username}:${password}`)}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ statement, parameters }),
    });
  } catch {
    // Most likely the instance is paused. Resuming is manual (docs/graph.md).
    return json({ error: "graph_unreachable" }, 503);
  }

  if (!upstream.ok) return json({ error: "graph_error", status: upstream.status }, 502);

  const result = (await upstream.json()) as {
    data?: { fields?: string[]; values?: unknown[][] };
    errors?: unknown[];
  };
  if (result.errors?.length) return json({ error: "graph_error" }, 502);

  const fields = result.data?.fields ?? [];
  const rows = (result.data?.values ?? []).map((values) =>
    Object.fromEntries(fields.map((field, i) => [field, values[i]]))
  );
  return json({ rows }, 200);
});
