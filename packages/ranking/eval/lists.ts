// List-level report for recommend()'s 1.8.0 options (`--lists`). A HARNESS CHECK on synthetic data,
// NOT an accuracy result: it shows what diversity / exploration 'community' do to a list (how many
// taste families it spans, how varied it is, what it costs in predicted z), never whether users
// would like the list better. Pure; cli.ts does the printing.
//
// The synthetic `bevGraph` is built the way the graph sync builds the real one, with the package's
// own network functions: taste families = louvainCommunities(attributeProjection(Bevs, memberships))
// with one `note:<token>` membership per entry of each Bev's `flavorTokens` (a snapshot carries no
// flavour base); pagerank = pageRank over the similarity graph (`syntheticEdges`); bridge =
// participationCoefficient(similarity graph, families); ids from communityHubs over the projection.

import { MIN_N_USER, RECOMMEND_N } from '../src/constants.ts';
import { attributeProjection, communityHubs, louvainCommunities, pageRank, participationCoefficient, type AttributeMembership, type WeightedGraph } from '../src/network.ts';
import { predictScore } from '../src/blend.ts';
import { recommend } from '../src/recommend.ts';
import { contentSimilarity } from '../src/similarity.ts';
import type { BevFeatures, BevGraphStats, BevId, PredictionSnapshot, RecommendOptions, UserId } from '../src/types.ts';
import { syntheticSnapshot } from '../test/snapshot-fixture.ts';
import { SYNTHETIC_BANNER } from './report.ts';
import { syntheticEdges } from './synthetic.ts';

export const LIST_ARMS = [
  { id: 'default', label: '{} (live engine)', opts: {} },
  { id: 'diversity', label: "{ diversity: 'community' }", opts: { diversity: 'community' } },
  { id: 'diversity+exploration', label: "{ diversity: 'community', exploration: 'community' }", opts: { diversity: 'community', exploration: 'community' } },
] as const satisfies ReadonlyArray<{ id: string; label: string; opts: Pick<RecommendOptions, 'diversity' | 'exploration'> }>;
export type ListArmId = (typeof LIST_ARMS)[number]['id'];

export interface ListMetrics {
  /** (user, day) lists scored. */
  lists: number;
  /** Mean number of distinct taste families among the top `top` positions. */
  distinctFamilies: number;
  /** Mean intra-list diversity of the top `top`: 1 − mean pairwise contentSimilarity. */
  intraListDiversity: number;
  /** Mean un-jittered predicted ẑ of the top `top` (the price paid for diversity). */
  meanPredictedZ: number;
  /** Exploration picks over all lists (whole list, not only the top). */
  explorationPicks: number;
  /** Share of those picks in a family where the user has ranked nothing. NaN with no picks. */
  explorationUnchartedShare: number;
}

export interface FamilySummary {
  families: number;
  /** Family sizes, descending. */
  sizes: number[];
  /** Modularity of the families over the projection. */
  modularity: number;
  /** Members in their family's most common category, over all Bevs (1 = families are categories). */
  categoryPurity: number;
  /** Similarity edges, and the share of them joining two families. */
  similarityEdges: number;
  crossFamilyEdgeShare: number;
}

export interface ListReport {
  seed: string;
  users: number;
  bevs: number;
  days: number;
  n: number;
  top: number;
  /** Users with at least MIN_N_USER rankings (the app shows no list below that). */
  eligibleUsers: number;
  /**
   * Of those, users who have ranked in every taste family: exploration 'community' has no uncharted
   * family for them and always uses the category pool.
   */
  usersChartingEveryFamily: number;
  families: FamilySummary;
  arms: Array<{ id: ListArmId; label: string; metrics: ListMetrics }>;
}

export interface ListReportOptions {
  seed?: string;
  users?: number;
  bevs?: number;
  /** Seeds per user ("days"); default 7. */
  days?: number;
  /** List length; default RECOMMEND_N = 20. */
  n?: number;
  /** Positions scored by the top-k metrics; default 10. */
  top?: number;
}

