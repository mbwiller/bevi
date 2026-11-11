/**
 * The pure half of the graph-signals phase of the nightly sync (TASKS.md
 * A-16 (4); scripts/graph/sync.ts is the I/O half, and the Cypher it sends is
 * in sync-core.ts with every other statement).
 *
 * Every night, inside the sync's one transaction, the similarity graph is READ
 * BACK OUT OF NEO4J -- every `(:Bev)` id and every `SIMILAR_TO` as (a, b, w) --
 * and `computeGraphStats` turns it into three numbers and one label per Bev:
 *
 *   pagerank   weighted PageRank: how central a Bev is in the similarity graph
 *   community  the Louvain community it falls in, as an OPAQUE id
 *   bridge     the participation coefficient: 0 when every neighbour is in its
 *              own community, towards 1 when its edges are spread over many
 *   (plus `strength` and `degree`, the weighted and unweighted degree)
 *
 * TWO GRAPHS, ON PURPOSE. `similarity` is the `SIMILAR_TO` graph: PageRank,
 * strength and degree are measured on it, and it is the graph whose weight the
 * bridge score spreads across communities. `partition` is the graph Louvain
 * runs on, and it is a SEPARATE INPUT over the same Bevs. Today the sync passes
 * the `SIMILAR_TO` graph for both. That is not a promise: Louvain over
 * `SIMILAR_TO` largely rediscovers the root categories, and the partition
 * graph is about to become the flavour projection (Bevs joined through shared
 * `(:Flavor)` and `(:Note)` nodes) once the package function that builds it is
 * on `main`. Nothing here assumes the two are the same graph.
 *
 * NOTHING HERE REIMPLEMENTS A FORMULA. The five numbers come from
 * `graphStrength`, `pageRank`, `louvainCommunities`, `participationCoefficient`
 * and `communityHubs` in @bevi/ranking (packages/ranking/src/network.ts, paper
 * section 10.9), and from nothing else. This file arranges their output into
 * rows, checks it, and writes a report. Those functions are deterministic in
 * the SET of nodes and edges, so this is too: shuffled input gives the same
 * rows.
 *
 * THE COMMUNITY ID IS OPAQUE, AND THAT IS A PRIVACY RULE. A community is named
 * after its hub (`communityHubs`: the member with the greatest within-community
 * strength, in the partition graph), which keeps the name stable from night to night while the hub
 * stays the hub. But a hub can be an ALCOHOLIC Bev, the id reaches every client
 * in the prediction snapshot, and a catalog Bev id is derivable by anyone (it
 * is a uuid v5 of a public slug under a public namespace). So neither the hub's
 * id nor a plain hash of it may be the public id: an under-21 client could
 * confirm "my lemonade's community is led by that beer" by hashing the
 * catalog. `communityIdOf` is therefore INJECTED -- the I/O half supplies a
 * keyed HMAC whose key lives in Actions secrets -- and this file checks only
 * its shape, that it does not collide, and that it is neither a Bev id nor cut
 * from the hub's own. Clients compare
 * the ids for equality and nothing else.
 *
 * No fetch, no environment, no clock, no randomness.
 */

import {
  communityHubs,
  graphStrength,
  louvainCommunities,
  pageRank,
  participationCoefficient,
} from "@bevi/ranking";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One weighted, undirected edge between two Bevs: a `SIMILAR_TO` as read back from the graph, or an edge of the partition graph. */
export interface GraphEdge {
  a: string;
  b: string;
  w: number;
}

/** The graph Louvain runs on: the same shape as the package's `WeightedGraph`, over the same Bev ids as `nodes`. */
export interface PartitionGraph {
  nodes: readonly string[];
  edges: readonly GraphEdge[];
}

/** One Bev's graph signals: a row of `public.bev_graph_stats`, in camelCase. */
export interface GraphStatsRow {
  bevId: string;
  /** Opaque: `communityIdOf(hub)`. Equal for two Bevs exactly when they share a community. */
  communityId: string;
  /** How many Bevs carry this `communityId`, this one included. */
  communitySize: number;
  /** Weighted PageRank; sums to 1 over `rows`. */
  pagerank: number;
  /** Sum of the weights of this Bev's `SIMILAR_TO` edges. 0 for a Bev with none. */
  strength: number;
  /** How many `SIMILAR_TO` edges it has. */
  degree: number;
  /**
   * Participation coefficient in [0, 1): how this Bev's `SIMILAR_TO` weight is
   * spread across the communities of the partition. 0 for a Bev with no
   * `SIMILAR_TO` edge.
   */
  bridge: number;
}

