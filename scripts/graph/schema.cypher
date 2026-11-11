// Bevi Bev-graph schema for Neo4j AuraDB Free (A-15, TASKS.md decisions 28-29).
//
// Constraints and indexes only -- no data. Every statement is idempotent, so
// `npm run graph:schema` is safe to run any number of times.
//
// Node and property inventory, and who owns what, is in docs/graph.md. The
// short version: Postgres is the system of record, the graph holds the
// relationships, and nothing a user taps ever reads from here.
//
// Statements are separated by a line containing only `;`. scripts/graph/
// apply-schema.ts splits on that, so do not put a `;` at the end of a line.

// ---------------------------------------------------------------------------
// Uniqueness
// ---------------------------------------------------------------------------
// Bev.id is the Postgres bevs.id (uuid as a string), so the two stores join on
// one value and the nightly sync can MERGE by it.

CREATE CONSTRAINT bev_id_unique IF NOT EXISTS
FOR (b:Bev) REQUIRE b.id IS UNIQUE
;

CREATE CONSTRAINT category_id_unique IF NOT EXISTS
FOR (c:Category) REQUIRE c.id IS UNIQUE
;

// Brand.key is normaliseBrand(bevs.brand) from @bevi/ranking (lowercased,
// trimmed, inner whitespace collapsed); bevs.brand is free text in Postgres
// with no brands table yet, so the graph is where a brand first becomes an
// entity.
CREATE CONSTRAINT brand_key_unique IF NOT EXISTS
FOR (br:Brand) REQUIRE br.key IS UNIQUE
;

CREATE CONSTRAINT flavor_name_unique IF NOT EXISTS
FOR (f:Flavor) REQUIRE f.name IS UNIQUE
;

// Note.token is one of flavorTokens(name, flavor) from @bevi/ranking -- the
// same token set the content term's Jaccard is taken over. Only tokens shared
// by at least two active Bevs become nodes (scripts/graph/sync-core.ts), so a
// (:Note) is always a bridge between Bevs and never a dead end.
CREATE CONSTRAINT note_token_unique IF NOT EXISTS
FOR (n:Note) REQUIRE n.token IS UNIQUE
;

// User.pseudonym is hmac(user_id, BEVI_PSEUDONYM_SALT) -- stable across syncs
// so co-rating can accumulate, and never reversible to a handle or birth date.
// No other user property is ever synced (decision 31).
CREATE CONSTRAINT user_pseudonym_unique IF NOT EXISTS
FOR (u:User) REQUIRE u.pseudonym IS UNIQUE
;

// Community.id is an OPAQUE id: "c_" plus 16 hex characters of a keyed HMAC of
// the community's hub Bev id (scripts/graph/sync.ts, communityIdentifier). It
// is never the hub's id and never an unkeyed hash of it, because the same id
// reaches clients in the prediction snapshot and a hub can be an alcoholic
// Bev. Communities are COMPUTED nightly inside the sync transaction from the
// graph as read back (scripts/graph/analytics-core.ts), not mirrored.
CREATE CONSTRAINT community_id_unique IF NOT EXISTS
FOR (c:Community) REQUIRE c.id IS UNIQUE
;

// One row, holding lastSyncAt, the syncId of the generation the graph holds
// and one count per label and type. The nightly write to it is also the
// keep-alive that stops Aura Free auto-pausing after 72 hours (docs/graph.md).
CREATE CONSTRAINT meta_singleton_unique IF NOT EXISTS
FOR (m:Meta) REQUIRE m.key IS UNIQUE
;

// ---------------------------------------------------------------------------
// Lookup indexes
// ---------------------------------------------------------------------------
// "Bevs in this root category" and "Bevs of this brand" are index lookups
// rather than scans. categoryId is the ROOT category on every Bev; the leaf,
// when there is one, is leafCategoryId and the target of IN_CATEGORY.

CREATE INDEX bev_category_idx IF NOT EXISTS
FOR (b:Bev) ON (b.categoryId)
;

CREATE INDEX bev_brand_idx IF NOT EXISTS
FOR (b:Bev) ON (b.brand)
;

// ---------------------------------------------------------------------------
// Vector index on Bev.embedding
// ---------------------------------------------------------------------------
// 384 dimensions, cosine: the output of Supabase Edge Functions' built-in
// gte-small model (decision 30b). The nightly sync copies bev_embeddings onto
// Bev.embedding, every component through toFloat(): JSON renders 0 and 1 as
// integers, and the index wants a list of floats. A Bev with no row in
// bev_embeddings has no embedding property and is simply absent from the
// index.

