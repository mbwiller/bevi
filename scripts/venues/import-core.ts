/**
 * The pure half of the OpenStreetMap venue import (A-08). No I/O, no fetch, no
 * environment: everything here is a function of its arguments, so it is unit
 * tested in import-core.test.ts and `import-osm.ts` keeps only the network and
 * the database.
 *
 * Conventions follow scripts/graph/edges-core.ts: no dependencies, Node 22
 * type stripping, and the impure shell stays as thin as it can be.
 */

/**
 * The five-borough bounding box (decision 36). THE SAME SIX FIGURES are the
 * `venues_nyc_bounds` CHECK in 20261102000300 and `NYC_BOUNDS` in `shared/`
 * (half 2). A row outside them is dropped here rather than offered to the
 * database, so the CHECK is a backstop and never a crash.
 */
export const NYC_BOUNDS = {
  south: 40.477,
  north: 40.918,
  west: -74.26,
  east: -73.7,
} as const;

/**
 * Where curation starts (D-13): the Upper East Side, with Roosevelt Island in
 * frame. One box covering both, which is also roughly what M-16's default view
 * will show. `--bbox` overrides it, so widening coverage is a flag rather than
 * a code change.
 */
export const START_BBOX = {
  south: 40.749,
  north: 40.787,
  west: -73.97,
  east: -73.941,
} as const;

export interface Bbox {
  south: number;
  north: number;
  west: number;
  east: number;
}

/** OSM tags we import a venue for (decision 35). */
export const AMENITIES = ["cafe", "bar", "pub", "juice_bar"] as const;
export const SHOPS = ["convenience", "supermarket", "alcohol", "beverages", "coffee", "tea", "deli"] as const;

/** The New York City relation; 3600000000 + 175905 is its Overpass area id. */
export const NYC_AREA_ID = 3600175905;

export interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface VenueRow {
  osm_id: string;
  name: string;
  kind: "chain" | "craft";
  /**
   * The `chains.id` this venue is a branch of, or null. Set exactly when
   * `kind` is "chain" (the `venues_chain_is_chain_kind` CHECK of
   * 20261109000200 holds the database to the same rule).
   */
  chain_id: string | null;
  lat: number;
  lng: number;
  address: string | null;
  neighborhood: string | null;
  borough: Borough | null;
  hours_osm: string | null;
  hours_known: boolean;
  website: string | null;
  source: "osm";
}

export type Borough = "Manhattan" | "Brooklyn" | "Queens" | "Bronx" | "Staten Island";

/** What `locate` answers: a neighbourhood name and its borough. */
export interface Place {
  neighborhood: string;
  borough: Borough;
}

export type Locator = (lat: number, lng: number) => Place | null;

export interface SkipReason {
  osmId: string;
  reason: "no name" | "no coordinates" | "outside New York City" | "no imported tag" | "duplicate";
}

export interface ParseResult {
  rows: VenueRow[];
  skipped: SkipReason[];
}

