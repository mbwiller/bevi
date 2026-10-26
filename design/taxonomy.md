# D-04 · The category taxonomy

**Status: draft for Arjun's review (2026-10-24).** Decided in TASKS.md §6 D-04: two levels, today's 15 categories stay as the parents, leaves lined up with the flavour-profile `base` vocabulary, plus a leaf for each of the 378 catalog Bevs. A-13 loads this into Postgres (`categories.parent_id`) and Neo4j (`CHILD_OF`); M-21 then anchors placement on it ("compare a new mocha with mochas first").

Files, all under `design/taxonomy/`:

| File | What |
|---|---|
| `categories-tree.json` | Every node, 75 of them: the 15 parents exactly as in `data/catalog/categories.json` plus `parentId: null`, and 60 leaves `{ id, name, parentId, sortOrder, isAlcoholic }`. Leaves have no `emoji`. |
| `bev-leaves.csv` | `slug,category,leaf` for all 378 catalog Bevs in `bevs.csv` order. `category` is the leaf's parent; `leaf` is the node the Bev should point to after A-13. For three rows this is a deliberate correction rather than the Bev's present category in `data/catalog/bevs.csv` -- see §7. A-13 brings `data/catalog` into line. |

Validated by a throwaway script (every slug once, same order; every `leaf` exists and sits under the row's `category`; ids unique, snake_case, no collision with the 15; `isAlcoholic` equals the parent's). The treeSimilarity figures below were computed with the real `treeSimilarity` in `packages/ranking/src/edges.ts` over this tree, not worked out by hand.

## 1. Principles

1. **Two levels.** A parent (one of today's 15) and its leaves. No third level now; the LaTeX's "coffee → iced → mocha" is flattened to "coffee → mocha", with hot/iced carried by the profile's `serve`.
2. **The 15 ids are the parents and do not change.** Same id, name, `sortOrder`, `isAlcoholic`, emoji. Every existing ranking, RLS rule, age gate, `category_stats` row and UI picker keeps working. Leaves are new snake_case ids chosen never to collide with the 15 (so a leaf under `tea` is `iced_tea`, never `tea`).
3. **`isAlcoholic` is inherited.** A leaf copies its parent's flag (`beer`, `wine`, `spirits_cocktails` → `true`), so the age gate can walk up one hop, or read the cached flag on the leaf; both give the same answer.
4. **Split where it changes a comparison, not for symmetry.** A leaf exists when "compare it with these first" would ask a different first question than the parent does. `water` and `sports` stay unsplit for that reason (§4). Leaf sizes range from 1 to 23 Bevs; a small leaf is fine when the drink is genuinely distinct (rosé, matcha).
5. **Line up with `FlavorBase` where the base is what people mean.** Soda's leaves are the soda bases (cola, lemon-lime, citrus, orange, root beer, ginger, cream) and `fruit_soda` collects grape, berry and tropical. Where the base is *not* how people think (every coffee has base `coffee`; every energy drink's base is a flavour, not a kind), the leaves follow the drink's form instead. The leaf → base table from the validator is in §8 as a check: 39 of the 57 non-empty leaves hold a single base; the other 18 are the deliberate unions (`fruit_*`, `*_juice_blend`, the energy segments, sports) or cocktails, where the base is the mixer.
6. **Leaf names are user-facing.** Sentence case, short, no emoji: "Iced tea", "Cold brew & iced coffee", "Taro & flavoured milk tea". Spelling follows the repo's prose (flavoured); flip to US spelling in A-13 if the app's copy wants it, nothing depends on the string.
7. **`sortOrder` on a leaf is its position among its siblings** (1..n), in the order a picker should list them (the common kind first). Parents keep their global 1..15. `categories.sort_order` has no uniqueness constraint, so the two schemes coexist.

## 2. The tree

60 leaves under 13 of the 15 parents; 2 parents unsplit. Counts are catalog Bevs from `bev-leaves.csv`.

