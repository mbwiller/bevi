/**
 * Unit tests for scripts/venues/import-core.ts -- the pure half of the
 * OpenStreetMap venue import (A-08).
 *
 *   npm run test:scripts
 *
 * node:test and node:assert, run with `--experimental-strip-types`, as in
 * scripts/graph/edges-core.test.ts: scripts/ is not an npm workspace and has
 * no test dependency of its own.
 *
 * What is under test is the plumbing a database cannot be borrowed to check:
 * the Overpass query's shape, the drop rules (and that every drop is counted),
 * the NYC box, the `hours_known` recogniser, and the CSV quoting. The one
 * thing deliberately pinned to the migration is the bounding box: the same six
 * figures are the `venues_nyc_bounds` CHECK and `shared/NYC_BOUNDS`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AMENITIES,
  CHAIN_ONLY_AMENITIES,
  CHAIN_ONLY_SHOPS,
  DEFAULT_OVERPASS_ENDPOINTS,
  LENOX_HILL_PROBE,
  NTA_DISPLAY_NAMES,
  NYC_AREA_ID,
  NYC_BOUNDS,
  SHOPS,
  START_BBOX,
  areasFromGeoJson,
  chainKey,
  hoursKnown,
  inBounds,
  makeLocator,
  ntaFileText,
  openAt,
  overpassEndpoints,
  overpassQuery,
  parseElements,
  parseHours,
  pointInPolygon,
  pointInRing,
  report,
  toCsv,
  trimNtas,
  trimRing,
  type OsmElement,
  type PolygonCoords,
} from "./import-core.ts";

const CHAINS = new Map([
  ["duane reade", "duane-reade"],
  ["cvs pharmacy", "cvs"],
  ["7-eleven", "7-eleven"],
  ["gristedes", "gristedes"],
]);

const el = (over: Partial<OsmElement> & { id: number }): OsmElement => ({
  type: "node",
  lat: 40.7736,
  lon: -73.9566,
  tags: { amenity: "cafe", name: "A Cafe" },
  ...over,
});

// ---------------------------------------------------------------------------
// The bounding box, which three other places depend on
// ---------------------------------------------------------------------------

test("NYC_BOUNDS is the five-borough box the migration's CHECK uses", () => {
  assert.deepEqual({ ...NYC_BOUNDS }, { south: 40.477, north: 40.918, west: -74.26, east: -73.7 });
});

test("the box is inclusive on every edge, like the CHECK's BETWEEN", () => {
  assert.equal(inBounds(40.477, -74.26), true);
  assert.equal(inBounds(40.918, -73.7), true);
  assert.equal(inBounds(40.4769, -73.95), false);
  assert.equal(inBounds(40.9181, -73.95), false);
  assert.equal(inBounds(40.75, -74.2601), false);
  assert.equal(inBounds(40.75, -73.6999), false);
});

test("the starting area (D-13) is inside the city box", () => {
  assert.equal(inBounds(START_BBOX.south, START_BBOX.west), true);
  assert.equal(inBounds(START_BBOX.north, START_BBOX.east), true);
});

// ---------------------------------------------------------------------------
// The Overpass query
// ---------------------------------------------------------------------------

test("the query clips to the New York City area as well as the bbox", () => {
  const q = overpassQuery(START_BBOX);
  assert.match(q, new RegExp(`area\\(${NYC_AREA_ID}\\)->\\.nyc;`));
  // Both clauses are area-restricted, so a wider --bbox cannot import New Jersey.
  assert.equal(q.match(/\(area\.nyc\);/g)?.length, 2);
  assert.match(q, /40\.749,-73\.97,40\.787,-73\.941/);
});

test("the query asks for every imported tag, and a point for ways", () => {
  const q = overpassQuery(START_BBOX);
  for (const a of AMENITIES) assert.ok(q.includes(a), `amenity ${a}`);
  for (const s of SHOPS) assert.ok(q.includes(s), `shop ${s}`);
  // `out center` is what gives a supermarket drawn as a building one pin.
  assert.match(q, /out center tags;/);
  assert.match(q, /\[out:json\]/);
});

// ---------------------------------------------------------------------------
// parseElements: the drop rules, and that nothing vanishes unaccounted for
// ---------------------------------------------------------------------------

test("a named, located, in-bounds venue becomes a row", () => {
  const { rows, skipped } = parseElements([el({ id: 1 })], CHAINS);
  assert.equal(skipped.length, 0);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    osm_id: "node/1",
    name: "A Cafe",
    kind: "craft",
    chain_id: null,
    lat: 40.7736,
    lng: -73.9566,
    address: null,
    neighborhood: null,
    borough: null,
    hours_osm: null,
    hours_known: false,
    website: null,
    source: "osm",
  });
});

test("a nameless venue is dropped and counted: a pin needs a name", () => {
  const { rows, skipped } = parseElements([el({ id: 2, tags: { amenity: "cafe" } })], CHAINS);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped, [{ osmId: "node/2", reason: "no name" }]);
});

test("a venue with no coordinates is dropped and counted", () => {
  const e = el({ id: 3 });
  delete e.lat;
  delete e.lon;
  const { rows, skipped } = parseElements([e], CHAINS);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped, [{ osmId: "node/3", reason: "no coordinates" }]);
});

test("a venue outside the box is dropped, so the CHECK is a backstop and never a crash", () => {
  // Yonkers: north of 40.918, so outside the box on latitude.
  const { rows, skipped } = parseElements([el({ id: 4, lat: 40.9312, lon: -73.8988 })], CHAINS);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped, [{ osmId: "node/4", reason: "outside New York City" }]);
});

test("the box is a RECTANGLE, so it alone does not exclude New Jersey", () => {
  // Hoboken is west of Manhattan but well inside the five-borough bounding
  // rectangle, so inBounds keeps it. What actually excludes it is the Overpass
  // `(area.nyc)` clip on both clauses, which the query tests above pin -- and
  // the database CHECK is a rectangle for the same reason, so it cannot be the
  // thing that enforces "strictly New York City" either.
  assert.equal(inBounds(40.744, -74.032), true);
  const { rows } = parseElements([el({ id: 25, lat: 40.744, lon: -74.032 })], CHAINS);
  assert.equal(rows.length, 1, "kept by the box; dropped by Overpass, not here");
});

test("an element with neither amenity nor shop is dropped and counted", () => {
  const { rows, skipped } = parseElements([el({ id: 5, tags: { name: "A Bench" } })], CHAINS);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped, [{ osmId: "node/5", reason: "no imported tag" }]);
});

test("a way arrives through `center`, with its type in the id", () => {
  const { rows } = parseElements(
    [
      {
        type: "way",
        id: 6,
        center: { lat: 40.77, lon: -73.96 },
        tags: { shop: "supermarket", name: "A Market" },
      },
    ],
    CHAINS,
  );
  assert.equal(rows[0]?.osm_id, "way/6");
  assert.equal(rows[0]?.lat, 40.77);
  assert.equal(rows[0]?.lng, -73.96);
});

test("a known brand makes the venue a chain, so a preset can expand onto it", () => {
  const { rows } = parseElements(
    [
      el({ id: 7, tags: { shop: "convenience", name: "Duane Reade", brand: "Duane Reade" } }),
      el({ id: 8, tags: { amenity: "cafe", name: "Corner Roasters", brand: "Corner Roasters" } }),
    ],
    CHAINS,
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.kind, r.chain_id]),
    [
      ["Duane Reade", "chain", "duane-reade"],
      ["Corner Roasters", "craft", null],
    ],
  );
});

test("address, neighborhood, borough and website come off the tags we trust", () => {
  const { rows } = parseElements(
    [
      el({
        id: 9,
        tags: {
          amenity: "cafe",
          name: "Tagged Cafe",
          "addr:housenumber": "1234",
          "addr:street": "Lexington Avenue",
          "addr:suburb": "Upper East Side",
          "addr:city": "New York",
          "contact:website": "https://example.test",
        },
      }),
    ],
    CHAINS,
  );
  assert.equal(rows[0]?.address, "1234 Lexington Avenue");
  assert.equal(rows[0]?.neighborhood, "Upper East Side");
  // OSM writes Manhattan as "New York" more often than as "Manhattan".
  assert.equal(rows[0]?.borough, "Manhattan");
  assert.equal(rows[0]?.website, "https://example.test");
});

test("an unrecognised city stays null rather than guessing a borough", () => {
  const { rows } = parseElements(
    [el({ id: 10, tags: { amenity: "cafe", name: "Odd City", "addr:city": "Kings County" } })],
    CHAINS,
  );
  assert.equal(rows[0]?.borough, null);
});

test("a street with no house number still gives an address", () => {
  const { rows } = parseElements(
    [el({ id: 11, tags: { amenity: "bar", name: "Street Only", "addr:street": "Second Avenue" } })],
    CHAINS,
  );
  assert.equal(rows[0]?.address, "Second Avenue");
});

test("rows come out in osm_id order, so a re-run produces the same CSV", () => {
  const { rows } = parseElements(
    [el({ id: 30 }), el({ id: 4, lat: 40.78, lon: -73.95 }), el({ id: 200 })],
    CHAINS,
  );
  assert.deepEqual(
    rows.map((r) => r.osm_id),
    ["node/200", "node/30", "node/4"],
  );
});

test("the same element twice yields one row, and the duplicate is counted", () => {
  const { rows, skipped } = parseElements([el({ id: 12 }), el({ id: 12 })], CHAINS);
  assert.equal(rows.length, 1);
  // Not a bare `continue`: report()'s "every element is kept or accounted for"
  // invariant would otherwise be false.
  assert.deepEqual(skipped, [{ osmId: "node/12", reason: "duplicate" }]);
});

test("a repeated nameless element is counted once, not twice", () => {
  const nameless = { id: 15, tags: { amenity: "cafe" } };
  const { rows, skipped } = parseElements([el(nameless), el(nameless)], CHAINS);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped, [
    { osmId: "node/15", reason: "no name" },
    { osmId: "node/15", reason: "duplicate" },
  ]);
});

// ---------------------------------------------------------------------------
// hours_known: what we will admit to understanding
// ---------------------------------------------------------------------------

test("hours_known recognises the simple weekday forms", () => {
  assert.equal(hoursKnown("Mo-Su 08:00-22:00"), true);
  assert.equal(hoursKnown("Mo,We,Fr 09:00-17:00"), true);
  assert.equal(hoursKnown("Sa 10:00-23:59"), true);
  // 24:00 as a close time is common in OSM and unambiguous.
  assert.equal(hoursKnown("Mo-Su 08:00-24:00"), true);
});

test("several rules are known only when their day sets are DISJOINT", () => {
  // Disjoint: `;` as override and `;` as union agree, so OR-ing is correct.
  assert.equal(hoursKnown("Mo-Fr 07:00-19:00; Sa-Su 08:00-18:00"), true);
  assert.equal(hoursKnown("Mo-Th 07:00-19:00; Fr 07:00-22:00; Sa,Su 09:00-17:00"), true);
  // Overlapping: in the spec the later rule REPLACES the earlier one for
  // Wednesday, so a naive union would claim open at 20:00 on a Wednesday.
  // Not something we understand.
  assert.equal(hoursKnown("Mo-Su 11:00-22:00; We 11:00-15:00"), false);
  assert.equal(hoursKnown("Mo-Fr 09:00-17:00; Fr 09:00-14:00"), false);
  // A day repeated inside one rule is the same trap.
  assert.equal(hoursKnown("Mo,Mo 09:00-17:00"), false);
});

test("an overnight range is not known: we import bars, where it is the normal case", () => {
  assert.equal(hoursKnown("Mo-Su 18:00-02:00"), false);
  assert.equal(hoursKnown("Fr-Sa 20:00-04:00"), false);
  // Degenerate ranges fall out of the same rule.
  assert.equal(hoursKnown("Mo-Su 00:00-00:00"), false);
  assert.equal(hoursKnown("Mo 09:00-09:00"), false);
});

test("a backwards day range is not known: it wraps the week", () => {
  assert.equal(hoursKnown("Fr-Mo 08:00-22:00"), false);
  assert.equal(hoursKnown("Su-Sa 08:00-22:00"), false);
});

test("hours_known refuses everything else it cannot evaluate, so the UI says Hours unknown", () => {
  assert.equal(hoursKnown(null), false);
  assert.equal(hoursKnown("24/7"), false);
  assert.equal(hoursKnown("Mo-Fr 07:00-19:00; PH off"), false);
  assert.equal(hoursKnown("Mo-Su sunrise-sunset"), false);
  assert.equal(hoursKnown("Jan-Mar Mo-Fr 09:00-17:00"), false);
  assert.equal(hoursKnown("Mo-Fr 07:00+"), false);
  assert.equal(hoursKnown("Mo-Fr 7:00-19:00"), false); // not zero-padded
  assert.equal(hoursKnown("Mo-Fr 07:00-25:00"), false); // not a time
  assert.equal(hoursKnown("Mo-Fr 24:00-25:00"), false); // 24:00 is a close only
  assert.equal(hoursKnown(""), false);
});

test("whitespace is trimmed as JS trim() trims it, which venue_open_at's hours_trim mirrors", () => {
  // The same string as the pgTAP case in 27_venues_read: a leading NBSP, a
  // tab after `;`, a trailing newline. SQL's plain btrim used to strip spaces
  // only, so this was known here and null there.
  const hours = "\u00a0Mo-Fr 07:00-19:00;\tSa-Su 08:00-18:00\n";
  assert.equal(hoursKnown(hours), true);
  // Monday 2026-11-02, 18:00 in New York.
  assert.equal(openAt(hours, new Date("2026-11-02T23:00:00Z")), true);
});

test("parseHours gives half 2 the parsed rules, in minutes from midnight", () => {
  assert.deepEqual(parseHours("Mo-Tu,Th 08:30-24:00"), [
    { days: [0, 1, 3], open: 510, close: 1440 },
  ]);
  assert.deepEqual(parseHours("Mo-Fr 07:00-19:00; Sa-Su 08:00-18:00"), [
    { days: [0, 1, 2, 3, 4], open: 420, close: 1140 },
    { days: [5, 6], open: 480, close: 1080 },
  ]);
  assert.equal(parseHours("24/7"), null);
});

test("hours_osm is kept even when it is not evaluable", () => {
  const { rows } = parseElements(
    [el({ id: 13, tags: { amenity: "bar", name: "Always Open", opening_hours: "24/7" } })],
    CHAINS,
  );
  assert.equal(rows[0]?.hours_osm, "24/7");
  assert.equal(rows[0]?.hours_known, false);
});

// ---------------------------------------------------------------------------
// The reviewable CSV, and the report
// ---------------------------------------------------------------------------

test("the CSV quotes commas, quotes and newlines", () => {
  const { rows } = parseElements(
    [
      el({
        id: 14,
        tags: {
          amenity: "cafe",
          name: 'Joe, "The" Roaster',
          "addr:street": "First Avenue",
          "addr:suburb": "Yorkville",
        },
      }),
    ],
    CHAINS,
  );
  const csv = toCsv(rows);
  const [header, row] = csv.split("\n");
  assert.equal(header, "osm_id,name,kind,chain_id,lat,lng,address,neighborhood,borough,hours_osm,hours_known,website");
  assert.ok(row?.includes('"Joe, ""The"" Roaster"'), row);
  assert.ok(csv.endsWith("\n"), "ends with a newline");
});

test("an empty import is an empty CSV with a header, not an error", () => {
  assert.equal(toCsv([]), "osm_id,name,kind,chain_id,lat,lng,address,neighborhood,borough,hours_osm,hours_known,website\n");
});

test("the report accounts for every element, kept or dropped", () => {
  const elements = [
    el({ id: 20, tags: { shop: "convenience", name: "Duane Reade", brand: "Duane Reade", "addr:suburb": "Yorkville" } }),
    el({ id: 21, tags: { amenity: "cafe", name: "Roasters", "addr:suburb": "Yorkville", opening_hours: "Mo-Su 08:00-20:00" } }),
    el({ id: 22, tags: { amenity: "cafe", name: "Mystery Hours", opening_hours: "24/7" } }),
    el({ id: 23, tags: { amenity: "cafe" } }),
    el({ id: 24, lat: 40.9312, lon: -73.8988 }),
  ];
  const r = report(parseElements(elements, CHAINS));
  assert.equal(r.total, 3);
  assert.equal(r.chain, 1);
  assert.equal(r.craft, 2);
  assert.equal(r.withHours, 2);
  assert.equal(r.withKnownHours, 1);
  assert.deepEqual(r.neighborhoods, [
    ["Yorkville", 2],
    ["(none)", 1],
  ]);
  assert.deepEqual(r.skipped, [
    ["no name", 1],
    ["outside New York City", 1],
  ]);
  assert.equal(r.withNeighborhood, 2);
  assert.deepEqual(r.chainBranches, [["duane-reade", 1]]);
  assert.equal(r.total + r.skipped.reduce((a, [, n]) => a + n, 0), elements.length);
});

// ---------------------------------------------------------------------------
// Chains in the query and in the match
// ---------------------------------------------------------------------------

test("with no chain brands the query is decision 35's two clauses, nothing more", () => {
  const q = overpassQuery(START_BBOX);
  assert.ok(!q.includes("brand"), q);
  for (const t of [...CHAIN_ONLY_AMENITIES, ...CHAIN_ONLY_SHOPS]) assert.ok(!q.includes(t), `no ${t} without a chain`);
});

test("chain brands add fast food, pharmacies and chemists ONLY for those brands, in the same one query", () => {
  const q = overpassQuery(START_BBOX, NYC_AREA_ID, ["Duane Reade", "Dunkin'", "Duane Reade"]);
  assert.match(q, /nwr\["brand"~"\^\(Duane Reade\|Dunkin'\)\$",i\]\["amenity"~"\^\(fast_food\|pharmacy\)\$"\]/);
  assert.match(q, /nwr\["brand"~"\^\(Duane Reade\|Dunkin'\)\$",i\]\["shop"~"\^\(chemist\)\$"\]/);
  // Every clause, including the two new ones, is clipped to the city.
  assert.equal(q.match(/\(area\.nyc\);/g)?.length, 4);
  assert.equal(q.match(/out center tags;/g)?.length, 1, "one query");
});

test("a brand that would break the Overpass regex is refused, not escaped", () => {
  assert.throws(() => overpassQuery(START_BBOX, NYC_AREA_ID, ["Joe (Coffee)"]), /not safe/);
  assert.throws(() => overpassQuery(START_BBOX, NYC_AREA_ID, ['Say "Hi"']), /not safe/);
});

test("chainKey is the brand, or the exact name when there is no brand tag (the Gristedes case)", () => {
  assert.equal(chainKey({ brand: " Duane Reade ", name: "Duane Reade #123" }), "duane reade");
  assert.equal(chainKey({ name: "Gristedes" }), "gristedes");
  assert.equal(chainKey({}), null);
  const { rows } = parseElements(
    [
      el({ id: 30, tags: { shop: "supermarket", name: "Gristedes" } }),
      el({ id: 31, tags: { shop: "alcohol", name: "Gristedes Wine & Liquor" } }),
      // A brand tag that is not a chain wins over a name that is.
      el({ id: 32, tags: { amenity: "cafe", name: "Gristedes", brand: "Someone Else" } }),
    ],
    CHAINS,
  );
  assert.deepEqual(rows.map((r) => [r.osm_id, r.chain_id, r.kind]), [
    ["node/30", "gristedes", "chain"],
    ["node/31", null, "craft"],
    ["node/32", null, "craft"],
  ]);
});

// ---------------------------------------------------------------------------
// Point in polygon
// ---------------------------------------------------------------------------

// A 4x4 square with a 2x2 hole, as [lng, lat].
const SQUARE: PolygonCoords = [
  [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
  [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]],
];

test("ray casting: inside the outer ring, outside it, and in the hole", () => {
  assert.equal(pointInRing(0.5, 0.5, SQUARE[0]!), true);
  assert.equal(pointInRing(5, 2, SQUARE[0]!), false);
  assert.equal(pointInPolygon(0.5, 0.5, SQUARE), true, "between the outer ring and the hole");
  assert.equal(pointInPolygon(2, 2, SQUARE), false, "a hole is not inside the polygon");
  assert.equal(pointInPolygon(-1, 2, SQUARE), false);
});

test("ring orientation does not matter (even-odd), so holes need no winding", () => {
  const cw = [...SQUARE[0]!].reverse();
  assert.equal(pointInRing(0.5, 0.5, cw), true);
  assert.equal(pointInRing(5, 2, cw), false);
});

test("a MultiPolygon locates in any member, and the first containing area wins", () => {
  const areas = areasFromGeoJson({
    features: [
      { properties: { nta2020: "XX0001", name: "Twin", borough: "Queens" },
        geometry: { type: "MultiPolygon", coordinates: [SQUARE, [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]]] } },
      { properties: { nta2020: "XX0002", name: "Plain", borough: "Bronx" },
        geometry: { type: "Polygon", coordinates: [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]] } },
    ],
  });
  const locate = makeLocator(areas);
  // locate takes (lat, lng): y first.
  assert.deepEqual(locate(11, 11), { neighborhood: "Twin", borough: "Queens" });
  assert.deepEqual(locate(0.5, 0.5), { neighborhood: "Twin", borough: "Queens" });
  assert.equal(locate(2, 2), null, "in the hole");
  assert.deepEqual(locate(20.5, 20.5), { neighborhood: "Plain", borough: "Bronx" });
  assert.equal(locate(50, 50), null);
});

test("a malformed NTA file is an error, not a silently empty locator", () => {
  assert.throws(() => areasFromGeoJson({ features: [] }), /no features/);
  assert.throws(
    () => areasFromGeoJson({ features: [{ properties: { nta2020: "X", name: "N", borough: "Jersey" }, geometry: { type: "Polygon", coordinates: [] } }] }),
    /borough/,
  );
  assert.throws(
    () => areasFromGeoJson({ features: [{ properties: { nta2020: "X", name: "N", borough: "Bronx" }, geometry: { type: "Point", coordinates: [0, 0] } }] }),
    /Polygon or MultiPolygon/,
  );
});

// ---------------------------------------------------------------------------
// The committed NTA file, against places we know
// ---------------------------------------------------------------------------

const NTA_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "venues", "nyc-nta-2020.geojson");
const nyc = makeLocator(areasFromGeoJson(JSON.parse(readFileSync(NTA_FILE, "utf8"))));

test("the Upper East Side reads as its neighbourhoods, not as census labels", () => {
  // Second Avenue at East 76th.
  assert.deepEqual(nyc(40.7736, -73.9566), { neighborhood: "Lenox Hill", borough: "Manhattan" });
  // Madison Avenue at East 90th: the Fifth-to-Third strip, MN0802.
  assert.deepEqual(nyc(40.7838, -73.9555), { neighborhood: "Upper East Side", borough: "Manhattan" });
  // York Avenue at East 86th.
  assert.deepEqual(nyc(40.776, -73.948), { neighborhood: "Yorkville", borough: "Manhattan" });
  // The probe the Roosevelt Island split keys on is itself Lenox Hill.
  assert.deepEqual(nyc(LENOX_HILL_PROBE.lat, LENOX_HILL_PROBE.lng), { neighborhood: "Lenox Hill", borough: "Manhattan" });
});

test("Roosevelt Island comes out as its own name, split off MN0801", () => {
  // The tram station, and the north end by the lighthouse.
  assert.deepEqual(nyc(40.7621, -73.9497), { neighborhood: "Roosevelt Island", borough: "Manhattan" });
  assert.deepEqual(nyc(40.77, -73.944), { neighborhood: "Roosevelt Island", borough: "Manhattan" });
  // ... while York Avenue at East 68th, inside the island's bounding box, is not.
  assert.deepEqual(nyc(40.7646, -73.9547), { neighborhood: "Lenox Hill", borough: "Manhattan" });
});

test("other boroughs come back with theirs, and the river and New Jersey with nothing", () => {
  assert.deepEqual(nyc(40.671, -73.9814), { neighborhood: "Park Slope", borough: "Brooklyn" });
  assert.equal(nyc(40.768, -73.948)?.neighborhood ?? null, null, "the East River between York Avenue and the island");
  assert.equal(nyc(40.744, -74.0324), null, "Hoboken");
});

test("the committed file is trimmed: three properties, 5 dp, under 1.5 MB", () => {
  const text = readFileSync(NTA_FILE, "utf8");
  assert.ok(text.length < 1.5 * 1024 * 1024, `${text.length} bytes`);
  const fc = JSON.parse(text) as { features: Array<{ properties: Record<string, unknown>; geometry: { coordinates: number[][][][] } }> };
  for (const f of fc.features) assert.deepEqual(Object.keys(f.properties).sort(), ["borough", "name", "nta2020"]);
  const sample = fc.features[0]!.geometry.coordinates[0]![0]![0]!;
  for (const n of sample) assert.equal(Math.round(n * 1e5) / 1e5, n);
  const names = new Set(fc.features.map((f) => f.properties.name));
  for (const n of [...Object.values(NTA_DISPLAY_NAMES), "Roosevelt Island"]) assert.ok(names.has(n), n);
});

// ---------------------------------------------------------------------------
// Trimming the NYC Open Data download
// ---------------------------------------------------------------------------

test("trimRing rounds to 5 dp, drops the repeats rounding makes, simplifies, and stays closed", () => {
  const ring: Array<[number, number]> = [
    [0, 0], [0.000001, 0.000001], [1, 0], [2, 0.0000001], [2, 2], [0, 2], [0, 0],
  ];
  const t = trimRing(ring, 0.00001)!;
  assert.deepEqual(t, [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]);
  assert.equal(trimRing([[0, 0], [0.000001, 0], [0, 0.000001], [0, 0]], 0.00001), null, "a sliver collapses");
});

const rawNta = (code: string, name: string, boro: string, coordinates: PolygonCoords[]) => ({
  type: "Feature",
  properties: { nta2020: code, ntaname: name, boroname: boro, shape_area: "1", cdtaname: "x" },
  geometry: { type: "MultiPolygon", coordinates },
});
const box = (w: number, s: number, e: number, n: number): PolygonCoords => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];

test("trimNtas keeps three properties, renames the Upper East Side NTAs, and splits Roosevelt Island off MN0801", () => {
  const p = LENOX_HILL_PROBE;
  const mainland = box(p.lng - 0.005, p.lat - 0.005, p.lng + 0.003, p.lat + 0.005);
  const island = box(-73.952, 40.755, -73.945, 40.77);
  const islet = box(-73.9578, 40.7483, -73.9575, 40.7486);
  const out = trimNtas({
    features: [
      rawNta("MN0803", "Upper East Side-Yorkville", "Manhattan", [box(-73.95, 40.775, -73.94, 40.785)]),
      rawNta("MN0801", "Upper East Side-Lenox Hill-Roosevelt Island", "Manhattan", [islet, island, mainland]),
      rawNta("BK0602", "Park Slope", "Brooklyn", [box(-73.99, 40.66, -73.97, 40.68)]),
    ],
  });
  assert.deepEqual(out.map((f) => [f.properties.nta2020, f.properties.name, f.geometry.coordinates.length]), [
    ["BK0602", "Park Slope", 1],
    ["MN0801", "Lenox Hill", 1],
    ["MN0801", "Roosevelt Island", 2],
    ["MN0803", "Yorkville", 1],
  ]);
  for (const f of out) assert.deepEqual(Object.keys(f.properties).sort(), ["borough", "name", "nta2020"]);
  const locate = makeLocator(areasFromGeoJson(JSON.parse(ntaFileText(out))));
  assert.equal(locate(40.762, -73.9497)?.neighborhood, "Roosevelt Island");
  assert.equal(locate(p.lat, p.lng)?.neighborhood, "Lenox Hill");
});

test("trimNtas refuses an MN0801 the probe no longer splits, rather than guessing", () => {
  assert.throws(
    () => trimNtas({ features: [rawNta("MN0801", "Upper East Side-Lenox Hill-Roosevelt Island", "Manhattan", [box(-73.952, 40.755, -73.945, 40.77)])] }),
    /Lenox Hill probe/,
  );
});

// ---------------------------------------------------------------------------
// The NTA fill in parseElements
// ---------------------------------------------------------------------------

test("the locator fills neighbourhood and borough; a mapper's addr:suburb still wins the neighbourhood", () => {
  const { rows } = parseElements(
    [
      el({ id: 40, lat: 40.7621, lon: -73.9497, tags: { amenity: "cafe", name: "Island Cafe" } }),
      el({ id: 41, lat: 40.7736, lon: -73.9566, tags: { amenity: "cafe", name: "Named", "addr:suburb": "Upper East Side" } }),
      // addr:city "New York" is what mappers write for every borough; the polygon knows better.
      el({ id: 42, lat: 40.671, lon: -73.9814, tags: { amenity: "bar", name: "Slope Bar", "addr:city": "New York" } }),
      el({ id: 43, lat: 40.768, lon: -73.948, tags: { amenity: "cafe", name: "Boat", "addr:city": "New York" } }),
    ],
    CHAINS,
    undefined,
    nyc,
  );
  assert.deepEqual(rows.map((r) => [r.osm_id, r.neighborhood, r.borough]), [
    ["node/40", "Roosevelt Island", "Manhattan"],
    ["node/41", "Upper East Side", "Manhattan"],
    ["node/42", "Park Slope", "Brooklyn"],
    // No polygon: OSM's own city is the fallback.
    ["node/43", null, "Manhattan"],
  ]);
});

test("overpassEndpoints: the default list is https, distinct, and led by the main instance", () => {
  const list = overpassEndpoints({});
  assert.deepEqual(list, [...DEFAULT_OVERPASS_ENDPOINTS]);
  assert.equal(list[0], "https://overpass-api.de/api/interpreter");
  assert.ok(list.length >= 2, "a fallback needs at least one mirror");
  assert.equal(new Set(list).size, list.length);
  for (const u of list) assert.equal(new URL(u).protocol, "https:");
  // A caller mutating the result must not corrupt the default.
  list.pop();
  assert.equal(overpassEndpoints({}).length, DEFAULT_OVERPASS_ENDPOINTS.length);
});

test("overpassEndpoints: a blank override means the default list", () => {
  assert.deepEqual(overpassEndpoints({ OVERPASS_URL: "" }), [...DEFAULT_OVERPASS_ENDPOINTS]);
  assert.deepEqual(overpassEndpoints({ OVERPASS_URL: "  , ," }), [...DEFAULT_OVERPASS_ENDPOINTS]);
});

test("overpassEndpoints: the override replaces the defaults, trimmed and de-duplicated in order", () => {
  const env = {
    OVERPASS_URL:
      " https://b.example/api/interpreter ,https://a.example/api/interpreter,,https://b.example/api/interpreter ",
  };
  assert.deepEqual(overpassEndpoints(env), [
    "https://b.example/api/interpreter",
    "https://a.example/api/interpreter",
  ]);
});

test("overpassEndpoints: a non-https or malformed entry is an error, never silently skipped", () => {
  assert.throws(() => overpassEndpoints({ OVERPASS_URL: "http://a.example/api/interpreter" }), /https/);
  assert.throws(() => overpassEndpoints({ OVERPASS_URL: "https://ok.example/x,not a url" }), /not a URL/);
});