export function inBounds(lat: number, lng: number, b: Bbox = NYC_BOUNDS): boolean {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

/**
 * Tags we import ONLY for a branch of a preset chain. Decision 35 lists the
 * kinds of place a Bev is bought in; Dunkin' is mapped as `amenity=fast_food`
 * and Duane Reade / CVS / Walgreens as `amenity=pharmacy` or `shop=chemist`,
 * none of which decision 35 imports. Importing every fast-food counter or
 * pharmacy would bring in hundreds of places with nothing to pin, so these
 * tags are queried only together with a `brand` that `data/venues/chains.json`
 * names -- the chain preset IS the curation that says the branch sells Bevs.
 */
export const CHAIN_ONLY_AMENITIES = ["fast_food", "pharmacy"] as const;
export const CHAIN_ONLY_SHOPS = ["chemist"] as const;

/**
 * A brand goes into an Overpass regex unescaped, so it must not contain a
 * regex metacharacter or a quote. Every real NYC chain brand fits (letters,
 * digits, spaces, `'`, `&`, `-`); `loadChains` refuses anything else rather
 * than escaping it, because an escaping bug here silently drops branches.
 */
export const SAFE_BRAND = /^[A-Za-z0-9 '&-]{1,60}$/;

/**
 * The Overpass query. `out center` so a way or relation (a supermarket drawn as
 * a building) arrives with one point rather than a polygon, which is all a pin
 * needs. The area clause clips to the city even when `--bbox` is wider, so the
 * NYC rule holds whatever is passed.
 *
 * `chainBrands` are the exact OSM `brand` values of the preset chains (case
 * as OSM writes them; matched case-insensitively). With none, the query is
 * decision 35's two clauses and nothing else. Still ONE query either way --
 * Overpass etiquette (A-08).
 */
export function overpassQuery(
  bbox: Bbox,
  areaId: number = NYC_AREA_ID,
  chainBrands: readonly string[] = [],
): string {
  const bb = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const amenity = AMENITIES.join("|");
  const shop = SHOPS.join("|");
  const lines = [
    "[out:json][timeout:180];",
    `area(${areaId})->.nyc;`,
    "(",
    `  nwr["amenity"~"^(${amenity})$"](${bb})(area.nyc);`,
    `  nwr["shop"~"^(${shop})$"](${bb})(area.nyc);`,
  ];
  const brands = [...new Set(chainBrands)].sort();
  if (brands.length > 0) {
    for (const b of brands) {
      if (!SAFE_BRAND.test(b)) throw new Error(`brand ${JSON.stringify(b)} is not safe to put in an Overpass regex`);
    }
    const alt = brands.join("|");
    lines.push(
      `  nwr["brand"~"^(${alt})$",i]["amenity"~"^(${CHAIN_ONLY_AMENITIES.join("|")})$"](${bb})(area.nyc);`,
      `  nwr["brand"~"^(${alt})$",i]["shop"~"^(${CHAIN_ONLY_SHOPS.join("|")})$"](${bb})(area.nyc);`,
    );
  }
  lines.push(");", "out center tags;");
  return lines.join("\n");
}

// The recogniser moved to `shared/src/hours.ts` so the FakeApi answers
// `openNow` with the same grammar this importer uses to set `hours_known`.
// SQL carries its own copy (`venue_open_at`, 20261102000400) because it has
// to; two definitions is the floor, three was not. Re-exported so this
// module's callers and tests keep one import.
// The file, not the package: `@bevi/shared`'s index uses extensionless
// relative imports, which only a bundler or tsc resolves -- Node's ESM loader
// refuses them, and everything in scripts/ runs under plain
// `node --experimental-strip-types`. `hours.ts` imports nothing, so pointing
// at it directly costs nothing and avoids rewriting the contract package's
// imports for one helper.
import { hoursKnown } from "../../shared/src/hours.ts";

export { hoursKnown, openAt, parseHours, type HoursRule } from "../../shared/src/hours.ts";

/** `addr:housenumber` + `addr:street`, which is as much as OSM reliably has. */
function address(tags: Record<string, string>): string | null {
  const house = tags["addr:housenumber"]?.trim();
  const street = tags["addr:street"]?.trim();
  if (street && house) return `${house} ${street}`;
  return street || null;
}

/**
 * OSM writes the borough as `addr:city` ("Brooklyn") or, for Manhattan, often
 * as "New York". Anything we do not recognise stays null rather than guessing:
 * the column is a five-value CHECK and a wrong borough is worse than none.
 */
const BOROUGHS: Record<string, VenueRow["borough"]> = {
  "new york": "Manhattan",
  manhattan: "Manhattan",
  brooklyn: "Brooklyn",
  queens: "Queens",
  bronx: "Bronx",
  "the bronx": "Bronx",
  "staten island": "Staten Island",
};

function borough(tags: Record<string, string>): VenueRow["borough"] {
  const raw = (tags["addr:city"] ?? tags["addr:borough"] ?? "").trim().toLowerCase();
  return BOROUGHS[raw] ?? null;
}

const trimToNull = (value: string | undefined, max: number): string | null => {
  const v = value?.trim();
  if (!v) return null;
  return v.length > max ? v.slice(0, max) : v;
};

/**
 * The key a venue is matched to a chain by: its OSM `brand`, lowercased and
 * trimmed -- or, when the element has no `brand` at all, its `name`. The name
 * fallback exists for one real case: the six Gristedes on the Upper East Side
 * carry `name=Gristedes` and no `brand` tag. It is an EXACT match on the
 * whole name, so "Gristedes Liquors" or "Starbucks Reserve Bar" do not match.
 */
export function chainKey(tags: Record<string, string>): string | null {
  const brand = tags.brand?.trim().toLowerCase();
  if (brand) return brand;
  return tags.name?.trim().toLowerCase() || null;
}

/**
 * Elements -> rows, with every drop accounted for.
 *
 * `chainsByBrand` maps a lowercased OSM brand (see `chainKey`) to a
 * `chains.id`: a match makes the venue `kind = 'chain'` with that `chain_id`,
 * which is what lets `expand_chain_assortments` give it the chain's Bevs.
 *
 * `locate` fills the neighbourhood and borough from NYC's Neighborhood
 * Tabulation Areas (see `makeLocator`). OSM's own `addr:suburb` still wins for
 * the neighbourhood when a mapper set one; the BOROUGH comes from the polygon
 * whenever there is one, because `addr:city = New York` -- the commonest value
 * -- is what mappers write for every borough, and only the polygon knows.
 */
export function parseElements(
  elements: readonly OsmElement[],
  chainsByBrand: ReadonlyMap<string, string>,
  bounds: Bbox = NYC_BOUNDS,
  locate: Locator | null = null,
): ParseResult {
  const rows: VenueRow[] = [];
  const skipped: SkipReason[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const osmId = `${el.type}/${el.id}`;
    const tags = el.tags ?? {};

    if (seen.has(osmId)) {
      skipped.push({ osmId, reason: "duplicate" });
      continue;
    }
    seen.add(osmId);

    if (!tags.amenity && !tags.shop) {
      skipped.push({ osmId, reason: "no imported tag" });
      continue;
    }
    const name = trimToNull(tags.name, 120);
    if (name === null) {
      // A nameless cafe cannot be shown on a pin or matched to a menu.
      skipped.push({ osmId, reason: "no name" });
      continue;
    }
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") {
      skipped.push({ osmId, reason: "no coordinates" });
      continue;
    }
    if (!inBounds(lat, lng, bounds)) {
      skipped.push({ osmId, reason: "outside New York City" });
      continue;
    }

    const key = chainKey(tags);
    const chainId = key === null ? null : (chainsByBrand.get(key) ?? null);
    const place = locate ? locate(lat, lng) : null;
    const hoursOsm = trimToNull(tags.opening_hours, 200);

    rows.push({
      osm_id: osmId,
      name,
      kind: chainId === null ? "craft" : "chain",
      chain_id: chainId,
      lat,
      lng,
      address: trimToNull(address(tags) ?? undefined, 200),
      neighborhood: trimToNull(tags["addr:suburb"], 80) ?? place?.neighborhood ?? null,
      borough: place?.borough ?? borough(tags),
      hours_osm: hoursOsm,
      hours_known: hoursKnown(hoursOsm),
      website: trimToNull(tags.website ?? tags["contact:website"], 300),
      source: "osm",
    });
  }

  // Stable order, so two runs over the same data produce the same CSV and the
  // same request body: the diff of a re-import is then only what OSM changed.
  rows.sort((a, b) => (a.osm_id < b.osm_id ? -1 : a.osm_id > b.osm_id ? 1 : 0));
  return { rows, skipped };
}

const CSV_COLUMNS = [
  "osm_id",
  "name",
  "kind",
  "chain_id",
  "lat",
  "lng",
  "address",
  "neighborhood",
  "borough",
  "hours_osm",
  "hours_known",
  "website",
] as const;

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The reviewable CSV (A-08): what the import would write, for human eyes first. */
export function toCsv(rows: readonly VenueRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return [header, ...body, ""].join("\n");
}

export interface Report {
  total: number;
  chain: number;
  craft: number;
  withHours: number;
  withKnownHours: number;
  withNeighborhood: number;
  withBorough: number;
  neighborhoods: Array<[string, number]>;
  /** Branches per `chain_id`, largest first. */
  chainBranches: Array<[string, number]>;
  skipped: Array<[SkipReason["reason"], number]>;
}

const countBy = <K extends string>(keys: Iterable<K>): Array<[K, number]> => {
  const m = new Map<K, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
};

export function report(result: ParseResult): Report {
  return {
    total: result.rows.length,
    chain: result.rows.filter((r) => r.kind === "chain").length,
    craft: result.rows.filter((r) => r.kind === "craft").length,
    withHours: result.rows.filter((r) => r.hours_osm !== null).length,
    withKnownHours: result.rows.filter((r) => r.hours_known).length,
    withNeighborhood: result.rows.filter((r) => r.neighborhood !== null).length,
    withBorough: result.rows.filter((r) => r.borough !== null).length,
    neighborhoods: countBy(result.rows.map((r) => r.neighborhood ?? "(none)")),
    chainBranches: countBy(result.rows.flatMap((r) => (r.chain_id === null ? [] : [r.chain_id]))),
    skipped: countBy(result.skipped.map((s) => s.reason)),
  };
}

// ---------------------------------------------------------------------------
// Neighbourhoods: point-in-polygon against NYC's 2020 NTAs
// ---------------------------------------------------------------------------
//
// NYC mappers do not use `addr:suburb` (0 of 410 venues in D-13's box had
// one), so the neighbourhood comes from the city's own Neighborhood
// Tabulation Areas: `data/venues/nyc-nta-2020.geojson`, a trimmed copy of NYC
// Open Data dataset 9nt8-h7nd built by `build-nta.ts` (see
// data/venues/README.md for the source and licence). No dependency: GeoJSON
// is JSON, and ray casting is twenty lines.

/** [lng, lat], GeoJSON's order. */
export type Position = [number, number];
/** A closed ring: first position equals the last. */
export type Ring = Position[];
/** GeoJSON polygon coordinates: the outer ring, then any holes. */
export type PolygonCoords = Ring[];

export interface Area {
  /** The NTA code, e.g. "MN0801". Two areas share one when an NTA is split (Roosevelt Island). */
  code: string;
  name: string;
  borough: Borough;
  polygons: PolygonCoords[];
  /** west, south, east, north -- the cheap rejection before the ray cast. */
  bbox: [number, number, number, number];
}

/**
 * Even-odd ray casting: a ray from the point towards +x crosses the ring's
 * edges an odd number of times exactly when the point is inside. Orientation
 * does not matter, which is why holes need no special winding. A point
 * exactly on an edge may land either side; at 5 dp (about a metre) that is a
 * venue on a boundary line, and either neighbour is a fair answer.
 */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and inside none of the holes. */
export function pointInPolygon(lng: number, lat: number, polygon: PolygonCoords): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || !pointInRing(lng, lat, outer)) return false;
  return !holes.some((h) => pointInRing(lng, lat, h));
}

