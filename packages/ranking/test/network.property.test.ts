import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  communityHubs,
  compareCodePoints,
  graphStrength,
  louvainCommunities,
  modularity,
  mulberry32,
  pageRank,
  participationCoefficient,
  randomInt,
  type WeightedGraph,
} from '../src/index.ts';

// Small random graphs (≤ 12 nodes) with weights on a 0.05 grid, so exact ties happen (unit-weight
// cliques, symmetric shapes) and the tie rules are exercised. Ids include one astral character and
// one from U+E000–U+FFFF, which order differently by code point and by UTF-16 code unit.
const POOL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'aa', 'B', '\u{1F600}', 'Ｃ'];

const graphArb: fc.Arbitrary<WeightedGraph> = fc
  .integer({ min: 0, max: POOL.length })
  .chain((n) => {
    const nodes = POOL.slice(0, n);
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    return fc.tuple(
      fc.constant(nodes),
      fc.array(fc.option(fc.integer({ min: 1, max: 20 }), { nil: null, freq: 2 }), { minLength: pairs.length, maxLength: pairs.length }),
      fc.constant(pairs),
    );
  })
  .map(([nodes, ws, pairs]) => ({
    nodes,
    edges: pairs.flatMap(([i, j], k) => (ws[k] == null ? [] : [{ a: nodes[i] as string, b: nodes[j] as string, w: (ws[k] as number) / 20 }])),
  }));

function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rand, i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The same graph with nodes and edges shuffled and every edge's a and b flipped. */
const scramble = (g: WeightedGraph, seed: number): WeightedGraph => ({
  nodes: shuffle(g.nodes, seed),
  edges: shuffle(g.edges, seed + 1).map((e) => ({ a: e.b, b: e.a, w: e.w })),
});

const scale = (g: WeightedGraph, k: number): WeightedGraph => ({ nodes: g.nodes, edges: g.edges.map((e) => ({ ...e, w: e.w * k })) });
const singletons = (g: WeightedGraph) => Object.fromEntries(g.nodes.map((id, i) => [id, i]));
const closeRecord = (a: Record<string, number>, b: Record<string, number>, tol: number) => {
  expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(a)) expect(Math.abs((a[k] as number) - (b[k] as number))).toBeLessThanOrEqual(tol);
};
const scaleArb = fc.constantFrom(0.01, 0.37, 2, 7.3, 1000);

describe('pageRank properties', () => {
  it('is non-negative and sums to 1 within 1e-9', () => {
    fc.assert(
      fc.property(graphArb, (g) => {
        const p = pageRank(g);
        const vals = Object.values(p);
        expect(vals.length).toBe(g.nodes.length);
        for (const v of vals) expect(v).toBeGreaterThanOrEqual(0);
        if (vals.length > 0) expect(Math.abs(vals.reduce((s, v) => s + v, 0) - 1)).toBeLessThanOrEqual(1e-9);
      }),
    );
  });

  it('at the defaults the tolerance ends the iteration: a cap of 1000 gives the identical vector', () => {
    fc.assert(
      fc.property(graphArb, (g) => {
        expect(pageRank(g, { maxIterations: 1000 })).toEqual(pageRank(g));
      }),
    );
  });

  it('automorphic nodes get equal PageRank: the two ends of a path, the leaves of a star', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 1, max: 20 }), (n, k) => {
        const ids = POOL.slice(0, n);
        const w = k / 20;
        const path = pageRank({ nodes: ids, edges: ids.slice(1).map((id, i) => ({ a: ids[i] as string, b: id, w })) });
        expect(Math.abs((path[ids[0] as string] as number) - (path[ids[n - 1] as string] as number))).toBeLessThanOrEqual(1e-12);
        const star = pageRank({ nodes: ids, edges: ids.slice(1).map((id) => ({ a: ids[0] as string, b: id, w })) });
        for (const id of ids.slice(2)) expect(Math.abs((star[id] as number) - (star[ids[1] as string] as number))).toBeLessThanOrEqual(1e-12);
      }),
    );
  });
});

