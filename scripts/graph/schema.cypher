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

// Brand.key is the lowercased brand string; bevs.brand is free text in
// Postgres with no brands table yet, so the graph is where a brand first
// becomes an entity.
CREATE CONSTRAINT brand_key_unique IF NOT EXISTS
FOR (br:Brand) REQUIRE br.key IS UNIQUE
;

CREATE CONSTRAINT flavor_name_unique IF NOT EXISTS
FOR (f:Flavor) REQUIRE f.name IS UNIQUE
;

// User.pseudonym is hmac(user_id, BEVI_PSEUDONYM_SALT) -- stable across syncs
// so co-rating can accumulate, and never reversible to a handle or birth date.
// No other user property is ever synced (decision 31).
CREATE CONSTRAINT user_pseudonym_unique IF NOT EXISTS
FOR (u:User) REQUIRE u.pseudonym IS UNIQUE
;

// One row, holding lastSyncAt. The nightly write to it is also the keep-alive
// that stops Aura Free auto-pausing after 72 hours (docs/graph.md).
CREATE CONSTRAINT meta_singleton_unique IF NOT EXISTS
FOR (m:Meta) REQUIRE m.key IS UNIQUE
;

// ---------------------------------------------------------------------------
// Lookup indexes
// ---------------------------------------------------------------------------
// The sync builds candidate pairs from "same category subtree" and "same
// brand", so both of those are index lookups rather than scans.

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
// gte-small model (decision 30b). The index is created now so the schema is
// complete, but nothing populates Bev.embedding until A-16 -- the embed step,
// bev_embeddings and pgvector all land there. An empty vector index is valid
// and costs nothing.

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
// and reading the edge undirected. Same for CHILD_OF, IN_CATEGORY, BY_BRAND,
// TASTES_OF and RANKED: MERGE on the pattern is what keeps them single.
//
//   (:Bev)-[:IN_CATEGORY]->(:Category)-[:CHILD_OF]->(:Category)
//   (:Bev)-[:BY_BRAND]->(:Brand)
//   (:Bev)-[:TASTES_OF]->(:Flavor)
//   (:User {pseudonym})-[:RANKED {score, z, bucket, rankedAt}]->(:Bev)
//   (:Bev)-[:SIMILAR_TO {w, tree, content, emb, profile, cop, version,
//                        computedAt}]->(:Bev)
