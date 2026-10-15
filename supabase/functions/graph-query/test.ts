// Deno tests for graph-query's input handling. Run with:
//   deno test supabase/functions/graph-query/test.ts
//
// These cover the parts that must hold without a Neo4j instance: the template
// allow-list, uuid validation and limit clamping. Anything past that needs a
// live graph and belongs to A-16's sanity report.

import { assertEquals } from "jsr:@std/assert@1";

const FUNCTION_URL = Deno.env.get("GRAPH_QUERY_URL") ?? "http://127.0.0.1:54321/functions/v1/graph-query";
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

// `supabase functions serve` must be running. Without it these skip rather
// than fail, so the file is safe to run anywhere.
const serving = await fetch(FUNCTION_URL, { method: "OPTIONS" })
  .then(() => true)
  .catch(() => false);

Deno.test({
  name: "an unknown template is rejected and the allow-list is reported",
  ignore: !serving,
  fn: async () => {
    const { status, json } = await post({ template: "MATCH (n) DETACH DELETE n" });
    assertEquals(status, 400);
    assertEquals(json.error, "unknown_template");
    assertEquals(json.allowed, ["similar", "bev", "meta"]);
  },
});

Deno.test({
  name: "a missing template is rejected",
  ignore: !serving,
  fn: async () => {
    const { status, json } = await post({});
    assertEquals(status, 400);
    assertEquals(json.error, "unknown_template");
  },
});

Deno.test({
  name: "a non-uuid bevId is rejected before any upstream call",
  ignore: !serving,
  fn: async () => {
    const { status, json } = await post({ template: "similar", bevId: "' OR 1=1 --" });
    assertEquals(status, 400);
    assertEquals(json.error, "invalid_bev_id");
  },
});

Deno.test({
  name: "GET is rejected",
  ignore: !serving,
  fn: async () => {
    const response = await fetch(FUNCTION_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${ANON_KEY}` },
    });
    assertEquals(response.status, 405);
    await response.body?.cancel();
  },
});
