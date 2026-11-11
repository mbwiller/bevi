/** Unweighted, undirected simple adjacency: parallel edges count once; loops ignored. */
export function centralities(nodes, edges) {
  const adjacency = new Map(nodes.map(n => [n.id, new Set()]));
  for (const e of edges) {
    if (e.source !== e.target && adjacency.has(e.source) && adjacency.has(e.target)) {
      adjacency.get(e.source).add(e.target); adjacency.get(e.target).add(e.source);
    }
  }
  const count = nodes.length;
  let rank = new Map(nodes.map(n => [n.id, 1 / count]));
  for (let iteration = 0; iteration < 100 && count; iteration++) {
    let dangling = 0;
    for (const [id, neighbors] of adjacency) if (!neighbors.size) dangling += rank.get(id);
    const next = new Map(nodes.map(n => [n.id, .15 / count + .85 * dangling / count]));
    for (const [id, neighbors] of adjacency) for (const other of neighbors) next.set(other, next.get(other) + .85 * rank.get(id) / neighbors.size);
    let delta = 0;
    for (const [id, value] of next) delta += Math.abs(value - rank.get(id));
    rank = next;
    if (delta < 1e-6) break;
  }
  return Object.fromEntries(nodes.map(n => [n.id, { degree: adjacency.get(n.id).size, pageRank: rank.get(n.id) }]));
}

export function networkView(snapshot, view, selected) {
  if (view === 'similarity') {
    const nodes = snapshot.nodes.filter(n => n.labels.includes('Bev'));
    const ids = new Set(nodes.map(n => n.id));
    return { nodes, edges: snapshot.edges.filter(e => e.type === 'SIMILAR_TO' && ids.has(e.source) && ids.has(e.target)) };
  }
  if (view === 'neighborhood') {
    const ids = new Set(selected ? [selected] : []);
    for (const e of snapshot.edges) if (e.source === selected || e.target === selected) { ids.add(e.source); ids.add(e.target); }
    return { nodes: snapshot.nodes.filter(n => ids.has(n.id)), edges: snapshot.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
  }
  return snapshot;
}