export interface GraphCommunity {
  id: string;
  size: number;
  /** The member with the greatest within-community strength in the partition graph. NEVER sent to a client. */
  hubBevId: string;
}

export interface GraphStats {
  /** One per Bev, sorted by id in code-unit order. */
  rows: GraphStatsRow[];
  /** Largest first; equal sizes by their smallest member id. */
  communities: GraphCommunity[];
  /** Q of the partition, on the PARTITION graph, at the package's default resolution. 0 for a graph without edges. */
  modularity: number;
  counts: {
    bevs: number;
    /** `SIMILAR_TO` edges: the graph PageRank, strength, degree and bridge are measured on. */
    edges: number;
    /** Edges of the graph Louvain ran on. Equal to `edges` while the sync passes `SIMILAR_TO` for both. */
    partitionEdges: number;
    communities: number;
    /** Communities of one Bev. */
    singletons: number;
    /** Bevs with no `SIMILAR_TO` edge at all. */
    isolated: number;
  };
}

export interface GraphStatsInput {
  /** Every Bev id. */
  nodes: readonly string[];
  /** The `SIMILAR_TO` edges: `graphStrength`, `pageRank`, and the graph `participationCoefficient` measures over. */
  similarity: readonly GraphEdge[];
  /** The graph `louvainCommunities` and `communityHubs` run on. Its nodes must be exactly `nodes`. */
  partition: PartitionGraph;
  /** hub Bev id -> the community's opaque public id. Injected: the HMAC and its key live in the I/O half. */
  communityIdOf: (hubBevId: string) => string;
}

/**
 * The shape of a public community id, and the CHECK on
 * `bev_graph_stats.community_id` (20261110000100). Enforced here as well, so a
 * wrong `communityIdOf` fails before the graph is written rather than at the
 * Postgres write-back after the commit.
 */
export const COMMUNITY_ID_PATTERN = /^c_[0-9a-f]{16}$/;

