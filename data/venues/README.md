# data/venues

The curated inputs of the venue sync (A-08). `npm run venues:sync` (scripts/venues/import-osm.ts) reads all three files; `--dry-run` reads them, queries Overpass and prints what it would write, with no credentials.

| File | What it is | Who edits it |
| --- | --- | --- |
| `nyc-nta-2020.geojson` | NYC's 2020 Neighborhood Tabulation Areas, trimmed. Gives every venue its `neighborhood` and `borough`. | Rebuilt by script, never by hand |
| `chains.json` | Chain presets: which catalog Bevs every branch of a chain carries. | Matt and Arjun, reviewed in PRs |
| `menus.csv` | Craft menus: which Bevs one specific venue carries. | Matt and Arjun, reviewed in PRs |

## nyc-nta-2020.geojson

- **Source:** NYC Department of City Planning, *2020 Neighborhood Tabulation Areas (NTAs)*, NYC Open Data dataset `9nt8-h7nd` — <https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd>, downloaded 2026-11-09 from `https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=500` (262 features).
- **Licence:** published on NYC Open Data under the NYC Open Data Terms of Use (<https://opendata.cityofnewyork.us/overview/#termsofuse>): free to use and redistribute, provided as is. No attribution is required; this note is the courtesy.
- **Trimmed** by `scripts/venues/build-nta.ts` (`trimNtas` in `import-core.ts`, unit tested): each feature keeps only `nta2020`, a display `name` and `borough`; coordinates are rounded to 5 dp (about 1.1 m) and simplified within 0.00001° (about 1 m). 4.6 MB → about 1 MB, 115k → 46k points. One feature per line.
- **Rebuild** (when the city publishes new NTAs): download into an empty directory of its own, then `npm run venues:nta -- <dir>/nta2020.geojson`. The build is deterministic.

### Names

NTA names are compound census labels ("Upper East Side-Lenox Hill-Roosevelt Island"). Three are renamed in `NTA_DISPLAY_NAMES` (import-core.ts) after checking what ground each polygon actually covers:

| NTA | Official name | Shown as | Why |
| --- | --- | --- | --- |
| MN0802 | Upper East Side-Carnegie Hill | **Upper East Side** | It is the whole Fifth-to-Third-Avenue strip from 59th to 96th Street, so "Carnegie Hill" would mislabel Madison and Park in the 60s |
| MN0801 | Upper East Side-Lenox Hill-Roosevelt Island | **Lenox Hill** + **Roosevelt Island** | East of Third in the 60s and 70s, plus the island; split below |
| MN0803 | Upper East Side-Yorkville | **Yorkville** | East of Third in the 80s and 90s |

Every other NTA keeps its official name (so a venue in Long Island City reads "Long Island City-Hunters Point"). Extend the table when coverage grows past D-13's starting area.

**Roosevelt Island** is not its own NTA, but MN0801 is a MultiPolygon whose members are already separate polygons: the Lenox Hill mainland, the island and two East River islets. The rule (`RI_SPLIT_CODE`, `LENOX_HILL_PROBE`): the member containing Second Avenue at East 70th Street is Lenox Hill; every other member of MN0801 is Roosevelt Island. The build fails if the probe ever stops landing in exactly one member. A bounding box could not do this: any box around the island takes in York Avenue.

The neighbourhood comes from the polygon unless OSM has an `addr:suburb` (none do in the starting area). The borough comes from the polygon whenever there is one, because `addr:city = New York` is written for every borough. Because the polygon always answers, a hand-edited `neighborhood` on an OSM venue is re-derived on the next sync: fix the name in `NTA_DISPLAY_NAMES` instead.

## chains.json

```json
{
  "assortments": { "<name>": { "slugs": [], "brands": [], "categories": [], "exclude_slugs": [] } },
  "chains": [
    { "id": "duane-reade", "name": "Duane Reade", "osm_brands": ["Duane Reade"],
      "assortment": { "include": ["cooler"], "slugs": [], "brands": [], "categories": [], "exclude_slugs": [] } }
  ]
}
```

- `osm_brands` are the OSM `brand` values exactly as OSM writes them (matched case-insensitively). A branch is also matched by its exact `name` when it has no `brand` tag (the Gristedes case). The Overpass query asks for `amenity=fast_food|pharmacy` and `shop=chemist` **only** for these brands, which is how Dunkin' and the pharmacies get in without importing every fast-food counter.
- An assortment is the union of `include` (shared assortments above), `brands` (catalog `brand`, exact), `slugs` and `categories` (a root or a leaf id from `data/catalog/categories.json`), minus `exclude_slugs`. Resolved to Bev ids at load time by slug (`uuidv5(slug)` is the id), so no database read.
- **Strict:** an unknown slug, brand, category or include fails the run; so does a chain that resolves to nothing (leave it out instead) or one OSM brand on two chains. **No preset may select an alcoholic Bev**, by any selector; a bar's beer goes in `menus.csv`. `curation-core.test.ts` resolves the real file against the real catalog, so all of this fails in CI before a sync.
- The file is the whole truth: a chain deleted here is deleted from the database, its branches lose their chain rows, and a Bev deleted from a preset leaves every branch on the next sync. Menu rows are never touched by any of that.

### The chains, and why each carries what it does

Chosen from the brands actually tagged in D-13's box (Overpass, 2026-11-09). Conservative on purpose: a preset claims every branch has every Bev, so it lists what you would expect in any branch's cooler, not everything the chain sells somewhere.

- **`cooler`** (shared, 51 Bevs): the national-brand packaged cold drinks in every NYC pharmacy and convenience cooler — Coke, Diet Coke, Coke Zero, Sprite, Pepsi (regular, Diet, Zero), Dr Pepper and Diet, Mountain Dew, Fanta Orange, Canada Dry; Poland Spring, Dasani, Aquafina, Smartwater, Fiji, Evian, Essentia, Core; Perrier and San Pellegrino; five Gatorades, Powerade, two BodyArmors; Red Bull and Sugarfree, Monster and Zero Ultra, one Celsius; Snapple Lemon and Peach, Arizona Green Tea, Pure Leaf Sweet and Unsweetened, Gold Peak Sweet; the bottled Starbucks Frappuccinos (Mocha, Vanilla, Coffee) and Doubleshot Espresso & Cream; Tropicana, Simply Orange and Lemonade, two Naked Juices; Vita Coco. Only the core flavour of each line.
- **Duane Reade** (12 branches), **CVS** (6), **Walgreens** (1): `cooler`. Pharmacies with a full drinks cooler.
- **7-Eleven** (4), **Circle K** (1): `cooler`. Convenience stores, same cooler.
- **Morton Williams** (7), **Gristedes** (6), **D'Agostino** (2), **Key Food**, **Foodtown**, **C-Town**, **Food Universe** (1 each): `cooler` + `supermarket` (105 Bevs). NYC supermarkets carry the mainstream ranges in full: every catalog flavour of Tropicana, Simply, Minute Maid, Ocean Spray, Snapple, Arizona, Pure Leaf, Gold Peak, Lipton, LaCroix, bubly, Polar and Canada Dry, plus Cherry Coke, Sprite Zero, 7Up, Dunkin' bottled iced coffee and Starbucks Frappuccino Caramel.
- **Whole Foods Market** (3): `natural-grocer` (66 Bevs) and nothing from `cooler`, since Whole Foods' ingredient standards keep most mainstream sodas off its shelves: Spindrift, Topo Chico, LaCroix, Perrier, San Pellegrino, Waterloo, Olipop, Poppi, Zevia, GT's, Health-Ade, Suja, Vita Coco, Harmless Harvest, Guayaki, Liquid Death, Essentia, Evian, Mountain Valley, Califia, Rise and Chameleon.
- **Starbucks** (23): the three catalog Frappuccinos a Starbucks bar actually makes under that name (Mocha, Caramel, Coffee). Not the bottled Doubleshot or the bottled-only flavours.
- **Dunkin'** (16): the catalog's three Dunkin' iced coffees (Original, Mocha, French Vanilla), which a Dunkin' makes to order. OSM tags Dunkin' `amenity=fast_food`.
- **Gong Cha** (1): its two catalog milk teas (Classic, Taro).

Left out because no catalog Bev is sold in every branch as far as we can tell (mostly own-label drinks): Le Pain Quotidien, Joe & The Juice, Pret A Manger, Sweetgreen, Juice Press, Bluestone Lane, Joe Coffee, Paris Baguette, Heytea, Trader Joe's, and Health Mart (independently owned). Their branches are still imported as craft venues where their OSM tag is one decision 35 imports, so a menu row can give one a pin. The fast-food chains (Subway, McDonald's, Chipotle and so on) are not imported at all.

