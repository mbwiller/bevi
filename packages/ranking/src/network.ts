// Graph signals of the Bev similarity graph (LaTeX §10.9): centrality (weighted PageRank),
// communities (Louvain modularity clustering) and bridges (the participation coefficient). The
// nightly graph sync calls these over `bev_edges` and stores the result per Bev; nothing here does
// I/O, and nothing in 1.7.0 reads the result on a prediction path.
//
// Determinism. Every function validates the graph with one rule set, then works over the nodes in
// `compareCodePoints` order (Unicode code point, SQL `collate "C"`) with each node's neighbours in
// that order too, so a result depends on neither the order of `nodes` and `edges` nor the
// orientation of an edge. Every per-node sum (strength, PageRank's in-flow, a node's weight into a
// community) runs over its neighbours in that order; every sum over nodes runs in node order.

import {
  LOUVAIN_RESOLUTION,
  LOUVAIN_TIE_EPSILON,
  PAGERANK_DAMPING,
  PAGERANK_MAX_ITERATIONS,
  PAGERANK_TOLERANCE,
} from './constants.ts';
import { compareCodePoints as cmp } from './bayesian.ts';

/** An undirected weighted graph. Node ids are opaque strings (Bev ids in practice). */
export interface WeightedGraph {
  nodes: readonly string[];
  edges: ReadonlyArray<{ a: string; b: string; w: number }>;
}

export interface PageRankOptions {
  /** d in [0, 1); default PAGERANK_DAMPING = 0.85. */
  damping?: number;
  /** Stop once Σ|p′ − p| < tolerance; > 0; default PAGERANK_TOLERANCE = 1e-10. */
  tolerance?: number;
  /** A positive integer; default PAGERANK_MAX_ITERATIONS = 100. */
  maxIterations?: number;
}

export interface LouvainOptions {
  /** γ ≥ 0; default LOUVAIN_RESOLUTION = 1. */
  resolution?: number;
}

export interface LouvainResult {
  /** Member lists sorted by code point; the lists by size desc, then first member asc. */
  communities: string[][];
  /** Node id → index of its community in `communities`. */
  communityOf: Record<string, number>;
  /** `modularity(graph, communityOf, resolution)`. */
  modularity: number;
}

/**
 * Safety rail, not a formula input: Louvain local-move passes per level before it throws. Each move
 * raises modularity by more than LOUVAIN_TIE_EPSILON, so the loop terminates; real graphs settle in
 * a handful of passes. Reaching this means a bug, and throwing beats spinning in a nightly job.
 */
const LOUVAIN_MAX_PASSES = 10_000;

/** The validated graph: nodes sorted, adjacency by node index, neighbours ascending. */
interface Prepared {
  ids: string[];
  index: Map<string, number>;
  nbr: number[][];
  wts: number[][];
  /** s_i = Σ_j w_ij over neighbours in order. */
  strength: number[];
  /** m = (Σ_i s_i) / 2, the total edge weight. */
  m: number;
}