| Parent | Leaf | n |
|---|---|---|
| **soda** (64) | `cola` Cola | 14 |
|  | `lemon_lime` Lemon-lime soda | 5 |
|  | `citrus_soda` Citrus soda | 7 |
|  | `orange_soda` Orange soda | 7 |
|  | `fruit_soda` Fruit soda | 15 |
|  | `root_beer` Root beer | 8 |
|  | `ginger_ale` Ginger ale & ginger beer | 4 |
|  | `cream_soda` Cream soda | 4 |
| **diet_soda** (40) | `diet_cola` Diet cola | 20 |
|  | `diet_lemon_lime` Diet lemon-lime soda | 3 |
|  | `diet_citrus_soda` Diet citrus soda | 5 |
|  | `diet_orange_soda` Diet orange soda | 4 |
|  | `diet_fruit_soda` Diet fruit soda | 1 |
|  | `diet_root_beer` Diet root beer | 3 |
|  | `diet_ginger_ale` Diet ginger ale | 3 |
|  | `diet_cream_soda` Diet cream soda | 1 |
| **juice** (29) | `orange_juice` Orange & grapefruit juice | 5 |
|  | `apple_juice` Apple juice | 4 |
|  | `grape_cranberry_juice` Grape & cranberry juice | 5 |
|  | `lemonade` Lemonade & limeade | 4 |
|  | `fruit_juice_blend` Fruit punch & juice blends | 7 |
|  | `green_juice` Green & vegetable juice | 4 |
| **water** (14) | *(unsplit, all on the parent)* | 14 |
| **sparkling_water** (39) | `plain_sparkling_water` Plain sparkling water | 4 |
|  | `citrus_sparkling_water` Citrus sparkling water | 19 |
|  | `fruit_sparkling_water` Fruit sparkling water | 16 |
| **energy** (40) | `classic_energy` Classic energy drinks | 14 |
|  | `performance_energy` Zero-sugar performance energy | 23 |
|  | `energy_shot` Energy shots | 3 |
| **coffee** (30) | `brewed_coffee` Brewed coffee & espresso | 0 |
|  | `cold_brew` Cold brew & iced coffee | 6 |
|  | `latte` Lattes & cappuccinos | 9 |
|  | `flavored_latte` Mochas & flavoured lattes | 9 |
|  | `blended_coffee` Frappuccinos & blended coffee | 6 |
| **tea** (25) | `hot_tea` Hot tea | 0 |
|  | `iced_tea` Iced tea | 16 |
|  | `green_tea` Green tea | 6 |
|  | `matcha` Matcha | 1 |
|  | `chai` Chai | 0 |
|  | `yerba_mate` Yerba mate | 2 |
| **boba** (15) | `classic_milk_tea` Classic milk tea | 5 |
|  | `flavored_milk_tea` Taro & flavoured milk tea | 7 |
|  | `boba_fruit_tea` Fruit tea | 3 |
| **sports** (20) | *(unsplit, all on the parent)* | 20 |
| **smoothie** (11) | `fruit_smoothie` Fruit smoothie | 6 |
|  | `green_smoothie` Green smoothie | 2 |
|  | `protein_smoothie` Protein smoothie | 3 |
| **beer** (18) | `lager` Lager | 10 |
|  | `ale` Ales, stouts & wheat beers | 2 |
|  | `hard_seltzer` Hard seltzer | 6 |
| **wine** (8) | `red_wine` Red wine | 2 |
|  | `white_wine` White wine | 3 |
|  | `rose_wine` Rosé | 1 |
|  | `sparkling_wine` Sparkling wine | 2 |
| **spirits_cocktails** (12) | `vodka` Vodka & vodka cocktails | 6 |
|  | `tequila` Tequila & agave cocktails | 2 |
|  | `whiskey` Whiskey & whiskey cocktails | 2 |
|  | `rum` Rum & rum cocktails | 2 |
| **other** (13) | `kombucha` Kombucha | 5 |
|  | `coconut_water` Coconut water | 2 |
|  | `aguas_frescas` Horchata & aguas frescas | 3 |
|  | `cultured_milk_drink` Yogurt & cultured milk drinks | 3 |

Totals: 378 Bevs; 344 point to a leaf, 34 point to a parent (water 14, sports 20). Every Bev now points to a true leaf or to an unsplit parent; nothing sits on a parent that has children.

**Why 60.** The brief asked for 35–60. Soda and diet soda take 16 between them because the diet tree mirrors the soda tree (§6), and that mirror is worth more than the count. The remaining 44 cover 11 parents at 3–6 each. Going lower would mean dropping distinctions that change the first comparison (red vs white wine, cold brew vs mocha, lager vs hard seltzer); going higher would mean splitting by flavour inside sparkling water, sports or energy, where the profile term already carries the flavour and the tree would just echo it.

**The three empty leaves** (`brewed_coffee`, `hot_tea`, `chai`) exist because the catalog is ready-to-drink only, while the create flow will mostly produce cafe drinks, which is exactly the feedback that started this (*"cafe → hot / cold → subcategories"*). A user's first "Pike Place", "English breakfast" or "chai latte" needs a leaf that is not a bottled iced drink, and `chai` and `matcha` are `FlavorBase` values that would otherwise have no home. They cost nothing to load. I did not add a `gin` leaf by the same logic: spirits are age-gated and low-volume for this audience, and a gin & tonic lands on `spirits_cocktails` itself under the shape rule (§3), which is the designed fallback.