CREATE VECTOR INDEX bev_embedding_idx IF NOT EXISTS
FOR (b:Bev) ON (b.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 384,
  `vector.similarity_function`: 'cosine'
} }
;

// ---------------------------------------------------------------------------
// Relationships: no constraints, by design
// ---------------------------------------------------------------------------
// Neo4j cannot express "at most one SIMILAR_TO per unordered pair", so the
// sync enforces it by only ever writing the direction where src.id < dst.id
// and reading the edge undirected. Every other type is kept single the same
// way: the sync MERGEs on the pattern, and it verifies the counts against
// Postgres inside the transaction before it commits.
//
// The model scripts/graph/sync.ts writes (docs/graph.md has the full tables):
//
//   (:Category {id, name, isAlcoholic, sortOrder, depth, parentId})
//   (:Brand    {key, name})
//   (:Flavor   {name})
//   (:Note     {token, bevCount})
//   (:Bev      {id, name, brand, brandKey, flavor, categoryId, leafCategoryId,
//               priceTier, isAlcoholic, isStarter, source,
//               base, carbonated, caffeine, sweetness, dairy, alcohol, serve,
//               profileSource,              -- only with a flavour profile
//               embedding, embeddingModel,  -- only with an embedding
//               pagerank, strength, degree, bridge, community})
//                                           -- COMPUTED, on every Bev; below
//   (:User     {pseudonym})                 -- and nothing else, ever
//   (:Community {id, size})                 -- COMPUTED; id is opaque
//   (:Meta     {key: 'singleton', lastSyncAt, syncId, rankingVersion,
//               edgesVersion, <one count per label and type>,
//               modularity, analyticsVersion,
//               lastAttemptAt, lastAttemptOk, lastKeepAliveAt})
//
//   (:Category)-[:CHILD_OF]->(:Category)        leaf -> its root
//   (:Bev)-[:IN_CATEGORY]->(:Category)          exactly one, to the LEAF when
//                                               the Bev has one, else the root
//   (:Bev)-[:BY_BRAND]->(:Brand)
//   (:Bev)-[:TASTES_OF]->(:Flavor)
//   (:Bev)-[:HAS_NOTE]->(:Note)
//   (:Bev)-[:SIMILAR_TO {w, tree, content, emb, profile, cop, version,
//                        computedAt}]->(:Bev)   bev_edges, row for row
//   (:User)-[:RANKED {score, z, bucket, rankedAt}]->(:Bev)
//   (:User)-[:LIKES {w}]->(:Bev)                derived: z >= +0.25, w = z
//   (:User)-[:DISLIKES {w}]->(:Bev)             derived: z <= -0.25, w = -z
//   (:Bev)-[:IN_COMMUNITY {hub}]->(:Community)  COMPUTED: exactly one per Bev;
//                                               hub = true on exactly one
//                                               member of each community
//
// The computed part (A-16 (4)). After the mirror is written and swept, the
// sync reads every (:Bev) id and every SIMILAR_TO back out of the graph and
// computes, with @bevi/ranking's network.ts and nothing else:
//
//   Bev.pagerank   FLOAT    weighted PageRank over SIMILAR_TO; sums to 1
//   Bev.strength   FLOAT    the sum of the Bev's SIMILAR_TO weights
//   Bev.degree     INTEGER  how many SIMILAR_TO it has
//   Bev.bridge     FLOAT    participation coefficient in [0, 1): how its
//                           SIMILAR_TO weight is spread across communities
//   Bev.community  STRING   the opaque id of its (:Community)
//
// Communities are Louvain communities of a PARTITION graph that is an input
// of the computation: today the SIMILAR_TO graph itself, soon the flavour
// projection (Bevs joined through shared (:Flavor) and (:Note) nodes). These
// five are set by their own statement after the Bev upsert, which replaces
// the whole property map, so they are fresh every run. Postgres holds the
// same numbers in bev_graph_stats, written after the commit. No gds.*
// procedure is involved: Graph Data Science is a paid product here.
//
// Every node and relationship the sync owns also carries `syncId`, the stamp
// of the run that last wrote it. The sync sweeps whatever does not carry its
// own, which is how a removed ranking or a hidden Bev leaves the graph.
