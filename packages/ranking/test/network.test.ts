import { describe, expect, it } from 'vitest';
import {
  communityHubs,
  graphStrength,
  LOUVAIN_RESOLUTION,
  LOUVAIN_TIE_EPSILON,
  louvainCommunities,
  modularity,
  PAGERANK_DAMPING,
  PAGERANK_MAX_ITERATIONS,
  PAGERANK_TOLERANCE,
  pageRank,
  participationCoefficient,
  RANKING_CONSTANTS,
  type WeightedGraph,
} from '../src/index.ts';

// Hand-built graphs with closed-form answers (LaTeX §10.9). d = 0.85 throughout unless stated.
// PageRank values are compared with the closed forms at 1e-9: the L1 step of iteration k is at most
// 2·d^k, so at the defaults the 1e-10 tolerance ends the iteration (k ≤ 147) before the cap of 200,
// even on a bipartite graph (the path, the star), where the iterates oscillate with factor d.

const E = (a: string, b: string, w = 1) => ({ a, b, w });
const d = PAGERANK_DAMPING;

const single: WeightedGraph = { nodes: ['a', 'b'], edges: [E('a', 'b', 0.7)] };
const path: WeightedGraph = { nodes: ['a', 'b', 'c'], edges: [E('a', 'b'), E('b', 'c')] };
const star: WeightedGraph = { nodes: ['z', 'l1', 'l2', 'l3', 'l4'], edges: ['l1', 'l2', 'l3', 'l4'].map((l) => E('z', l)) };
const triangle: WeightedGraph = { nodes: ['a', 'b', 'c'], edges: [E('a', 'b', 0.4), E('b', 'c', 0.4), E('c', 'a', 0.4)] };
const withIsolated: WeightedGraph = { nodes: ['a', 'b', 'z'], edges: [E('a', 'b', 0.5)] };

function clique(prefix: string): { nodes: string[]; edges: Array<{ a: string; b: string; w: number }> } {
  const nodes = [1, 2, 3, 4].map((i) => `${prefix}${i}`);
  const edges = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) edges.push(E(nodes[i] as string, nodes[j] as string));
  return { nodes, edges };
}
const A = clique('a');
const B = clique('b');
/** Two 4-cliques of weight 1 joined by one edge a4–b1 of weight 0.1. */
const twoCliques: WeightedGraph = { nodes: [...A.nodes, ...B.nodes], edges: [...A.edges, ...B.edges, E('a4', 'b1', 0.1)] };

/** Four triangles p, q, r, s in a ring: t3 — next1. */
const ring: WeightedGraph = (() => {
  const nodes: string[] = [];
  const edges: Array<{ a: string; b: string; w: number }> = [];
  for (const t of ['p', 'q', 'r', 's']) {
    nodes.push(`${t}1`, `${t}2`, `${t}3`);
    edges.push(E(`${t}1`, `${t}2`), E(`${t}2`, `${t}3`), E(`${t}1`, `${t}3`));
  }
  edges.push(E('p3', 'q1'), E('q3', 'r1'), E('r3', 's1'), E('s3', 'p1'));
  return { nodes, edges };
})();

const square = (wAB: number, wBC: number, wCD: number, wDA: number): WeightedGraph => ({
  nodes: ['a', 'b', 'c', 'd'],
  edges: [E('a', 'b', wAB), E('b', 'c', wBC), E('c', 'd', wCD), E('d', 'a', wDA)],
});

const empty: WeightedGraph = { nodes: [], edges: [] };

describe('constants', () => {
  it('are the textbook values and ride in RANKING_CONSTANTS', () => {
    expect([PAGERANK_DAMPING, PAGERANK_TOLERANCE, PAGERANK_MAX_ITERATIONS]).toEqual([0.85, 1e-10, 200]);
    expect([LOUVAIN_RESOLUTION, LOUVAIN_TIE_EPSILON]).toEqual([1, 1e-12]);
    expect(RANKING_CONSTANTS).toMatchObject({ pagerankDamping: 0.85, pagerankTolerance: 1e-10, pagerankMaxIterations: 200, louvainResolution: 1, louvainTieEpsilon: 1e-12 });
  });
});

describe('graphStrength', () => {
  it('counts neighbours and sums incident weight', () => {
    expect(graphStrength(twoCliques)).toMatchObject({ a1: { degree: 3, strength: 3 }, a4: { degree: 4, strength: 3.1 }, b1: { degree: 4, strength: 3.1 } });
    expect(graphStrength(withIsolated)).toEqual({ a: { degree: 1, strength: 0.5 }, b: { degree: 1, strength: 0.5 }, z: { degree: 0, strength: 0 } });
    expect(graphStrength(empty)).toEqual({});
  });
});

