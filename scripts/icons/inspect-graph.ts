/** Read-only icon inventory. Does not apply schema, sync nodes, or read user properties.
 * node --env-file=supabase/.env --experimental-strip-types scripts/icons/inspect-graph.ts --out /tmp/bevi-icon-graph.json
 * node --experimental-strip-types scripts/icons/inspect-graph.ts --dry-run
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalogBevId, loadBevRows } from '../catalog/catalog.ts';

export const queries = {
  constraints: 'SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties RETURN name, type, labelsOrTypes, properties ORDER BY name',
  indexes: 'SHOW INDEXES YIELD name, type, state, labelsOrTypes, properties RETURN name, type, state, labelsOrTypes, properties ORDER BY name',
  labels: 'MATCH (n) RETURN labels(n) AS labels, count(*) AS count ORDER BY count DESC',
  relationships: 'MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY type',
  beverageProperties: 'MATCH (b:Bev) UNWIND keys(b) AS property RETURN DISTINCT property ORDER BY property',
  beverages: 'MATCH (b:Bev) RETURN b.id AS id, b.name AS name, b.brand AS brand, b.flavor AS flavor, b.categoryId AS categoryId, b.isAlcoholic AS isAlcoholic ORDER BY id',
  categories: 'MATCH (c:Category) OPTIONAL MATCH (c)-[:CHILD_OF]->(p:Category) RETURN c.id AS id, c.name AS name, collect(p.id) AS parentIds ORDER BY id',
  beverageCategories: 'MATCH (b:Bev)-[:IN_CATEGORY]->(c:Category) RETURN b.id AS bevId, collect(c.id) AS categoryIds ORDER BY bevId',
  meta: "MATCH (m:Meta {key: 'singleton'}) RETURN m.lastSyncAt AS lastSyncAt, m.lastKeepAliveAt AS lastKeepAliveAt",
} as const;

export function unpack(body: any): Record<string, any>[] {
  if (body.errors?.length) throw new Error(`Neo4j query failed: ${body.errors.map((e: any) => e.code ?? 'unknown error').join(', ')}`);
  if (body.counters?.containsUpdates || body.counters?.containsSystemUpdates) throw new Error('Unexpected write counters in inspection response');
  if (!Array.isArray(body.data?.fields) || !Array.isArray(body.data?.values)) throw new Error('Missing Neo4j result data');
  return body.data.values.map((row: any[]) => Object.fromEntries(body.data.fields.map((key: string, i: number) => [key, row[i]])));
}

export function reconcile(beverages: Record<string, any>[]) {
  const catalog = loadBevRows().map(row => ({ id: catalogBevId(row.slug), slug: row.slug }));
  const catalogIds = new Set(catalog.map(row => row.id));
  const ids = beverages.map(row => row.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
  const graphIds = new Set(ids);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  const duplicateIds = [...duplicates];
  return {
    catalogCount: catalog.length,
    graphBevCount: beverages.length,
    matchingIdCount: catalog.filter(row => graphIds.has(row.id)).length,
    catalogOnly: catalog.filter(row => !graphIds.has(row.id)),
    graphOnly: beverages.filter(row => typeof row.id === 'string' && !catalogIds.has(row.id)),
    missingIdCount: beverages.length - ids.length,
    duplicateIds,
    note: 'ID comparison only. Postgres live inventory and product/status conflicts still require reconciliation; CSV IDs may have been skipped by seed deduplication.',
  };
}

async function main() {
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ readOnly: true, queries }, null, 2));
    return;
  }
  const names = ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'NEO4J_DATABASE'];
  const missing = names.filter(name => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Fill ${missing.join(', ')} in supabase/.env, then run with --env-file=supabase/.env`);
  const outputIndex = process.argv.indexOf('--out');
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (!output || output.startsWith('--')) throw new Error('Provide --out <local-json-path>');
  const uri = new URL(process.env.NEO4J_URI!);
  if (!['neo4j+s:', 'bolt+s:', 'https:'].includes(uri.protocol) || uri.username || uri.password) throw new Error('Expected a secure Aura URI without embedded credentials');
  const endpoint = `https://${uri.hostname}/db/${encodeURIComponent(process.env.NEO4J_DATABASE!)}/query/v2`;
  const authorization = `Basic ${Buffer.from(`${process.env.NEO4J_USERNAME}:${process.env.NEO4J_PASSWORD}`).toString('base64')}`;
  const results: Record<string, Record<string, any>[]> = {};
  for (const [name, statement] of Object.entries(queries)) {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ statement, accessMode: 'Read', includeCounters: true }),
    });
    if (!response.ok) throw new Error(`Neo4j ${name}: HTTP ${response.status}`);
    results[name] = unpack(await response.json());
  }
  const comparison = reconcile(results.beverages!);
  const report = { observedAt: new Date().toISOString(), source: 'live-neo4j-read-only', ...results, reconciliation: comparison };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ output, observedAt: report.observedAt, labels: results.labels, relationships: results.relationships,
    graphBevCount: comparison.graphBevCount, matchingIdCount: comparison.matchingIdCount,
    catalogOnlyCount: comparison.catalogOnly.length, graphOnlyCount: comparison.graphOnly.length,
    missingIdCount: comparison.missingIdCount, duplicateIdCount: comparison.duplicateIds.length }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Graph inspection failed');
  process.exitCode = 1;
});
