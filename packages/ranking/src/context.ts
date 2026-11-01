// Derived data for one PredictionSnapshot (effective stats, z-scores, raters per Bev, user
// similarities, the stored edge and neighbour lookups), computed once per snapshot and cached in a
// WeakMap.
// Snapshots are treated as immutable once passed to predictScore / recommend.

import { RANKING_VERSION } from './constants.ts';
import { effectiveGlobalStats, effectiveUserStats, populationStats, zScore } from './stats.ts';
import type { BevId, MeanStd, PredictionSnapshot, Stats, UserId, UserNeighbour } from './types.ts';

export interface SnapshotContext {
  globalEffective: MeanStd;
  userStats: Map<UserId, Stats>;
  userEffective: Map<UserId, MeanStd>;
  /** z_{u,b} for every ranking, keyed user → Bev. */
  z: Map<UserId, Map<BevId, number>>;
  /** Users who ranked each Bev, with their z. */
  raters: Map<BevId, Array<{ userId: UserId; z: number }>>;
  /** Lazily filled: u → (v → sim'(u, v)), the cosine of §8.9 (the default). */
  userSims: Map<UserId, Map<UserId, number>>;
  /** Lazily filled: u → (v → Pearson · min(1, |common| / 5)), for `userSimilarity: 'pearson'`. */
  userSimsPearson: Map<UserId, Map<UserId, number>>;
  /**
   * Lazily filled: u → (v → sim_B(u, v) · min(1, n_v / N₀)) over u's stored neighbours, for
   * `userSimilarity: 'stored'` when u has rows. Only listed neighbours are keys; everyone else is 0.
   */
  userSimsStored: Map<UserId, Map<UserId, number>>;
  /**
   * Lazily filled on the first edges-mode call: a → (b → w) for every `snapshot.edges` row, in both
   * orientations; null when the snapshot has no `edges` field. Undefined until then, so the
   * default ('content') path never reads or validates the edges.
   */
  edgeWeights?: Map<BevId, Map<BevId, number>> | null;
  /**
   * Lazily filled on the first stored-mode call: u → (v → sim_B(u, v) as stored) for every
   * `snapshot.userNeighbours` list (an empty list gives an empty map); null when the snapshot has
   * no `userNeighbours` field. Undefined until then, so the default ('cosine') path never reads or
   * validates the neighbours.
   */
  neighbourSims?: Map<UserId, Map<UserId, number>> | null;
}

const cache = new WeakMap<PredictionSnapshot, SnapshotContext>();
const EMPTY_STATS: Stats = { n: 0, mean: 0, stddev: 0 };

export function assertVersion(snapshot: PredictionSnapshot): void {
  if (snapshot.version !== RANKING_VERSION) {
    throw new Error(`PredictionSnapshot version ${snapshot.version} does not match RANKING_VERSION ${RANKING_VERSION}`);
  }
}

/**
 * Builds (or returns the cached) context. Choices where §8–§9 are silent:
 * - A user's μ, σ, n come from `snapshot.users[u].stats` (complete even when Arjun restricts
 *   `rankings` past ~500 users); a user missing from `users` gets stats from their rankings here.
 * - Global stats fall back to GLOBAL_FALLBACK only when `rankings` is empty.
 * - A duplicated (userId, bevId) ranking keeps the last row.
 */
export function snapshotContext(snapshot: PredictionSnapshot): SnapshotContext {
  assertVersion(snapshot);
  const hit = cache.get(snapshot);
  if (hit) return hit;

  const scores = new Map<UserId, Map<BevId, number>>();
  for (const r of snapshot.rankings) {
    let m = scores.get(r.userId);
    if (!m) scores.set(r.userId, (m = new Map()));
    m.set(r.bevId, r.score);
  }

  const global: Stats = { n: snapshot.rankings.length, mean: snapshot.global.mean, stddev: snapshot.global.stddev };
  const globalEffective = effectiveGlobalStats(global);
  const userStats = new Map<UserId, Stats>();
  const userEffective = new Map<UserId, MeanStd>();
  const ids = new Set<UserId>([...Object.keys(snapshot.users), ...scores.keys()]);
  for (const u of ids) {
    const s = snapshot.users[u]?.stats ?? (scores.has(u) ? populationStats([...(scores.get(u) as Map<BevId, number>).values()]) : EMPTY_STATS);
    userStats.set(u, s);
    userEffective.set(u, effectiveUserStats(s, global));
  }

  const z = new Map<UserId, Map<BevId, number>>();
  const raters = new Map<BevId, Array<{ userId: UserId; z: number }>>();
  for (const u of [...scores.keys()].sort()) {
    const eff = userEffective.get(u) as MeanStd;
    const zu = new Map<BevId, number>();
    for (const [b, s] of scores.get(u) as Map<BevId, number>) {
      const zv = zScore(s, eff);
      zu.set(b, zv);
      let list = raters.get(b);
      if (!list) raters.set(b, (list = []));
      list.push({ userId: u, z: zv });
    }
    z.set(u, zu);
  }

  const ctx: SnapshotContext = { globalEffective, userStats, userEffective, z, raters, userSims: new Map(), userSimsPearson: new Map(), userSimsStored: new Map() };
  cache.set(snapshot, ctx);
  return ctx;
}