/** PageRank is normalised by its own sum, so anything further off than this is a bug, not rounding. */
export const PAGERANK_SUM_TOLERANCE = 1e-9;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${what} is not a finite number: ${String(value)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// The computation
// ---------------------------------------------------------------------------

/**
 * Centrality, community and bridge score for every Bev.
 *
 * `nodes` are Bev ids; `similarity` the `SIMILAR_TO` rows and `partition.edges`
 * the edges Louvain runs on, each unordered pair once, in any order and either
 * orientation. The package functions validate both graphs (an endpoint that is
 * not a node, a self-loop, a duplicate pair, a weight that is not finite and
 * positive all throw), and `partition.nodes` must be the same SET as `nodes`.
 *
 *   strength, degree   graphStrength(similarity)
 *   pagerank           pageRank(similarity)
 *   community          louvainCommunities(partition)
 *   hub                communityHubs(partition, communityOf)
 *   bridge             participationCoefficient(similarity, communityOf)
 *
 * A Bev with no edge in the partition graph is a community of its own. A Bev
 * with no `SIMILAR_TO` edge has strength 0, degree 0 and bridge 0, and still
 * gets its share of PageRank.
 *
 * THROWS, so nothing wrong is ever written: a partition over a different set
 * of Bevs, a non-finite or out-of-range result, a PageRank that does not sum
 * to 1, a `communityIdOf` that returns something not shaped like `c_` + 16 hex
 * or made of a Bev id, and two communities that map to one id.
 */
export function computeGraphStats(input: GraphStatsInput): GraphStats {
  const { nodes, partition } = input;
  const bevIds = new Set(nodes);
  if (partition.nodes.length !== nodes.length || partition.nodes.some((id) => !bevIds.has(id))) {
    throw new RangeError(
      `the partition graph has ${partition.nodes.length} node(s) and the similarity graph ${nodes.length}: ` +
        `they must be the same set of Bevs`,
    );
  }

  const similarity = { nodes, edges: input.similarity };
  const degrees = graphStrength(similarity);
  const rank = pageRank(similarity);
  const louvain = louvainCommunities(partition);
  const hubs = communityHubs(partition, louvain.communityOf);
  const bridges = participationCoefficient(similarity, louvain.communityOf);

  // -- communities, in the package's order: size desc, then first member -----
  const seen = new Map<string, string>();
  const communities: GraphCommunity[] = louvain.communities.map((members, index) => {
    const hubBevId = hubs[index];
    if (hubBevId === undefined || !members.includes(hubBevId)) {
      throw new RangeError(`community ${index} has no hub among its ${members.length} member(s)`);
    }
    const id = input.communityIdOf(hubBevId);
    // None of these messages prints the id it rejects: a wrong one may be the
    // very thing that must not reach a log.
    if (typeof id !== "string" || !COMMUNITY_ID_PATTERN.test(id)) {
      throw new RangeError(`communityIdOf returned an id that is not "c_" plus 16 hex characters (hub ${hubBevId})`);
    }
    // The pattern already rules out a whole uuid. What it cannot rule out is
    // an id that IS some Bev's id, or one cut from the hub's own hex.
    if (bevIds.has(id) || id.slice(2) === hubBevId.replaceAll("-", "").slice(0, 16).toLowerCase()) {
      throw new RangeError(`communityIdOf returned an id that contains a Bev id (hub ${hubBevId})`);
    }
    const other = seen.get(id);
    if (other !== undefined) {
      throw new RangeError(`two communities map to one id: the hubs ${other} and ${hubBevId} collide`);
    }
    seen.set(id, hubBevId);
    return { id, size: members.length, hubBevId };
  });

  // -- one row per Bev -------------------------------------------------------
  const rows: GraphStatsRow[] = [...nodes].sort(cmp).map((bevId) => {
    const index = louvain.communityOf[bevId];
    const community = index === undefined ? undefined : communities[index];
    const degree = degrees[bevId];
    if (community === undefined || degree === undefined) throw new RangeError(`Bev ${bevId} has no community or no degree`);

    const pagerank = finite(rank[bevId], `pagerank of Bev ${bevId}`);
    const strength = finite(degree.strength, `strength of Bev ${bevId}`);
    const bridge = finite(bridges[bevId], `bridge of Bev ${bevId}`);
    if (pagerank < 0 || pagerank > 1) throw new RangeError(`pagerank of Bev ${bevId} is outside [0, 1]: ${pagerank}`);
    if (strength < 0) throw new RangeError(`strength of Bev ${bevId} is negative: ${strength}`);
    if (!Number.isInteger(degree.degree) || degree.degree < 0) {
      throw new RangeError(`degree of Bev ${bevId} is not a non-negative integer: ${String(degree.degree)}`);
    }
    if (bridge < 0 || bridge >= 1) throw new RangeError(`bridge of Bev ${bevId} is outside [0, 1): ${bridge}`);

    return {
      bevId,
      communityId: community.id,
      communitySize: community.size,
      pagerank,
      strength,
      degree: degree.degree,
      bridge,
    };
  });

  const modularity = finite(louvain.modularity, "modularity");
  let total = 0;
  for (const row of rows) total += row.pagerank;
  if (rows.length > 0 && Math.abs(total - 1) > PAGERANK_SUM_TOLERANCE) {
    throw new RangeError(`pagerank sums to ${total} over ${rows.length} Bevs, not 1`);
  }
  const members = communities.reduce((n, c) => n + c.size, 0);
  if (members !== rows.length) throw new RangeError(`the communities hold ${members} Bevs, the graph has ${rows.length}`);

  return {
    rows,
    communities,
    modularity,
    counts: {
      bevs: rows.length,
      edges: input.similarity.length,
      partitionEdges: partition.edges.length,
      communities: communities.length,
      singletons: communities.filter((c) => c.size === 1).length,
      isolated: rows.filter((row) => row.degree === 0).length,
    },
  };
}

// ---------------------------------------------------------------------------
// What the I/O half writes
// ---------------------------------------------------------------------------

/** A row of `public.bev_graph_stats`, exactly as `replace_bev_graph_stats(p_rows, p_version)` expects it. */
export interface BevGraphStatsDbRow {
  bev_id: string;
  community_id: string;
  community_size: number;
  pagerank: number;
  strength: number;
  degree: number;
  bridge: number;
}

export function graphStatsDbRows(stats: GraphStats): BevGraphStatsDbRow[] {
  return stats.rows.map((row) => ({
    bev_id: row.bevId,
    community_id: row.communityId,
    community_size: row.communitySize,
    pagerank: row.pagerank,
    strength: row.strength,
    degree: row.degree,
    bridge: row.bridge,
  }));
}

/** What `SET_BEV_GRAPH_STATS`, `UPSERT_COMMUNITIES` and `UPSERT_IN_COMMUNITY` in sync-core.ts take as `$rows`. */
export interface GraphStatsWrites {
  bevs: Array<{ id: string; pagerank: number; strength: number; degree: number; bridge: number; community: string }>;
  communities: Array<{ id: string; size: number }>;
  inCommunity: Array<{ from: string; to: string; hub: boolean }>;
}

export function graphStatsWrites(stats: GraphStats): GraphStatsWrites {
  const hubOf = new Map(stats.communities.map((c) => [c.id, c.hubBevId]));
  return {
    bevs: stats.rows.map((row) => ({
      id: row.bevId,
      pagerank: row.pagerank,
      strength: row.strength,
      degree: row.degree,
      bridge: row.bridge,
      community: row.communityId,
    })),
    communities: stats.communities.map((c) => ({ id: c.id, size: c.size })).sort((x, y) => cmp(x.id, y.id)),
    inCommunity: stats.rows.map((row) => ({
      from: row.bevId,
      to: row.communityId,
      hub: hubOf.get(row.communityId) === row.bevId,
    })),
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** What the report needs to know about a Bev: its catalog name and its ROOT category. */
export interface ReportBev {
  id: string;
  name: string;
  brand: string | null;
  flavor: string | null;
  /** One of the 15 roots, as on `bevs.category_id` and `(:Bev).categoryId`. */
  categoryId: string;
}

const REPORT_TOP = 10;
const REPORT_COMMUNITY_MEMBERS = 3;

const present = (value: string | null): value is string => typeof value === "string" && value.trim() !== "";

/**
 * `Name, Flavour (Brand)`. The flavour is added only when the name does not
 * already say it: the catalog has several Bevs that share a name and a brand
 * and differ by flavour alone, and a report line should tell them apart.
 */
function label(bev: ReportBev): string {
  const flavor = present(bev.flavor) && !bev.name.toLowerCase().includes(bev.flavor.trim().toLowerCase()) ? `, ${bev.flavor.trim()}` : "";
  return `${bev.name}${flavor}${present(bev.brand) ? ` (${bev.brand.trim()})` : ""}`;
}
const percent = (part: number, whole: number): string => `${whole === 0 ? 0 : Math.round((100 * part) / whole)}%`;

/** The most common root category among `members` and how many of them it holds; a tie goes to the smaller id. */
function dominantCategory(members: readonly ReportBev[]): { categoryId: string; count: number } {
  const tally = new Map<string, number>();
  for (const bev of members) tally.set(bev.categoryId, (tally.get(bev.categoryId) ?? 0) + 1);
  const [categoryId, count] = [...tally].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]))[0] ?? ["", 0];
  return { categoryId, count };
}

