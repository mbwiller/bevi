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
  lat: number;
  lng: number;
  address: string | null;
  neighborhood: string | null;
  borough: string | null;
  hours_osm: string | null;
  hours_known: boolean;
  website: string | null;
  source: "osm";
}

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
 * The Overpass query. `out center` so a way or relation (a supermarket drawn as
 * a building) arrives with one point rather than a polygon, which is all a pin
 * needs. The area clause clips to the city even when `--bbox` is wider, so the
 * NYC rule holds whatever is passed.
 */
export function overpassQuery(bbox: Bbox, areaId: number = NYC_AREA_ID): string {
  const bb = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const amenity = AMENITIES.join("|");
  const shop = SHOPS.join("|");
  return [
    "[out:json][timeout:180];",
    `area(${areaId})->.nyc;`,
    "(",
    `  nwr["amenity"~"^(${amenity})$"](${bb})(area.nyc);`,
    `  nwr["shop"~"^(${shop})$"](${bb})(area.nyc);`,
    ");",
    "out center tags;",
  ].join("\n");
}

const DAY_INDEX: Record<string, number> = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };

const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
const DAY_PART = `${DAY}(?:-${DAY})?`;
const DAYS = `${DAY_PART}(?:,${DAY_PART})*`;
// 24:00 is allowed, and only as a closing time: "Mo-Su 08:00-24:00" is common
// in OSM and means end of day. 25:00 and similar are not times.
const TIME = "(?:[01][0-9]|2[0-3]):[0-5][0-9]";
const CLOSE = `(?:${TIME}|24:00)`;
const RULE = new RegExp(`^(${DAYS}) (${TIME})-(${CLOSE})$`);

export interface HoursRule {
  /** Day indices the rule covers, Monday = 0. */
  days: number[];
  /** Minutes from midnight. `close` may be 1440 for 24:00. */
  open: number;
  close: number;
}

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** `Mo-We,Fr` -> [0, 1, 2, 4]; null if a range runs backwards or a day repeats. */
function dayList(spec: string): number[] | null {
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const [from, to] = part.split("-");
    const a = DAY_INDEX[from!];
    if (a === undefined) return null;
    if (to === undefined) {
      out.push(a);
      continue;
    }
    const b = DAY_INDEX[to];
    // A backwards range like `Fr-Mo` is legal in the opening_hours spec (it
    // wraps the week) but needs wrap-aware evaluation, so it is not something
    // we claim to understand.
    if (b === undefined || b <= a) return null;
    for (let d = a; d <= b; d += 1) out.push(d);
  }
  return new Set(out).size === out.length ? out : null;
}

/**
 * The `opening_hours` strings we are willing to claim we understand, which is
 * what `hours_known` promises -- NOT merely that the string exists.
 *
 * Deliberately a narrow recogniser rather than the `opening_hours` npm parser:
 * this repo's scripts take no dependencies, and "Open now is best-effort"
 * (A-08) is satisfied by being honest about what we do not understand. Three
 * of these exclusions were false positives in the first draft, found in
 * review, and each one would have made a naive "is it open now?" wrong rather
 * than unknown:
 *
 *   * `;` is an OVERRIDE separator in the spec, not "and also". In
 *     `Mo-Su 11:00-22:00; We 11:00-15:00` the Wednesday rule REPLACES the
 *     general one, so OR-ing the rules says open at 20:00 on a Wednesday.
 *     Multiple rules are therefore accepted only when their day sets are
 *     DISJOINT, which is exactly when override and union agree -- that keeps
 *     the common `Mo-Fr ...; Sa-Su ...` and rejects the trap.
 *   * An OVERNIGHT range (`Mo-Su 18:00-02:00`) needs wrap-around handling, and
 *     we import bars and pubs, so it is the normal case for some venues. A
 *     rule whose close is not after its open is not understood.
 *   * A BACKWARDS day range (`Fr-Mo`) wraps the week; same reasoning.
 *
 * Everything else outside the grammar -- `24/7`, `PH off`, month ranges,
 * `sunrise`, open-ended `07:00+` -- is unknown too, so the UI says "Hours
 * unknown" instead of guessing.
 */
export function parseHours(hoursOsm: string | null): HoursRule[] | null {
  if (hoursOsm === null) return null;
  const trimmed = hoursOsm.trim();
  if (trimmed === "") return null;

  const rules: HoursRule[] = [];
  const claimed = new Set<number>();
  for (const raw of trimmed.split(";")) {
    const m = RULE.exec(raw.trim());
    if (m === null) return null;
    const days = dayList(m[1]!);
    if (days === null) return null;
    // Disjoint day sets only: see the note above on `;`.
    for (const d of days) {
      if (claimed.has(d)) return null;
      claimed.add(d);
    }
    const open = minutes(m[2]!);
    const close = m[3] === "24:00" ? 24 * 60 : minutes(m[3]!);
    if (close <= open) return null;
    rules.push({ days, open, close });
  }
  return rules;
}

export function hoursKnown(hoursOsm: string | null): boolean {
  return parseHours(hoursOsm) !== null;
}

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
 * Elements -> rows, with every drop accounted for. `chainBrands` maps a
 * lowercased OSM `brand` to nothing but presence: a match makes the venue
 * `kind = 'chain'`, which is what lets a `chains` preset expand onto it.
 */
export function parseElements(
  elements: readonly OsmElement[],
  chainBrands: ReadonlySet<string>,
  bounds: Bbox = NYC_BOUNDS,
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

    const brand = tags.brand?.trim().toLowerCase();
    const hoursOsm = trimToNull(tags.opening_hours, 200);

    rows.push({
      osm_id: osmId,
      name,
      kind: brand && chainBrands.has(brand) ? "chain" : "craft",
      lat,
      lng,
      address: trimToNull(address(tags) ?? undefined, 200),
      neighborhood: trimToNull(tags["addr:suburb"], 80),
      borough: borough(tags),
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
  neighborhoods: Array<[string, number]>;
  skipped: Array<[SkipReason["reason"], number]>;
}

export function report(result: ParseResult): Report {
  const byNeighborhood = new Map<string, number>();
  for (const r of result.rows) {
    const key = r.neighborhood ?? "(none)";
    byNeighborhood.set(key, (byNeighborhood.get(key) ?? 0) + 1);
  }
  const bySkip = new Map<SkipReason["reason"], number>();
  for (const s of result.skipped) bySkip.set(s.reason, (bySkip.get(s.reason) ?? 0) + 1);

  return {
    total: result.rows.length,
    chain: result.rows.filter((r) => r.kind === "chain").length,
    craft: result.rows.filter((r) => r.kind === "craft").length,
    withHours: result.rows.filter((r) => r.hours_osm !== null).length,
    withKnownHours: result.rows.filter((r) => r.hours_known).length,
    neighborhoods: [...byNeighborhood].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    skipped: [...bySkip].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
  };
}
