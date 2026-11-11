/** Keep all structural edges and strongest similarity ties per endpoint. */
export function overviewEdges(edges, limit = 3) {
  const counts = new Map(), retained = new Set();
  for (const edge of [...edges].filter(e => e.type === 'SIMILAR_TO').sort((a,b) => Number(b.properties?.w ?? 0) - Number(a.properties?.w ?? 0) || a.id.localeCompare(b.id))) {
    for (const id of new Set([edge.source, edge.target])) {
      const count = counts.get(id) ?? 0;
      if (count < limit) retained.add(edge.id);
      counts.set(id, count + 1);
    }
  }
  return edges.filter(e => e.type !== 'SIMILAR_TO' || retained.has(e.id));
}
export function focusNetwork(edges, id) {
  const neighbors = new Set(id ? [id] : []);
  const incident = id ? edges.filter(e => e.source === id || e.target === id) : [];
  for (const e of incident) { neighbors.add(e.source); neighbors.add(e.target); }
  return { neighbors, edges: incident };
}
export function zoomAt(scale, offset, factor, x, y) {
  const next = Math.max(.03, Math.min(12, scale * factor)), ratio = next / scale;
  return { scale: next, offset: { x: x - (x - offset.x) * ratio, y: y - (y - offset.y) * ratio } };
}