/**
 * Σ over communities of the size of its largest root-category group, divided
 * by the number of Bevs: 1 when every community sits inside one root category,
 * lower the more the data-driven communities cut across the hand-built
 * taxonomy. It is a description of the partition, not a formula anything reads.
 */
export function categoryPurity(stats: GraphStats, bevs: readonly ReportBev[]): number {
  if (stats.rows.length === 0) return 0;
  const bevOf = new Map(bevs.map((bev) => [bev.id, bev]));
  const membersOf = new Map<string, ReportBev[]>();
  for (const row of stats.rows) {
    const bev = bevOf.get(row.bevId);
    if (bev === undefined) throw new RangeError(`Bev ${row.bevId} has graph stats but no catalog row`);
    const list = membersOf.get(row.communityId);
    if (list === undefined) membersOf.set(row.communityId, [bev]);
    else list.push(bev);
  }
  let agreeing = 0;
  for (const community of stats.communities) agreeing += dominantCategory(membersOf.get(community.id) ?? []).count;
  return agreeing / stats.rows.length;
}

/**
 * The analytics report, as lines: modularity and the number of communities;
 * one line per community (size, hub, its three highest-PageRank members, the
 * share of its members in its most common root category); the ten most
 * central Bevs; the ten highest bridge scores; and the overall category purity.
 *
 * CATALOG NAMES ONLY. No Bev id, no community id and nothing about a user
 * reaches a line: the log this is printed to is public, and a community id
 * printed beside its hub's name would undo the opacity the id exists for.
 */
