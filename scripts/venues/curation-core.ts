/**
 * The pure half of venue curation (A-08): the chain presets in
 * `data/venues/chains.json` and the craft menus in `data/venues/menus.csv`,
 * resolved against the catalog. No I/O beyond what the caller passes in, so it
 * is unit tested in curation-core.test.ts and `import-osm.ts` keeps the network
 * and the database.
 *
 * WHY SLUGS AND NOT IDS. Every catalog Bev's id is `uuidv5(slug)`
 * (`scripts/catalog/catalog.ts`'s `catalogBevId`), so a preset written in slugs
 * resolves to the exact database ids with no round trip -- which is also why
 * `--dry-run` needs no credentials to say what a branch would carry. A slug that
 * the database skipped at seed time (its natural key already belonged to a
 * user's Bev) resolves to an id with no row; `expand_chain_assortments` ignores
 * ids that are not an active Bev, so that case costs one missing Bev, not a
 * failed run.
 */

import { SAFE_BRAND, type VenueRow } from "./import-core.ts";

/** What the resolver needs to know about a catalog Bev. */
export interface CatalogBev {
  slug: string;
  name: string;
  brand: string;
  /** Root category id (what `bevs.category_id` stores). */
  category: string;
  /** Leaf category id, or "" when the Bev sits on its root. */
  leaf: string;
  alcoholic: boolean;
}

export interface CatalogInput {
  rows: ReadonlyArray<{ slug: string; name: string; brand: string; category: string; leaf: string }>;
  categories: ReadonlyArray<{ id: string; parentId: string | null; isAlcoholic: boolean }>;
}

/**
 * The catalog as the resolver sees it. Alcoholic is decided by the ROOT
 * category, as the database's age gate does (a leaf inherits its root's flag).
 */
export function catalogFrom(input: CatalogInput): CatalogBev[] {
  const alcoholic = new Map(input.categories.map((c) => [c.id, c.isAlcoholic]));
  return input.rows.map((r) => {
    const flag = alcoholic.get(r.category);
    if (flag === undefined) throw new Error(`catalog Bev ${r.slug} has unknown category ${r.category}`);
    return { slug: r.slug, name: r.name, brand: r.brand, category: r.category, leaf: r.leaf, alcoholic: flag };
  });
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

/**
 * Which catalog Bevs a chain carries. The union of everything selected by
 * `include` (named shared assortments), `brands` (case-insensitive, exact),
 * `slugs` and `categories` (a root or a leaf id), minus `exclude_slugs`.
 */
export interface AssortmentSpec {
  include?: string[];
  brands?: string[];
  slugs?: string[];
  categories?: string[];
  exclude_slugs?: string[];
}

export interface ChainSpec {
  id: string;
  name: string;
  /** The OSM `brand` values that identify a branch, as OSM spells them. */
  osm_brands: string[];
  assortment: AssortmentSpec;
}

export interface ChainFile {
  /** Shared assortments a chain can `include`, so the pharmacies say one list once. */
  assortments?: Record<string, AssortmentSpec>;
  chains: ChainSpec[];
}

export interface ResolvedChain {
  id: string;
  name: string;
  osm_brands: string[];
  slugs: string[];
  bev_ids: string[];
}

const CHAIN_ID = /^[a-z0-9-]{2,40}$/;
const SPEC_KEYS = new Set(["include", "brands", "slugs", "categories", "exclude_slugs"]);

function stringList(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.trim() === "")) {
    throw new Error(`${where} must be a list of non-empty strings`);
  }
  return value as string[];
}