/**
 * The symmetric lookup a → (b → w) of `snapshot.edges`, built once per snapshot; null when the
 * snapshot carries no `edges` field (undefined or null). Throws on a malformed row: an id that is
 * not a non-empty string, a self-edge, w not a finite number in [0, 1], or an unordered pair listed
 * twice (`bev_edges`' primary key and CHECKs rule all of these out in SQL).
 */
export function edgeLookup(snapshot: PredictionSnapshot): Map<BevId, Map<BevId, number>> | null {
  const ctx = snapshotContext(snapshot);
  if (ctx.edgeWeights !== undefined) return ctx.edgeWeights;
  const rows = snapshot.edges;
  if (rows === undefined || rows === null) return (ctx.edgeWeights = null);
  if (!Array.isArray(rows)) throw new RangeError('snapshot.edges must be an array');
  const m = new Map<BevId, Map<BevId, number>>();
  const put = (x: BevId, y: BevId, w: number) => {
    let row = m.get(x);
    if (!row) m.set(x, (row = new Map()));
    row.set(y, w);
  };
  rows.forEach((e, i) => {
    const { a, b, w } = e ?? ({} as { a?: unknown; b?: unknown; w?: unknown });
    if (typeof a !== 'string' || a === '' || typeof b !== 'string' || b === '') throw new RangeError(`snapshot.edges[${i}]: a and b must be non-empty ids`);
    if (a === b) throw new RangeError(`snapshot.edges[${i}]: self-edge on "${a}"`);
    if (typeof w !== 'number' || !(w >= 0 && w <= 1)) throw new RangeError(`snapshot.edges[${i}]: w must be a number in [0, 1], got ${String(w)}`);
    if (m.get(a)?.has(b)) throw new RangeError(`snapshot.edges[${i}]: the pair ("${a}", "${b}") is listed twice`);
    put(a, b, w);
    put(b, a, w);
  });
  return (ctx.edgeWeights = m);
}

/**
 * The lookup u → (v → sim) of `snapshot.userNeighbours`, built once per snapshot from the RAW
 * stored similarities (Layer 2 applies the reliability weight per call, in `simsOf`, because n_v
 * comes from the context); null when the snapshot carries no `userNeighbours` field (undefined or
 * null). Every list is validated, not only the viewer's. Throws a RangeError when the field is not
 * a plain object whose values are arrays, or on a malformed row: an id that is not a non-empty
 * string, a row naming the keyed user itself, sim not a finite number in [-1, 1], common not a
 * non-negative integer, or a neighbour listed twice for one user (`user_neighbors`' primary key and
 * CHECKs rule all of these out in SQL). `common` is validated but read by no formula.
 */
export function neighbourLookup(snapshot: PredictionSnapshot): Map<UserId, Map<UserId, number>> | null {
  const ctx = snapshotContext(snapshot);
  if (ctx.neighbourSims !== undefined) return ctx.neighbourSims;
  const field: unknown = snapshot.userNeighbours;
  if (field === undefined || field === null) return (ctx.neighbourSims = null);
  const proto = typeof field === 'object' ? Object.getPrototypeOf(field) : undefined;
  if (typeof field !== 'object' || Array.isArray(field) || (proto !== Object.prototype && proto !== null)) {
    throw new RangeError('snapshot.userNeighbours must be a plain object of arrays keyed by user id');
  }
  const m = new Map<UserId, Map<UserId, number>>();
  for (const [u, rows] of Object.entries(field as Record<string, unknown>)) {
    if (u === '') throw new RangeError('snapshot.userNeighbours: a key must be a non-empty user id');
    if (!Array.isArray(rows)) throw new RangeError(`snapshot.userNeighbours["${u}"] must be an array`);
    const sims = new Map<UserId, number>();
    rows.forEach((row: unknown, i) => {
      const where = `snapshot.userNeighbours["${u}"][${i}]`;
      const { userId, sim, common } = (typeof row === 'object' && row !== null ? row : {}) as Partial<Record<keyof UserNeighbour, unknown>>;
      if (typeof userId !== 'string' || userId === '') throw new RangeError(`${where}: userId must be a non-empty id`);
      if (userId === u) throw new RangeError(`${where}: "${u}" is listed as their own neighbour`);
      if (typeof sim !== 'number' || !(sim >= -1 && sim <= 1)) throw new RangeError(`${where}: sim must be a number in [-1, 1], got ${String(sim)}`);
      if (typeof common !== 'number' || !Number.isInteger(common) || common < 0) throw new RangeError(`${where}: common must be a non-negative integer, got ${String(common)}`);
      if (sims.has(userId)) throw new RangeError(`${where}: "${userId}" is listed twice`);
      sims.set(userId, sim);
    });
    m.set(u, sims);
  }
  return (ctx.neighbourSims = m);
}

export function effectiveStatsOf(ctx: SnapshotContext, u: UserId): MeanStd {
  return ctx.userEffective.get(u) ?? ctx.globalEffective;
}

export function nOf(ctx: SnapshotContext, u: UserId): number {
  return ctx.userStats.get(u)?.n ?? 0;
}
