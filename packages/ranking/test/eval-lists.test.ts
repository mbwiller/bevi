import { describe, expect, it } from 'vitest';
import { formatListReport, LIST_ARMS, listReport, syntheticBevGraph } from '../eval/lists.ts';
import { SYNTHETIC_BANNER } from '../eval/report.ts';
import { syntheticEdges } from '../eval/synthetic.ts';
import { attributeProjection, communityHubs, louvainCommunities, pageRank, participationCoefficient } from '../src/index.ts';
import { syntheticSnapshot } from './snapshot-fixture.ts';

describe('eval --lists (synthetic list report)', () => {
  const opts = { seed: 'lists-test', users: 14, bevs: 40, days: 2 };

  it('runs, is deterministic, and prints the synthetic banner', () => {
    const a = listReport(opts);
    expect(listReport(opts)).toEqual(a);
    const text = formatListReport(a);
    expect(text.startsWith(SYNTHETIC_BANNER)).toBe(true);
    expect(text).toContain('NOT AN ACCURACY RESULT');
    expect(a.arms.map((x) => x.id)).toEqual(LIST_ARMS.map((x) => x.id));
    for (const arm of a.arms) {
      const m = arm.metrics;
      expect(m.lists).toBe(a.eligibleUsers * a.days);
      expect(m.distinctFamilies).toBeGreaterThanOrEqual(1);
      expect(m.distinctFamilies).toBeLessThanOrEqual(Math.min(a.top, a.families.families));
      expect(m.intraListDiversity).toBeGreaterThanOrEqual(0);
      expect(m.intraListDiversity).toBeLessThanOrEqual(1);
      expect(Number.isFinite(m.meanPredictedZ)).toBe(true);
    }
    // Diversity only reorders the normal picks: the exploration picks are the same.
    expect(a.arms[1]?.metrics.explorationPicks).toBe(a.arms[0]?.metrics.explorationPicks);
    expect(a.arms[1]?.metrics.explorationUnchartedShare).toBe(a.arms[0]?.metrics.explorationUnchartedShare);
    expect(a.families.sizes.reduce((t, x) => t + x, 0)).toBe(opts.bevs);
  });

  it('builds bevGraph with the real network functions: families over the projection, PageRank and bridges over the similarity graph', () => {
    const snap = syntheticSnapshot('lists-test', 14, 40);
    const g = syntheticBevGraph(snap);
    const nodes = Object.keys(snap.bevs).sort();
    const projection = attributeProjection(
      nodes,
      nodes.flatMap((id) => [...new Set(snap.bevs[id]?.flavorTokens)].map((t) => ({ node: id, attribute: `note:${t}` }))),
    );
    expect(g.projection).toEqual(projection);
    const { communityOf } = louvainCommunities(projection);
    expect(g.communityOf).toEqual(communityOf);
    const similarity = { nodes, edges: syntheticEdges(Object.values(snap.bevs)) };
    const pr = pageRank(similarity);
    const bridge = participationCoefficient(similarity, communityOf);
    const hubs = communityHubs(projection, communityOf);
    for (const id of nodes) {
      expect(g.bevGraph[id]).toEqual({ community: `family:${hubs[communityOf[id] as number]}`, pagerank: pr[id], bridge: bridge[id] });
    }
    // Two Bevs share a family id exactly when Louvain put them together.
    for (const a of nodes) for (const b of nodes) expect(g.bevGraph[a]?.community === g.bevGraph[b]?.community).toBe(communityOf[a] === communityOf[b]);
  });
});