/**
 * chains.json -> chains with Bev ids, or an Error naming the first problem.
 *
 * Strict on purpose: an unknown brand, slug, category or include is a typo,
 * and a typo here is a branch silently missing Bevs. And three rules that are
 * not typos:
 *   * NO ALCOHOL, from any selector. A preset is a claim about every branch,
 *     and an alcoholic Bev on a pin is the one claim the age gate makes
 *     expensive to get wrong; a chain whose branches do sell beer gets it
 *     through a human-checked menu instead.
 *   * NO EMPTY CHAIN. A chain with no catalog Bev would give its branches
 *     `kind = 'chain'` and no pin; leave it out of the file instead.
 *   * NO SHARED BRAND. One OSM brand must mean one chain, or which preset a
 *     branch gets would depend on row order.
 */
export function resolveChains(
  file: unknown,
  catalog: readonly CatalogBev[],
  idOf: (slug: string) => string,
): ResolvedChain[] {
  const f = file as ChainFile | null;
  if (!f || !Array.isArray(f.chains)) throw new Error("chains.json must be an object with a `chains` list");

  const bySlug = new Map(catalog.map((b) => [b.slug, b]));
  const brands = new Set(catalog.map((b) => b.brand.toLowerCase()));
  const categories = new Set(catalog.flatMap((b) => (b.leaf ? [b.category, b.leaf] : [b.category])));
  const shared = f.assortments ?? {};

  const select = (spec: AssortmentSpec, where: string, allowInclude: boolean): Set<string> => {
    if (spec === null || typeof spec !== "object") throw new Error(`${where} must be an object`);
    for (const k of Object.keys(spec)) if (!SPEC_KEYS.has(k)) throw new Error(`${where} has unknown key ${k}`);
    const out = new Set<string>();
    for (const name of stringList(spec.include, `${where}.include`)) {
      if (!allowInclude) throw new Error(`${where}: a shared assortment cannot include another`);
      const inner = shared[name];
      if (!inner) throw new Error(`${where}.include: no shared assortment ${name}`);
      for (const s of select(inner, `assortments.${name}`, false)) out.add(s);
    }
    for (const brand of stringList(spec.brands, `${where}.brands`)) {
      const b = brand.toLowerCase();
      if (!brands.has(b)) throw new Error(`${where}.brands: no catalog Bev has brand ${brand}`);
      for (const bev of catalog) if (bev.brand.toLowerCase() === b) out.add(bev.slug);
    }
    for (const slug of stringList(spec.slugs, `${where}.slugs`)) {
      if (!bySlug.has(slug)) throw new Error(`${where}.slugs: unknown slug ${slug}`);
      out.add(slug);
    }
    for (const cat of stringList(spec.categories, `${where}.categories`)) {
      if (!categories.has(cat)) throw new Error(`${where}.categories: no catalog Bev is in ${cat}`);
      for (const bev of catalog) if (bev.category === cat || bev.leaf === cat) out.add(bev.slug);
    }
    for (const slug of stringList(spec.exclude_slugs, `${where}.exclude_slugs`)) {
      if (!bySlug.has(slug)) throw new Error(`${where}.exclude_slugs: unknown slug ${slug}`);
      out.delete(slug);
    }
    return out;
  };

  const ids = new Set<string>();
  const brandOwner = new Map<string, string>();
  const resolved: ResolvedChain[] = [];

  for (const [i, c] of f.chains.entries()) {
    const where = `chains[${i}]`;
    if (!c || typeof c.id !== "string" || !CHAIN_ID.test(c.id)) throw new Error(`${where}.id must match ${CHAIN_ID}`);
    if (ids.has(c.id)) throw new Error(`${where}: duplicate chain id ${c.id}`);
    ids.add(c.id);
    if (typeof c.name !== "string" || c.name.trim().length < 1 || c.name.length > 80) {
      throw new Error(`${c.id}.name must be 1..80 characters`);
    }
    const osmBrands = stringList(c.osm_brands, `${c.id}.osm_brands`);
    if (osmBrands.length === 0) throw new Error(`${c.id}.osm_brands is empty: nothing would match a branch`);
    for (const b of osmBrands) {
      if (!SAFE_BRAND.test(b)) throw new Error(`${c.id}.osm_brands: ${JSON.stringify(b)} has a character Overpass's regex cannot take`);
      const key = b.toLowerCase();
      const owner = brandOwner.get(key);
      if (owner !== undefined && owner !== c.id) throw new Error(`${c.id}.osm_brands: ${b} already belongs to ${owner}`);
      brandOwner.set(key, c.id);
    }

    const slugs = [...select(c.assortment, `${c.id}.assortment`, true)].sort();
    const alcoholic = slugs.filter((s) => bySlug.get(s)!.alcoholic);
    if (alcoholic.length > 0) throw new Error(`${c.id}: presets carry no alcohol, but it selects ${alcoholic.join(", ")}`);
    if (slugs.length === 0) throw new Error(`${c.id}: the assortment selects no catalog Bev; leave the chain out instead`);

    resolved.push({ id: c.id, name: c.name.trim(), osm_brands: osmBrands, slugs, bev_ids: slugs.map(idOf) });
  }

  return resolved.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Lowercased OSM brand -> chain id, which is what `parseElements` matches with. */
export function chainsByBrand(chains: readonly ResolvedChain[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of chains) for (const b of c.osm_brands) m.set(b.toLowerCase(), c.id);
  return m;
}

/** The body `upsert_chains` takes. Brands are lowercased here AND in SQL. */
export function chainsPayload(chains: readonly ResolvedChain[]): Array<{
  id: string;
  name: string;
  osm_brands: string[];
  bev_ids: string[];
}> {
  return chains.map((c) => ({
    id: c.id,
    name: c.name,
    osm_brands: [...new Set(c.osm_brands.map((b) => b.toLowerCase()))].sort(),
    bev_ids: c.bev_ids,
  }));
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export const MENU_HEADER = ["osm_id", "venue_name", "bev_slug", "verified_at", "notes"] as const;

/**
 * RFC 4180, which is what a spreadsheet exports: commas and newlines inside
 * double quotes, `""` for a quote. `notes` is free text, so a plain split on
 * commas -- which the catalog CSV gets away with -- would not do here.
 */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let i = 0;
  const src = text.replace(/^﻿/, "");
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === "") { quoted = true; i += 1; continue; }
    if (ch === ",") { record.push(field); field = ""; i += 1; continue; }
    if (ch === "\r" && src[i + 1] === "\n") { i += 1; continue; }
    if (ch === "\n") { record.push(field); records.push(record); record = []; field = ""; i += 1; continue; }
    field += ch; i += 1;
  }
  if (quoted) throw new Error("menus.csv: a quoted field is never closed");
  if (field !== "" || record.length > 0) { record.push(field); records.push(record); }
  // A blank line is not a record.
  return records.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

