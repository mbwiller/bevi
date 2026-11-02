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
import { test } from "node:test";

import {
  AMENITIES,
  NYC_AREA_ID,
  NYC_BOUNDS,
  SHOPS,
  START_BBOX,
  hoursKnown,
  inBounds,
  overpassQuery,
  parseElements,
  parseHours,
  report,
  toCsv,
  type OsmElement,
} from "./import-core.ts";

const CHAINS = new Set(["duane reade", "cvs pharmacy", "7-eleven"]);

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
    rows.map((r) => [r.name, r.kind]),
    [
      ["Duane Reade", "chain"],
      ["Corner Roasters", "craft"],
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
  assert.equal(header, "osm_id,name,kind,lat,lng,address,neighborhood,borough,hours_osm,hours_known,website");
  assert.ok(row?.includes('"Joe, ""The"" Roaster"'), row);
  assert.ok(csv.endsWith("\n"), "ends with a newline");
});

test("an empty import is an empty CSV with a header, not an error", () => {
  assert.equal(toCsv([]), "osm_id,name,kind,lat,lng,address,neighborhood,borough,hours_osm,hours_known,website\n");
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
  assert.equal(r.total + r.skipped.reduce((a, [, n]) => a + n, 0), elements.length);
});