function prepare(graph: WeightedGraph): Prepared {
  if (graph === null || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError('graph must be { nodes: string[], edges: { a, b, w }[] }');
  }
  for (const id of graph.nodes) {
    if (typeof id !== 'string') throw new TypeError(`node ids must be strings, got ${typeof id}`);
    if (id === '') throw new RangeError('node ids must be non-empty');
  }
  const ids = [...graph.nodes].sort(cmp);
  const index = new Map<string, number>();
  ids.forEach((id, i) => {
    if (index.has(id)) throw new RangeError(`duplicate node "${id}"`);
    index.set(id, i);
  });
  const adj: Array<Map<number, number>> = ids.map(() => new Map());
  for (const e of graph.edges) {
    if (e === null || typeof e !== 'object') throw new TypeError('edges must be { a, b, w } objects');
    if (typeof e.a !== 'string' || typeof e.b !== 'string') throw new TypeError('edge endpoints must be strings');
    if (typeof e.w !== 'number') throw new TypeError(`weight of {${e.a}, ${e.b}} must be a number`);
    const i = index.get(e.a);
    const j = index.get(e.b);
    if (i === undefined) throw new RangeError(`edge endpoint "${e.a}" is not a node`);
    if (j === undefined) throw new RangeError(`edge endpoint "${e.b}" is not a node`);
    if (i === j) throw new RangeError(`self-loop on "${e.a}"`);
    if (!Number.isFinite(e.w)) throw new RangeError(`weight of {${e.a}, ${e.b}} must be finite, got ${e.w}`);
    if (e.w <= 0) throw new RangeError(`weight of {${e.a}, ${e.b}} must be > 0, got ${e.w}`);
    const ai = adj[i] as Map<number, number>;
    if (ai.has(j)) throw new RangeError(`duplicate edge {${e.a}, ${e.b}}`);
    ai.set(j, e.w);
    (adj[j] as Map<number, number>).set(i, e.w);
  }
  const nbr: number[][] = [];
  const wts: number[][] = [];
  const strength: number[] = [];
  let total = 0;
  for (const a of adj) {
    const js = [...a.keys()].sort((x, y) => x - y);
    const ws = js.map((j) => a.get(j) as number);
    let s = 0;
    for (const w of ws) s += w;
    nbr.push(js);
    wts.push(ws);
    strength.push(s);
    total += s;
  }
  return { ids, index, nbr, wts, strength, m: total / 2 };
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Each node's community label, by node index. Throws if a node has none or a label is not an integer. */
function labels(g: Prepared, communityOf: Readonly<Record<string, number>>): number[] {
  if (communityOf === null || typeof communityOf !== 'object') throw new TypeError('communityOf must be an object');
  return g.ids.map((id) => {
    if (!has(communityOf, id)) throw new RangeError(`node "${id}" has no community`);
    const c = communityOf[id];
    if (typeof c !== 'number' || !Number.isInteger(c)) throw new RangeError(`community of "${id}" must be an integer, got ${String(c)}`);
    return c;
  });
}

function resolutionOf(r: number | undefined): number {
  const gamma = r ?? LOUVAIN_RESOLUTION;
  if (!(Number.isFinite(gamma) && gamma >= 0)) throw new RangeError(`resolution must be a finite number >= 0, got ${gamma}`);
  return gamma;
}

// ---------------------------------------------------------------- strength

/**
 * Each node's degree (neighbour count) and strength s_i = Σ_j w_ij, the weighted degree, summed over
 * its neighbours in code-point order. An isolated node has { degree: 0, strength: 0 }.
 */
export function graphStrength(graph: WeightedGraph): Record<string, { degree: number; strength: number }> {
  const g = prepare(graph);
  return Object.fromEntries(g.ids.map((id, i) => [id, { degree: (g.nbr[i] as number[]).length, strength: g.strength[i] as number }]));
}

// ---------------------------------------------------------------- PageRank

/**
 * Weighted PageRank by power iteration on the random walk P_ij = w_ij / s_i.
 *
 * Start p_j = 1/n. Each iteration, for j in node order,
 *   p′_j = (1 − d)/n + d · (Σ_{i ~ j} p_i · w_ij / s_i + D/n),
 * the sum over j's neighbours i in node order, evaluated as `acc += p_i * w_ij / s_i` (left to right),
 * and D = Σ p_i over the isolated nodes (s_i = 0) in node order: their mass is spread uniformly,
 * including back to themselves. Stop when Σ_j |p′_j − p_j| (node order) is below `tolerance`, or
 * after `maxIterations` iterations. The result is the last p′ divided by its own sum (node order),
 * so it sums to 1 up to rounding. An empty graph gives {}.
 *
 * In exact arithmetic the iteration preserves Σp = 1 and contracts the error by at least d per step.
 */
export function pageRank(graph: WeightedGraph, opts: PageRankOptions = {}): Record<string, number> {
  const d = opts.damping ?? PAGERANK_DAMPING;
  const tolerance = opts.tolerance ?? PAGERANK_TOLERANCE;
  const maxIterations = opts.maxIterations ?? PAGERANK_MAX_ITERATIONS;
  if (!(d >= 0 && d < 1)) throw new RangeError(`damping must be in [0, 1), got ${d}`);
  if (!(tolerance > 0)) throw new RangeError(`tolerance must be > 0, got ${tolerance}`);
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw new RangeError(`maxIterations must be a positive integer, got ${maxIterations}`);
  const g = prepare(graph);
  const n = g.ids.length;
  if (n === 0) return {};
  let p: number[] = new Array<number>(n).fill(1 / n);
  const base = (1 - d) / n;
  for (let it = 0; it < maxIterations; it++) {
    let dangling = 0;
    for (let i = 0; i < n; i++) if ((g.strength[i] as number) === 0) dangling += p[i] as number;
    const next: number[] = new Array<number>(n);
    let change = 0;
    for (let j = 0; j < n; j++) {
      const ns = g.nbr[j] as number[];
      const ws = g.wts[j] as number[];
      let acc = 0;
      for (let t = 0; t < ns.length; t++) {
        const i = ns[t] as number;
        acc += ((p[i] as number) * (ws[t] as number)) / (g.strength[i] as number);
      }
      const v = base + d * (acc + dangling / n);
      next[j] = v;
      change += Math.abs(v - (p[j] as number));
    }
    p = next;
    if (change < tolerance) break;
  }
  let sum = 0;
  for (const v of p) sum += v;
  return Object.fromEntries(g.ids.map((id, i) => [id, (p[i] as number) / sum]));
}

// ---------------------------------------------------------------- modularity

/** Q over prepared data and per-index labels; see `modularity`. */
function modularityOf(g: Prepared, label: readonly number[], gamma: number): number {
  if (g.m === 0) return 0;
  const intra = new Map<number, number>();
  const tot = new Map<number, number>();
  for (let i = 0; i < g.ids.length; i++) {
    const c = label[i] as number;
    tot.set(c, (tot.get(c) ?? 0) + (g.strength[i] as number));
    if (!intra.has(c)) intra.set(c, 0);
    const ns = g.nbr[i] as number[];
    const ws = g.wts[i] as number[];
    for (let t = 0; t < ns.length; t++) {
      const j = ns[t] as number;
      if (j > i && label[j] === c) intra.set(c, (intra.get(c) as number) + (ws[t] as number));
    }
  }
  let q = 0;
  const twoM = 2 * g.m;
  for (const c of [...tot.keys()].sort((x, y) => x - y)) {
    const s = (tot.get(c) as number) / twoM;
    q += (intra.get(c) as number) / g.m - gamma * s * s;
  }
  return q;
}

/**
 * Modularity with resolution γ:
 *   Q = Σ_c [ W_c / m − γ · (S_c / (2m))² ],
 * m the total edge weight ((Σ_i s_i) / 2), W_c the weight of the edges with both ends in c, S_c the
 * total strength of c's members. Communities are summed in ascending label order; W_c and S_c in
 * node order (each edge once, from its smaller endpoint). m = 0 gives 0.
 *
 * `communityOf` maps every node to an integer label (any integers; extra keys are ignored). Throws
 * if a node has no label. γ defaults to LOUVAIN_RESOLUTION = 1 and must be ≥ 0.
 */
export function modularity(graph: WeightedGraph, communityOf: Readonly<Record<string, number>>, resolution?: number): number {
  const gamma = resolutionOf(resolution);
  const g = prepare(graph);
  return modularityOf(g, labels(g, communityOf), gamma);
}

// ---------------------------------------------------------------- Louvain

/** One level of Louvain: super-nodes by index (ascending index = ascending representative id). */
interface Level {
  nbr: number[][];
  wts: number[][];
  /** k_i: the node's total strength, its internal weight counted twice. */
  k: number[];
  /** Weight of the original edges inside the super-node, each once. */
  self: number[];
}

/**
 * Local moves at one level. Returns each node's community label (labels are node indices) and
 * whether anything moved.
 */
function localMoves(lv: Level, m: number, gamma: number): { comm: number[]; moved: boolean } {
  const n = lv.k.length;
  const comm = Array.from({ length: n }, (_, i) => i);
  const members: Array<Set<number>> = Array.from({ length: n }, (_, i) => new Set([i]));
  const tot = lv.k.slice();
  const twoM2 = 2 * m * m;
  const rep = (c: number): number => {
    let r = Infinity;
    for (const x of members[c] as Set<number>) if (x < r) r = x;
    return r;
  };
  let movedAny = false;
  for (let pass = 1; ; pass++) {
    if (pass > LOUVAIN_MAX_PASSES) throw new Error(`louvainCommunities: no convergence after ${LOUVAIN_MAX_PASSES} passes`);
    let moved = false;
    for (let i = 0; i < n; i++) {
      const ki = lv.k[i] as number;
      const own = comm[i] as number;
      const ownMembers = members[own] as Set<number>;
      ownMembers.delete(i);
      tot[own] = ownMembers.size === 0 ? 0 : (tot[own] as number) - ki;
      // k_{i,C}: i's weight into each community, over its neighbours in index order.
      const into = new Map<number, number>();
      const ns = lv.nbr[i] as number[];
      const ws = lv.wts[i] as number[];
      for (let t = 0; t < ns.length; t++) {
        const c = comm[ns[t] as number] as number;
        into.set(c, (into.get(c) ?? 0) + (ws[t] as number));
      }
      const gain = (c: number) => (into.get(c) ?? 0) / m - (gamma * (tot[c] as number) * ki) / twoM2;
      let best = own;
      let bestGain = gain(own);
      const others = [...into.keys()].filter((c) => c !== own).map((c) => [rep(c), c] as const).sort((x, y) => x[0] - y[0]);
      for (const [, c] of others) {
        const gc = gain(c);
        if (gc > bestGain + LOUVAIN_TIE_EPSILON) {
          best = c;
          bestGain = gc;
        }
      }
      comm[i] = best;
      (members[best] as Set<number>).add(i);
      tot[best] = (tot[best] as number) + ki;
      if (best !== own) moved = true;
    }
    if (!moved) break;
    movedAny = true;
  }
  return { comm, moved: movedAny };
}

/** The next level: one super-node per community, ordered by representative (smallest member index). */
function aggregate(lv: Level, comm: readonly number[]): { next: Level; newIndex: Map<number, number> } {
  const n = lv.k.length;
  const firstOf = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const c = comm[i] as number;
    if (!firstOf.has(c)) firstOf.set(c, i);
  }
  const order = [...firstOf].sort((x, y) => x[1] - y[1]).map(([c]) => c);
  const newIndex = new Map(order.map((c, idx) => [c, idx]));
  const size = order.length;
  const k = new Array<number>(size).fill(0);
  const self = new Array<number>(size).fill(0);
  const adj: Array<Map<number, number>> = Array.from({ length: size }, () => new Map());
  for (let u = 0; u < n; u++) {
    const cu = newIndex.get(comm[u] as number) as number;
    k[cu] = (k[cu] as number) + (lv.k[u] as number);
    self[cu] = (self[cu] as number) + (lv.self[u] as number);
    const ns = lv.nbr[u] as number[];
    const ws = lv.wts[u] as number[];
    for (let t = 0; t < ns.length; t++) {
      const v = ns[t] as number;
      if (v <= u) continue;
      const cv = newIndex.get(comm[v] as number) as number;
      const w = ws[t] as number;
      if (cu === cv) self[cu] = (self[cu] as number) + w;
      else {
        const au = adj[cu] as Map<number, number>;
        const av = adj[cv] as Map<number, number>;
        au.set(cv, (au.get(cv) ?? 0) + w);
        av.set(cu, (av.get(cu) ?? 0) + w);
      }
    }
  }
  const nbr: number[][] = [];
  const wts: number[][] = [];
  for (const a of adj) {
    const js = [...a.keys()].sort((x, y) => x - y);
    nbr.push(js);
    wts.push(js.map((j) => a.get(j) as number));
  }
  return { next: { nbr, wts, k, self }, newIndex };
}