export interface MenuRow {
  osm_id: string;
  bev_id: string;
  /** ISO date or timestamp as written, or null for "not yet confirmed". */
  verified_at: string | null;
}

export interface MenuParse {
  rows: MenuRow[];
  /** One line per skipped row, `line N: why`. Never fatal: the rest still applies. */
  problems: string[];
  /** Distinct osm_ids among the accepted rows. */
  venues: string[];
}

const OSM_ID = /^(node|way|relation)\/[0-9]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * menus.csv -> rows. A WRONG HEADER is fatal (every column would be read as the
 * wrong thing); a bad ROW is reported and skipped, so one typo does not hold
 * back everyone else's menus. Alcohol is allowed here, unlike in a preset: a
 * menu row is a human saying "this bar pours this", and the read RPCs' age
 * gate hides it from a minor.
 */
export function parseMenus(text: string, catalog: readonly CatalogBev[], idOf: (slug: string) => string): MenuParse {
  const records = parseCsvRecords(text);
  const header = records.shift();
  if (!header || header.map((h) => h.trim()).join(",") !== MENU_HEADER.join(",")) {
    throw new Error(`menus.csv: the header must be exactly ${MENU_HEADER.join(",")}`);
  }
  const slugs = new Set(catalog.map((b) => b.slug));
  const rows: MenuRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  records.forEach((r, i) => {
    const line = i + 2;
    if (r.length !== MENU_HEADER.length) {
      problems.push(`line ${line}: expected ${MENU_HEADER.length} fields, got ${r.length}`);
      return;
    }
    const [osmId, , slug, verified] = r.map((c) => c.trim()) as [string, string, string, string, string];
    if (!OSM_ID.test(osmId)) { problems.push(`line ${line}: osm_id ${JSON.stringify(osmId)} is not node/N, way/N or relation/N`); return; }
    if (!slugs.has(slug)) { problems.push(`line ${line}: unknown bev_slug ${JSON.stringify(slug)}`); return; }
    if (verified !== "" && (!DATE.test(verified) || Number.isNaN(Date.parse(verified)))) {
      problems.push(`line ${line}: verified_at ${JSON.stringify(verified)} is not a date (YYYY-MM-DD)`);
      return;
    }
    const key = `${osmId} ${slug}`;
    if (seen.has(key)) { problems.push(`line ${line}: ${slug} at ${osmId} is listed twice`); return; }
    seen.add(key);
    rows.push({ osm_id: osmId, bev_id: idOf(slug), verified_at: verified === "" ? null : verified });
  });

  return { rows, problems, venues: [...new Set(rows.map((r) => r.osm_id))].sort() };
}

