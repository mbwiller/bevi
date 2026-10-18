// The offline evaluation dataset and the export format it is loaded from (format documented in
// eval/README.md). Pure: parsing takes an already-decoded JSON value; only eval/cli.ts reads files.

import { BUCKET_DB } from '../src/constants.ts';
import { flavorTokens, normaliseBrand } from '../src/similarity.ts';
import type { BevFeatures, BevId, Bucket, CategoryId, PriceTier, UserId } from '../src/types.ts';

export const EXPORT_FORMAT = 'bevi-eval-export';
export const EXPORT_FORMAT_VERSION = 1;

/** A catalog row, raw as in `bevs` joined to `categories` (normalisation happens in `featuresOf`). */
export interface EvalBev {
  id: BevId;
  name: string;
  brand: string | null;
  flavor: string | null;
  categoryId: CategoryId;
  priceTier: PriceTier;
  isAlcoholic: boolean;
}

/** One `rankings` row. `rankedAt` is ISO 8601. */
export interface EvalRanking {
  userId: UserId;
  bevId: BevId;
  bucket: Bucket;
  position: number;
  score: number;
  rankedAt: string;
}

/** One `comparisons` row. `createdAt` is ISO 8601. */
export interface EvalComparison {
  userId: UserId;
  submissionId: string;
  winnerBevId: BevId;
  loserBevId: BevId;
  tie: boolean;
  createdAt: string;
}

export interface EvalDataset {
  bevs: EvalBev[];
  rankings: EvalRanking[];
  comparisons: EvalComparison[];
}

/** The JSON file Arjun's export produces (see README). Buckets use the DB encoding 3/2/1. */
export interface EvalExport {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  exportedAt?: string;
  bevs: Array<{ id: string; name: string; brand: string | null; flavor: string | null; categoryId: string; priceTier: number; isAlcoholic: boolean }>;
  rankings: Array<{ userId: string; bevId: string; bucket: number; position: number; score: number | string; rankedAt: string }>;
  comparisons: Array<{ userId: string; submissionId: string; winnerBevId: string; loserBevId: string; tie: boolean; createdAt: string }>;
}

const BUCKET_FROM_DB = new Map<number, Bucket>(Object.entries(BUCKET_DB).map(([b, n]) => [n, b as Bucket]));

function fail(where: string, why: string): never {
  throw new Error(`eval export: ${where}: ${why}`);
}

function obj(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(where, 'expected an object');
  return v as Record<string, unknown>;
}

function str(o: Record<string, unknown>, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v === '') fail(where, `"${k}" must be a non-empty string`);
  return v;
}

function optStr(o: Record<string, unknown>, k: string, where: string): string | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') fail(where, `"${k}" must be a string or null`);
  return v;
}

function num(o: Record<string, unknown>, k: string, where: string): number {
  const v = o[k];
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(where, `"${k}" must be a finite number`);
  return n;
}

function bool(o: Record<string, unknown>, k: string, where: string): boolean {
  const v = o[k];
  if (typeof v !== 'boolean') fail(where, `"${k}" must be a boolean`);
  return v;
}

function time(o: Record<string, unknown>, k: string, where: string): string {
  const v = str(o, k, where);
  if (!Number.isFinite(Date.parse(v))) fail(where, `"${k}" is not an ISO timestamp`);
  return v;
}

function arr(o: Record<string, unknown>, k: string): unknown[] {
  const v = o[k];
  if (!Array.isArray(v)) fail('root', `"${k}" must be an array`);
  return v;
}