/**
 * Louvain modularity clustering (Blondel et al. 2008), made deterministic.
 *
 * Level 0: every node its own community. Nodes are visited in code-point order, in passes, until a
 * full pass moves nothing. Visiting i: remove it from its community, then evaluate the gain
 *   ΔQ(C) = k_{i,C} / m − γ · S_C · k_i / (2m²)
 * (k_{i,C} = i's weight into C, S_C = C's strength without i, k_i = i's strength) for its own, now
 * possibly empty, community first and then each neighbouring community by ascending representative
 * (a community's smallest member id, code point). A candidate replaces the best so far only if its
 * gain is larger by more than LOUVAIN_TIE_EPSILON, so a tie keeps i where it was. Then communities
 * become super-nodes (internal weight kept as a self-loop, counted in k but not in k_{i,C}; a
 * super-node's id for ordering is its representative) and the process repeats until a level moves
 * nothing. Every move raises modularity, so the result is never below all-singletons.
 *
 * Output: `communities` (members sorted by code point; lists by size desc, then first member asc),
 * `communityOf` (index into `communities`) and the partition's `modularity`. Isolated nodes are
 * singletons; a graph without edges is all singletons with modularity 0.
 */
export function louvainCommunities(graph: WeightedGraph, opts: LouvainOptions = {}): LouvainResult {
  const gamma = resolutionOf(opts.resolution);
  const g = prepare(graph);
  const n = g.ids.length;
  // nodeOf[original index] = its super-node at the current level.
  let nodeOf = Array.from({ length: n }, (_, i) => i);
  if (g.m > 0) {
    let lv: Level = { nbr: g.nbr, wts: g.wts, k: g.strength.slice(), self: new Array<number>(n).fill(0) };
    // A level that moves anything merges at least two super-nodes, so at most n levels run.
    for (let level = 0; ; level++) {
      if (level > n) throw new Error(`louvainCommunities: more than ${n} levels`);
      const { comm, moved } = localMoves(lv, g.m, gamma);
      if (!moved) break;
      const { next, newIndex } = aggregate(lv, comm);
      nodeOf = nodeOf.map((x) => newIndex.get(comm[x] as number) as number);
      lv = next;
    }
  }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const c = nodeOf[i] as number;
    const list = groups.get(c);
    if (list) list.push(g.ids[i] as string);
    else groups.set(c, [g.ids[i] as string]);
  }
  // Members are already in code-point order (ids are sorted and visited in order).
  const communities = [...groups.values()].sort((x, y) => y.length - x.length || cmp(x[0] as string, y[0] as string));
  const communityOf: Record<string, number> = Object.fromEntries(communities.flatMap((members, c) => members.map((id) => [id, c] as const)));
  const label = g.ids.map((id) => communityOf[id] as number);
  return { communities, communityOf, modularity: modularityOf(g, label, gamma) };
}