const BOROUGH_NAMES: ReadonlySet<string> = new Set(["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]);

function bboxOf(polygons: readonly PolygonCoords[]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of polygons) for (const [x, y] of p[0] ?? []) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** A GeoJSON Polygon or MultiPolygon geometry, as a list of polygons. */
function polygonsOf(geometry: unknown): PolygonCoords[] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (g?.type === "Polygon") return [g.coordinates as PolygonCoords];
  if (g?.type === "MultiPolygon") return g.coordinates as PolygonCoords[];
  throw new Error(`expected a Polygon or MultiPolygon, got ${String(g?.type)}`);
}

/**
 * The committed, trimmed file -> areas. Its features carry exactly
 * `{ nta2020, name, borough }` (see `trimNtas`); anything else is an error,
 * because a silently empty locator would put every venue back at "no
 * neighbourhood" with nothing in the log to say why.
 */
export function areasFromGeoJson(fc: unknown): Area[] {
  const features = (fc as { features?: unknown })?.features;
  if (!Array.isArray(features) || features.length === 0) throw new Error("NTA file has no features");
  return features.map((f: { properties?: Record<string, unknown>; geometry?: unknown }) => {
    const p = f.properties ?? {};
    const name = p.name, borough = p.borough, code = p.nta2020;
    if (typeof name !== "string" || name === "") throw new Error("NTA feature without a name");
    if (typeof code !== "string") throw new Error(`NTA feature ${name} without an nta2020 code`);
    if (typeof borough !== "string" || !BOROUGH_NAMES.has(borough)) {
      throw new Error(`NTA feature ${name} has borough ${String(borough)}`);
    }
    const polygons = polygonsOf(f.geometry);
    return { code, name, borough: borough as Borough, polygons, bbox: bboxOf(polygons) };
  });
}

/**
 * `locate(lat, lng)` over a set of areas: the first area containing the
 * point, or null (the river, the harbour, a pier the NTAs leave out). NTAs
 * tile the city without overlap, so "first" only matters on a shared edge.
 */
export function makeLocator(areas: readonly Area[]): Locator {
  return (lat, lng) => {
    for (const a of areas) {
      const [w, s, e, n] = a.bbox;
      if (lng < w || lng > e || lat < s || lat > n) continue;
      if (a.polygons.some((p) => pointInPolygon(lng, lat, p))) {
        return { neighborhood: a.name, borough: a.borough };
      }
    }
    return null;
  };
}

/**
 * NTA 2020 names are compound ("Upper East Side-Lenox Hill-Roosevelt
 * Island"), which reads as a census label rather than a neighbourhood in
 * M-16's filter. The three Upper East Side NTAs are renamed to what their
 * ground actually is, checked against the polygons rather than the labels:
 *
 *   MN0802 "Upper East Side-Carnegie Hill" is the strip from Fifth Avenue to
 *          about Third, 59th to 96th Street -- Madison and Park in the 60s and
 *          70s as much as Carnegie Hill proper -- so it is "Upper East Side";
 *          calling it Carnegie Hill would mislabel Lexington and 68th.
 *   MN0801 "Upper East Side-Lenox Hill-Roosevelt Island", east of Third in
 *          the 60s and 70s, is "Lenox Hill" (its island part is split off,
 *          below).
 *   MN0803 "Upper East Side-Yorkville", east of Third in the 80s, is
 *          "Yorkville".
 *
 * So the filter offers Upper East Side, Lenox Hill, Yorkville and Roosevelt
 * Island. Every other NTA keeps its official name, which is right everywhere
 * and merely official-sounding outside D-13's starting area; growing the
 * coverage is the moment to extend this table, not a reason to guess now.
 */
export const NTA_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  MN0801: "Lenox Hill",
  MN0802: "Upper East Side",
  MN0803: "Yorkville",
};