/** The synthetic stand-in for `bev_graph_stats`, built with the real network functions (see the file comment). */
export function syntheticBevGraph(snapshot: PredictionSnapshot): { bevGraph: Record<BevId, BevGraphStats>; projection: WeightedGraph; similarity: WeightedGraph; communityOf: Record<string, number>; modularity: number } {
  const nodes = Object.keys(snapshot.bevs).sort();
  const memberships: AttributeMembership[] = nodes.flatMap((id) => [...new Set((snapshot.bevs[id] as { flavorTokens: string[] }).flavorTokens)].map((t) => ({ node: id, attribute: `note:${t}` })));
  const projection = attributeProjection(nodes, memberships);
  const { communityOf, modularity } = louvainCommunities(projection);
  const hubs = communityHubs(projection, communityOf);
  const similarity: WeightedGraph = { nodes, edges: syntheticEdges(Object.values(snapshot.bevs)) };
  const pr = pageRank(similarity);
  const bridge = participationCoefficient(similarity, communityOf);
  const bevGraph: Record<BevId, BevGraphStats> = {};
  for (const id of nodes) bevGraph[id] = { community: `family:${hubs[communityOf[id] as number] as string}`, pagerank: pr[id] as number, bridge: bridge[id] as number };
  return { bevGraph, projection, similarity, communityOf, modularity };
}

function summarise(snapshot: PredictionSnapshot, g: ReturnType<typeof syntheticBevGraph>): FamilySummary {
  const members = new Map<number, BevId[]>();
  for (const [id, c] of Object.entries(g.communityOf)) {
    const list = members.get(c);
    if (list) list.push(id);
    else members.set(c, [id]);
  }
  let pure = 0;
  for (const ids of members.values()) {
    const byCat = new Map<string, number>();
    for (const id of ids) {
      const c = (snapshot.bevs[id] as { categoryId: string }).categoryId;
      byCat.set(c, (byCat.get(c) ?? 0) + 1);
    }
    pure += Math.max(...byCat.values());
  }
  const cross = g.similarity.edges.filter((e) => g.communityOf[e.a] !== g.communityOf[e.b]).length;
  return {
    families: members.size,
    sizes: [...members.values()].map((x) => x.length).sort((a, b) => b - a),
    modularity: g.modularity,
    categoryPurity: pure / Object.keys(g.communityOf).length,
    similarityEdges: g.similarity.edges.length,
    crossFamilyEdgeShare: g.similarity.edges.length > 0 ? cross / g.similarity.edges.length : Number.NaN,
  };
}

