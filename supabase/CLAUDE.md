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
