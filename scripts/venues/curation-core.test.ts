/**
 * Unit tests for scripts/venues/curation-core.ts: the chain presets
 * (data/venues/chains.json) and the craft menus (data/venues/menus.csv),
 * resolved against the catalog.
 *
 *   npm run test:scripts
 *
 * Two kinds of test. Synthetic catalogs pin each rule of the resolver and the
 * menu parser. And the REAL chains.json is resolved against the REAL catalog,
 * so a preset that names a slug the catalog renamed, or that picks up an
 * alcoholic Bev, fails here -- before a sync could write it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { catalogBevId, loadBevRows, loadCategories } from "../catalog/catalog.ts";
import {
  MENU_HEADER,
  catalogFrom,
  chainsByBrand,
  chainsPayload,
  forecastPins,
  parseCsvRecords,
  parseMenus,
  resolveChains,
  type CatalogBev,
} from "./curation-core.ts";
import type { VenueRow } from "./import-core.ts";

const bev = (slug: string, brand: string, category: string, leaf = "", alcoholic = false): CatalogBev => ({
  slug, name: slug, brand, category, leaf, alcoholic,
});

const CATALOG: CatalogBev[] = [
  bev("coke", "Coca-Cola", "soda", "cola"),
  bev("diet-coke", "Coca-Cola", "diet_soda", "diet_cola"),
  bev("sprite", "Sprite", "soda", "lemon_lime"),
  bev("poland", "Poland Spring", "water"),
  bev("frapp", "Starbucks", "coffee", "blended_coffee"),
  bev("modelo", "Modelo", "beer", "", true),
  bev("house-wine", "Generic", "wine", "", true),
  bev("horchata", "Generic", "other", "aguas_frescas"),
];

const id = (slug: string) => `id:${slug}`;

const chain = (over: Record<string, unknown> = {}) => ({
  id: "corner",
  name: "Corner",
  osm_brands: ["Corner"],
  assortment: { slugs: ["coke"] },
  ...over,
});

test("the resolver unions brands, slugs, categories and shared assortments, minus exclusions", () => {
  const [c] = resolveChains(
    {
      assortments: { water: { slugs: ["poland"] } },
      chains: [chain({ assortment: { include: ["water"], brands: ["coca-cola"], categories: ["lemon_lime"], exclude_slugs: ["diet-coke"] } })],
    },
    CATALOG,
    id,
  );
  assert.deepEqual(c!.slugs, ["coke", "poland", "sprite"]);
  assert.deepEqual(c!.bev_ids, ["id:coke", "id:poland", "id:sprite"]);
});

test("a category may be a root or a leaf", () => {
  const [root] = resolveChains({ chains: [chain({ assortment: { categories: ["soda"] } })] }, CATALOG, id);
  const [leaf] = resolveChains({ chains: [chain({ assortment: { categories: ["cola"] } })] }, CATALOG, id);
  assert.deepEqual(root!.slugs, ["coke", "sprite"]);
  assert.deepEqual(leaf!.slugs, ["coke"]);
});

test("no preset may carry alcohol, whichever selector picks it up", () => {
  assert.throws(() => resolveChains({ chains: [chain({ assortment: { slugs: ["modelo"] } })] }, CATALOG, id), /no alcohol.*modelo/);
  // `Generic` is a brand of both wine and aguas frescas: selecting it by brand is still refused.
  assert.throws(() => resolveChains({ chains: [chain({ assortment: { brands: ["Generic"] } })] }, CATALOG, id), /house-wine/);
  // ... and excluding the wine makes it acceptable.
  const [c] = resolveChains({ chains: [chain({ assortment: { brands: ["Generic"], exclude_slugs: ["house-wine"] } })] }, CATALOG, id);
  assert.deepEqual(c!.slugs, ["horchata"]);
});

test("typos are errors: unknown slug, brand, category, include or key", () => {
  const bad = (assortment: unknown) => () => resolveChains({ chains: [chain({ assortment })] }, CATALOG, id);
  assert.throws(bad({ slugs: ["cokee"] }), /unknown slug cokee/);
  assert.throws(bad({ brands: ["Pepsi"] }), /no catalog Bev has brand Pepsi/);
  assert.throws(bad({ categories: ["juice"] }), /no catalog Bev is in juice/);
  assert.throws(bad({ include: ["nope"] }), /no shared assortment nope/);
  assert.throws(bad({ slug: ["coke"] }), /unknown key slug/);
  assert.throws(bad({ slugs: ["coke"], exclude_slugs: ["cokee"] }), /unknown slug cokee/);
});

test("a chain that resolves to nothing is an error: leave it out instead", () => {
  assert.throws(
    () => resolveChains({ chains: [chain({ assortment: { slugs: ["coke"], exclude_slugs: ["coke"] } })] }, CATALOG, id),
    /selects no catalog Bev/,
  );
});

test("ids are unique slugs, names bounded, brands non-empty, Overpass-safe and owned by one chain", () => {
  const r = (chains: unknown[]) => () => resolveChains({ chains }, CATALOG, id);
  assert.throws(r([chain({ id: "Corner Shop" })]), /id must match/);
  assert.throws(r([chain(), chain()]), /duplicate chain id corner/);
  assert.throws(r([chain({ name: "" })]), /name/);
  assert.throws(r([chain({ osm_brands: [] })]), /osm_brands is empty/);
  assert.throws(r([chain({ osm_brands: ["Corner (NYC)"] })]), /Overpass/);
  assert.throws(r([chain(), chain({ id: "other", osm_brands: ["CORNER"] })]), /already belongs to corner/);
  assert.throws(
    () => resolveChains({ assortments: { a: { include: ["b"] }, b: { slugs: ["coke"] } }, chains: [chain({ assortment: { include: ["a"] } })] }, CATALOG, id),
    /cannot include another/,
  );
  assert.throws(() => resolveChains({}, CATALOG, id), /`chains` list/);
});

test("brands match case-insensitively, and the payload lowercases them for upsert_chains", () => {
  const chains = resolveChains({ chains: [chain({ osm_brands: ["Corner", "Corner Express"] })] }, CATALOG, id);
  assert.deepEqual([...chainsByBrand(chains)], [["corner", "corner"], ["corner express", "corner"]]);
  assert.deepEqual(chainsPayload(chains), [
    { id: "corner", name: "Corner", osm_brands: ["corner", "corner express"], bev_ids: ["id:coke"] },
  ]);
});

// ---------------------------------------------------------------------------
// The real presets against the real catalog
// ---------------------------------------------------------------------------

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "venues");
const realCatalog = catalogFrom({ rows: loadBevRows(), categories: loadCategories() });

test("data/venues/chains.json resolves against data/catalog, every chain non-empty and alcohol-free", () => {
  const chains = resolveChains(JSON.parse(readFileSync(join(DATA, "chains.json"), "utf8")), realCatalog, catalogBevId);
  assert.ok(chains.length >= 10, `${chains.length} chains`);
  const alcoholic = new Set(realCatalog.filter((b) => b.alcoholic).map((b) => b.slug));
  for (const c of chains) {
    assert.ok(c.slugs.length > 0, c.id);
    assert.deepEqual(c.slugs.filter((s) => alcoholic.has(s)), [], c.id);
  }
  // The ids are exactly what the seed migration gave these slugs.
  const sb = chains.find((c) => c.id === "starbucks")!;
  assert.deepEqual(sb.bev_ids, sb.slugs.map(catalogBevId));
  // Every brand the Upper East Side's chains are tagged with is matched.
  const brands = chainsByBrand(chains);
  for (const b of ["duane reade", "cvs pharmacy", "starbucks", "dunkin'", "7-eleven", "whole foods market", "morton williams", "gristedes"]) {
    assert.ok(brands.has(b), b);
  }
});

test("catalogFrom takes the alcohol flag from the root category", () => {
  const c = catalogFrom({
    rows: [{ slug: "x", name: "X", brand: "B", category: "beer", leaf: "" }],
    categories: [{ id: "beer", parentId: null, isAlcoholic: true }],
  });
  assert.equal(c[0]!.alcoholic, true);
  assert.throws(() => catalogFrom({ rows: [{ slug: "x", name: "X", brand: "B", category: "nope", leaf: "" }], categories: [] }), /unknown category/);
});

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

test("the CSV reader handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
  assert.deepEqual(parseCsvRecords('﻿a,b\r\n"x, y","say ""hi""\nthere"\n\n'), [
    ["a", "b"],
    ["x, y", 'say "hi"\nthere'],
  ]);
  assert.throws(() => parseCsvRecords('a,"open\n'), /never closed/);
});

test("the shipped menus.csv is just the header, and parses to nothing", () => {
  const text = readFileSync(join(DATA, "menus.csv"), "utf8");
  assert.equal(text, `${MENU_HEADER.join(",")}\n`);
  assert.deepEqual(parseMenus(text, realCatalog, catalogBevId), { rows: [], problems: [], venues: [] });
});

test("menu rows resolve slugs to ids; bad rows are reported and skipped, not fatal", () => {
  const csv = [
    "osm_id,venue_name,bev_slug,verified_at,notes",
    'node/1,Bar One,modelo,2026-11-01,"on tap, and bottled"',
    "node/1,Bar One,horchata,,",
    "node/1,Bar One,horchata,,twice",
    "way/2,Cafe Two,cokee,,typo",
    "cafe/3,Cafe Three,coke,,bad id",
    "node/4,Cafe Four,coke,yesterday,",
    "node/5,Cafe Five,coke",
  ].join("\n");
  const m = parseMenus(csv, CATALOG, id);
  // Alcohol is allowed on a menu: a human said the bar pours it, and the read RPCs' age gate hides it.
  assert.deepEqual(m.rows, [
    { osm_id: "node/1", bev_id: "id:modelo", verified_at: "2026-11-01" },
    { osm_id: "node/1", bev_id: "id:horchata", verified_at: null },
  ]);
  assert.deepEqual(m.venues, ["node/1"]);
  assert.equal(m.problems.length, 5);
  assert.match(m.problems[0]!, /line 4: horchata at node\/1 is listed twice/);
  assert.match(m.problems[1]!, /line 5: unknown bev_slug "cokee"/);
  assert.match(m.problems[2]!, /line 6: osm_id "cafe\/3"/);
  assert.match(m.problems[3]!, /line 7: verified_at "yesterday"/);
  assert.match(m.problems[4]!, /line 8: expected 5 fields, got 3/);
});

test("a wrong header is fatal: every column would be misread", () => {
  assert.throws(() => parseMenus("osm_id,bev_slug\n", CATALOG, id), /header must be exactly/);
  assert.throws(() => parseMenus("", CATALOG, id), /header must be exactly/);
});

// ---------------------------------------------------------------------------
// The dry run's forecast
// ---------------------------------------------------------------------------

const venue = (osm_id: string, chain_id: string | null): VenueRow => ({
  osm_id, name: osm_id, kind: chain_id ? "chain" : "craft", chain_id, lat: 40.77, lng: -73.95,
  address: null, neighborhood: null, borough: null, hours_osm: null, hours_known: false, website: null, source: "osm",
});

test("the forecast counts a pin per venue with a chain preset or a menu, and a shared Bev once, as menu", () => {
  const chains = resolveChains({ chains: [chain({ assortment: { slugs: ["coke", "sprite"] } })] }, CATALOG, id);
  const f = forecastPins(
    [venue("node/1", "corner"), venue("node/2", null), venue("node/3", null), venue("node/4", "corner")],
    chains,
    [
      { osm_id: "node/2", bev_id: "id:horchata", verified_at: null },
      { osm_id: "node/4", bev_id: "id:coke", verified_at: null },
      { osm_id: "node/9", bev_id: "id:coke", verified_at: null },
    ],
  );
  assert.deepEqual(f, {
    pinned: 3,
    fromChain: 2,
    fromMenu: 2,
    // node/1: coke + sprite; node/4: sprite only (coke is its menu row).
    chainRows: 3,
    menuRows: 2,
    menuUnknownVenues: ["node/9"],
  });
});