describe('louvainCommunities properties', () => {
  it('returns a partition, communityOf agrees with communities, and the order rule holds', () => {
    fc.assert(
      fc.property(graphArb, (g) => {
        const r = louvainCommunities(g);
        const seen = r.communities.flat();
        expect([...seen].sort()).toEqual([...g.nodes].sort());
        expect(new Set(seen).size).toBe(seen.length);
        r.communities.forEach((members, c) => {
          expect(members.length).toBeGreaterThan(0);
          for (const id of members) expect(r.communityOf[id]).toBe(c);
          for (let i = 1; i < members.length; i++) expect(compareCodePoints(members[i - 1] as string, members[i] as string)).toBe(-1);
          const prev = r.communities[c - 1];
          if (prev) expect(prev.length > members.length || (prev.length === members.length && compareCodePoints(prev[0] as string, members[0] as string) < 0)).toBe(true);
        });
        expect(Object.keys(r.communityOf).length).toBe(g.nodes.length);
      }),
    );
  });

  it('modularity is ≥ all-singletons − 1e-12, ≤ 1, and equals modularity(graph, communityOf)', () => {
    fc.assert(
      fc.property(graphArb, (g) => {
        const r = louvainCommunities(g);
        expect(r.modularity).toBeGreaterThanOrEqual(modularity(g, singletons(g)) - 1e-12);
        expect(r.modularity).toBeLessThanOrEqual(1);
        expect(r.modularity).toBe(modularity(g, r.communityOf));
      }),
    );
  });
});

describe('participationCoefficient properties', () => {
  it('is in [0, 1), and exactly 0 for a node whose neighbours all share its community', () => {
    const labelsArb = graphArb.chain((g) => fc.tuple(fc.constant(g), fc.array(fc.integer({ min: 0, max: 3 }), { minLength: g.nodes.length, maxLength: g.nodes.length })));
    fc.assert(
      fc.property(labelsArb, ([g, ls]) => {
        const communityOf = Object.fromEntries(g.nodes.map((id, i) => [id, ls[i] as number]));
        const p = participationCoefficient(g, communityOf);
        const nbrs = new Map<string, string[]>(g.nodes.map((id) => [id, []]));
        for (const e of g.edges) {
          nbrs.get(e.a)?.push(e.b);
          nbrs.get(e.b)?.push(e.a);
        }
        for (const id of g.nodes) {
          const v = p[id] as number;
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
          if ((nbrs.get(id) as string[]).every((j) => communityOf[j] === communityOf[id])) expect(v).toBe(0);
        }
      }),
    );
  });

  it('is 0 everywhere when the whole graph is one community', () => {
    fc.assert(
      fc.property(graphArb, (g) => {
        for (const v of Object.values(participationCoefficient(g, Object.fromEntries(g.nodes.map((id) => [id, 0]))))) expect(v).toBe(0);
      }),
    );
  });
});

describe('communityHubs properties', () => {
  it('returns one member of each community, with the greatest within-community strength', () => {
    fc.assert(
      fc.property(graphArb, (g) => {
        const r = louvainCommunities(g);
        const hubs = communityHubs(g, r.communityOf);
        expect(Object.keys(hubs).length).toBe(r.communities.length);
        r.communities.forEach((members, c) => {
          const hub = hubs[c] as string;
          expect(members).toContain(hub);
          const within = (id: string) => g.edges.filter((e) => (e.a === id && r.communityOf[e.b] === c) || (e.b === id && r.communityOf[e.a] === c)).reduce((s, e) => s + e.w, 0);
          for (const m of members) expect(within(m)).toBeLessThanOrEqual(within(hub) + 1e-12);
        });
      }),
    );
  });
});

describe('invariance (all six functions)', () => {
  it('shuffling nodes and edges and flipping every edge changes nothing, exactly', () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (g, seed) => {
        const h = scramble(g, seed);
        expect(graphStrength(h)).toEqual(graphStrength(g));
        expect(pageRank(h)).toEqual(pageRank(g));
        const r = louvainCommunities(g);
        expect(louvainCommunities(h)).toEqual(r);
        expect(modularity(h, r.communityOf)).toBe(r.modularity);
        expect(participationCoefficient(h, r.communityOf)).toEqual(participationCoefficient(g, r.communityOf));
        expect(communityHubs(h, r.communityOf)).toEqual(communityHubs(g, r.communityOf));
      }),
    );
  });

  it('scaling every weight leaves PageRank, the partition, modularity and participation unchanged (1e-9)', () => {
    fc.assert(
      fc.property(graphArb, scaleArb, (g, k) => {
        const s = scale(g, k);
        closeRecord(pageRank(s), pageRank(g), 1e-9);
        const r = louvainCommunities(g);
        const rs = louvainCommunities(s);
        expect(rs.communities).toEqual(r.communities);
        expect(Math.abs(rs.modularity - r.modularity)).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(modularity(s, r.communityOf) - r.modularity)).toBeLessThanOrEqual(1e-9);
        closeRecord(participationCoefficient(s, r.communityOf), participationCoefficient(g, r.communityOf), 1e-9);
      }),
    );
  });
});
