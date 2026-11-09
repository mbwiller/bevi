/**
 * Rebuilds data/venues/nyc-nta-2020.geojson from NYC Open Data's 2020
 * Neighborhood Tabulation Areas (dataset 9nt8-h7nd).
 *
 *   curl -o <dir>/nta2020.geojson 'https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=500'
 *   npm run venues:nta -- <dir>/nta2020.geojson
 *
 * The download is DATA, read with JSON.parse and nothing else; keep it in a
 * directory of its own. Everything this does is `trimNtas` in import-core.ts
 * (unit tested): keep the code, a display name and the borough, round to 5 dp,
 * simplify within about a metre, and split MN0801 into Lenox Hill and Roosevelt
 * Island. The output is deterministic, so a rebuild from the same download is
 * byte-identical and a rebuild from a newer one diffs as what the city changed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ntaFileText, trimNtas } from "./import-core.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "venues", "nyc-nta-2020.geojson");

const input = process.argv[2];
if (!input) {
  console.error("venues:nta: pass the downloaded NTA 2020 GeoJSON as the first argument");
  process.exit(1);
}

const features = trimNtas(JSON.parse(readFileSync(input, "utf8")));
const text = ntaFileText(features);
writeFileSync(OUT, text);
const points = features.reduce(
  (n, f) => n + f.geometry.coordinates.reduce((m, poly) => m + poly.reduce((k, ring) => k + ring.length, 0), 0),
  0,
);
console.log(`venues:nta: ${features.length} feature(s), ${points} point(s), ${(text.length / 1024).toFixed(0)} KiB -> ${OUT}`);