export function listReport(opts: ListReportOptions = {}): ListReport {
  const seed = opts.seed ?? 'bevi-eval';
  const nUsers = opts.users ?? 40;
  const nBevs = opts.bevs ?? 80;
  const days = opts.days ?? 7;
  const n = opts.n ?? RECOMMEND_N;
  const top = opts.top ?? 10;
  const plain = syntheticSnapshot(seed, nUsers, nBevs);
  const g = syntheticBevGraph(plain);
  const snapshot: PredictionSnapshot = { ...plain, bevGraph: g.bevGraph };
  const familyOf = (id: BevId) => (g.bevGraph[id] as BevGraphStats).community;

  const users = Object.keys(snapshot.users)
    .sort()
    .filter((u) => (snapshot.users[u] as { stats: { n: number } }).stats.n >= MIN_N_USER);
  const rankedBy = new Map<UserId, BevId[]>();
  for (const r of snapshot.rankings) {
    const l = rankedBy.get(r.userId);
    if (l) l.push(r.bevId);
    else rankedBy.set(r.userId, [r.bevId]);
  }

  const arms = LIST_ARMS.map((arm) => {
    let lists = 0;
    let fam = 0;
    let ild = 0;
    let z = 0;
    let picks = 0;
    let uncharted = 0;
    for (const u of users) {
      const charted = new Set((rankedBy.get(u) ?? []).map(familyOf));
      for (let d = 0; d < days; d++) {
        const recs = recommend(snapshot, u, { n, seed: `${u}:${seed}:day-${d}`, ...arm.opts });
        const head = recs.slice(0, top).map((r) => r.bevId);
        if (head.length === 0) continue;
        lists++;
        fam += new Set(head.map(familyOf)).size;
        let simSum = 0;
        let pairs = 0;
        for (let i = 0; i < head.length; i++) {
          for (let j = i + 1; j < head.length; j++) {
            simSum += contentSimilarity(snapshot.bevs[head[i] as BevId] as BevFeatures, snapshot.bevs[head[j] as BevId] as BevFeatures);
            pairs++;
          }
        }
        ild += pairs > 0 ? 1 - simSum / pairs : 0;
        let zs = 0;
        for (const b of head) zs += predictScore(snapshot, u, b).z;
        z += zs / head.length;
        for (const r of recs) {
          if (!r.isExploration) continue;
          picks++;
          if (!charted.has(familyOf(r.bevId))) uncharted++;
        }
      }
    }
    const metrics: ListMetrics = {
      lists,
      distinctFamilies: lists > 0 ? fam / lists : Number.NaN,
      intraListDiversity: lists > 0 ? ild / lists : Number.NaN,
      meanPredictedZ: lists > 0 ? z / lists : Number.NaN,
      explorationPicks: picks,
      explorationUnchartedShare: picks > 0 ? uncharted / picks : Number.NaN,
    };
    return { id: arm.id, label: arm.label, metrics };
  });

  const families = summarise(plain, g);
  const usersChartingEveryFamily = users.filter((u) => new Set((rankedBy.get(u) ?? []).map(familyOf)).size === families.families).length;
  return { seed, users: nUsers, bevs: nBevs, days, n, top, eligibleUsers: users.length, usersChartingEveryFamily, families, arms };
}

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—');

export function formatListReport(r: ListReport): string {
  const lines = [
    SYNTHETIC_BANNER,
    '# LIST METRICS describe what an option does to a list (spread, variety, the',
    '# predicted z it gives up), not whether anyone would prefer that list.',
    '#'.repeat(78),
    '',
    `recommend() list report: syntheticSnapshot("${r.seed}", ${r.users} users, ${r.bevs} Bevs); ${r.eligibleUsers} users with >= ${MIN_N_USER} rankings × ${r.days} seeds; n = ${r.n}, top-${r.top} metrics`,
    `taste families (Louvain over attributeProjection of note:<token>): ${r.families.families}, sizes ${r.families.sizes.join(' ')}, modularity ${f3(r.families.modularity)}, category purity ${f3(r.families.categoryPurity)}`,
    `similarity graph (syntheticEdges): ${r.families.similarityEdges} edges, ${f3(r.families.crossFamilyEdgeShare)} of them across families (the bridge scores' source)`,
    `${r.usersChartingEveryFamily} of ${r.eligibleUsers} users have ranked in every family, so exploration 'community' falls back to the category pool for them`,
    '',
    `${'arm'.padEnd(52)} ${'lists'.padStart(6)} ${'families@' + r.top}  ${'ILD@' + r.top}  ${'mean z@' + r.top}  ${'expl. picks'.padStart(11)}  uncharted`,
  ];
  for (const a of r.arms) {
    const m = a.metrics;
    lines.push(
      `${a.label.padEnd(52)} ${String(m.lists).padStart(6)} ${f3(m.distinctFamilies).padStart(11)}  ${f3(m.intraListDiversity).padStart(6)}  ${f3(m.meanPredictedZ).padStart(9)}  ${String(m.explorationPicks).padStart(11)}  ${f3(m.explorationUnchartedShare).padStart(9)}`,
    );
  }
  lines.push(
    '',
    `families@k: distinct taste families in the top k. ILD@k: 1 - mean pairwise contentSimilarity in the top k.`,
    `mean z@k: mean un-jittered predicted z of the top k. uncharted: share of exploration picks (whole list) in a family the user has not ranked.`,
  );
  return lines.join('\n');
}