// ---------------------------------------------------------------------------
// The dry run's forecast
// ---------------------------------------------------------------------------

export interface PinForecast {
  /** Venues that would have at least one Bev, and therefore a pin (D-13). */
  pinned: number;
  /** Of those, how many get it from a chain preset. */
  fromChain: number;
  /** ... and how many from a menu (a venue with both counts in each). */
  fromMenu: number;
  /** venue_bevs rows the run would leave, by source. */
  chainRows: number;
  menuRows: number;
  /** Menu rows naming an osm_id this import did not see. */
  menuUnknownVenues: string[];
}

/**
 * What the database would hold after a sync of exactly these rows, assuming
 * every catalog slug is an active Bev there. It is a forecast for a dry run;
 * a real run prints `venue_sync_report()`, which counts what is actually
 * there (including venues outside this run's bbox).
 */
export function forecastPins(
  rows: readonly VenueRow[],
  chains: readonly ResolvedChain[],
  menus: readonly MenuRow[],
): PinForecast {
  const size = new Map(chains.map((c) => [c.id, new Set(c.bev_ids)]));
  const known = new Set(rows.map((r) => r.osm_id));
  const menuBy = new Map<string, Set<string>>();
  const unknown = new Set<string>();
  for (const m of menus) {
    if (!known.has(m.osm_id)) { unknown.add(m.osm_id); continue; }
    if (!menuBy.has(m.osm_id)) menuBy.set(m.osm_id, new Set());
    menuBy.get(m.osm_id)!.add(m.bev_id);
  }
  let pinned = 0, fromChain = 0, fromMenu = 0, chainRows = 0, menuRows = 0;
  for (const r of rows) {
    const preset = r.chain_id === null ? new Set<string>() : (size.get(r.chain_id) ?? new Set<string>());
    const menu = menuBy.get(r.osm_id) ?? new Set<string>();
    // A Bev on both is one row, source 'menu' (the menu upgrades it).
    const chainOnly = [...preset].filter((b) => !menu.has(b)).length;
    chainRows += chainOnly;
    menuRows += menu.size;
    if (preset.size > 0) fromChain += 1;
    if (menu.size > 0) fromMenu += 1;
    if (preset.size > 0 || menu.size > 0) pinned += 1;
  }
  return { pinned, fromChain, fromMenu, chainRows, menuRows, menuUnknownVenues: [...unknown].sort() };
}