// ---------------------------------------------------------------- participation and hubs

/**
 * The participation coefficient (Guimerà and Amaral 2005):
 *   P_i = 1 − Σ_c (s_{i,c} / s_i)²,
 * s_{i,c} = i's weight into community c (its own included), summed over i's neighbours in
 * code-point order, the order s_i is summed in, so a node whose neighbours all share one community
 * gets exactly 0. Communities are summed in ascending label order. An isolated node gets 0; tiny
 * negative float drift is clamped to 0. In [0, 1): high values mark a bridge between communities.
 * Throws if a node has no community (see `modularity`).
 */
export function participationCoefficient(graph: WeightedGraph, communityOf: Readonly<Record<string, number>>): Record<string, number> {
  const g = prepare(graph);
  const label = labels(g, communityOf);
  return Object.fromEntries(
    g.ids.map((id, i) => {
      const s = g.strength[i] as number;
      if (s === 0) return [id, 0];
      const into = new Map<number, number>();
      const ns = g.nbr[i] as number[];
      const ws = g.wts[i] as number[];
      for (let t = 0; t < ns.length; t++) {
        const c = label[ns[t] as number] as number;
        into.set(c, (into.get(c) ?? 0) + (ws[t] as number));
      }
      let sq = 0;
      for (const c of [...into.keys()].sort((x, y) => x - y)) {
        const r = (into.get(c) as number) / s;
        sq += r * r;
      }
      return [id, Math.max(0, 1 - sq)];
    }),
  );
}

/**
 * Each community's hub: the member with the greatest within-community strength (its weight to the
 * other members, summed over its neighbours in code-point order), ties to the smallest id (code
 * point), compared as exact doubles. A singleton's hub is itself. Keyed by community label. The
 * graph sync derives a community's opaque public id from its hub, so this rule is part of the
 * contract. Throws if a node has no community (see `modularity`).
 */
export function communityHubs(graph: WeightedGraph, communityOf: Readonly<Record<string, number>>): Record<number, string> {
  const g = prepare(graph);
  const label = labels(g, communityOf);
  const best = new Map<number, { i: number; s: number }>();
  for (let i = 0; i < g.ids.length; i++) {
    const c = label[i] as number;
    let s = 0;
    const ns = g.nbr[i] as number[];
    const ws = g.wts[i] as number[];
    for (let t = 0; t < ns.length; t++) if (label[ns[t] as number] === c) s += ws[t] as number;
    const cur = best.get(c);
    if (cur === undefined || s > cur.s) best.set(c, { i, s });
  }
  const out: Record<number, string> = {};
  for (const c of [...best.keys()].sort((x, y) => x - y)) out[c] = g.ids[(best.get(c) as { i: number }).i] as string;
  return out;
}