## menus.csv

One row per Bev a specific venue carries. Shipped empty (header only).

```csv
osm_id,venue_name,bev_slug,verified_at,notes
node/1234567890,Example Coffee Bar,la-colombe-draft-latte-oat-milk,2026-11-09,"on tap, oat only"
```

- `osm_id`: the venue's OSM id with its type, `node/N`, `way/N` or `relation/N`. Find it by clicking the place on openstreetmap.org (the URL ends `/node/N`), or in the CSV a dry run writes (`--out=...`, column `osm_id`).
- `venue_name`: for the human reading the file only; the sync ignores it.
- `bev_slug`: a slug from `data/catalog/bevs.csv`. Add the Bev to the catalog first if it is missing.
- `verified_at`: the date someone confirmed it (`YYYY-MM-DD`), or empty for not yet confirmed.
- `notes`: free text; quote it if it has a comma.

Alcohol is allowed here (a bar's menu is exactly where it belongs); the read RPCs hide it from a viewer under 21.

How it applies: for every venue the file names, that venue's menu rows become exactly the file's rows, so deleting a line removes that Bev from that venue. A venue the file does not name is left alone, so deleting a venue's last line does not clear its menu; remove those rows in SQL. A bad row (unknown slug, malformed id or date, an osm_id the database does not have) is printed and skipped; the rest still applies. A menu row wins over a chain row for the same Bev, and the chain expansion never touches it.