/**
 * Roosevelt Island is not its own NTA: MN0801 is "Upper East Side-Lenox
 * Hill-Roosevelt Island", one MultiPolygon whose members are the Lenox Hill
 * mainland, the island, and two East River islets. A rectangle cannot split
 * them (the island is diagonal and the river narrow, so any box around it
 * takes in York Avenue), but the MultiPolygon already has: each member is a
 * separate polygon. The rule is therefore explicit and testable -- the member
 * containing `LENOX_HILL_PROBE` (Second Avenue at East 70th Street) is Lenox
 * Hill, and every other member of MN0801, all of them islands in the East
 * River, is Roosevelt Island. `trimNtas` throws if the probe ever stops
 * landing in exactly one member, so a redrawn NTA cannot split silently wrong.
 */
export const RI_SPLIT_CODE = "MN0801";
export const LENOX_HILL_PROBE = { lat: 40.767, lng: -73.959 } as const;
export const ROOSEVELT_ISLAND = "Roosevelt Island";

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Perpendicular distance from p to the segment a-b, in degrees (fine at city scale). */
function segmentDistance(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}

/** Douglas-Peucker on an open path, iteratively (rings run to thousands of points). */
function simplifyPath(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxD = 0, index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i]!, points[first]!, points[last]!);
      if (d > maxD) { maxD = d; index = i; }
    }
    if (index !== -1 && maxD > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Round to 5 dp (about 1.1 m), drop the repeats that rounding creates, and
 * simplify within `tolerance` degrees. A ring that collapses below a
 * triangle is dropped (only slivers do), and it stays closed.
 */
export function trimRing(ring: Ring, tolerance: number): Ring | null {
  const rounded: Position[] = [];
  for (const [x, y] of ring) {
    const p: Position = [round5(x), round5(y)];
    const prev = rounded[rounded.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) rounded.push(p);
  }
  if (rounded.length > 1) {
    const a = rounded[0]!, z = rounded[rounded.length - 1]!;
    if (a[0] === z[0] && a[1] === z[1]) rounded.pop();
  }
  if (rounded.length < 3) return null;
  // Simplify as an open path from the first point back to itself, so the
  // closing vertex is pinned.
  const simplified = simplifyPath([...rounded, rounded[0]!], tolerance);
  if (simplified.length < 4) return null;
  return simplified;
}

export interface TrimmedFeature {
  type: "Feature";
  properties: { nta2020: string; name: string; borough: Borough };
  geometry: { type: "MultiPolygon"; coordinates: PolygonCoords[] };
}

/**
 * NYC Open Data's NTA 2020 FeatureCollection -> the committed file: only
 * `nta2020`, a display `name` and `borough`, coordinates rounded and
 * simplified, MN0801 split into Lenox Hill and Roosevelt Island. Sorted by
 * code then name, so a rebuild from the same download is byte-identical.
 */
export function trimNtas(raw: unknown, tolerance = 0.00001): TrimmedFeature[] {
  const features = (raw as { features?: unknown })?.features;
  if (!Array.isArray(features) || features.length === 0) throw new Error("not an NTA FeatureCollection");
  const out: TrimmedFeature[] = [];
  const emit = (code: string, name: string, borough: Borough, polygons: PolygonCoords[]) => {
    const trimmed: PolygonCoords[] = [];
    for (const [outer, ...holes] of polygons) {
      // A collapsed OUTER ring drops the whole polygon: its holes mean nothing alone.
      const o = outer ? trimRing(outer, tolerance) : null;
      if (o === null) continue;
      trimmed.push([o, ...holes.map((h) => trimRing(h, tolerance)).filter((r): r is Ring => r !== null)]);
    }
    if (trimmed.length > 0) {
      out.push({ type: "Feature", properties: { nta2020: code, name, borough }, geometry: { type: "MultiPolygon", coordinates: trimmed } });
    }
  };
  for (const f of features as Array<{ properties?: Record<string, unknown>; geometry?: unknown }>) {
    const p = f.properties ?? {};
    const code = String(p.nta2020 ?? "");
    const official = String(p.ntaname ?? "");
    const borough = String(p.boroname ?? "");
    if (!/^[A-Z]{2}[0-9]{2}[0-9]{2}$/.test(code) || official === "") throw new Error(`NTA feature without a code or name: ${JSON.stringify(p)}`);
    if (!BOROUGH_NAMES.has(borough)) throw new Error(`NTA ${code} has borough ${borough}`);
    const polygons = polygonsOf(f.geometry);
    const name = NTA_DISPLAY_NAMES[code] ?? official;
    if (code === RI_SPLIT_CODE) {
      const mainland = polygons.filter((poly) => pointInPolygon(LENOX_HILL_PROBE.lng, LENOX_HILL_PROBE.lat, poly));
      if (mainland.length !== 1) throw new Error(`${code}: expected exactly one member containing the Lenox Hill probe, found ${mainland.length}`);
      emit(code, name, borough as Borough, mainland);
      emit(code, ROOSEVELT_ISLAND, borough as Borough, polygons.filter((poly) => !mainland.includes(poly)));
    } else {
      emit(code, name, borough as Borough, polygons);
    }
  }
  out.sort((a, b) =>
    a.properties.nta2020 < b.properties.nta2020 ? -1 : a.properties.nta2020 > b.properties.nta2020 ? 1
      : a.properties.name < b.properties.name ? -1 : a.properties.name > b.properties.name ? 1 : 0);
  return out;
}

/** One feature per line: reviewable in a diff, and a fraction of pretty-printed size. */
export function ntaFileText(features: readonly TrimmedFeature[]): string {
  return ['{"type":"FeatureCollection","features":[', features.map((f) => JSON.stringify(f)).join(",\n"), "]}", ""].join("\n");
}
