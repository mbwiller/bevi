// A small synthetic PredictionSnapshot for tests: users with planted category tastes.
import {
  createPrng,
  populationStats,
  randomInt,
  RANKING_VERSION,
  storedScore,
  type BevFeatures,
  type PredictionSnapshot,
  type Stats,
  type UserSnapshot,
} from '../src/index.ts';

const CATS = ['soda', 'diet_soda', 'energy', 'water', 'sparkling_water', 'coffee', 'beer'];
const BRANDS = ['coke', 'pepsi', 'redbull', null, 'lacroix'];
const TOKENS = ['cola', 'cherry', 'lime', 'vanilla', 'diet', 'zero', 'citrus', 'berry'];

export function buildSnapshot(rankings: PredictionSnapshot['rankings'], bevs: BevFeatures[], canSeeAlcohol: Record<string, boolean> = {}): PredictionSnapshot {
  const byUser = new Map<string, Array<{ bevId: string; score: number }>>();
  for (const r of rankings) {
    const l = byUser.get(r.userId) ?? [];
    l.push(r);
    byUser.set(r.userId, l);
  }
  const bevMap: Record<string, BevFeatures> = {};
  for (const b of bevs) {
    const scores = rankings.filter((r) => r.bevId === b.id).map((r) => r.score);
    const s = populationStats(scores);
    bevMap[b.id] = { ...b, ratingCount: s.n, mean: s.mean, stddev: s.stddev };
  }
  const users: Record<string, UserSnapshot> = {};
  for (const [id, rs] of byUser) {
    const categoryStats: Record<string, Stats> = {};
    for (const c of new Set(rs.map((r) => bevMap[r.bevId]?.categoryId as string))) {
      categoryStats[c] = populationStats(rs.filter((r) => bevMap[r.bevId]?.categoryId === c).map((r) => r.score));
    }
    users[id] = { id, stats: populationStats(rs.map((r) => r.score)), categoryStats, canSeeAlcohol: canSeeAlcohol[id] ?? true };
  }
  for (const id of Object.keys(canSeeAlcohol)) {
    users[id] ??= { id, stats: { n: 0, mean: 0, stddev: 0 }, categoryStats: {}, canSeeAlcohol: canSeeAlcohol[id] as boolean };
  }
  const g = populationStats(rankings.map((r) => r.score));
  const byCategoryMean: Record<string, number> = {};
  for (const c of CATS) {
    const s = rankings.filter((r) => bevMap[r.bevId]?.categoryId === c).map((r) => r.score);
    if (s.length) byCategoryMean[c] = populationStats(s).mean;
  }
  return { version: RANKING_VERSION, generatedAt: '2026-10-11T00:00:00Z', global: { mean: g.mean, stddev: g.stddev, byCategoryMean }, bevs: bevMap, users, rankings };
}

export function syntheticSnapshot(seed: string, nUsers = 12, nBevs = 40): PredictionSnapshot {
  const rand = createPrng(seed);
  const bevs: BevFeatures[] = Array.from({ length: nBevs }, (_, i) => {
    const categoryId = CATS[randomInt(rand, CATS.length)] as string;
    return {
      id: `bev-${String(i).padStart(2, '0')}`,
      categoryId,
      brandKey: BRANDS[randomInt(rand, BRANDS.length)] ?? null,
      flavorTokens: [...new Set([TOKENS[randomInt(rand, TOKENS.length)] as string, TOKENS[randomInt(rand, TOKENS.length)] as string])].sort(),
      priceTier: (1 + randomInt(rand, 4)) as 1 | 2 | 3 | 4,
      ratingCount: 0,
      mean: 0,
      stddev: 0,
      isAlcoholic: categoryId === 'beer',
    };
  });
  const rankings: PredictionSnapshot['rankings'] = [];
  const canSee: Record<string, boolean> = {};
  for (let u = 0; u < nUsers; u++) {
    const userId = `user-${String(u).padStart(2, '0')}`;
    canSee[userId] = u % 3 !== 0;
    const loves = CATS[u % CATS.length];
    const count = randomInt(rand, Math.min(20, nBevs));
    const chosen = new Set<number>();
    while (chosen.size < count) chosen.add(randomInt(rand, nBevs));
    for (const i of chosen) {
      const b = bevs[i] as BevFeatures;
      if (b.isAlcoholic && !canSee[userId]) continue;
      const bucket = b.categoryId === loves ? 'LOVED' : rand() < 0.5 ? 'FINE' : 'DISLIKED';
      const n = 1 + randomInt(rand, 10);
      rankings.push({ userId, bevId: b.id, score: storedScore(randomInt(rand, n), n, bucket) });
    }
  }
  return buildSnapshot(rankings, bevs, canSee);
}
