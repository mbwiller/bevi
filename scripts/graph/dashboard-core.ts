import type { Neo4jClient } from './neo4j.ts';

// One statement observes nodes and edges together. No caller-supplied Cypher.
// Project properties individually so embedding vectors never cross the wire.
export const SNAPSHOT_QUERY = `
CALL () {
  MATCH (n)
  RETURN collect({id: elementId(n), labels: labels(n),
    keys: [k IN keys(n) WHERE k <> 'embedding' AND k <> 'pseudonym'],
    values: [k IN keys(n) WHERE k <> 'embedding' AND k <> 'pseudonym' | n[k]]}) AS nodes
}
CALL () {
  MATCH (a)-[r]->(b)
  RETURN collect({id: elementId(r), source: elementId(a), target: elementId(b),
    type: type(r), properties: properties(r)}) AS edges
}
RETURN nodes, edges`;
export interface GraphNode { id: string; labels: string[]; name: string; properties: Record<string, unknown> }
export interface GraphEdge { id: string; source: string; target: string; type: string; properties: Record<string, unknown> }
export interface Snapshot { nodes: GraphNode[]; edges: GraphEdge[]; meta: GraphNode[]; fetchedAt: string }
export async function readSnapshot(client: Pick<Neo4jClient, 'query'>): Promise<Snapshot> {
  const rows = await client.query(SNAPSHOT_QUERY);
  const row = rows[0];
  if (!row || !Array.isArray(row.nodes) || !Array.isArray(row.edges)) throw new Error('Invalid graph snapshot');
  const all: GraphNode[] = row.nodes.map((n: { id: string; labels: string[]; keys: string[]; values: unknown[] }) => {
    const properties = Object.fromEntries(n.keys.map((key, i) => [key, n.values[i]]));
    const name = n.labels.includes('User') ? `User ${n.id.split(':').at(-1)}` : String(properties.name ?? properties.token ?? properties.key ?? properties.id ?? n.labels[0] ?? n.id);
    return { id: n.id, labels: n.labels, name, properties };
  });
  const nodes = all.filter(n => !n.labels.includes('Meta'));
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, edges: (row.edges as GraphEdge[]).filter(e => ids.has(e.source) && ids.has(e.target)), meta: all.filter(n => n.labels.includes('Meta')), fetchedAt: new Date().toISOString() };
}
