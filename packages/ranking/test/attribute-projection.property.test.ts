// attributeProjection invariants: order independence, positive finite weights, a valid graph, and
// dependence on attribute labels only through their code-point order.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { attributeProjection, compareCodePoints, graphStrength, louvainCommunities, mulberry32, randomInt, type AttributeMembership } from '../src/index.ts';

const NODES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'aa', 'B', '\u{1F600}', 'Ｃ'];
const ATTRS = ['flavor:citrus', 'flavor:berry', 'note:lemon', 'note:mint', 'note:jam', 'x', 'y', 'z', '\u{1F34B}', 'Ｍ'];

const inputArb = fc
  .integer({ min: 0, max: NODES.length })
  .chain((n) =>
    fc.tuple(
      fc.constant(NODES.slice(0, n)),
      fc.array(fc.uniqueArray(fc.integer({ min: 0, max: ATTRS.length - 1 }), { maxLength: 5 }), { minLength: n, maxLength: n }),
      fc.integer({ min: 0, max: 2 ** 31 }),
    ),
  )
  .map(([nodes, attrs, seed]) => ({
    nodes,
    memberships: nodes.flatMap((node, i) => (attrs[i] as number[]).map((k) => ({ node, attribute: ATTRS[k] as string }))),
    seed,
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

describe('attributeProjection: invariants', () => {
  it('is invariant under shuffling nodes and memberships', () => {
    fc.assert(
      fc.property(inputArb, ({ nodes, memberships, seed }) => {
        const g = attributeProjection(nodes, memberships);
        expect(attributeProjection(shuffle(nodes, seed), shuffle(memberships, seed + 1))).toEqual(g);
      }),
      { numRuns: 300 },
    );
  });

  it('weights are finite and > 0; no self-loop, no duplicate pair, oriented and sorted; validates and composes', () => {
    fc.assert(
      fc.property(inputArb, ({ nodes, memberships }) => {
        const g = attributeProjection(nodes, memberships);
        expect(g.nodes).toEqual([...nodes].sort(compareCodePoints));
        const seen = new Set<string>();
        let prev: { a: string; b: string } | null = null;
        for (const e of g.edges) {
          expect(Number.isFinite(e.w) && e.w > 0).toBe(true);
          expect(compareCodePoints(e.a, e.b)).toBe(-1);
          const key = `${e.a}\u0000${e.b}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
          if (prev) expect(compareCodePoints(prev.a, e.a) || compareCodePoints(prev.b, e.b)).toBe(-1);
          prev = e;
        }
        // Edges appear for exactly the pairs that share an attribute (a shared one has degree ≥ 2).
        const attrsOf = new Map<string, Set<string>>(nodes.map((x) => [x, new Set()]));
        for (const m of memberships) attrsOf.get(m.node)?.add(m.attribute);
        for (let i = 0; i < g.nodes.length; i++) {
          for (let j = i + 1; j < g.nodes.length; j++) {
            const A = attrsOf.get(g.nodes[i] as string) as Set<string>;
            const B = attrsOf.get(g.nodes[j] as string) as Set<string>;
            const shares = [...A].some((x) => B.has(x));
            expect(seen.has(`${g.nodes[i]}\u0000${g.nodes[j]}`)).toBe(shares);
          }
        }
        expect(() => graphStrength(g)).not.toThrow();
        expect(() => louvainCommunities(g)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it('relabelling attributes: an order-preserving bijection changes nothing, any bijection at most 1e-12', () => {
    fc.assert(
      fc.property(inputArb, fc.integer({ min: 0, max: 2 ** 31 }), ({ nodes, memberships }, seed) => {
        const g = attributeProjection(nodes, memberships);
        const sorted = [...ATTRS].sort(compareCodePoints);
        // Order-preserving: the k-th attribute in code-point order becomes "q" + zero-padded k.
        const keep = new Map(sorted.map((x, k) => [x, `q${String(k).padStart(2, '0')}`]));
        const relabel = (map: Map<string, string>): AttributeMembership[] => memberships.map((m) => ({ node: m.node, attribute: map.get(m.attribute) as string }));
        expect(attributeProjection(nodes, relabel(keep))).toEqual(g);
        // Arbitrary: a random permutation of the labels changes only the summation order.
        const perm = shuffle(sorted, seed);
        const any = new Map(sorted.map((x, k) => [x, perm[k] as string]));
        const h = attributeProjection(nodes, relabel(any));
        expect(h.nodes).toEqual(g.nodes);
        expect(h.edges.map((e) => [e.a, e.b])).toEqual(g.edges.map((e) => [e.a, e.b]));
        h.edges.forEach((e, i) => expect(Math.abs(e.w - (g.edges[i] as { w: number }).w)).toBeLessThanOrEqual(1e-12));
      }),
      { numRuns: 300 },
    );
  });
});
