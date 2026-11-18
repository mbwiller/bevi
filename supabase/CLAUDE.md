# supabase/ — lane notes for Claude Code agents

This folder is **Arjun's lane** (migrations, RLS policies, SQL
functions/RPCs, triggers, views, Edge Functions, cron jobs, storage
buckets/policies, auth config, `seed.sql`). If you're an agent working
here, these rules apply before anything in a more general prompt.

## Migrations are append-only

- Never edit or delete a migration file under `migrations/` once it has
  been merged to `main`. A bad migration gets fixed by a new, later
  migration — not by changing the old one.
- It's fine to edit a migration you just created in this same PR, before
  it merges. Once it's on `main`, it's frozen.
- New migration files use the CLI's timestamped naming
  (`supabase migration new <name>` → `YYYYMMDDHHMMSS_<name>.sql`).

## Compatibility with clients you cannot redeploy

Once Bevi ships as a binary, a build approved in January is still calling
these RPCs in June. The backend is the only half that can move, so it
carries the whole burden (`DEVELOPMENT-ARJUN-IOS.md` §IA-3, and
`DEVELOPMENT-ARJUN.md` §14 for the long form).

- **Support window: the current contract major and the two previous minors**
  (`N`, `N-1`, `N-2`). Anything older is cut off deliberately, by raising
  `min_app_version` / `min_contract_version` in `app_config` (IA-2) so the
  app shows "update required" — never by letting its calls start failing.
- **Append-only gains a second rule: no destructive change while a shipped
  client still reads the thing.** Dropping a column, renaming a column,
  narrowing a check constraint, removing an enum value, and changing an
  RPC's return shape are **two-release operations**: add the new thing →
  ship a client that reads it → wait out `minAppVersion` → then remove, in a
  later migration. The ledger in `DEVELOPMENT-ARJUN.md` §15 records which
  release makes the removal legal; a destructive migration without a ledger
  row is a review failure (`.claude/agents/integrator.md`, checks g–i).
- **Never change a live RPC's columns in place.** When a return shape must
  change incompatibly, add `rpc_name_v2` and keep `rpc_name` answering the
  old shape until the old clients are gated out; then retire `rpc_name`
  through the same two-release dance. Same for parameters: a new one needs a
  default, because an old client calls with the old argument list.
- **Additive in one release, and fine:** a nullable column, a new enum
  value, a new table, a new RPC, a new column at the end of a `returns
  table (...)`, a wider check constraint. `packages/api` names the columns
  it reads, so an extra one never breaks an old client — keep it that way.
- Edge Functions, `pg_cron` jobs and `scripts/` deploy with the backend, so
  none of this applies to them. It applies to everything an installed app
  binary can reach: tables it selects from, RPCs it calls, enum values it
  parses, storage paths it builds.

## RLS: enable it once the schema is stable; not required for day-0 scaffolding

- Before assuming RLS "hasn't landed yet," check `migrations/` for any
  existing `alter table ... enable row level security` — don't guess.
- Once RLS work has started in this repo, every migration that creates a
  table must enable RLS **and** add its policies in the same migration.
  Early, schema-only migrations written before RLS work begins are allowed
  to defer this — but that's a temporary exemption for the bootstrap phase,
  not a standing excuse once policies exist elsewhere in the schema.
- No `INSERT`/`UPDATE`/`DELETE` policy for `authenticated` on content
  tables (catalog, rankings, feed, aggregates, etc.). Writes to those go
  through `security definer` RPC functions that validate and apply the
  change — never a direct table policy. `SELECT` policies for
  `authenticated` are fine. A user's own small tables (their profile row,
  follows, want-to-try) may reasonably get direct `own-row` policies; when
  in doubt, prefer the RPC pattern.

## The Bev graph

- Neo4j AuraDB Free holds the Bev-similarity graph; Postgres stays the system
  of record and **Neo4j is never on a request path**. Read `docs/graph.md`
  before touching `scripts/graph/`, `supabase/functions/graph-query/` or
  anything named `bev_edges` / `bev_embeddings` / `bev_flavor_profiles`.

## Secrets

- Never commit secrets. No service-role/secret keys (`sb_secret_...`,
  `service_role` JWTs), DB passwords, or third-party API tokens in any file
  here.
- `supabase/.env` is gitignored — real secrets for local Edge Functions and
  scripts go there, never inline in a migration, function, or committed
  config.
- The app only ever sees the publishable/anon key. If you find a secret
  key referenced from anywhere the app or `packages/api` client code can
  reach, that's a bug, not a style issue.

## Before opening a PR

If Docker is available locally, run:

```bash
supabase db reset   # drops, replays all migrations, runs seed.sql
supabase test db    # pgTAP tests
```

Both should pass clean before you ask for review. If Docker isn't
available in your environment, say so in the PR instead of skipping
silently.
