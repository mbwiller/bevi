// graph-query: read-only, on-demand exploration of the Bev graph (A-15).
//
// This is NOT on any hot path. The ranking flow, recommendations and Bev
// detail read `bev_edges` in Postgres, which the nightly sync (A-16) writes.
// This function exists for "Bevs similar to X" style queries that want the
// graph directly, and it degrades to an error -- never to wrong data -- when
// the Aura instance is paused.
//
// Security: JWT-verified (config.toml sets verify_jwt = true, the default), and
// the client can only name a template. There is no path by which caller input
// reaches Cypher as text: every template is a fixed string, and every value is
// bound as a named parameter. Do not add a template that interpolates.

const TEMPLATES = {
  // Nearest neighbours by the nightly SIMILAR_TO weight. Read undirected: the
  // sync only ever writes the src.id < dst.id direction (schema.cypher).
  similar: `
    MATCH (b:Bev { id: $bevId })-[s:SIMILAR_TO]-(other:Bev)
    RETURN other.id AS id, other.name AS name, other.brand AS brand,
           s.w AS weight, s.tree AS tree, s.content AS content,
           s.emb AS emb, s.profile AS profile
    ORDER BY s.w DESC
    LIMIT $limit
  `,
  // The Bev's own node, for checking what the sync actually wrote.
  bev: `
    MATCH (b:Bev { id: $bevId })
    OPTIONAL MATCH (b)-[:IN_CATEGORY]->(c:Category)
    OPTIONAL MATCH (b)-[:BY_BRAND]->(br:Brand)
    RETURN b.id AS id, b.name AS name, b.brand AS brand,
           c.id AS categoryId, br.key AS brandKey
  `,
  // When the sync last ran. The app has no use for this; it is here so a
  // human can check liveness without the Aura console.
  meta: `
    MATCH (m:Meta { key: 'singleton' })
    RETURN m.lastSyncAt AS lastSyncAt
  `,
} as const;

type TemplateName = keyof typeof TEMPLATES;

const MAX_LIMIT = 50;

interface RequestBody {
  template?: string;
  bevId?: string;
  limit?: number;
}

function queryApiUrl(uri: string, database: string): string {
  const host = uri.replace(/^[a-z+]+:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
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
  if (name === "similar" || name === "bev") {
    if (!isUuid(body.bevId)) return json({ error: "invalid_bev_id" }, 400);
    parameters.bevId = body.bevId;
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