export function graphStatsReport(stats: GraphStats, bevs: readonly ReportBev[]): string[] {
  const bevOf = new Map(bevs.map((bev) => [bev.id, bev]));
  const bev = (id: string): ReportBev => {
    const found = bevOf.get(id);
    if (found === undefined) throw new RangeError(`Bev ${id} has graph stats but no catalog row`);
    return found;
  };
  // PageRank desc, then id: a total order, so the report is deterministic.
  const byRank = [...stats.rows].sort((x, y) => y.pagerank - x.pagerank || cmp(x.bevId, y.bevId));
  const byBridge = [...stats.rows].sort((x, y) => y.bridge - x.bridge || cmp(x.bevId, y.bevId));
  const hubNameOf = new Map(stats.communities.map((c) => [c.id, label(bev(c.hubBevId))]));

  const c = stats.counts;
  const lines: string[] = [
    `modularity Q = ${stats.modularity.toFixed(4)} over ${c.communities} communities (${c.singletons} of one Bev), ` +
      `Louvain on a partition graph of ${c.partitionEdges} edges`,
    `${c.bevs} Bevs, ${c.edges} SIMILAR_TO edges (PageRank, strength and bridge are measured on these); ` +
      `${c.isolated} Bev(s) have no SIMILAR_TO edge`,
    "communities, largest first: size, hub, top members by PageRank, share in its most common root category",
  ];

  stats.communities.forEach((community, i) => {
    const members = byRank.filter((row) => row.communityId === community.id);
    const top = members.slice(0, REPORT_COMMUNITY_MEMBERS).map((row) => label(bev(row.bevId)));
    const dominant = dominantCategory(members.map((row) => bev(row.bevId)));
    lines.push(
      `  ${String(i + 1).padStart(3)}. ${String(community.size).padStart(4)}  hub: ${hubNameOf.get(community.id)}` +
        `  |  top: ${top.join(", ")}  |  ${percent(dominant.count, community.size)} ${dominant.categoryId}`,
    );
  });

  lines.push(`the ${Math.min(REPORT_TOP, byRank.length)} most central Bevs (weighted PageRank)`);
  for (const row of byRank.slice(0, REPORT_TOP)) {
    const b = bev(row.bevId);
    lines.push(`    ${row.pagerank.toFixed(6)}  ${label(b)} [${b.categoryId}]  degree ${row.degree}`);
  }

  // Most Bevs score exactly 0 (every neighbour in their own community), so
  // only the non-zero ones are worth a line.
  const bridging = byBridge.filter((row) => row.bridge > 0);
  lines.push(
    `${bridging.length} of ${c.bevs} Bevs have SIMILAR_TO edges into more than one community; ` +
      `the ${Math.min(REPORT_TOP, bridging.length)} highest bridge scores (participation coefficient)`,
  );
  if (bridging.length === 0) lines.push("    (none)");
  for (const row of bridging.slice(0, REPORT_TOP)) {
    const b = bev(row.bevId);
    lines.push(`    ${row.bridge.toFixed(4)}  ${label(b)} [${b.categoryId}]  in the community of ${hubNameOf.get(row.communityId)}`);
  }

  lines.push(
    `category purity ${categoryPurity(stats, bevs).toFixed(4)}: the share of Bevs that sit in their community's most common ` +
      `root category (1 = the communities follow the taxonomy exactly)`,
  );
  return lines;
}