## 3. The shape question: can a Bev sit directly on a parent?

**Decision: yes.** A Bev's `category_id` points to the most specific node that fits: a leaf when one does, otherwise its parent. Concretely:

- Bevs under an **unsplit parent** (`water`, `sports`) point to the parent. The parent is effectively a leaf at depth 1.
- A **user-created Bev** keeps the parent the create flow gave it until something relabels it (§5).
- A catalog Bev under a split parent sits on the parent only when no leaf fits; in the catalog that is exactly the two Ramune under `other` (§7), and `other` is a catch-all by name.

The alternative, "every Bev on a leaf", would force a single trivial leaf under `water` ("Water → Still water") and a catch-all `other_x` leaf under each of the 13 split parents for user-created Bevs. Fifteen catch-alls are ugly in a picker and, worse, two unclassified Bevs in the same catch-all would score tree = 1 as if they were the same kind of drink.

### What `treeSimilarity` does with mixed depth

Wu–Palmer, eq. (16): `2·depth(lca) / (depth(a) + depth(b))`, with the implicit root at depth 0 so a parent has depth 1 and a leaf depth 2. Computed with `treeSimilarity` from `packages/ranking/src/edges.ts` over `categories-tree.json` (`flat` = today's `{}` taxonomy, where a Bev carries its parent id):

| Pair | today (flat) | D-04 tree |
|---|---|---|
| same leaf: Coke ↔ Pepsi (`cola`, `cola`) | 1.000 | 1.000 |
| sibling leaves: Coke ↔ A&W root beer (`cola`, `root_beer`) | 1.000 | 0.500 |
| leaf ↔ its own parent: a catalog cola ↔ a user-created Bev left on `soda` | 1.000 | 0.667 |
| two Bevs both left on the same parent (`soda`, `soda`) | 1.000 | 1.000 |
| different parents, both leaves: Coke ↔ Diet Coke (`cola`, `diet_cola`) | 0.000 | 0.000 |
| leaf ↔ an unsplit parent: Coke ↔ Fiji (`cola`, `water`) | 0.000 | 0.000 |
| two unsplit parents: Fiji ↔ Gatorade (`water`, `sports`) | 0.000 | 0.000 |
| same unsplit parent: Fiji ↔ Evian (`water`, `water`) | 1.000 | 1.000 |
| sibling leaves under coffee: mocha ↔ cold brew (`flavored_latte`, `cold_brew`) | 1.000 | 0.500 |
| user-created coffee on `coffee` ↔ a mocha (`coffee`, `flavored_latte`) | 1.000 | 0.667 |
| `matcha` (tea) ↔ matcha latte with boba (`flavored_milk_tea`) | 0.000 | 0.000 |

Over all 75 × 75 node pairs the tree term takes exactly four values: **0, 0.5, 0.667, 1**. Read as the edge-weight contribution (0.25 × tree): 0, 0.125, 0.167, 0.25.

Two things follow from the 0.667 row, and both are acceptable:

1. **A Bev on a parent is scored as "a soda of unknown kind".** Its tree term to every leaf under the parent is 0.667, between "same leaf" (1) and "sibling" (0.5). That is the right reading of not knowing the leaf: the expected value, not a guess. The flip side is that two unclassified Bevs on the same parent score 1 with each other, which overstates it; the catch-all-leaf design would do the same, so this is not a reason to prefer it.
2. **M-21 needs one rule.** Its tiers are "same leaf, then same parent". For a new Bev whose own category is a parent, "same leaf" must be read as empty (T₁ = ∅) and the search starts at T₂ = every Bev under that parent, rather than treating the other unclassified Bevs on the parent as its leaf-mates. Equally, when the *new* Bev is in a leaf, bucket Bevs sitting on its parent belong in T₂, not T₁. That is a two-line special case in the tiering, and the LaTeX already allows tiering "by decreasing w bands" instead, which needs no special case at all.

Nothing in the stores depends on uniform depth: `parent_id` is nullable either way, `category_is_alcoholic(id)` walks up at most one hop, and `IN_CATEGORY` may point at any `(:Category)`.

## 4. The splits, parent by parent

- **soda (8 leaves).** Straight from `FlavorBase`: `cola`, `lemon_lime`, `citrus_soda` (Mountain Dew, grapefruit sodas), `orange_soda`, `root_beer` (birch beer included), `ginger_ale` (ginger ale and ginger beer), `cream_soda`, and `fruit_soda` for grape + berry + tropical + tamarind. Orange is its own leaf because orange soda is a market of its own (Fanta, Crush, Sunkist); grape and strawberry are not, so they share `fruit_soda` and let the profile's `base` (0.40 of the profile term) tell them apart. Pepper-style sodas (Dr Pepper, Doc Pop, Dr Wow) are in `cola` because `FlavorBase` has no `pepper`; see §7.
- **diet_soda (8 leaves).** The soda leaves with a `diet_` prefix, one for one, including two one-Bev leaves (`diet_fruit_soda`: Zevia Grape; `diet_cream_soda`: Zevia Cream Soda). §6 explains why the exact mirror beats merging the thin ones.
- **juice (6).** Juice is the most heterogeneous parent: orange juice, lemonade, apple juice, V8 and a Naked smoothie-style blend are different drinks that today all score tree = 1. `orange_juice` (with grapefruit), `apple_juice`, `grape_cranberry_juice` (Welch's, Ocean Spray), `lemonade` (and limeade), `fruit_juice_blend` (fruit punch plus the Naked/V8 Fusion blends) and `green_juice` (Green Machine, V8 Original, Green Goodness, Superfood).
- **water (unsplit).** 14 still waters and one misfiled sparkling (§7). The whole point of ranking waters is Fiji vs Dasani, and a "still vs enhanced/alkaline" split would not change the first question anyone is asked. Stays flat; all 15 Bevs point to `water`.
- **sparkling_water (3).** `plain_sparkling_water` (unflavoured: LaCroix Pure, Topo Chico, Perrier, San Pellegrino) against flavoured, and flavoured split once into `citrus_sparkling_water` (lemon, lime, grapefruit and, here, orange and tangerine) and `fruit_sparkling_water` (berry, tropical, cucumber, the Spindrift half-tea). Essence flavours are faint, so the flavour families inside sparkling water are weak signals compared with brand (real juice vs essence), which the content term already carries; two flavour leaves are enough. Assignment follows the profile's `base`, so Raspberry Lime (base `citrus`) is citrus.
- **energy (3).** Every energy drink has base `other` or a fruit, so `base` is no help. The split people actually shop by is the segment: `classic_energy` (Red Bull, Monster including Zero Ultra and the juice line, Rockstar, NOS, Full Throttle, Guru), `performance_energy` (the zero-sugar fitness cans: Celsius, Alani Nu, Bang, Ghost, Reign, C4) and `energy_shot` (5-hour). A new Celsius is first compared with Alani and Ghost, not with Monster, which is right.
- **coffee (5).** By form, since every Bev has base `coffee`: `brewed_coffee` (hot black: drip, pour-over, americano, a shot; empty in the catalog), `cold_brew` (black or lightly sweetened cold coffee, no milk), `latte` (milk espresso drinks, unflavoured; hot or iced, plant milk included), `flavored_latte` (mocha, vanilla, caramel: the "compare a mocha with mochas" leaf), `blended_coffee` (Frappuccino, frappé). Mocha is not split from vanilla/caramel lattes: it would be 5 vs 4 Bevs, and the profile term does not distinguish them either (all base `coffee`).
- **tea (6).** `iced_tea` (bottled black tea, sweet or not), `green_tea` (bottled green, including the sweetened Arizona/Honest ones: the green/black axis beats the sweet/unsweet one), `matcha`, `yerba_mate` (a different plant, caffeine 2), plus `hot_tea` and `chai`, empty for the cafe reason in §2.
- **boba (3).** `classic_milk_tea` (classic, brown sugar, Thai, oolong), `flavored_milk_tea` (taro, wintermelon, honeydew, the matcha latte), `boba_fruit_tea` (fruit teas without milk). Taro vs classic is the first thing a boba drinker says about a drink, so it is a leaf.
- **sports (unsplit).** All isotonic sports drinks; the candidate split (full-sugar vs zero/lyte) is weaker than it is for soda, where diet has a distinct taste, and flavour splits would echo the profile term. Stays flat; all 20 Bevs point to `sports`.
- **smoothie (3).** `fruit_smoothie`, `green_smoothie`, `protein_smoothie`. A chocolate protein shake and a mango smoothie are not like for like; user-created protein shakes (Core Power, Premier) will land in `protein_smoothie`.
- **beer (3).** `lager` (10 of the 12 beers), `ale` for everything else brewed (Guinness, Blue Moon; user-created IPAs land here, and the leaf can split into ale/stout/wheat once it has the Bevs), `hard_seltzer` (White Claw, Truly; the catalog files them under beer, which matches the aisle, and the tree keeps them away from lagers).
- **wine (4).** Red, white, rosé, sparkling. The universally understood split, and it matters most here: a new Cabernet should never first be compared with a Prosecco.
- **spirits_cocktails (4).** By spirit family, which is how a bar menu and `FlavorBase` (`agave`, `grain`) both think: `vodka` (Moscow mule, espresso martini, vodka soda, High Noon, Cutwater mule), `tequila` (margaritas), `whiskey` (old fashioned, Jack & Coke), `rum` (mojito, piña colada). Neat pours of a spirit land in the same leaf as its cocktails; the names say so.
- **other (4 + the parent).** `kombucha`, `coconut_water`, `aguas_frescas` (horchata, jamaica, tamarindo), `cultured_milk_drink` (Yakult, Calpico). Ramune (two Bevs) are sodas and have no leaf here; they sit on `other` pending the catalog correction in §7.

## 5. User-created Bevs

Today the create flow (`app/src/features/create-bev/CreateBevWizard.tsx`) offers the 15 parents and nothing else, and there are 5 user-created Bevs on prod with a parent as `category_id`.

- **Now:** they stay where they are. A parent-level `category_id` is valid under §3; A-13 changes nothing about those rows. New user-created Bevs keep landing on the parent until the UI changes.
- **Effect:** such a Bev gets tree = 0.667 to every catalog Bev under its parent, 0 elsewhere, and M-21 starts its search at the parent tier. Its placement is still category-aware, one level coarser.
- **Later, not designed here, two independent options:**
  1. *UI:* the wizard's category step becomes two-step (parent, then an optional leaf list from `categories.list()` filtered by `parentId`), and a relabel action on Bev detail for owners/admins.
  2. *Inference, the D-11 pattern:* when the embedding pipeline runs for a new Bev, copy the leaf of its most similar seeded Bev **under the same parent** (cosine ≥ 0.6, as D-11), marked inferred. The D-11 machinery already finds that neighbour, so this is a small addition to A-16's `embed` path. Worth doing before or with M-21, since it moves user-created Bevs from the 0.667 band into real leaves.

Either way, nothing in the app that keys on the 15 ids (`bevArtForCategory`, `visibleCategories`, the `canSeeAlcohol` check in `RankFlow`) breaks for a parent-level Bev. What they *do* need after A-13 is to resolve a **leaf** id to its root (open question 1).

## 6. Diet soda and sparkling-water flavours

**Diet soda stays a parent** because `diet_soda` is one of the 15 ids and the principle is that they do not move. Within it, the leaves **mirror soda's exactly** with a `diet_` prefix.

What this does to the three pairs that matter, tree term only:

| Pair | tree | why |
|---|---|---|
| Coke ↔ Pepsi | 1 | same leaf `cola` |
| Coke ↔ Fanta Orange | 0.5 | sibling leaves under `soda` |
| Coke ↔ Diet Coke | 0 | different parents; `cola` and `diet_cola` have no common ancestor below the root |
| Diet Coke ↔ Diet Pepsi, Diet Coke ↔ Coke Zero | 1 | same leaf `diet_cola` |
| Diet Coke ↔ Sprite Zero | 0.5 | sibling leaves under `diet_soda` |

So under the tree term alone Coke is closer to Fanta than to Diet Coke. That is already true today (flat: 1 vs 0), not something the tree introduces, and it is the price of keeping `diet_soda` as a top-level id. The other 0.75 of the edge weight is what carries Coke ↔ Diet Coke: same brand (0.30 of content), near-identical embeddings ("Coca-Cola Diet Coke … diet_soda" against "Coca-Cola Classic … soda"), identical profiles (1.0). Roughly w ≈ 0·0.25 + 0.15·(0.3 + 0.1) + 0.30·0.9 + 0.30·1.0 ≈ 0.63, comfortably above the 0.3 storage floor, against w ≈ 0.90 for Coke ↔ Pepsi (LaTeX example). M-21 tiers "by decreasing w bands" rather than by tree alone where it matters, so Diet Coke still anchors a new cola before Fanta does.

Why the exact mirror rather than merging the thin diet leaves into a `diet_other_soda`: the rule "the diet tree is the soda tree" is one sentence, every diet drink has an obvious leaf, and Zevia Grape ↔ Zevia Cream Soda scoring 0.5 (siblings) is more honest than scoring 1 in a shared catch-all. The two one-Bev leaves will fill (Diet Crush Grape, Diet A&W Cream Soda exist).

If the parents are ever re-cut, the better structure is flavour-first with diet as a third level (`soda → cola → diet_cola`), which would give Coke ↔ Diet Coke 0.8 and Coke ↔ Pepsi 1. Not now; the brief and the id constraint both say two levels.

**Sparkling water flavours** are the opposite case: a flavour split would *not* buy much, because essence flavours are faint and the profile term already carries `base`. Hence one plain leaf and two flavour leaves (citrus vs fruit) rather than a mirror of soda's eight. LaCroix Lime ↔ LaCroix Pamplemousse = 1, LaCroix Lime ↔ LaCroix Berry = 0.5, LaCroix Lime ↔ Topo Chico Original = 0.5, LaCroix Lime ↔ Sprite = 0.

## 7. Judgement calls and catalog corrections

### Judgement calls (the leaf is defensible, but someone could argue)

1. **Pepper-style sodas in `cola` / `diet_cola`:** Dr Pepper, Dr Pepper Cherry, Diet Dr Pepper, Dr Pepper Zero, Poppi Doc Pop, Olipop Dr Wow, Zevia Dr Zevia (7 Bevs). Their profile base is `cola` and `FlavorBase` has no `pepper`. If a `pepper` base is ever added, a `pepper` leaf is a seven-row move.
2. **Flavoured Diet Cokes in `diet_cola`** (Ginger Lime, Zesty Blood Orange, Twisted Mango, Feisty Cherry): a cola with a note, profile base `cola`.
3. **Mountain Dew family split by base:** Original and Spark → `citrus_soda`; Code Red (base `berry`) and Baja Blast (base `tropical`) → `fruit_soda`. Consistent with the profile, even though the brand straddles two leaves.
4. **Poppi Strawberry Lemon → `citrus_soda`**, Jarritos Tamarind → `fruit_soda` (base `other`; nothing fits better).
5. **Orange sparkling waters → `citrus_sparkling_water`** (LaCroix Orange, Topo Chico Tangerine, Perrier L'Orange). In soda, orange has its own leaf; in sparkling water it is a citrus note. *San Pellegrino Aranciata was on this list and has since moved to `soda` → `orange_soda` under the corrections below: at sweetness 3 it is a sweetened Italian soda, and every genuine sparkling water in the catalog is sweetness 0.*
6. **Spindrift / Polar Raspberry Lime and AHA Lime + Watermelon → citrus**, following their profile base rather than the first word of the name.
7. **Coffee with milk is `latte` whatever the label says:** Dunkin' Bottled Iced Coffee Original (dairy, sweetened) and Califia Cold Brew with Almond Milk are in `latte`; Peet's Iced Coffee Classic (no dairy) is in `cold_brew`. Starbucks Doubleshot Energy Coffee stays under its catalog parent `coffee`, in `latte`.
8. **Matcha latte with boba → `flavored_milk_tea`**, not tea's `matcha`: its parent is `boba`, so the tree gives it 0 to bottled matcha, and the profile's `base = matcha` (0.40 of the profile term) carries the link instead.
9. **Espresso martini → `vodka`** (it is a vodka cocktail; profile base `coffee`).
10. **Simply Grapefruit → `orange_juice`** ("Orange & grapefruit juice"); lemonade and limeade are a separate leaf because an ade is a different drink from a juice.
11. **Energy split by segment, not flavour** (§4). Red Bull Sugarfree and Monster Zero Ultra are `classic_energy` by brand house, even though they are zero-sugar.
12. **Arizona Green Tea and Honest Honey Green Tea → `green_tea`** although sweetened; `iced_tea` is the black-tea leaf.
13. **Yerba mate is its own leaf** (2 Bevs) rather than folded into green tea: different plant, different caffeine level.
14. **Hard seltzer stays under `beer`**, as the catalog has it; `spirits_cocktails` would be wrong (they are malt/sugar brews) and the leaf keeps them off the lager anchors.
15. **Fruit punch merged into `fruit_juice_blend`**: a punch is a juice blend; keeping it separate would be three Bevs for one more leaf.

### Catalog corrections — APPLIED in `bev-leaves.csv` (Arjun, 2026-10-26)

All five suggestions below were accepted and are now live in `bev-leaves.csv`, so the file is
internally consistent: every row's `leaf` sits under its own `category`, and no Bev sits on a
parent that has children. Six rows differ from `data/catalog/bevs.csv` as a result, which is
deliberate — **A-13 brings `data/catalog` and prod into line**, since it already re-points all 378
Bevs from parents to leaves and regenerates the seed migration. No separate migration.

Every one is derivable from `flavor-profiles.csv` rather than taste, which is why they were easy
to accept: the profile and the category disagreed, and the profile was right.

| Slug | Today | Suggest | Why |
|---|---|---|---|
| `ramune-original`, `ramune-melon` | `other` (on the parent) | `soda` → `lemon_lime`, `fruit_soda` | They are carbonated sodas (base `lemon-lime` / `tropical`, sweetness 3). The only two catalog Bevs with no leaf. |
| `liquid-death-sparkling-severed-lime` | `water` | `sparkling_water` → `citrus_sparkling_water` | Carbonated, flavoured, base `citrus`; the one non-still Bev under `water`. |
| `san-pellegrino-limonata`, `san-pellegrino-aranciata` | `sparkling_water` | `soda` → `citrus_soda`, `orange_soda` | Sweetness 3 in their own profiles; they are sweetened Italian sodas, not sparkling water. Every other sparkling water is sweetness 0. |
| `bolthouse-farms-perfectly-protein-vanilla-chai` | `juice` | `smoothie` → `protein_smoothie` | A dairy protein shake (dairy `true`, base `chai`), sibling of `bolthouse-farms-perfectly-protein-chocolate`, which is under `smoothie`. |
| `spindrift-half-tea-half-lemon` | `sparkling_water` | **kept as-is** | A sparkling tea (base `tea`, caffeine 1), but sweetness 0 like every other sparkling water. Agreed it is defensible where it is. |

None of these change the tree; each is a one-cell edit in `bevs.csv` plus the matching `leaf` in `bev-leaves.csv`, and I would fold them into the A-13 migration rather than a separate PR.

## 8. Leaf → flavour base (validator output)

A sanity check that the leaves and `FlavorBase` agree where they should. Mixed sets are the deliberate unions (`fruit_*`, `*_juice_blend`, energy) or follow the catalog's own labelling.

```
cola {cola: 14}                       diet_cola {cola: 20}
lemon_lime {lemon-lime: 4}            diet_lemon_lime {lemon-lime: 3}
citrus_soda {citrus: 6}               diet_citrus_soda {citrus: 5}
orange_soda {orange: 6}               diet_orange_soda {orange: 4}
fruit_soda {tropical: 6, berry: 4, grape: 3, other: 1}   diet_fruit_soda {grape: 1}
root_beer {root-beer: 8}              diet_root_beer {root-beer: 3}
ginger_ale {ginger: 4}                diet_ginger_ale {ginger: 3}
cream_soda {cream: 4}                 diet_cream_soda {cream: 1}
orange_juice {orange: 4, citrus: 1}   apple_juice {apple: 4}
grape_cranberry_juice {grape: 3, berry: 2}   lemonade {citrus: 4}
fruit_juice_blend {tropical: 4, berry: 2, chai: 1, herbal: 1}   green_juice {herbal: 4}
water {mineral: 14, citrus: 1}
plain_sparkling_water {mineral: 4}    citrus_sparkling_water {citrus: 16, orange: 4}
fruit_sparkling_water {berry: 8, tropical: 6, tea: 1, herbal: 1}
classic_energy {other: 8, tropical: 5, orange: 1}
performance_energy {berry: 8, tropical: 6, other: 4, orange: 2, cola: 1, herbal: 1, citrus: 1}
energy_shot {other: 2, citrus: 1}
cold_brew / latte / flavored_latte / blended_coffee: all {coffee}
iced_tea {tea: 16}  green_tea {tea: 6}  matcha {matcha: 1}  yerba_mate {tea: 2}
classic_milk_tea {tea: 5}  flavored_milk_tea {tea: 6, matcha: 1}  boba_fruit_tea {tea: 3}
sports {berry: 8, tropical: 4, lemon-lime: 3, grape: 3, orange: 2}
fruit_smoothie {berry: 3, tropical: 2, orange: 1}  green_smoothie {herbal: 2}  protein_smoothie {tropical: 1, chocolate: 1}
lager {hop: 10}  ale {hop: 2}  hard_seltzer {citrus: 3, berry: 2, tropical: 1}
red_wine / white_wine / rose_wine / sparkling_wine: all {wine}
vodka {grain: 3, ginger: 2, coffee: 1}  tequila {agave: 2}  whiskey {grain: 2}  rum {herbal: 1, tropical: 1}
kombucha {tea: 4, ginger: 1}  coconut_water {tropical: 2}
aguas_frescas {cream: 1, herbal: 1, other: 1}  cultured_milk_drink {other: 2, tropical: 1}
other (on the parent) {lemon-lime: 1, tropical: 1}
```

## 9. For Arjun (A-13)

What to load, in order:

1. **Categories.** `design/taxonomy/categories-tree.json` is the full `categories` table after A-13: 75 rows. The 15 parents are byte-for-byte today's rows plus `parentId: null`; the 60 leaves are new, with `parentId` set, `isAlcoholic` copied from the parent, `emoji` absent (null), `sortOrder` relative to siblings. `data/catalog/categories.json` should become this file (every node gains `parentId`), and `scripts/catalog/validate.ts` / `build-seed-migration.ts` need to accept leaf ids as a Bev's category and check `parentId` references.
2. **Bevs.** `design/taxonomy/bev-leaves.csv` gives `slug → leaf` for all 378. Migration: `update bevs set category_id = leaf` by slug for the 341 rows whose leaf differs from the parent; the other 37 (water, sports, two Ramune) are already right. In `bevs.csv` the `category` column becomes the leaf id (or keep `category` and add a `leaf` column, your call; the validator should then check `leaf`'s parent equals `category`).
3. **The 5 user-created Bevs on prod** are not in the catalog and need no change: a parent as `category_id` is valid (§3). Nothing to backfill; option 5.2 (inference) is a later increment.
4. **Age gate.** `category_is_alcoholic(id)`: `coalesce(c.is_alcoholic, parent.is_alcoholic)` with one hop is enough at two levels; the leaf rows also carry the flag, so the cached-column approach in A-13's note works with no walk at all. RLS and `submit_ranking` keep reading `categories.is_alcoholic` by the Bev's `category_id` and stay correct.
5. **Neo4j.** 60 `(:Category {id: leaf})-[:CHILD_OF]->(:Category {id: parent})` edges; `(:Bev)-[:IN_CATEGORY]->` now targets the leaf (or the parent for the 37). `Bev.isAlcoholic` walks up as `docs/graph.md` already says.
6. **The tree term.** `scripts/graph/build-edges.ts` builds `Taxonomy` as `Object.fromEntries(categories.map(c => [c.id, c.parentId]))`; today every value is null. With `parent_id` selected, `treeSimilarity` produces the §3 values and nothing else in the job changes. The "same category" candidate arm should become "same parent subtree" (all pairs under one of the 15), otherwise sibling-leaf pairs are only found through the brand and embedding arms. Watch `contentSimilarity` too: its 0.40·`[same category]` compares whatever `categoryId` the job passes, so Coke ↔ Fanta would drop from 0.40 to 0 on that term if it receives leaf ids. Pass the root there (the tree term already rewards the leaf), or accept the sharper content term deliberately; either way say which in A-13.
7. **Contract.** `Category.parentId` (S-14 part 2) as planned. `categories.list()` returns all 75; the app filters `parentId === null` for the picker, and a parent's `bevCount` should sum its leaves' Bevs plus its own. See open question 1 on `Bev.categoryId`.
8. **Apply the §7 corrections** in the same migration if you agree with them; they are five `bevs.csv` cells.

The review ask: the parent-level rule in §3 (it is the one decision M-21 and the sync both depend on), the energy split in §4, and the corrections in §7.

## 10. Open questions for Arjun

1. **What does `Bev.categoryId` return after A-13: the leaf.** The app today keys `bevArtForCategory`, `visibleCategories`, the `canSeeAlcohol` check and the Explore/search `categoryId` filter on the 15 ids. Should the contract add `Bev.rootCategoryId` (or `Category.rootId`), or does the app walk `Category.parentId` itself? I lean to the app walking (one lookup in `categoryById`), but `search({ categoryId })` and `listBucketBevs` should accept a parent and match its whole subtree server-side.
2. **`category_stats` and the Bayesian category prior** (`bayesCategoryPriorMin` = 30): key them on the root, not the leaf, until leaves have 30+ rated Bevs? Otherwise most leaves fall to the global fallback. The LaTeX's `cat(b)` for the prior would then mean root.
3. **`CategoryId` in `shared/src/enums.ts`** is a closed union of the 15. With 60 leaves as data, I would make it `string` (as `packages/ranking` already has it) and keep the 15 as a `RootCategoryId` union for the UI maps. Your call on the contract version.
4. **Load the three empty leaves now** (my recommendation; they are harmless rows) or only when a UI can assign them?
5. **Corrections in §7:** same migration, or a separate catalog PR first?
6. **Leaf names:** "flavoured" vs "flavored" in the three names that use it; pick when the strings go in.