describe('pageRank', () => {
  it('a single edge: 0.5 / 0.5 whatever its weight', () => {
    expect(pageRank(single)).toEqual({ a: 0.5, b: 0.5 });
  });

  it('a 3-node path: centre 18/37, ends (1 − 18/37)/2 = 19/74 each', () => {
    // x = (1 − d)/3 + d·y/2, y = (1 − d)/3 + d·2x, 2x + y = 1  ⇒  x = 0.475 / 1.85 = 19/74.
    const p = pageRank(path);
    expect(p.a).toBeCloseTo((1 - 18 / 37) / 2, 9);
    expect(p.a).toBeCloseTo(19 / 74, 9);
    expect(p.c).toBe(p.a);
    expect(p.b).toBeCloseTo(18 / 37, 9);
    expect(p.b as number).toBeGreaterThan(p.a as number);
  });

  it('a star with 4 leaves: hub 88/185, each leaf (1 − 88/185)/4', () => {
    // h = (1 − d)/5 + d·4x and h + 4x = 1  ⇒  h = (0.03 + 0.85) / 1.85.
    const p = pageRank(star);
    expect(p.z).toBeCloseTo(88 / 185, 9);
    for (const l of ['l1', 'l2', 'l3', 'l4']) expect(p[l]).toBeCloseTo((1 - 88 / 185) / 4, 9);
  });

  it('a triangle is uniform, exactly', () => {
    expect(pageRank(triangle)).toEqual({ a: 1 / 3, b: 1 / 3, c: 1 / 3 });
  });

  it('an isolated node keeps (1 − d)/(n − d): the teleport share plus its own redistributed mass', () => {
    // p_z = (1 − d)/n + d·p_z/n  ⇒  p_z = (1 − d)/(n − d) = 0.15/2.15 = 3/43; the other two share the rest.
    const p = pageRank(withIsolated);
    // The iteration stops once the L1 step is below 1e-10, so the values are within ~1e-11.
    expect(p.z).toBeCloseTo((1 - d) / (3 - d), 9);
    expect(p.z).toBeCloseTo(3 / 43, 9);
    expect(p.a).toBeCloseTo(20 / 43, 9);
    expect(p.b).toBe(p.a);
    expect(p.z as number).toBeGreaterThan((1 - d) / 3);
  });

  it('two cliques: the bridge endpoints rank above the interior nodes', () => {
    const p = pageRank(twoCliques);
    expect(p.a4).toBeCloseTo(0.127729024, 8);
    expect(p.a1).toBeCloseTo(0.124090325, 8);
    expect(p.b1).toBeCloseTo(p.a4 as number, 12);
    expect(p.a4 as number).toBeGreaterThan(p.a1 as number);
  });

  it('weights change the answer: on a path weighted 1 and 0.1 the heavy end outranks the light end', () => {
    const p = pageRank({ nodes: ['a', 'b', 'c'], edges: [E('a', 'b', 1), E('b', 'c', 0.1)] });
    expect(p.a as number).toBeGreaterThan(p.c as number);
    expect(pageRank(path).a).toBe(pageRank(path).c);
  });

  it('at the defaults the tolerance, not the cap, ends the iteration, even on bipartite graphs', () => {
    // If the cap of 200 bound, a larger cap would change the vector; it does not, to the bit.
    for (const g of [path, star, twoCliques, ring]) {
      expect(pageRank(g, { maxIterations: 1000 })).toEqual(pageRank(g));
      expect(pageRank(g, { maxIterations: PAGERANK_MAX_ITERATIONS })).toEqual(pageRank(g));
    }
  });

  it('an explicit small maxIterations caps deterministically, short of the fixed point', () => {
    const capped = pageRank(path, { maxIterations: 10 });
    expect(pageRank(path, { maxIterations: 10 })).toEqual(capped);
    // After 10 steps the bipartite oscillation is still about 2·0.85^10 ≈ 0.4 times its start: visibly off.
    expect(Math.abs((capped.b as number) - 18 / 37)).toBeGreaterThan(1e-3);
    expect(pageRank(path, { maxIterations: 11 }).b).not.toBe(capped.b);
  });

  it('damping 0 gives the uniform vector; maxIterations 1 stops after one step', () => {
    expect(pageRank(star, { damping: 0 })).toEqual({ z: 0.2, l1: 0.2, l2: 0.2, l3: 0.2, l4: 0.2 });
    // One step from uniform: h = 0.03 + 0.85·4·(0.2·1/1) = 0.71, leaves 0.03 + 0.85·0.2/4 = 0.0725.
    const one = pageRank(star, { maxIterations: 1 });
    expect(one.z).toBeCloseTo(0.71, 12);
    expect(one.l1).toBeCloseTo(0.0725, 12);
  });

  it('the empty graph and a graph without edges', () => {
    expect(pageRank(empty)).toEqual({});
    expect(pageRank({ nodes: ['x', 'y'], edges: [] })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('validates its options', () => {
    expect(() => pageRank(path, { damping: 1 })).toThrow(RangeError);
    expect(() => pageRank(path, { damping: -0.1 })).toThrow(RangeError);
    expect(() => pageRank(path, { damping: Number.NaN })).toThrow(RangeError);
    expect(() => pageRank(path, { tolerance: 0 })).toThrow(RangeError);
    expect(() => pageRank(path, { maxIterations: 0 })).toThrow(RangeError);
    expect(() => pageRank(path, { maxIterations: 1.5 })).toThrow(RangeError);
  });
});

describe('modularity', () => {
  it('two cliques split in two: 12/12.1 − 1/2', () => {
    const split = { a1: 0, a2: 0, a3: 0, a4: 0, b1: 1, b2: 1, b3: 1, b4: 1 };
    expect(modularity(twoCliques, split)).toBeCloseTo(12 / 12.1 - 0.5, 14);
  });

  it('one community is 0; all singletons are −Σ(s_i/2m)²', () => {
    expect(modularity(path, { a: 0, b: 0, c: 0 })).toBeCloseTo(0, 15);
    expect(modularity(path, { a: 0, b: 1, c: 2 })).toBeCloseTo(-(1 + 4 + 1) / 16, 15);
  });

  it('resolution scales the null-model term', () => {
    const split = { a1: 0, a2: 0, a3: 0, a4: 0, b1: 1, b2: 1, b3: 1, b4: 1 };
    expect(modularity(twoCliques, split, 2)).toBeCloseTo(12 / 12.1 - 1, 14);
    expect(modularity(twoCliques, split, 0)).toBeCloseTo(12 / 12.1, 14);
  });

  it('labels are any integers, extra keys are ignored, and m = 0 gives 0', () => {
    expect(modularity(path, { a: -7, b: -7, c: 40, zz: 3 })).toBeCloseTo(modularity(path, { a: 0, b: 0, c: 1 }), 15);
    expect(modularity({ nodes: ['x', 'y'], edges: [] }, { x: 0, y: 1 })).toBe(0);
    expect(modularity(empty, {})).toBe(0);
  });

  it('throws on a node without a community, a non-integer label or a bad resolution', () => {
    expect(() => modularity(path, { a: 0, b: 0 })).toThrow(/no community/);
    expect(() => modularity(path, { a: 0, b: 0, c: 0.5 })).toThrow(RangeError);
    expect(() => modularity(path, { a: 0, b: 0, c: 0 }, -1)).toThrow(RangeError);
  });
});

describe('louvainCommunities', () => {
  it('two cliques joined by a weak edge: exactly the two cliques', () => {
    const r = louvainCommunities(twoCliques);
    expect(r.communities).toEqual([
      ['a1', 'a2', 'a3', 'a4'],
      ['b1', 'b2', 'b3', 'b4'],
    ]);
    expect(r.communityOf).toEqual({ a1: 0, a2: 0, a3: 0, a4: 0, b1: 1, b2: 1, b3: 1, b4: 1 });
    expect(r.modularity).toBeCloseTo(12 / 12.1 - 0.5, 14);
  });

  it('a ring of four triangles: four communities, Q = 4·(3/16 − (8/32)²) = 0.5', () => {
    const r = louvainCommunities(ring);
    expect(r.communities).toEqual([
      ['p1', 'p2', 'p3'],
      ['q1', 'q2', 'q3'],
      ['r1', 'r2', 'r3'],
      ['s1', 's2', 's3'],
    ]);
    expect(r.modularity).toBeCloseTo(0.5, 14);
  });

  it('weights change the answer: a square pairs along its heavy edges', () => {
    // Unweighted, a joins b first (b precedes d) and the tie with all-in-one keeps the pairs.
    expect(louvainCommunities(square(1, 1, 1, 1)).communities).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const r = louvainCommunities(square(0.1, 1, 0.1, 1));
    expect(r.communities).toEqual([
      ['a', 'd'],
      ['b', 'c'],
    ]);
    // W = 2 of m = 2.2, each side strength 2.2: Q = 2/2.2 − 2·(1/2)².
    expect(r.modularity).toBeCloseTo(2 / 2.2 - 0.5, 14);
  });

  it('a path, a star and a triangle are one community (Q = 0 beats every split)', () => {
    for (const g of [path, star, triangle, single]) {
      const r = louvainCommunities(g);
      expect(r.communities.length).toBe(1);
      expect(r.modularity).toBeCloseTo(0, 15);
    }
  });

  it('isolated nodes are singletons, listed after larger communities and by id', () => {
    const r = louvainCommunities({ nodes: ['z', 'y', 'b', 'a'], edges: [E('a', 'b')] });
    expect(r.communities).toEqual([['a', 'b'], ['y'], ['z']]);
    expect(r.communityOf).toEqual({ a: 0, b: 0, y: 1, z: 2 });
  });

  it('a graph without edges is all singletons with modularity 0; the empty graph is empty', () => {
    expect(louvainCommunities({ nodes: ['y', 'x'], edges: [] })).toEqual({ communities: [['x'], ['y']], communityOf: { x: 0, y: 1 }, modularity: 0 });
    expect(louvainCommunities(empty)).toEqual({ communities: [], communityOf: {}, modularity: 0 });
  });

  it('a higher resolution splits the two cliques further; resolution 0 merges each component', () => {
    const fine = louvainCommunities(twoCliques, { resolution: 3 });
    expect(fine.communities.length).toBeGreaterThan(2);
    const coarse = louvainCommunities({ nodes: [...twoCliques.nodes, 'x', 'y'], edges: [...twoCliques.edges, E('x', 'y')] }, { resolution: 0 });
    expect(coarse.communities).toEqual([[...A.nodes, ...B.nodes], ['x', 'y']]);
    expect(() => louvainCommunities(path, { resolution: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe('participationCoefficient', () => {
  it('two cliques: only the bridge endpoints are non-zero, 1 − (3/3.1)² − (0.1/3.1)²', () => {
    const { communityOf } = louvainCommunities(twoCliques);
    const p = participationCoefficient(twoCliques, communityOf);
    const bridge = 1 - (3 / 3.1) ** 2 - (0.1 / 3.1) ** 2;
    expect(p.a4).toBeCloseTo(bridge, 14);
    expect(p.b1).toBeCloseTo(bridge, 14);
    for (const id of ['a1', 'a2', 'a3', 'b2', 'b3', 'b4']) expect(p[id]).toBe(0);
  });

  it('ring of triangles: each connector 1 − (2/3)² − (1/3)² = 4/9, each middle node 0', () => {
    const { communityOf } = louvainCommunities(ring);
    const p = participationCoefficient(ring, communityOf);
    expect(p.p1).toBeCloseTo(4 / 9, 14);
    expect(p.p3).toBeCloseTo(4 / 9, 14);
    expect(p.p2).toBe(0);
  });

  it('an even split over k communities is 1 − 1/k; an isolated node is 0', () => {
    const g: WeightedGraph = { nodes: ['h', 'x', 'y', 'z', 'q'], edges: [E('h', 'x', 0.3), E('h', 'y', 0.3), E('h', 'z', 0.3)] };
    const p = participationCoefficient(g, { h: 0, x: 1, y: 2, z: 3, q: 4 });
    expect(p.h).toBeCloseTo(2 / 3, 14);
    expect(p.q).toBe(0);
    expect(p.x).toBe(0);
  });

  it('weights change the answer', () => {
    const labels = { a: 0, b: 0, c: 1, d: 1 };
    expect(participationCoefficient(square(1, 1, 1, 1), labels).a).toBeCloseTo(0.5, 14);
    expect(participationCoefficient(square(1, 1, 1, 0.1), labels).a).toBeCloseTo(1 - (1 / 1.1) ** 2 - (0.1 / 1.1) ** 2, 14);
  });

  it('throws on a node without a community', () => {
    expect(() => participationCoefficient(path, { a: 0, b: 0 })).toThrow(/no community/);
  });
});

describe('communityHubs', () => {
  it('two cliques: every member has within-strength 3, so the smallest id wins in each', () => {
    const { communityOf } = louvainCommunities(twoCliques);
    expect(communityHubs(twoCliques, communityOf)).toEqual({ 0: 'a1', 1: 'b1' });
  });

  it('the greatest within-community strength wins even with a larger id; the cross edge does not count', () => {
    expect(communityHubs(star, { z: 0, l1: 0, l2: 0, l3: 0, l4: 0 })).toEqual({ 0: 'z' });
    // In {a, b, c} a has within 0.5 + 0.2, b 0.5 + 0.6, c 0.2 + 0.6; b's heavy edge to d is cross-community.
    const g: WeightedGraph = { nodes: ['a', 'b', 'c', 'd'], edges: [E('a', 'b', 0.5), E('a', 'c', 0.2), E('b', 'c', 0.6), E('b', 'd', 0.9)] };
    expect(communityHubs(g, { a: 0, b: 0, c: 0, d: 1 })).toEqual({ 0: 'b', 1: 'd' });
    expect(communityHubs(g, { a: 0, b: 0, c: 1, d: 1 })).toEqual({ 0: 'a', 1: 'c' });
  });

  it('a singleton is its own hub, keyed by its label; the empty graph has none', () => {
    expect(communityHubs(withIsolated, { a: 3, b: 3, z: 9 })).toEqual({ 3: 'a', 9: 'z' });
    expect(communityHubs(empty, {})).toEqual({});
  });
});

describe('validation (every function)', () => {
  const bad: Array<[string, WeightedGraph, RegExp]> = [
    ['a duplicate node id', { nodes: ['a', 'b', 'a'], edges: [] }, /duplicate node/],
    ['an empty-string id', { nodes: ['a', ''], edges: [] }, /non-empty/],
    ['an endpoint not in nodes', { nodes: ['a', 'b'], edges: [E('a', 'c')] }, /not a node/],
    ['a self-loop', { nodes: ['a', 'b'], edges: [E('a', 'a')] }, /self-loop/],
    ['a duplicate pair, same orientation', { nodes: ['a', 'b'], edges: [E('a', 'b'), E('a', 'b', 0.5)] }, /duplicate edge/],
    ['a duplicate pair, flipped', { nodes: ['a', 'b'], edges: [E('a', 'b'), E('b', 'a')] }, /duplicate edge/],
    ['a NaN weight', { nodes: ['a', 'b'], edges: [E('a', 'b', Number.NaN)] }, /finite/],
    ['an infinite weight', { nodes: ['a', 'b'], edges: [E('a', 'b', Number.POSITIVE_INFINITY)] }, /finite/],
    ['a zero weight', { nodes: ['a', 'b'], edges: [E('a', 'b', 0)] }, /> 0/],
    ['a negative weight', { nodes: ['a', 'b'], edges: [E('a', 'b', -0.2)] }, /> 0/],
  ];
  const fns: Array<[string, (g: WeightedGraph) => unknown]> = [
    ['graphStrength', (g) => graphStrength(g)],
    ['pageRank', (g) => pageRank(g)],
    ['modularity', (g) => modularity(g, Object.fromEntries(g.nodes.map((n) => [n, 0])))],
    ['louvainCommunities', (g) => louvainCommunities(g)],
    ['participationCoefficient', (g) => participationCoefficient(g, Object.fromEntries(g.nodes.map((n) => [n, 0])))],
    ['communityHubs', (g) => communityHubs(g, Object.fromEntries(g.nodes.map((n) => [n, 0])))],
  ];
  for (const [what, g, msg] of bad) {
    it(`throws a RangeError on ${what}`, () => {
      for (const [, f] of fns) expect(() => f(g)).toThrow(RangeError);
      for (const [, f] of fns) expect(() => f(g)).toThrow(msg);
    });
  }

  it('throws a TypeError on a non-string id or a non-number weight', () => {
    const nonString = { nodes: ['a', 1], edges: [] } as unknown as WeightedGraph;
    const nonNumber = { nodes: ['a', 'b'], edges: [{ a: 'a', b: 'b', w: '1' }] } as unknown as WeightedGraph;
    for (const [, f] of fns) {
      expect(() => f(nonString)).toThrow(TypeError);
      expect(() => f(nonNumber)).toThrow(TypeError);
    }
  });

  it('accepts ids that are Object.prototype keys', () => {
    const g: WeightedGraph = { nodes: ['__proto__', 'constructor'], edges: [E('__proto__', 'constructor')] };
    const r = louvainCommunities(g);
    expect(Object.keys(r.communityOf).sort()).toEqual(['__proto__', 'constructor']);
    expect(Object.keys(pageRank(g)).sort()).toEqual(['__proto__', 'constructor']);
    expect(participationCoefficient(g, r.communityOf)).toEqual(Object.fromEntries([['__proto__', 0], ['constructor', 0]]));
  });
});
