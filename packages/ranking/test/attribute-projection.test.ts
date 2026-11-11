// attributeProjection (1.8.0, LaTeX §10.9): the Adamic–Adar projection of a Bev–attribute graph that
// the graph sync clusters into taste families. Table tests with closed forms.
import { describe, expect, it } from 'vitest';
import { attributeProjection, graphStrength, louvainCommunities, pageRank, type AttributeMembership } from '../src/index.ts';

const M = (node: string, attribute: string): AttributeMembership => ({ node, attribute });

describe('attributeProjection', () => {
  it('two nodes sharing one attribute of degree 2: exactly 1 / ln 2', () => {
    expect(attributeProjection(['b', 'a'], [M('b', 'x'), M('a', 'x')])).toEqual({ nodes: ['a', 'b'], edges: [{ a: 'a', b: 'b', w: 1 / Math.log(2) }] });
    expect(1 / Math.log(2)).toBeCloseTo(1.4426950408889634, 15);
  });

  it('degree 3: 1 / ln 3 on each of the three pairs, oriented and sorted', () => {
    const w = 1 / Math.log(3);
    expect(attributeProjection(['c', 'a', 'b'], [M('c', 'x'), M('a', 'x'), M('b', 'x')]).edges).toEqual([
      { a: 'a', b: 'b', w },
      { a: 'a', b: 'c', w },
      { a: 'b', b: 'c', w },
    ]);
  });

  it('two shared attributes: the sum, accumulated in attribute code-point order', () => {
    // a, b share x (deg 2) and y (deg 3, with c). Rows given out of order; x < y.
    const g = attributeProjection(['a', 'b', 'c'], [M('c', 'y'), M('b', 'y'), M('a', 'y'), M('b', 'x'), M('a', 'x')]);
    const tx = 1 / Math.log(2);
    const ty = 1 / Math.log(3);
    expect(g.edges).toEqual([
      { a: 'a', b: 'b', w: 0 + tx + ty },
      { a: 'a', b: 'c', w: ty },
      { a: 'b', b: 'c', w: ty },
    ]);
  });

  it('a degree-1 attribute adds no edge; an isolated node is kept', () => {
    expect(attributeProjection(['a', 'b', 'z'], [M('a', 'solo'), M('a', 'x'), M('b', 'x'), M('z', 'own')])).toEqual({
      nodes: ['a', 'b', 'z'],
      edges: [{ a: 'a', b: 'b', w: 1 / Math.log(2) }],
    });
    expect(attributeProjection(['a', 'b'], [M('a', 'x'), M('b', 'y')])).toEqual({ nodes: ['a', 'b'], edges: [] });
  });

  it('the empty input, and nodes without memberships', () => {
    expect(attributeProjection([], [])).toEqual({ nodes: [], edges: [] });
    expect(attributeProjection(['y', 'x'], [])).toEqual({ nodes: ['x', 'y'], edges: [] });
  });

  it('orders by code point, not UTF-16 code unit (U+FF23 before U+1F600)', () => {
    const g = attributeProjection(['\u{1F600}', 'Ｃ'], [M('\u{1F600}', 'k'), M('Ｃ', 'k')]);
    expect(g.nodes).toEqual(['Ｃ', '\u{1F600}']);
    expect(g.edges).toEqual([{ a: 'Ｃ', b: '\u{1F600}', w: 1 / Math.log(2) }]);
  });

  it('throws on malformed input', () => {
    const bad: Array<[string, () => unknown, ErrorConstructor]> = [
      ['duplicate node', () => attributeProjection(['a', 'a'], []), RangeError],
      ['empty node id', () => attributeProjection([''], []), RangeError],
      ['node id not a string', () => attributeProjection([1 as unknown as string], []), TypeError],
      ['empty attribute', () => attributeProjection(['a'], [M('a', '')]), RangeError],
      ['membership node not in nodes', () => attributeProjection(['a'], [M('b', 'x')]), RangeError],
      ['duplicate (node, attribute)', () => attributeProjection(['a', 'b'], [M('a', 'x'), M('b', 'x'), M('a', 'x')]), RangeError],
      ['row not an object', () => attributeProjection(['a'], [null as unknown as AttributeMembership]), TypeError],
      ['attribute not a string', () => attributeProjection(['a'], [{ node: 'a', attribute: 3 } as unknown as AttributeMembership]), TypeError],
      ['nodes not an array', () => attributeProjection('ab' as unknown as string[], []), TypeError],
      ['memberships not an array', () => attributeProjection(['a'], {} as unknown as AttributeMembership[]), TypeError],
    ];
    for (const [name, f, E] of bad) expect(f, name).toThrow(E);
  });

  it('composes with louvainCommunities: two flavour groups joined by one rare shared note', () => {
    // Citrus: c1, c2, c3 share flavor:citrus, note:lemon, note:zest (each degree 3), so each pair
    // weighs 3 / ln 3 ≈ 2.7307. Berry: b1, b2, b3 likewise with flavor:berry, note:jam, note:tart.
    // c3 and b1 also share the rare note:mint (degree 2): 1 / ln 2 ≈ 1.4427, more than any single
    // common attribute but less than a within-group pair.
    const citrus = ['c1', 'c2', 'c3'];
    const berry = ['b1', 'b2', 'b3'];
    const rows = [
      ...citrus.flatMap((n) => ['flavor:citrus', 'note:lemon', 'note:zest'].map((x) => M(n, x))),
      ...berry.flatMap((n) => ['flavor:berry', 'note:jam', 'note:tart'].map((x) => M(n, x))),
      M('c3', 'note:mint'),
      M('b1', 'note:mint'),
    ];
    const g = attributeProjection([...berry, ...citrus], rows);
    const t3 = 1 / Math.log(3);
    const within = 0 + t3 + t3 + t3;
    expect(g.edges.find((e) => e.a === 'c1' && e.b === 'c2')?.w).toBe(within);
    expect(g.edges.find((e) => e.a === 'b1' && e.b === 'c3')?.w).toBe(1 / Math.log(2));
    expect(g.edges.length).toBe(7);
    const res = louvainCommunities(g);
    expect(res.communities).toEqual([berry, citrus]);
    // Q = 2·(W/m − (S/2m)²) with W = 3·within, m = 6·within + 1/ln 2, S = 2W + 1/ln 2.
    const m = 6 * within + 1 / Math.log(2);
    const W = 3 * within;
    const S = 2 * W + 1 / Math.log(2);
    expect(res.modularity).toBeCloseTo(2 * (W / m - (S / (2 * m)) ** 2), 12);
    // And the projection is a valid graph for the other functions.
    expect(() => pageRank(g)).not.toThrow();
    expect(graphStrength(g).c3?.degree).toBe(3);
  });
});