/** Validates an export (already JSON-decoded) and returns the dataset. Throws on the first malformed row. */
export function parseExport(json: unknown): EvalDataset {
  const root = obj(json, 'root');
  if (root.format !== EXPORT_FORMAT) fail('root', `"format" must be "${EXPORT_FORMAT}"`);
  if (root.formatVersion !== EXPORT_FORMAT_VERSION) fail('root', `unsupported formatVersion ${String(root.formatVersion)}`);

  const bevs = arr(root, 'bevs').map((v, i): EvalBev => {
    const w = `bevs[${i}]`;
    const o = obj(v, w);
    const tier = num(o, 'priceTier', w);
    if (![1, 2, 3, 4].includes(tier)) fail(w, '"priceTier" must be 1–4');
    return {
      id: str(o, 'id', w),
      name: str(o, 'name', w),
      brand: optStr(o, 'brand', w),
      flavor: optStr(o, 'flavor', w),
      categoryId: str(o, 'categoryId', w),
      priceTier: tier as PriceTier,
      isAlcoholic: bool(o, 'isAlcoholic', w),
    };
  });
  const rankings = arr(root, 'rankings').map((v, i): EvalRanking => {
    const w = `rankings[${i}]`;
    const o = obj(v, w);
    const bucket = BUCKET_FROM_DB.get(num(o, 'bucket', w));
    if (!bucket) fail(w, '"bucket" must be 3 (LOVED), 2 (FINE) or 1 (DISLIKED)');
    const position = num(o, 'position', w);
    if (!Number.isInteger(position) || position < 0) fail(w, '"position" must be an integer ≥ 0');
    const score = num(o, 'score', w);
    if (score < 0 || score > 10) fail(w, '"score" must be in [0, 10]');
    return { userId: str(o, 'userId', w), bevId: str(o, 'bevId', w), bucket, position, score, rankedAt: time(o, 'rankedAt', w) };
  });
  const comparisons = arr(root, 'comparisons').map((v, i): EvalComparison => {
    const w = `comparisons[${i}]`;
    const o = obj(v, w);
    return {
      userId: str(o, 'userId', w),
      submissionId: str(o, 'submissionId', w),
      winnerBevId: str(o, 'winnerBevId', w),
      loserBevId: str(o, 'loserBevId', w),
      tie: bool(o, 'tie', w),
      createdAt: time(o, 'createdAt', w),
    };
  });
  return { bevs, rankings, comparisons };
}

/** The inverse of `parseExport` (used to write the synthetic sample file). */
export function toExport(ds: EvalDataset, exportedAt?: string): EvalExport {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    ...(exportedAt === undefined ? {} : { exportedAt }),
    bevs: ds.bevs.map((b) => ({ ...b })),
    rankings: ds.rankings.map((r) => ({ userId: r.userId, bevId: r.bevId, bucket: BUCKET_DB[r.bucket], position: r.position, score: r.score, rankedAt: r.rankedAt })),
    comparisons: ds.comparisons.map((c) => ({ ...c })),
  };
}

export type CatalogFeatures = Omit<BevFeatures, 'ratingCount' | 'mean' | 'stddev'>;

/** The prediction features of a catalog row, normalised exactly as packages/api/src/snapshot.ts does. */
export function featuresOf(b: EvalBev): CatalogFeatures {
  return {
    id: b.id,
    categoryId: b.categoryId,
    brandKey: normaliseBrand(b.brand),
    flavorTokens: flavorTokens(b.name, b.flavor),
    priceTier: b.priceTier,
    isAlcoholic: b.isAlcoholic,
  };
}

export interface PreparedDataset {
  catalog: Map<BevId, CatalogFeatures>;
  /** Rankings on catalog Bevs; a duplicated (user, Bev) keeps the latest `rankedAt`. */
  rankings: EvalRanking[];
  /** Comparisons on catalog Bevs. */
  comparisons: EvalComparison[];
  dropped: { rankingsUnknownBev: number; rankingsDuplicate: number; comparisonsUnknownBev: number };
}

export function prepareDataset(ds: EvalDataset): PreparedDataset {
  const catalog = new Map<BevId, CatalogFeatures>();
  for (const b of [...ds.bevs].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) catalog.set(b.id, featuresOf(b));
  let unknown = 0;
  const latest = new Map<string, EvalRanking>();
  for (const r of ds.rankings) {
    if (!catalog.has(r.bevId)) {
      unknown++;
      continue;
    }
    const key = `${r.userId}\u0000${r.bevId}`;
    const prev = latest.get(key);
    if (!prev || Date.parse(r.rankedAt) >= Date.parse(prev.rankedAt)) latest.set(key, r);
  }
  const kept = ds.rankings.length - unknown;
  const comparisons = ds.comparisons.filter((c) => catalog.has(c.winnerBevId) && catalog.has(c.loserBevId));
  return {
    catalog,
    rankings: [...latest.values()],
    comparisons,
    dropped: { rankingsUnknownBev: unknown, rankingsDuplicate: kept - latest.size, comparisonsUnknownBev: ds.comparisons.length - comparisons.length },
  };
}
