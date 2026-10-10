# Bevi — Development plan: Arjun (backend)

> Your lane: the Supabase project and everything server-side. Postgres schema, RLS, SQL functions/RPCs, Edge Functions, cron, storage, auth config, the `packages/api` client the app talks through, and the seed catalog with its image pipeline.
> Matt owns the app, the ranking math, and design. You meet in `shared/` through `contract/*` PRs.

Written 2026-10-09 from `vision.md` (source of truth), `CONVERSATION.md` (raw founding chat), the agreed work-split brief, and the Bev Maps conventions you already use. Facts about Supabase, Apple and vendors were checked against current docs on 2026-10-09; where I could not confirm something I say so.

**Sections**

1. [Lane and conventions](#1-lane-and-conventions)
2. [Platform and environments](#2-platform-and-environments)
3. [Schema (contract v0 draft)](#3-schema-contract-v0-draft)
4. [Security: RLS, auth, deletion, age gate, abuse](#4-security)
5. [Server logic: RPCs, functions, jobs](#5-server-logic)
6. [`packages/api`](#6-packagesapi)
7. [Catalog and images (`data/catalog/`)](#7-catalog-and-images)
8. [Ops: CI, observability, backups, seeding](#8-ops)
9. [Working with Matt](#9-working-with-matt)
10. [Plan by phase](#10-plan-by-phase)
11. [First week checklist](#11-first-week-checklist)
12. [Deliberately not doing](#12-deliberately-not-doing)
13. [Open questions and proposed vision.md changes](#13-open-questions-and-proposed-visionmd-changes)

---

## 1. Lane and conventions

Same model as Bev Maps: lane per owner, one shared contract, PR + CI + integrator before merge, never push `main`.

| Path | Owner | What lives there |
|---|---|---|
| `app/` | Matt | Expo RN app: navigation (5 tabs), screens, components, design system/tokens, logo usage, camera/image-picker UI, client state, the dev-only mock API |
| `packages/ranking/` | Matt | Pure TypeScript, zero I/O: pairwise placement state machine (gut-check bucket → binary search), score-from-position, normalization (per-user z-scores, per-category stats definitions), Bayesian leaderboard average, predicted score + recommendations (Layer 1, Layer 2, blend, exploration), onboarding starter-set selection, "rank on Bevi" formula. Unit-tested. |
| `design/` | Matt | Beli reference screenshots, brand, logo, per-screen specs |
| `supabase/` | Arjun | Migrations, RLS policies, SQL functions/RPCs, triggers, views, Edge Functions, cron/scheduled jobs, storage buckets + policies, auth config, `seed.sql` |
| `packages/api/` | Arjun | Typed data-access client wrapping supabase-js that implements the `BeviApi` interface. The ONLY thing the app imports to talk to the backend. |
| `data/catalog/` | Arjun | Seed Bev catalog (names, flavors, categories, price tiers), image sourcing + background-removal pipeline. Matt reviews image style. |
| `shared/` | Both, via `contract/*` PRs | Domain types, enums (buckets, categories, price tiers), the `BeviApi` interface, generated Supabase DB types, fixtures, golden test vectors |
| Root, `CLAUDE.md`, `vision.md`, `.github/`, `.claude/` | Both, via `chore/*` PRs | Workspace config, CI, agent definitions |

Rules carried over from Bev Maps, adjusted for Bevi:

- Branches: you use `be/*`. Shared changes go on `contract/*` (Matt approves) or `chore/*`. Branch from fresh `main`, rebase daily, squash-merge, delete the branch.
- You never edit `app/`, `packages/ranking/`, `design/`. If you need something there, write it in your PR under "Heads-up for Matt".
- One root lockfile. Install with `npm install <pkg> -w packages/api`. On lockfile conflict take main's and rerun `npm install`.
- Never commit keys. Supabase secrets live in the dashboard, GitHub Environments, and gitignored `supabase/.env`. The app only ever sees the publishable (anon) key, which Matt puts in `app/`.
- Run the integrator agent locally before opening a PR.
- Sub-agents: default Sonnet; Opus only for schema/algorithm decisions; Haiku for "do this 200 times". Tags on every task in §10.

### Your folder layout

```
supabase/
  config.toml                 # local stack, auth, functions, seed paths
  migrations/                 # YYYYMMDDHHMMSS_<thing>.sql, append-only
  seed.sql                    # categories + catalog + local-only fixture users
  seed/catalog.sql            # generated from data/catalog (see §7)
  tests/                      # pgTAP: *.test.sql, incl. generated vector tests
  functions/
    _shared/                  # supabaseAdmin.ts, snapshot.ts, images.ts, ranking.bundle.mjs (generated)
    recommend/                # Layer 1/2 predictions + Recommended list
    process-photo/            # background removal + resize for user uploads
    delete-account/           # Apple token revocation on delete (task 3.0, only once Apple sign-in exists)
packages/api/
  src/index.ts                # createBeviApi(config): BeviApi
  src/errors.ts               # ApiError + PG error mapping
  src/paging.ts               # cursor helpers
  src/*.ts                    # one file per BeviApi area (bevs, rankings, feed, ...)
  test/                       # vitest against local stack
data/catalog/
  bevs.csv                    # the seed list (source of truth for seeds)
  categories.json
  raw/<slug>.<ext>            # downloaded source images (gitignored)
  images/<slug>.webp          # cutouts, 1024px, transparent
  contact-sheet.html          # generated; Matt reviews style here
scripts/catalog/              # validate, fetch-images, cutout, build-seed, upload-images
```

---

## 2. Platform and environments

### 2.1 Projects

| Environment | What | Where secrets live |
|---|---|---|
| `local` | `supabase start` on your Mac (Docker). Migrations + `seed.sql` applied by `supabase db reset`. This is where you and your agents do all development and where CI runs. | `supabase/.env` (gitignored) |
| `bevi-dev` | Hosted Free project. Target of `main` deploys. Matt's dev/TestFlight-internal builds point here. | Dashboard + GitHub Environment `dev` |
| `bevi-prod` | Hosted Free project (upgrade to Pro when §2.3 bites). Deployed by manual approval only. | Dashboard + GitHub Environment `prod` |

Free plan allows 2 active projects per organization, so dev + prod both free is allowed. Both pause after a week of no activity (see 2.3).

### 2.2 Local workflow (migrations as code)

```bash
npx supabase init                      # once; creates supabase/config.toml
npx supabase start                     # Postgres + Auth + Storage + Studio at localhost:54323
npx supabase migration new add_rankings
# edit supabase/migrations/<ts>_add_rankings.sql
npx supabase db reset                  # drops, replays all migrations, runs seed.sql
npx supabase test db                   # pgTAP tests in supabase/tests
npx supabase db lint                   # plpgsql_check on functions
npx supabase gen types typescript --local --schema public > shared/src/db.types.ts
npx supabase functions serve recommend --env-file supabase/.env   # needs Docker
npx supabase link --project-ref <dev-ref>
npx supabase db push                   # apply pending migrations to the linked project
npx supabase functions deploy --use-api
```

Rules:

- Never edit the hosted DB through Studio and forget it. If you must hotfix in the dashboard, immediately `supabase db diff -f <name>` to capture it as a migration.
- Migrations are append-only once merged. A bad migration gets a new corrective migration, not an edit.
- Every migration that creates a table also enables RLS and adds policies in the same file. A pgTAP test (§8.1) fails CI if any `public` table has RLS off.
- Pin `config.toml` `[db] major_version` to what the hosted projects run (check `SHOW server_version;` after creating them; new projects were on Postgres 17 at time of writing, the CLI default used to be 15).
- Keep `seed.sql` idempotent for local and CI only. Hosted projects get the catalog through the `scripts/catalog/upload` path (§7), not through `seed.sql`.

### 2.3 Free-tier facts that matter for a ~20-person app (verified 2026-10-09 on supabase.com/pricing and docs)

| Item | Free | Pro ($25/mo) | What it means for Bevi |
|---|---|---|---|
| Pausing | **Paused after 1 week of inactivity**; restore manually from dashboard | Never paused | The single biggest gotcha. If friends stop ranking for 7 days, the app returns errors until someone restores it. Mitigation below. |
| Backups | **Not included** (docs: "regularly export using `supabase db dump`") | Daily, 7-day retention; PITR is an add-on (~$100/mo for 7 days) | We run our own nightly dump from GitHub Actions (§8.3). |
| Database size | 500 MB | 8 GB | Fine. 20 users × 500 rankings is tiny. |
| Storage | 1 GB | 100 GB | ~400 seed Bevs × (200 KB full + 30 KB thumb) ≈ 90 MB. User photos add ~250 KB each. Fine for years. |
| Egress | 5 GB/mo (+5 GB cached) | 250 GB | Images are the only real egress. Keep thumbs ≤ 30 KB WebP, set long `Cache-Control`, let the app cache. 5 GB ≈ 170k thumb loads/mo. |
| Image transformations | **Not included (Pro+)** | 100 origin images included | We can't use `?width=` URLs. Generate full + thumb sizes ourselves at upload time (§7.4). |
| Edge Functions | 500k invocations/mo; 150 s wall clock; **2 s CPU per request**; 256 MB; 20 MB bundle; 100 functions | 2M; 400 s | Recommendation batches must stay under 2 s CPU each; batch by user, not all users at once. Image resizing in WASM also eats CPU; one image per invocation. |
| Realtime | 200 concurrent, 2M msgs/mo | 500 | Not needed for v1 feed; pull-to-refresh. |
| Auth MAU | 50,000 | 100,000 | Irrelevant at our size. |
| Built-in email | **2 emails/hour** total (meant for non-production) | same | Irrelevant in v1 (Google-only sign-in, email disabled). If email sign-in is ever enabled, custom SMTP is mandatory first. |
| Log retention | 1 day | 7 days | Errors older than a day are gone. See §8.2. |
| Compute | Shared CPU, 500 MB RAM | Micro | pg_trgm and the small tables are fine. |
| Branching | Not included | per-branch hourly | Not needed; local stack is the branch. |
| Cron / pg_net / pg_trgm / pgTAP | Available (pg_cron and pg_net are enabled from the dashboard or `create extension`; pgTAP is used by `supabase test db` locally). I could not find an official statement that any of these are plan-gated; third-party sources say pg_cron is on all plans. Verify in Database → Extensions on the dev project on day 1. |

Keep-alive for the pause: the commonly reported trigger is "no API activity". It is **not confirmed** that pg_cron activity inside the DB counts as activity, so don't rely on it. Add a tiny GitHub Actions cron (every 3 days) that calls a `ping()` RPC on both hosted projects with the publishable key. If that proves insufficient, the honest fix is Pro on prod only ($25/mo, split two ways), which also buys backups. Decide at the end of Phase 1 based on whether the dev project ever paused.

Also: paused projects can reportedly be deleted after a long time paused (one source says ~90 days; unverified). The nightly dump covers us either way.

### 2.4 Secrets and keys

| Secret | Where | Who |
|---|---|---|
| Publishable/anon key, project URL | `app/` env (`EXPO_PUBLIC_…`, Matt), passed into `createBeviApi(config)`; `packages/api` test env | Public by design; RLS is the security boundary |
| Service-role/secret key | Edge Function env (auto-injected as `SUPABASE_SERVICE_ROLE_KEY`), `scripts/catalog/` via `supabase/.env`, Vault for pg_net calls | Never in the app, never in git |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` | GitHub Environments `dev` / `prod` | CI deploys |
| `REPLICATE_API_TOKEN` (or Photoroom key) | `supabase secrets set`, `supabase/.env` | process-photo function and catalog scripts |
| `CRON_SECRET` | Vault (`vault.create_secret`) and function secrets | pg_net → Edge Function auth |
| Google OAuth client IDs (iOS, Android, Web) + Web client secret | Dashboard → Auth → Providers → Google; `config.toml` for local | Client IDs are public; the Web client secret is not |
| Apple Services ID key (task 3.0, only if web OAuth is needed) | Dashboard | Rotates every 6 months; prefer native-only to avoid it |

Supabase introduced new-style API keys (`sb_publishable_…` / `sb_secret_…`) alongside the legacy `anon`/`service_role` JWTs. Use the new ones for new projects; supabase-js accepts either.

---

## 3. Schema (contract v0 draft)

This is your draft for the `contract/v0` PR. Matt's per-screen data list may add columns; the shapes below are designed to need only additive changes. Naming: `snake_case` in SQL, `camelCase` in `shared/` types (generated DB types stay snake_case; `packages/api` maps at the edge).

Design decisions you should defend in review:

1. **Users do not write rows.** No `INSERT/UPDATE/DELETE` policies for `authenticated` on any table except their own `profiles` row, `follows`, and `want_to_try`. Everything else goes through `security definer` RPCs that validate, lock, and update aggregates. (The founding chat's "add a row in the SQL" becomes "call `create_bev()`".)
2. **Rankings store position and score, re-spaced per bucket** (vision §4). Position is a 0-based index within `(user_id, bucket)`; `0` is the user's favourite in that bucket. The unique index on `(user_id, bucket, position)` is `DEFERRABLE INITIALLY DEFERRED` so a single `UPDATE … SET position = position + 1` shift never collides mid-statement. A per-user advisory lock serialises concurrent submits from the same user (two devices, double tap).
3. **Aggregates live in their own tables** (`bev_stats`, `user_stats`, `user_category_stats`) rather than as columns on `bevs`/`profiles`, so the hot write path never touches catalog rows and RLS on the catalog stays read-only.
4. **Categories are text slugs** (`'soda'`, `'diet_soda'`) so `shared/` enums and the DB agree without a lookup.
5. **Buckets are `smallint` 1/2/3** in the DB (`1` = DISLIKED, `2` = FINE, `3` = LOVED) so `ORDER BY bucket DESC, position` yields the user's full list best-first. The domain type in `shared/` is `'LOVED' | 'FINE' | 'DISLIKED'`; `packages/api/src/mappers.ts` converts both ways. `insertIndex` 0 = best in the bucket (confirmed with Matt).
6. **Merged duplicates are kept, not deleted.** `bevs.status = 'merged'` + `merged_into` + a row in `bev_aliases`, so old links and searches still resolve.
7. **Every Bev-creating or ranking RPC writes a `feed_events` row.** The feed is a query over events, not over rankings, so re-ranks and want-to-try saves can appear without special-casing.

### 3.1 Extensions

```sql
create extension if not exists pg_trgm;      -- fuzzy search + dedupe
create extension if not exists unaccent;     -- "Jarritos Tamarindo" vs "Jarritos Tamarindó"
create extension if not exists pg_cron;      -- scheduled jobs (hosted: enable in dashboard too)
create extension if not exists pg_net;       -- cron → Edge Function HTTP calls
-- pgtap is created by `supabase test db` in the test transaction; don't put it in a migration.
```

### 3.2 Tables

#### `categories`

```sql
create table public.categories (
  id            text primary key,                  -- 'soda', 'diet_soda', ...
  name          text not null,                     -- 'Diet / zero-sugar soda'
  sort_order    smallint not null,
  is_alcoholic  boolean not null default false,    -- 21+ gate
  emoji         text
);
```

Seed rows (from vision §2): `soda`, `diet_soda`, `juice`, `water`, `sparkling_water`, `energy`, `coffee`, `tea`, `boba`, `sports`, `smoothie`, `beer`, `wine`, `spirits_cocktails`, `other`. I split "Alcoholic" into three because a leaderboard that mixes beer and whiskey is useless; all three carry `is_alcoholic = true`. Flag this in contract v0 (see §13).

#### `profiles`

```sql
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  handle           text not null unique
                   check (handle = lower(handle) and handle ~ '^[a-z0-9_]{3,20}$'),
  display_name     text not null check (char_length(display_name) between 1 and 40),
  avatar_path      text,                           -- storage path in 'avatars'
  birth_date       date,                           -- declared age for the 21+ gate
  age_attested_at  timestamptz,                    -- when they declared it
  timezone         text not null default 'America/Los_Angeles',  -- for streak day boundaries
  role             text not null default 'user' check (role in ('user','admin')),
  bevi_rank        integer,                        -- refreshed by cron (Matt's formula)
  handle_changed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index profiles_handle_trgm on public.profiles using gin (handle gin_trgm_ops);
```

Vision §8 calls this `users`; it must be `profiles` because `auth.users` is Supabase's and not ours. A trigger on `auth.users` insert creates the row (§4.2). Reserved handles (`admin`, `bevi`, `support`, `null`, …) are rejected in `set_handle()`.

#### `follows`

```sql
create table public.follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  followee_id  uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);
```

#### `bevs`

```sql
create table public.bevs (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(name) between 1 and 80),
  brand                 text check (char_length(brand) <= 80),      -- maker, or the shop for shop drinks
  flavor                text check (char_length(flavor) <= 80),
  category_id           text not null references public.categories(id),
  photo_path            text,                 -- 'bev-photos/<id>/full.webp' (cutout). Required once status='active'
  thumb_path            text,                 -- 'bev-photos/<id>/thumb.webp'
  nutrition_label_path  text,                 -- 'nutrition-labels/<id>.jpg'
  price_tier            smallint not null check (price_tier between 1 and 4),
  price_estimated       boolean not null default true,
  upc                   text check (upc ~ '^[0-9]{8,14}$'),         -- barcode; see §13
  is_starter            boolean not null default false,             -- onboarding candidate pool
  status                text not null default 'active'
                        check (status in ('pending_photo','active','merged','hidden')),
  merged_into           uuid references public.bevs(id),
  created_by            uuid references public.profiles(id) on delete set null,  -- null = seeded
  source                text not null default 'user' check (source in ('seed','user','featured')),
  search_text           text generated always as
                        (lower(coalesce(brand,'') || ' ' || name || ' ' || coalesce(flavor,''))) stored,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (status <> 'active' or photo_path is not null),
  check ((status = 'merged') = (merged_into is not null))
);
create index bevs_search_trgm   on public.bevs using gin (search_text gin_trgm_ops);
create index bevs_category_idx  on public.bevs (category_id) where status = 'active';
create unique index bevs_upc_uq on public.bevs (upc) where upc is not null and status <> 'merged';
create unique index bevs_natural_uq on public.bevs
  (category_id, lower(coalesce(brand,'')), lower(name), lower(coalesce(flavor,'')))
  where status in ('pending_photo','active');
```

`unaccent()` is not immutable so it can't go in the generated column; apply it in the search function to both sides instead.

#### `bev_aliases` (dedupe memory)

```sql
create table public.bev_aliases (
  alias       text not null,                     -- normalized: lower(unaccent(brand name flavor))
  bev_id      uuid not null references public.bevs(id) on delete cascade,
  source      text not null check (source in ('seed','merge','manual')),
  created_at  timestamptz not null default now(),
  primary key (alias)
);
create index bev_aliases_trgm on public.bev_aliases using gin (alias gin_trgm_ops);
```

Seeds get common aliases ("coke" → Coca-Cola Classic, "coke zero" → Coca-Cola Zero Sugar). Merges add the duplicate's name. `find_similar_bevs()` searches both `bevs.search_text` and this table.

#### `bev_stats`

```sql
create table public.bev_stats (
  bev_id        uuid primary key references public.bevs(id) on delete cascade,
  rating_count  integer not null default 0,
  sum_score     numeric(10,3) not null default 0,
  avg_score     numeric(4,2),                   -- null until rating_count > 0
  score_stddev  numeric(4,2),                   -- POPULATION stddev (stddev_pop): 0 when rating_count = 1, null when 0. Matt's SIGMA_FLOOR = 1.0 applies only when computing z-scores, never to the stored value
  bayes_score   numeric(4,2),                   -- Matt's Bayesian average; refreshed with global mean
  last_ranked_at timestamptz,
  updated_at    timestamptz not null default now()
);
```

Maintained by `refresh_bev_stats(uuid[])`, called from every ranking RPC for every Bev whose score moved (a bucket re-space moves them all), and by a nightly full refresh as a safety net.

#### `rankings`

```sql
create table public.rankings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  bev_id      uuid not null references public.bevs(id) on delete cascade,
  bucket      smallint not null check (bucket in (1,2,3)),   -- 1 DISLIKED, 2 FINE, 3 LOVED (domain enum maps in packages/api)
  position    integer not null check (position >= 0),       -- 0 = best in bucket
  score       numeric(4,2) not null check (score >= 0 and score <= 10),
  note        text check (char_length(note) <= 280),
  photo_path  text,                                          -- optional "my drink" photo in the feed (raw-uploads → bev-photos/user/...)
  ranked_at   timestamptz not null default now(),            -- first ranked (drives streaks + feed)
  updated_at  timestamptz not null default now(),
  unique (user_id, bev_id),
  unique (user_id, bucket, position) deferrable initially deferred
);
create index rankings_bev_idx  on public.rankings (bev_id);
create index rankings_user_recent_idx on public.rankings (user_id, ranked_at desc);
```

#### `comparisons`

```sql
create table public.comparisons (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  submission_id  uuid not null,                        -- groups one submit_ranking call
  winner_bev_id  uuid not null references public.bevs(id) on delete cascade,
  loser_bev_id   uuid not null references public.bevs(id) on delete cascade,
  tie            boolean not null default false,        -- "about the same"; winner/loser then just record the pair order shown
  created_at     timestamptz not null default now(),
  check (winner_bev_id <> loser_bev_id)
);
create index comparisons_user_idx on public.comparisons (user_id, created_at desc);
```

Raw pairwise answers, private to the user. Used later for drift re-checks and as Layer 2 training signal.

#### `want_to_try`

```sql
create table public.want_to_try (
  user_id            uuid not null references public.profiles(id) on delete cascade,
  bev_id             uuid not null references public.bevs(id) on delete cascade,
  source_user_id     uuid references public.profiles(id) on delete set null,   -- "saw Jack rank it"
  source_ranking_id  uuid references public.rankings(id) on delete set null,
  created_at         timestamptz not null default now(),
  primary key (user_id, bev_id)
);
```

#### `user_stats` and `user_category_stats`

```sql
create table public.user_stats (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  rating_count     integer not null default 0,
  mean_score       numeric(5,3),
  stddev_score     numeric(5,3),                -- stddev_pop, same rule as bev_stats
  want_count       integer not null default 0,
  follower_count   integer not null default 0,
  following_count  integer not null default 0,
  updated_at       timestamptz not null default now()
);

create table public.user_category_stats (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  category_id   text not null references public.categories(id),
  rating_count  integer not null default 0,
  mean_score    numeric(5,3),
  stddev_score  numeric(5,3),                 -- stddev_pop
  affinity_z    numeric(6,3),                  -- Matt's "category affinity" if Matt wants it stored; else computed in the Edge Function
  updated_at    timestamptz not null default now(),
  primary key (user_id, category_id)
);
```

#### `streaks`

```sql
create table public.streaks (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  current_days    integer not null default 0,
  longest_days    integer not null default 0,
  last_ranked_on  date,                        -- in the user's profile timezone
  updated_at      timestamptz not null default now()
);
```

`touch_streak(uid)` runs inside `submit_ranking` and `rerank_bev` (re-ranks count; removals don't break a streak): compute `today := (now() at time zone p.timezone)::date`; if `last_ranked_on = today` nothing; if `= today - 1` increment; else reset to 1. An hourly cron zeroes `current_days` where `last_ranked_on < today - 1` in each user's timezone, so profile and leaderboard reads never show a stale streak. Matt's streak vectors (start of Phase 2) pin the edge cases.

#### `featured_bevs`

```sql
create table public.featured_bevs (
  id          uuid primary key default gen_random_uuid(),
  bev_id      uuid not null references public.bevs(id) on delete cascade,
  title       text not null,
  blurb       text,
  image_path  text,                            -- polished/generated hero, 'featured/<id>.webp'; falls back to bev photo
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  sort_order  smallint not null default 0,
  created_by  uuid references public.profiles(id) on delete set null
);
```

Admin-only writes (you two, via SQL or a tiny admin RPC). No admin UI in v1.

#### `feed_events`

```sql
create table public.feed_events (
  id              bigint generated always as identity primary key,
  actor_id        uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('ranked','reranked','want_to_try','followed')),
  bev_id          uuid references public.bevs(id) on delete cascade,
  ranking_id      uuid references public.rankings(id) on delete cascade,
  target_user_id  uuid references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now()
);
create index feed_events_actor_idx on public.feed_events (actor_id, id desc);
```

Keyset-paginated by `id`. Deleting a ranking cascades its events away.

#### `bev_reports` (moderation)

```sql
create table public.bev_reports (
  id            bigint generated always as identity primary key,
  reporter_id   uuid not null references public.profiles(id) on delete cascade,
  bev_id        uuid not null references public.bevs(id) on delete cascade,
  reason        text not null check (reason in ('duplicate','junk','wrong_info','bad_photo','inappropriate','other')),
  duplicate_of  uuid references public.bevs(id),
  note          text check (char_length(note) <= 500),
  status        text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by   uuid references public.profiles(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (reporter_id, bev_id, reason)
);
```

#### `user_bev_predictions` (recommendations cache)

```sql
create table public.user_bev_predictions (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  bev_id           uuid not null references public.bevs(id) on delete cascade,
  predicted_score  numeric(4,2) not null,
  rec_rank         integer,                     -- null = not in the Recommended list; 1 = top
  reason           jsonb,                       -- Matt's explanation payload ("people like you", "you love sparkling")
  model_version    text not null,               -- packages/ranking version that produced it
  computed_at      timestamptz not null default now(),
  primary key (user_id, bev_id)
);
create index predictions_rec_idx on public.user_bev_predictions (user_id, rec_rank) where rec_rank is not null;

create table public.recommendation_jobs (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  requested_at  timestamptz not null default now(),
  attempts      smallint not null default 0
);
```

#### `user_actions` (rate limiting log)

```sql
create table public.user_actions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  action      text not null,                    -- 'create_bev','report','set_handle','follow'
  created_at  timestamptz not null default now()
);
create index user_actions_idx on public.user_actions (user_id, action, created_at desc);
```

Cron deletes rows older than 7 days.

#### `global_stats` (one row)

```sql
create table public.global_stats (
  id             boolean primary key default true check (id),   -- singleton
  mean_score     numeric(5,3),                                  -- m in the Bayesian average
  rating_count   integer,
  updated_at     timestamptz not null default now()
);
```

```sql
create table public.category_stats (
  category_id   text primary key references public.categories(id),
  rating_count  integer not null default 0,
  mean_score    numeric(5,3),                                  -- category prior m, used once rating_count >= 30
  updated_at    timestamptz not null default now()
);
```

Both are refreshed by `refresh_global_stats()` (cron, every 10 min).

### 3.3 Views

| View | Purpose | Notes |
|---|---|---|
| `bev_cards` | `bevs` ⋈ `bev_stats` ⋈ `categories`, only `status='active'`, age-filtered | What search, lists and the detail page read. Public URL columns computed from paths. |
| `bev_leaderboard` | `bev_cards` + `bayes_score(sum_score, rating_count, m, 3)` ordered desc, `rating_count >= 2` (`MIN_RATERS`), with `category_id` for filtering; `m` is the category mean when that category has ≥ 30 rankings, else the global mean | Keep as a view; materialize only if slow |
| `bev_new` | `bev_cards` with `rating_count = 1`, newest first | The "New" strip under the leaderboard |
| `bev_leaderboard_30d` | Same, over rankings in the last 30 days | "Hottest this month" (Phase 3) |
| `user_leaderboard` | `profiles` ⋈ `user_stats` ⋈ `streaks`, `points = rating_count + 3 * current_days + 2 * created_adopted` (created Bevs ranked by someone else), `rank() over (order by points desc)` so ties share a rank | `bevi_rank` is snapshotted into `profiles` hourly |
| `my_lists` (function, not view) | Bev'd list ordered `bucket desc, position` | Functions, because RLS on views in Supabase needs `security_invoker = true` (set it on every view). |

Set `alter view … set (security_invoker = true)` on all views so RLS of the underlying tables applies.

---

## 4. Security

### 4.1 RLS matrix

All policies are `to authenticated`. `anon` gets nothing except `ping()`. The age gate is a `stable security definer` helper:

```sql
create or replace function public.viewer_is_adult() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select birth_date <= (current_date - interval '21 years')::date
       from public.profiles where id = auth.uid()),
    false);
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;
```

| Table | SELECT | INSERT | UPDATE | DELETE | Visibility class |
|---|---|---|---|---|---|
| `categories` | all | — | — | — | public |
| `profiles` | all (handle, display_name, avatar, counts); `birth_date` is excluded by a column-level `revoke select (birth_date) … from authenticated` + the API reads it via `get_my_profile()` | trigger only | own row (`id = auth.uid()`), but `role`, `bevi_rank`, `handle` are protected by a `before update` trigger (handle only via `set_handle()`) | RPC only | public |
| `follows` | all | own `follower_id = auth.uid()` | — | own | public |
| `bevs` | `status in ('active')` or (`status='pending_photo'` and `created_by = auth.uid()`) or `is_admin()`; and (`not category.is_alcoholic` or `viewer_is_adult()`) | RPC only | admin only | — | public (age-gated) |
| `bev_aliases` | all | RPC only | — | — | public |
| `bev_stats` | all | — | — | — | public |
| `rankings` | all (profile feeds are public inside the app) with the same alcohol filter via join | RPC only | RPC only | RPC only | public (age-gated) |
| `comparisons` | own | RPC only | — | — | private |
| `want_to_try` | own | own | — | own | private (count is public via `user_stats`) |
| `user_stats`, `user_category_stats`, `streaks` | all | — | — | — | public |
| `featured_bevs` | all where `now() between starts_at and coalesce(ends_at,'infinity')` | admin | admin | admin | public |
| `feed_events` | `actor_id = auth.uid()` or actor in my follows | RPC only | — | — | friends-visible |
| `bev_reports` | own or admin | RPC only | admin | — | private |
| `user_bev_predictions` | own | service role | service role | service role | private |
| `recommendation_jobs`, `user_actions`, `global_stats` | none (service role / RPC internals only; `global_stats` select all) | — | — | — | internal |
| `storage.objects` | see §7.5 | | | | |

"RPC only" means: no policy for `authenticated`; the RPC is `security definer`, owned by `postgres`, with `set search_path = public` and an explicit `auth.uid()` check. `revoke execute on function … from public, anon; grant execute … to authenticated;` on every RPC.

The alcohol filter on `rankings` and `feed_events` matters: a minor following a 21+ friend must not see beer rankings in the feed. Implement it once in `bev_cards` and join everything through that view, so there is one place to get it right.

### 4.2 Auth

**Decided 2026-10-09: v1 sign-in is Google only.** Email/password and magic link are disabled, so no custom SMTP, no Resend and no Turnstile in v1.

- **Flow:** native Google sign-in in the app (`@react-native-google-signin/google-signin`) returns an ID token; `packages/api` exposes `signInWithGoogle(idToken)`, which calls `supabase.auth.signInWithIdToken({ provider: 'google', token })` internally. The app never touches supabase-js.
- **Setup (you):** Google Cloud project → OAuth client IDs for iOS (bundle ids `com.bevi.app`, `com.bevi.app.dev`), Android (package name + SHA-1 of the debug and release keystores; Matt supplies the SHA-1s from EAS) and a Web client ID. Dashboard → Auth → Providers → Google: enable, paste the Web client ID as the client ID and add the iOS and Android client IDs to "Authorized Client IDs" (Supabase validates the ID token's `aud` against this list). `config.toml`: `[auth.external.google] enabled = true`, `skip_nonce_check = true` only if the native library can't send a nonce (check `@react-native-google-signin` docs; it usually can). Expo Go cannot run the native Google module; Matt uses a dev build.
- **Disabled in v1:** `[auth.email] enable_signup = false` (hosted: Auth → Providers → Email off), `enable_anonymous_sign_ins = false`. Keep `rate_limit.sign_in_sign_ups = 30` (per 5 min per IP, default). Hosted settings are set in the dashboard; check whether `supabase config push` covers the Google provider fields, otherwise write the clicks into `supabase/README.md`.
- **Profile trigger:** reads Google's `full_name` and `avatar_url` from `raw_user_meta_data` (Google supplies them on every sign-in), generates a handle from the email prefix, and onboarding still asks for a real handle via `set_handle()`.
- **App Store 4.8 consequence:** shipping Google (a third-party login) requires an equivalent privacy-preserving option, i.e. Sign in with Apple. Google-only is fine for Android and internal TestFlight; **Apple must be added before App Store submission, and possibly before external TestFlight beta review** (beta review applies the guidelines; treat it as a gate). That work is task 3.0 in §10, with the setup notes kept there.
- **Account deletion:** `delete_my_account` (§4.3) is unchanged. Google needs no token revocation on delete; the Apple revocation step moves to task 3.0 with Apple itself.

**Profile creation on signup**

```sql
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_base text; v_handle text; v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1), 'bevi user');
  -- Google supplies full_name and avatar_url in raw_user_meta_data; Apple (task 3.0) supplies the name only on first sign-in
  v_base := regexp_replace(lower(coalesce(split_part(new.email,'@',1), 'user')), '[^a-z0-9_]', '', 'g');
  v_base := left(coalesce(nullif(v_base,''), 'user'), 14);
  v_handle := v_base;
  while exists (select 1 from public.profiles where handle = v_handle) loop
    v_handle := v_base || '_' || substr(md5(gen_random_uuid()::text), 1, 4);
  end loop;
  insert into public.profiles (id, handle, display_name, avatar_path)
  values (new.id, v_handle, left(v_name, 40), new.raw_user_meta_data->>'avatar_url');   -- external URL until the user uploads one; packages/api passes it through as-is
  insert into public.user_stats (user_id) values (new.id);
  insert into public.streaks (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

The generated handle is only a placeholder (and once Apple sign-in exists its private relay emails like `abc123@privaterelay.appleid.com` make it junk), so onboarding always asks for a handle (`set_handle()` RPC: lowercases, validates, checks reserved list, allows 1 change per 30 days).

### 4.3 Account deletion (App Store 5.1.1(v): "If your app supports account creation, you must also offer account deletion within the app")

```sql
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth, storage as $$
declare v_uid uuid := auth.uid(); v_bevs uuid[];
begin
  if v_uid is null then raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501'; end if;
  select array_agg(distinct bev_id) into v_bevs from public.rankings where user_id = v_uid;
  delete from storage.objects where bucket_id in ('avatars','raw-uploads') and owner_id = v_uid::text;
  -- bevs they created stay in the catalog with created_by = null (FK on delete set null); say so in the privacy policy
  delete from auth.users where id = v_uid;      -- cascades: profiles → rankings, comparisons, follows, want_to_try, events, stats
  perform public.refresh_bev_stats(v_bevs);
  perform public.refresh_global_stats();
end $$;
```

Deleting from `auth.users` inside a `security definer` function owned by `postgres` is the standard Supabase pattern and avoids needing the service key from the app. Verify the `storage.objects` owner column name on your Postgres/storage version (`owner` uuid in older, `owner_id` text in newer schemas).

With Google-only sign-in nothing else is needed. When Sign in with Apple is added (task 3.0), Apple additionally expects its tokens to be revoked on account deletion, and Supabase does not do that for native sign-in; the `delete-account` Edge Function described in task 3.0 handles it.

### 4.4 Age gate (alcoholic categories)

- Store a declared `birth_date` collected during onboarding (Apple's guidelines accept "verified or declared age" mechanisms; nothing requires ID checks for an app like this). The RPC `set_birth_date()` is one-way: it can be set once and only changed by an admin, so nobody flips from 19 to 21. Matt's onboarding spec matches this.
- `viewer_is_adult()` gates `bevs` (and everything joined through `bev_cards`), `create_bev()` for alcoholic categories, and `submit_ranking()`.
- App Store rating consequence: "frequent" alcohol references rate the app 18+ under Apple's 2025 tiers (13+/16+/18+ replaced 12+/17+). A beer leaderboard is arguably "frequent". For a friends-only release that may be fine; see §13 for the alternative of shipping v1 without alcohol.

### 4.5 Rate limits and abuse on user-created content

```sql
create or replace function public.assert_rate(p_action text, p_limit int, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.user_actions
       where user_id = auth.uid() and action = p_action and created_at > now() - p_window) >= p_limit then
    raise exception 'BEVI_RATE_LIMITED' using errcode = 'P0001', detail = p_action;
  end if;
  insert into public.user_actions (user_id, action) values (auth.uid(), p_action);
end $$;
```

| Action | Limit | Why |
|---|---|---|
| `create_bev` | 5 / hour, 20 / day | A real person adds a few drinks a day |
| `submit_ranking` | 60 / hour | Onboarding ranks ~10 in a minute; nobody ranks 60/h legitimately |
| `report_bev` | 20 / day | |
| `follow` | 100 / day | |
| `set_handle` | 1 / 30 days | |
| `raw-uploads` object insert | 10 MB max, `image/jpeg,image/png,image/heic,image/webp` only (bucket config) | Storage cost |

Plus: Supabase Auth rate limits (defaults are fine), string length checks on every text column, `pending_photo` Bevs auto-hidden after 24 h if the photo never arrives (cron), and moderation via `bev_reports` (§7.6).

---

## 5. Server logic

Formulas are Matt's; you store and execute. Every SQL function that encodes a formula gets a header comment naming the `packages/ranking` export it mirrors and the vector file that proves it.

### 5.1 Error convention for RPCs

Raise with a stable code in the message and a Postgres `errcode`; `packages/api` maps both to `ApiError`.

| Message | errcode | API code |
|---|---|---|
| `BEVI_UNAUTHORIZED` | `42501` | `unauthorized` |
| `BEVI_NOT_FOUND` | `P0002` | `not_found` |
| `BEVI_ALREADY_RANKED`, `BEVI_DUPLICATE_BEV`, `BEVI_HANDLE_TAKEN`, `BEVI_STALE_BUCKET` | `23505` | `conflict` (for `BEVI_STALE_BUCKET` the app refetches the bucket and restarts placement) |
| `BEVI_BAD_INDEX`, `BEVI_VALIDATION` | `22023` | `validation` |
| `BEVI_RATE_LIMITED` | `P0001` | `rate_limited` |
| `BEVI_AGE_RESTRICTED` | `42501` | `age_restricted` |

### 5.2 `submit_ranking` (seam 3)

Input shape mirrors `api.submitRanking({ bevId, bucket, insertIndex, expectedBucketSize, comparisons, note })`. `expectedBucketSize` is the bucket length the app binary-searched over; if the server's count differs (another device ranked in between), the placement is stale and the RPC refuses rather than inserting at a wrong index.

```sql
create or replace function public.submit_ranking(
  p_bev_id               uuid,
  p_bucket               smallint,                 -- 3 LOVED, 2 FINE, 1 DISLIKED
  p_insert_index         integer,                  -- 0 = best in bucket, n = append at the bottom
  p_expected_bucket_size integer,                  -- bucket length the app placed against
  p_comparisons          jsonb default '[]'::jsonb,   -- [{"winner": uuid, "loser": uuid, "tie": bool}, ...] — every comparison, not just the decisive ones
  p_note                 text default null,
  p_photo_path           text default null
) returns public.rankings
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
  v_row public.rankings;
  v_sub uuid := gen_random_uuid();
  v_cat text;
begin
  if v_uid is null then raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));      -- per-user mutex
  perform public.assert_rate('submit_ranking', 60, interval '1 hour');

  select category_id into v_cat from public.bev_cards where id = p_bev_id;   -- bev_cards applies status + age gate
  if v_cat is null then raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.rankings where user_id = v_uid and bev_id = p_bev_id) then
    raise exception 'BEVI_ALREADY_RANKED' using errcode = '23505';
  end if;

  select count(*) into v_n from public.rankings where user_id = v_uid and bucket = p_bucket;
  if v_n <> p_expected_bucket_size then
    raise exception 'BEVI_STALE_BUCKET' using errcode = '23505', detail = format('expected=%s actual=%s', p_expected_bucket_size, v_n);
  end if;
  if p_insert_index < 0 or p_insert_index > v_n then
    raise exception 'BEVI_BAD_INDEX' using errcode = '22023', detail = format('n=%s', v_n);
  end if;

  update public.rankings set position = position + 1, updated_at = now()
   where user_id = v_uid and bucket = p_bucket and position >= p_insert_index;  -- safe: unique is deferred

  insert into public.rankings (user_id, bev_id, bucket, position, score, note, photo_path)
  values (v_uid, p_bev_id, p_bucket, p_insert_index, 0, p_note, p_photo_path)
  returning * into v_row;

  insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id, tie)
  select v_uid, v_sub, (c->>'winner')::uuid, (c->>'loser')::uuid, coalesce((c->>'tie')::boolean, false)
    from jsonb_array_elements(p_comparisons) c;

  perform public.respace_bucket(v_uid, p_bucket);                        -- scores for the whole bucket
  perform public.refresh_bev_stats(array(select bev_id from public.rankings where user_id = v_uid and bucket = p_bucket));
  perform public.refresh_user_stats(v_uid, v_cat);
  perform public.touch_streak(v_uid);
  insert into public.feed_events (actor_id, kind, bev_id, ranking_id) values (v_uid, 'ranked', p_bev_id, v_row.id);
  insert into public.recommendation_jobs (user_id) values (v_uid) on conflict (user_id) do update set requested_at = now();

  select * into v_row from public.rankings where id = v_row.id;
  return v_row;
end $$;
```

Why this is race-safe: the advisory lock serialises all ranking writes for one user inside one transaction; the deferred unique constraint lets the shift happen in one statement; `bev_stats` refresh is idempotent (recomputed from `rankings`, not incremented); the whole thing is one transaction, so a failure anywhere leaves nothing half-applied. Two different users ranking the same Bev at once only contend on the `bev_stats` row, which is a plain upsert.

Helpers (bodies are placeholders until Matt's vectors land):

```sql
-- Mirrors packages/ranking scoreFromPosition(). Verified by shared/fixtures/score_from_position.vectors.json
-- Bands are equal thirds: DISLIKED (1) [0, 10/3], FINE (2) [10/3, 20/3], LOVED (3) [20/3, 10].
-- score = hi - (hi - lo) * (i + 1) / (n + 1), i = 0 is best in the bucket, rounded to 2 dp.
create or replace function public.ranking_score(p_bucket smallint, p_position integer, p_count integer)
returns numeric language sql immutable as $$
  select round(b.hi - (b.hi - b.lo) * (p_position + 1)::numeric / (p_count + 1), 2)
    from (select (p_bucket - 1) * 10.0 / 3 as lo, p_bucket * 10.0 / 3 as hi) b;
$$;

create or replace function public.respace_bucket(p_uid uuid, p_bucket smallint) returns void
language sql security definer set search_path = public as $$
  update public.rankings r
     set score = public.ranking_score(p_bucket, r.position, c.n), updated_at = now()
    from (select count(*)::int n from public.rankings where user_id = p_uid and bucket = p_bucket) c
   where r.user_id = p_uid and r.bucket = p_bucket;
$$;

create or replace function public.refresh_bev_stats(p_bev_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  insert into public.bev_stats (bev_id, rating_count, sum_score, avg_score, score_stddev, last_ranked_at, updated_at)
  select b.id, count(r.id), coalesce(sum(r.score),0), avg(r.score), stddev_pop(r.score), max(r.ranked_at), now()
    from unnest(p_bev_ids) as ids(id)
    join public.bevs b on b.id = ids.id
    left join public.rankings r on r.bev_id = b.id
   group by b.id
  on conflict (bev_id) do update
    set rating_count = excluded.rating_count, sum_score = excluded.sum_score, avg_score = excluded.avg_score,
        score_stddev = excluded.score_stddev, last_ranked_at = excluded.last_ranked_at, updated_at = now();
$$;
```

`bayes_score` is computed in the `bev_leaderboard` view through a `bayes_score(sum, n, m, c)` SQL function with its own vector file: `(c * m + sum) / (c + n)`. Agreed constants (Matt's §8): `C = 3` and `MIN_RATERS = 2`, both rows in `ranking_constants` (seeded from `shared/`, pinned by the vector test). Bevs with `rating_count < MIN_RATERS` are excluded from the ranked board and returned as a separate "New" strip. The prior `m`: on the overall board it is `global_stats.mean_score`; on a per-category board it is that category's mean when the category has at least 30 rankings (`category_stats.rating_count >= 30`), otherwise the global mean.

### 5.10 Other agreed formulas (Matt's; yours to execute)

| Formula | SQL home | Definition |
|---|---|---|
| Per-Bev / per-user stddev | `refresh_bev_stats`, `refresh_user_stats` | `stddev_pop`; one rating → 0 |
| z-score | `z_score(score, mean, stddev)` | `(score - mean) / greatest(stddev, 1.0)`; `SIGMA_FLOOR = 1.0` lives here only |
| Rank points ("rank on Bevi") | `user_leaderboard` view, snapshotted into `profiles.bevi_rank` hourly | `bevs_ranked + 3 * current_streak + 2 * bevs_created`, where a created Bev counts only once another user has ranked it. `rank()` window so ties share a rank |
| Streak day | `touch_streak` | The local date in the profile timezone. `submit_ranking` **and** `rerank_bev` call it; `remove_ranking` does not touch it, and removals never break a streak |


### 5.3 Re-rank and remove

- `rerank_bev(p_bev_id, p_bucket, p_insert_index, p_expected_bucket_size, p_comparisons, p_note)`: same signature and stale-bucket check as `submit_ranking` (the app's `rerankBev` has the same shape as `submitRanking`); `p_expected_bucket_size` is the target bucket's length *excluding* the Bev being moved. Same lock; delete the existing row's slot (shift down the old bucket), insert at the new slot (shift up the new bucket), re-space both buckets, refresh stats for both buckets' Bevs, `touch_streak` (re-ranks count), `feed_events.kind = 'reranked'`. Implement as: remove then insert inside one transaction, reusing the two primitives.
- `remove_ranking(p_bev_id)` (the app's `removeRanking(bevId)`): lock, delete, `UPDATE … position = position - 1 WHERE position > old`, re-space, refresh stats, enqueue recommendation job. No feed event, and the streak is untouched.
- Both return the user's updated bucket list so the app can reconcile without a second round trip.

### 5.4 Create Bev with dedupe

```sql
-- "Did you mean…?" before creating. Pure read; app calls it as the user types the name.
create or replace function public.find_similar_bevs(p_name text, p_brand text default null, p_category_id text default null, p_limit int default 5)
returns table (bev_id uuid, name text, brand text, flavor text, thumb_url text, similarity real)
language sql stable security definer set search_path = public as $$
  with q as (select lower(unaccent(coalesce(p_brand,'') || ' ' || p_name)) as text)
  select b.id, b.name, b.brand, b.flavor, public.public_url(b.thumb_path),
         greatest(similarity(q.text, unaccent(b.search_text)),
                  coalesce((select max(similarity(q.text, a.alias)) from public.bev_aliases a where a.bev_id = b.id), 0)) as sim
    from public.bev_cards b, q
   where (p_category_id is null or b.category_id = p_category_id)
     and (unaccent(b.search_text) % q.text
          or exists (select 1 from public.bev_aliases a where a.bev_id = b.id and a.alias % q.text))
   order by sim desc limit p_limit;
$$;
```

`create_bev(p_name, p_brand, p_flavor, p_category_id, p_price_tier, p_price_estimated, p_upc, p_raw_photo_path, p_raw_label_path)`:

1. auth + `assert_rate('create_bev', 5, '1 hour')` + `assert_rate('create_bev', 20, '1 day')`.
2. Age gate if the category is alcoholic.
3. Exact-match guard: the `bevs_natural_uq` index raises `23505` → `BEVI_DUPLICATE_BEV` with the existing id in `detail`, so the app can jump to ranking it.
4. If `p_upc` matches an existing Bev → return that Bev instead of creating (idempotent by barcode).
5. Insert with `status = 'pending_photo'` and `created_by = auth.uid()`; price tier: if `p_price_tier` is null, estimate from the category default (§7.2) and set `price_estimated = true`.
6. Enqueue photo processing: `insert into photo_jobs (bev_id, raw_path, kind)`; a `pg_net` call (or the storage webhook) wakes `process-photo` (§7.4). When the cutout lands, the function sets `photo_path`, `thumb_path`, `status = 'active'` and writes the alias.
7. Return the row. The app can start ranking immediately against the pending Bev; it only becomes searchable by others once `active`.

Set the trigram threshold with `set pg_trgm.similarity_threshold = 0.3` in the function (default 0.3 is a good start; tune with real typos).

### 5.5 Search

`search_bevs(p_query text, p_category_id text default null, p_cursor numeric default null, p_limit int default 20)`:

- Normalise: `lower(unaccent(p_query))`.
- Score = `0.6 * similarity(search_text, q) + 0.4 * (search_text like q || '%')::int + 0.2 * (rating_count > 0)::int`, plus alias hits.
- Returns `bev_cards` columns + score, ordered by score desc, `rating_count` desc. Cursor is the (score, id) pair encoded by `packages/api`.
- Separately, `lookup_bev_by_upc(p_upc)` for barcode scanning (§13).

User search (`search_users(q)`): trigram on `handle` and `display_name`, limit 20.

### 5.6 Feed, lists, leaderboards, social

| RPC / view | Shape | Notes |
|---|---|---|
| `get_feed(p_cursor bigint, p_limit int)` | rows of `feed_events` ⋈ actor profile ⋈ `bev_cards` ⋈ `rankings` (score, note, photo) | Actors = me ∪ my followees. Keyset on `id desc`. Alcohol filter via `bev_cards`. |
| `get_featured()` | current `featured_bevs` ⋈ `bev_cards` | Cache-friendly; changes rarely |
| `list_rankings(p_user_id, p_bucket, p_cursor, p_limit)` | `rankings` ⋈ `bev_cards`, ordered `bucket desc, position` | Bev'd list; the app loads one bucket fully before a placement session (binary search needs the ordered list) |
| `list_want_to_try(p_cursor, p_limit)` | own `want_to_try` ⋈ `bev_cards` ⋈ source profile | |
| `add_want_to_try(p_bev_id, p_source_ranking_id)` / `remove_want_to_try(p_bev_id)` | | Writes `feed_events('want_to_try')`, refreshes `user_stats.want_count` |
| `follow_user(p_user_id)` / `unfollow_user(p_user_id)` | | Updates both users' counts in `user_stats`; `feed_events('followed')` |
| `get_profile(p_handle)` | profile ⋈ `user_stats` ⋈ `streaks` + `is_following` + `follows_me` | |
| `get_bev(p_bev_id)` | `bev_cards` + my ranking (if any) + my prediction + friends who ranked it (profiles I follow, with their score) + `in_want_to_try` | One call for the detail page |
| `bev_leaderboard` view, `get_bev_leaderboard(p_category_id, p_period, p_limit, p_offset)` | ranked rows (`rating_count >= 2`) plus a `new_bevs` array (one-rater Bevs) | Offset paging is fine here (bounded, top 100) |
| `user_leaderboard` view, `get_user_leaderboard(p_limit)` | | |
| `get_recommendations(p_limit)` | `user_bev_predictions` where `rec_rank is not null` ⋈ `bev_cards` | Reads the cache only |
| `get_starter_candidates()` | `bev_cards where is_starter` (age-filtered, ≥ 30 rows, each with `rating_count`) | Selection is client-side: Matt's `selectStarterSet()` picks 10 (6 core + 4 seeded by `userId`) |
| `get_my_overview()` | counts, rank, streak, handle, etc. for the Profile tab | |
| `report_bev(p_bev_id, p_reason, p_duplicate_of, p_note)` | | rate-limited |
| `ping()` | `select true` | granted to `anon` for the keep-alive |

### 5.7 Golden-vector tests in CI (seam 4)

Matt exports `shared/fixtures/<formula>.vectors.json`. Proposed format, to be fixed in contract v0:

```json
{ "formula": "scoreFromPosition", "version": "2026-10-20", "sql": "ranking_score",
  "tolerance": 0.005,
  "cases": [ { "name": "loved, 1 of 1", "args": [3, 0, 1], "expected": 8.33 },
             { "name": "fine, 3 of 7",  "args": [2, 2, 7], "expected": 5.42 } ] }
```

Formulas expected: `scoreFromPosition` → `ranking_score`; `bayesAverage` → `bayes_score`; `userMeanStddev` / `categoryStats` → `refresh_user_stats` (table-level cases: input rankings → expected rows); `streakUpdate` → `touch_streak` (sequence of dates + timezone → expected current/longest); `userRank` → `user_leaderboard` (rank points + tie sharing); `zScore` → `z_score(score, mean, stddev)` (with the 1.0 floor); `predictScore`/`recommend` → the Edge Function (run as a Deno test against the bundle, not pgTAP).

Mechanism: `scripts/vectors-to-pgtap.ts` (Haiku-level) reads every `*.vectors.json` and writes `supabase/tests/generated/<formula>.test.sql`:

```sql
begin; select plan(2);
select cmp_ok(abs(public.ranking_score(3,0,1) - 8.33), '<', 0.005, 'scoreFromPosition: loved, 1 of 1');
select cmp_ok(abs(public.ranking_score(2,2,7) - 5.42), '<', 0.005, 'scoreFromPosition: fine, 3 of 7');
select * from finish(); rollback;
```

`supabase test db` runs them with the rest of your pgTAP suite. CI regenerates the SQL on every run (generated files are gitignored) so a `contract/*` PR that changes vectors fails your SQL until you update it; that's the intended coupling. Table-level cases use a `with fixture as (insert … returning *)` prelude inside the test transaction.

### 5.8 Recommendations: Edge Function + job queue (seam 5)

**Flow**

1. `submit_ranking` / `remove_ranking` upsert `recommendation_jobs(user_id)`.
2. pg_cron every minute: `select net.http_post(url := <functions-url>/recommend, headers := jsonb_build_object('Authorization','Bearer '|| (select decrypted_secret from vault.decrypted_secrets where name='cron_secret'), 'Content-Type','application/json'), body := '{"mode":"queue"}')` (pg_net is fire-and-forget; the function pulls the queue itself).
3. Nightly 03:30 UTC: same call with `{"mode":"all"}` so new Bevs and other users' rankings propagate to everyone.
4. The `recommend` function (`verify_jwt = false` in `config.toml`, checks `CRON_SECRET` itself): takes up to 10 users per invocation (2 s CPU cap), for each builds the `PredictionSnapshot`, calls `predictScore()`/`recommend()` from the `packages/ranking` bundle with an explicit seed, upserts `user_bev_predictions` (full matrix for that user: ~400 rows) with `model_version = RANKING_VERSION`, sets `rec_rank` for the top N, deletes the job. Failures increment `attempts`; after 3 the job is left for inspection.
5. On-demand: `get_bev()` returns `predicted_score` from the cache or null. The app shows "not enough data yet" for null; no synchronous compute in v1. (If Matt wants an instant prediction after onboarding, `api.refreshRecommendations()` can `functions.invoke('recommend', { body: { mode: 'me' } })` with the user's JWT and wait; keep it to one user per call.)

**Snapshot** (`_shared/snapshot.ts`, yours; the *type* `PredictionSnapshot` is Matt's in `shared/`): the target user's rankings (bev, category, score, z-score), their `user_stats`/`user_category_stats`, all active `bev_cards` with `bev_stats` and `global_stats`, and for Layer 2 the normalized scores of every user who shares ≥ 3 ranked Bevs with the target (at 20 users: just everyone). Build it with 3–4 queries via the service-role client; no per-row queries.

**How the Edge Function (Deno) imports `packages/ranking`** — verified 2026-10-09:

- Supabase CLI ≥ 2.13.3 has `supabase functions deploy --use-api`, which bundles server-side and "simplifies importing files outside the `supabase/` directory … useful for monorepo setups" (changelog 2025-02-14, discussion #33613). You map the package in the function's `deno.json`: `"imports": { "@bevi/ranking": "../../../packages/ranking/src/index.ts" }`. Caveats found: it is still labelled experimental; `supabase functions serve` (local) still runs in Docker and the changelog says the flag "only modifies deploy behavior", so local serve may not resolve the outside path; one user reported an unanswered `../../` import failure in Sep 2025; and it requires `packages/ranking` to be Deno-resolvable (relative imports with explicit extensions, no Node built-ins, no tsconfig path aliases), which is a constraint on Matt's package.
- **Approach (agreed with Matt): prebuilt bundle.** `scripts/bundle-ranking.mjs` runs esbuild on `packages/ranking/src/index.ts` → `supabase/functions/_shared/ranking.bundle.mjs` (ESM, no externals, ~tens of KB). The function imports `../_shared/ranking.bundle.mjs`. The bundle is gitignored and produced by `npm run be:bundle`, which `be:serve` and the CI deploy job run first. This works identically for local `serve`, Docker deploy and `--use-api` deploy, puts no constraints on how Matt writes `packages/ranking` beyond "zero I/O, no Node APIs" (already the rule), and the bundle carries the package's `RANKING_VERSION` export into `model_version`. Types come from `packages/ranking` directly for `deno check` via a `.d.ts` emitted by the same script (`tsc --emitDeclarationOnly` into `_shared/ranking.bundle.d.mts`).
- **Fallback if the bundle step is ever a problem:** the direct `deno.json` path import with `--use-api`, once Supabase documents it with an example (they promised one in the discussion; not there as of Oct 2025). Second fallback: publish `@bevi/ranking` to GitHub Packages and import `npm:@bevi/ranking` with a function-local `.npmrc` (private registries are supported since CLI 1.207.9). Ownership does not change in any variant: Matt owns the math, you own the function.
- Vision §8 says Layer 1 should "start as SQL views/functions". With seam 5 the prediction math runs in TypeScript inside the Edge Function instead, so one implementation (Matt's) serves the app's tests, the function and the vectors. Proposed vision change in §13.

### 5.9 Scheduled jobs (pg_cron)

| Schedule (UTC) | Job | Notes |
|---|---|---|
| `* * * * *` | `net.http_post` → `recommend` `{mode: queue}` | No-op when queue empty |
| `30 3 * * *` | `recommend` `{mode: all}` | Full refresh |
| `15 * * * *` | `reset_lapsed_streaks()` | Per-user timezone |
| `20 * * * *` | `refresh_user_ranks()` → `profiles.bevi_rank` | Rank points via `user_leaderboard` (§5.10) |
| `*/10 * * * *` | `refresh_global_stats()` | `global_stats` + `category_stats`: the Bayesian priors |
| `0 4 * * *` | `refresh_all_stats()` | Full `bev_stats` + `user_stats` recompute (safety net) |
| `0 5 * * *` | housekeeping: delete `user_actions` > 7 d, hide `pending_photo` Bevs > 24 h, delete orphaned `raw-uploads` > 7 d | |

Supabase recommends ≤ 8 concurrent jobs and ≤ 10 minutes each; we are nowhere near. Job history is in `cron.job_run_details`; the CI/ops checklist includes a weekly glance at failures.

---

## 6. `packages/api`

The only module the app imports to reach the backend. It implements `BeviApi` from `shared/`, and nothing else is exported.

### 6.1 Shape

```ts
// packages/api/src/index.ts
import type { BeviApi, AuthStorage } from '@bevi/shared';

export interface BeviApiConfig {
  url: string;                 // Supabase project URL
  publishableKey: string;      // sb_publishable_… (anon); safe in the app
  authStorage: AuthStorage;    // { getItem, setItem, removeItem } — the app passes an expo-secure-store or AsyncStorage wrapper
}
export function createBeviApi(config: BeviApiConfig): BeviApi { … }
export { ApiError } from './errors';
```

`packages/api` creates and owns the supabase-js client internally; the app never imports `@supabase/supabase-js` and never sees the client. The app only supplies the config (from `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) and a storage adapter for session persistence. Auth lives in the API surface (`getSession`, `onAuthChange`, `signInWithGoogle`, `signOut`, `deleteAccount`; `signInWithApple` arrives with task 3.0). Matt's swap line is `EXPO_PUBLIC_BEVI_API=mock|supabase` → `createMockApi()` or `createBeviApi(config)` in `app/src/api/index.ts`.

Proposed `BeviApi` surface (final list is Matt's per-screen needs in contract v0):

| Area | Methods |
|---|---|
| Session | `getSession`, `onAuthChange`, `signInWithGoogle(idToken)`, `signOut`, `deleteAccount`. `signInWithApple(idToken, nonce)` is added with task 3.0 (additive contract change) |
| Profile | `getMyProfile`, `getProfile(handle)`, `updateProfile({displayName, avatarPath})`, `setHandle`, `setBirthDate`, `searchUsers(q)`, `getMyOverview` |
| Social | `follow`, `unfollow`, `listFollowers(userId, cursor)`, `listFollowing(userId, cursor)`, `getFeed(cursor)`, `getFeatured` |
| Bevs | `searchBevs({q, categoryId, cursor})`, `lookupByUpc`, `getBev(id)`, `findSimilarBevs`, `createBev`, `uploadRawPhoto(file) → path`, `reportBev`, `listCategories` |
| Rankings | `submitRanking({bevId, bucket, insertIndex, expectedBucketSize, comparisons, note})`, `rerankBev(…)` (same shape as `submitRanking`), `removeRanking(bevId)`, `listRankings({userId, bucket, cursor})`, `getMyRankingForBev` |
| Want to try | `addWantToTry`, `removeWantToTry`, `listWantToTry(cursor)` |
| Leaderboards | `getBevLeaderboard({categoryId, period})`, `getUserLeaderboard` |
| Recs | `getRecommendations`, `getStarterCandidates` (≥ 30 age-filtered `is_starter` Bevs with `ratingCount`; the app's `selectStarterSet()` picks 10), `refreshRecommendations` (optional, Phase 2) |

### 6.2 Conventions

- **Types:** `supabase gen types typescript --local --schema public > shared/src/db.types.ts`, committed, with a CI drift check (§8.1). `packages/api` maps DB rows (snake_case) to `shared/` domain types (camelCase) in one `mappers.ts`, including `Bucket` `'LOVED' | 'FINE' | 'DISLIKED'` ↔ smallint 3/2/1; RPC row types come from the generated `Functions` section so a changed RPC signature fails `tsc`.
- **Errors:** methods throw `ApiError { code: 'unauthorized' | 'not_found' | 'conflict' | 'validation' | 'rate_limited' | 'age_restricted' | 'network' | 'unknown'; message; detail? }`. Mapping: `PostgrestError.code` `23505` → `conflict`, `42501` → `unauthorized`/`age_restricted` (by message prefix), `P0001` → `rate_limited`, `22023` → `validation`, `P0002` → `not_found`, `PGRST116` (single row missing) → `not_found`, fetch failures → `network`. Never let a raw `PostgrestError` escape. Matt's screens switch on `code`.
- **Pagination:** every list takes `{ cursor?: string; limit?: number }` and returns `{ items: T[]; nextCursor: string | null }`. Cursor = base64url JSON of the keyset tuple; opaque to the app. Default `limit` 20, max 50.
- **Storage URLs:** `packages/api` returns full public URLs for photos (`client.storage.from('bev-photos').getPublicUrl(path)`); the app never sees bucket paths. Add `?v=<updated_at epoch>` for cache busting on re-processed images.
- **Uploads:** `uploadRawPhoto(file)` uploads to `raw-uploads/<uid>/<uuid>.<ext>` with `contentType`, returns the path; `createBev` takes the path.
- **Realtime:** not in v1. If the feed needs live updates in Phase 3, expose `subscribeFeed(cb)` over `postgres_changes` on `feed_events`; free plan limits (200 connections) are irrelevant at our size.
- **Tests:** vitest against `supabase start` with two seeded test users (service-role helper to mint sessions); one test per method, plus the "mock and real agree" test: run the same fixture scenario through `app/src/api/mock.ts`'s fixtures and `packages/api` and compare shapes with the `shared/` zod schemas if Matt adds them (optional).

---

## 7. Catalog and images

### 7.1 Scope for launch

Target ≈ 380 seed Bevs. Enough that onboarding and search feel populated for 20 friends, small enough that Haiku agents can do it in a day and you can eyeball the contact sheet.

| Category | Seeds | Examples |
|---|---|---|
| `soda` | 60 | Coca-Cola Classic, Pepsi, Sprite, Dr Pepper, Mountain Dew, Fanta Orange, A&W Root Beer, Jarritos (6 flavors), Mexican Coke |
| `diet_soda` | 40 | Diet Coke, Coke Zero, Pepsi Zero, Diet Dr Pepper, Olipop (6), Poppi (6), Zevia (4) |
| `juice` | 30 | Tropicana OJ, Simply Lemonade, Minute Maid Apple, Welch's Grape, Naked Green Machine |
| `water` | 15 | Fiji, Evian, Smartwater, Liquid Death, Essentia, Arrowhead |
| `sparkling_water` | 40 | LaCroix (12), Topo Chico, Spindrift (6), Bubly (6), Waterloo (4), Perrier, San Pellegrino |
| `energy` | 40 | Red Bull (4), Monster (6), Celsius (8), Alani Nu (5), Bang, Ghost, Reign, 5-hour |
| `coffee` | 30 | Starbucks Frappuccino bottles (5), Starbucks Doubleshot, Dunkin' bottled, La Colombe Draft Latte (4), Stok cold brew, Chameleon |
| `tea` | 25 | Arizona (6), Pure Leaf (4), Snapple (4), Gold Peak, Lipton, Ito En, Yerba Mate (Guayakí 4) |
| `boba` | 15 | Generic chain items: "Classic milk tea (Kung Fu Tea)", "Brown sugar boba (Tiger Sugar)", Boba Guys |
| `sports` | 20 | Gatorade (8), Powerade (4), BodyArmor (4), Prime (4) |
| `smoothie` | 10 | Jamba (4), Naked, Odwalla-style, Bolthouse |
| `beer` | 20 | Modelo, Corona, Coors Light, Bud Light, White Claw (4), Truly (2), Guinness, Blue Moon, local IPAs ×2 |
| `wine` | 8 | Generic by style: "House red (Cabernet)", "Prosecco", … plus 2–3 named |
| `spirits_cocktails` | 12 | Margarita, Old Fashioned, Espresso Martini, Tito's soda, Jack & Coke, … |
| `other` | 15 | Horchata, agua fresca (jamaica, tamarindo), Yakult, Calpico, Ramune, kombucha (GT's 4), Vita Coco |

Mark at least 30 as `is_starter` (the Coke/Diet Coke/Sprite/LaCroix/Red Bull tier of fame), none alcoholic, so `getStarterCandidates()` always returns ≥ 30 even for minors; Matt's `selectStarterSet()` picks 10 of them client-side.

### 7.2 Source format and rules

`data/catalog/bevs.csv` (UTF-8, header row):

```
slug,name,brand,flavor,category,price_tier,price_estimated,upc,is_starter,aliases,image_source_url,image_license,image_attribution,notes
coca-cola-classic,Coca-Cola Classic,Coca-Cola,Original,soda,1,false,049000006346,true,"coke|coca cola",https://…,CC-BY-SA-3.0,"Open Food Facts contributors",
```

- `slug` is the stable key for images and for re-running the pipeline; it is not exposed in the app.
- Price tier rules (typical US retail per single serving, 2026): `$` ≤ $2.50; `$$` $2.50–6; `$$$` $6–15; `$$$$` > $15. Alcohol by typical per-drink price out. Category defaults when unknown (used by `create_bev` estimation too): soda/diet/water/sparkling/sports/juice/tea → `$`; energy/coffee/smoothie/boba/other → `$$`; beer → `$$`; wine/cocktails → `$$$`. Anything estimated gets `price_estimated = true`.
- `aliases` pipe-separated, lowercase, no brand duplication needed (the pipeline also generates `brand + name` and `name` alone).
- `scripts/catalog/validate.ts` fails on: unknown category, missing name, duplicate natural key, tier outside 1–4, missing `image_source_url` for an active seed, missing license.
- `scripts/catalog/build-seed.ts` writes `supabase/seed/catalog.sql` (deterministic UUIDs from `uuid_generate_v5(namespace, slug)` so re-seeding is idempotent) and `shared/fixtures/bevs.sample.json` (at least 60 Bevs covering every category, with real dev-bucket image URLs, for Matt's mock; due Oct 16). Matt generates the companion `users`, `rankings`, `follows` and `featured` fixtures with `packages/ranking`.

### 7.3 Image sourcing stance

Honest position: manufacturer packshots are copyrighted; using them as catalog icons in a reviews app is widespread and very likely tolerated (and arguably nominative use), but it is not risk-free, and nothing about a 20-friend app justifies a lawyer. So:

1. **Primary: Open Food Facts.** Product database with barcodes and user-contributed photos; the database is ODbL and the photos are CC BY-SA 3.0. Coverage of US beverages is good for packaged drinks. Photos are not clean cutouts, so they go through the same background-removal pipeline as user uploads. Obligations: attribution (an "Image credits" line in Settings → About listing Open Food Facts, and the per-image `image_attribution` kept in the CSV) and share-alike on the derived cutouts, which is fine for us. Bonus: we get the UPC for free, which powers barcode lookup.
2. **Secondary: manufacturer press/media kits** (Coca-Cola, PepsiCo, Red Bull, Celsius all have them) where the terms allow editorial/non-commercial use; record the URL and terms in the CSV. These are already clean.
3. **Wikimedia Commons** for the odd thing (CC licenses vary; record each).
4. **Our own photos** for shop drinks (boba, horchata, cocktails) where nothing exists: shoot on a plain background with a phone, run through the pipeline. Haiku can't do this; it's a weekend errand. Fewer than 40 Bevs need it.
5. **Generated imagery** only for `featured_bevs` hero art (vision §2), never as a Bev's identifying icon: generated "Coke cans" reproduce trademarks and look uncanny next to real packshots.

Every seed image keeps `image_source_url`, `image_license`, `image_attribution`, so any one can be swapped on request. Never scrape Google Images; never use Amazon listing photos.

**Style standard (Matt reviews the contact sheet against the Beli screenshots and UI spec in `bevi-ui-inspiration/`, where Matt's reference material now lives):** transparent background; subject fills ~85% of the height; square canvas 1024×1024 with the product centered and bottom-aligned; no shadows; WebP with alpha (PNG fallback only if an edge halo is visible). Thumbs 256×256 same framing.

### 7.4 Background-removal pipeline (user uploads and seeds)

Expected volume: 380 seeds once, then ~5 new Bevs per user per month → ~100/month. At that scale per-image cost barely matters; minimum plan fees and engineering time do.

| Option | Cost at our scale | Quality on cans/bottles | Effort | Verdict |
|---|---|---|---|---|
| **Replicate** hosted open models (`851-labs/background-remover`, BiRefNet, rembg variants) | ~$0.001–0.005/run → < $1/month; pay-as-you-go, no minimum | Good on product shots; occasional halos on glass/clear liquids | HTTP call from the Edge Function; 2–10 s with cold starts | **Use this.** |
| Photoroom Remove Background API | $0.02/image, but sold as a $20/month bucket of 1,000 (no rollover); 1,000 free sandbox images are watermarked, ~10 free production calls | Excellent, product-photo tuned | Trivial | Good upgrade if Replicate quality disappoints; the $20 floor is the only objection |
| remove.bg | ~$0.20–0.40/image pay-as-you-go; 50 free low-res preview calls/month (unverified) | Excellent | Trivial | Too expensive per image for no benefit over Photoroom |
| Self-hosted `rembg` (Python, U²-Net/ISNet) on a small VM | ~$5–7/month VM, or $0 on a laptop for the one-off seed run | Same models as Replicate | Ops burden; needs a worker and queue | Use the laptop variant **only** for the one-time seed batch if you want to avoid any API spend; not for production uploads |
| On-device: iOS 17+ Vision `VNGenerateForegroundInstanceMaskRequest`; Android ML Kit Subject Segmentation (beta) | $0, instant, private | Very good on iOS; Android beta and spottier | Needs a custom Expo module (that's `app/`, so Matt's lane); simulator can't run it | Phase 3 polish. Your pipeline must accept an already-cut PNG (`createBev({ cutoutPath })` skips removal). |
| `@imgly/background-removal` (ONNX in browser/Node) | $0 | Good | Node package in a Deno Edge Function with a 2 s CPU limit and 256 MB is unlikely to work; not verified | Skip |

**Edge Function `process-photo`:**

1. Triggered by `pg_net` from `create_bev` (or the storage `objects` insert webhook) with `{ bev_id, raw_path, kind: 'photo' | 'label' | 'avatar' }`.
2. Download the raw object with the service-role client (max 10 MB; reject otherwise).
3. `photo`: POST to Replicate (model pinned by version hash in a function secret), poll until done (set `Prefer: wait` where supported), fetch the PNG.
4. Resize/crop to the style standard and encode WebP full (1024) + thumb (256). Supabase's docs show image manipulation in Edge Functions with `npm:@imagemagick/magick-wasm`; that's the first thing to try. Keep one image per invocation to stay under the 2 s CPU budget; measure, and if WASM encoding blows the budget, do the resize on Replicate too (several models accept size params) and only pass bytes through.
5. `label`: resize to max 1600 px, JPEG q80, no cutout. `avatar`: 512 px square WebP.
6. Upload to the public bucket, update `bevs` (`photo_path`, `thumb_path`, `status = 'active'`, alias row) or `profiles.avatar_path`, delete the raw object (or keep 7 days for re-processing; cron cleans up).
7. On failure after 3 attempts: leave `pending_photo`, write to `photo_jobs.error`; the housekeeping cron hides stale pending Bevs; the user sees "photo processing failed, try another".

Seed images use the same code path through `scripts/catalog/cutout.ts` (Node, calling Replicate directly), so seeds and user uploads look identical.

### 7.5 Storage buckets

| Bucket | Public | Who writes | Path | Limits |
|---|---|---|---|---|
| `raw-uploads` | no | authenticated, `insert` own prefix `<uid>/…`, `select` own; service role reads | `<uid>/<uuid>.<ext>` | 10 MB, `image/jpeg,png,heic,webp` |
| `bev-photos` | yes (CDN) | service role only | `<bev_id>/full.webp`, `<bev_id>/thumb.webp`, `user/<ranking_id>.webp` | `Cache-Control: public, max-age=31536000, immutable` (cache-bust with `?v=`) |
| `nutrition-labels` | yes | service role only | `<bev_id>.jpg` | |
| `avatars` | yes | service role (processed) | `<uid>.webp` | |
| `featured` | yes | admin via scripts | `<featured_id>.webp` | |

Bucket config and policies live in a migration (`insert into storage.buckets …` + `create policy … on storage.objects`), so local and hosted match. Because image transformations are Pro-only, every size we serve is pre-rendered; there are exactly two Bev sizes and one avatar size.

### 7.6 Moderation of user-added Bevs and photos

Friends-only, so optimistic: user-created Bevs go live as soon as the photo is processed. Guardrails:

- Dedupe at creation (`find_similar_bevs`, natural-key unique index, UPC match).
- `report_bev` with reasons; `moderation_queue` view for admins (open reports, Bevs created in the last 7 days with their photos, Bevs with `rating_count = 1` after 30 days).
- Admin RPCs (`is_admin()` only): `merge_bevs(dup, canonical)` (re-point rankings, want_to_try, comparisons, events; if a user ranked both keep the canonical and remove the dup ranking, re-space, refresh stats; add alias; set `status='merged'`), `hide_bev(id, reason)`, `set_bev_photo(id, path)`, `edit_bev(id, fields)`.
- Photo content: at 20 friends, eyeball the weekly moderation view. If this ever opens up, add a nudity/safety classifier on Replicate in `process-photo` before publishing; not now.
- Expect the integrator agent to flag any PR that adds a write path bypassing these RPCs.

---

## 8. Ops

### 8.1 CI (`.github/workflows/backend.yml`, added via a `chore/*` PR alongside Matt's app workflow)

Trigger: PRs and `main` pushes touching `supabase/**`, `packages/api/**`, `shared/**`, `data/catalog/**`, `scripts/**`.

```yaml
jobs:
  db:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4 { with: { node-version: 22, cache: npm } }
      - uses: supabase/setup-cli@v1 { with: { version: latest } }   # pin once a version is known-good
      - run: npm ci
      - run: supabase start -x studio,imgproxy,inbucket,logflare,vector
      - run: supabase db lint --level warning
      - run: npm run vectors:gen            # shared/fixtures/*.vectors.json → supabase/tests/generated/*.test.sql
      - run: supabase test db               # pgTAP: schema, RLS-on-every-table, policies, RPC behaviour, vectors
      - run: supabase gen types typescript --local --schema public > shared/src/db.types.ts
      - run: git diff --ignore-space-at-eol --exit-code -- shared/src/db.types.ts   # type drift check (Supabase's documented pattern)
      - run: npm run be:bundle && cd supabase/functions && deno check **/index.ts && deno test _shared
      - run: npm test -w packages/api       # vitest against the local stack
      - run: npm run catalog:validate
  deploy-dev:   # on push to main
    environment: dev
    steps: [setup-cli, supabase link --project-ref $PROJECT_ID, supabase db push, npm run be:bundle, supabase functions deploy --use-api, supabase config push (if it covers auth settings you need)]
  deploy-prod:  # workflow_dispatch, environment prod with required reviewer (Matt or you)
```

pgTAP tests to write first (Haiku-level, mechanical):

- Every table in `public` has `rowsecurity = true` and at least one policy. (`select is_empty($$select tablename from pg_tables where schemaname='public' and not rowsecurity$$)`)
- No `authenticated` INSERT/UPDATE/DELETE policy exists on `bevs`, `rankings`, `comparisons`, `feed_events`, `bev_stats`.
- A minor cannot select an alcoholic Bev; an adult can.
- `submit_ranking` insert-at-0 shifts and re-spaces; two sequential submits produce the expected positions; `BEVI_ALREADY_RANKED` on repeat; `BEVI_BAD_INDEX` on `n+1`.
- `remove_ranking` closes the gap.
- `delete_my_account` removes everything and refreshes stats.
- Vectors (generated).

Integrator agent (`.claude/agents/integrator.md`, `chore/*` PR with Matt): same shape as Bev Maps with Bevi's checks: `packages/api` matches `BeviApi` exactly; mock and real return the same shapes; `shared/` changes are in their own `contract/*` PR and vectors are regenerated; new tables have RLS and no direct write policies; no secrets; migrations are append-only; cross-PR conflicts with Matt's open `ui/*`/`rank/*` PRs; `npm ci && npm run typecheck && npm test` pass.

### 8.2 Observability

- Free plan keeps logs 1 day. For anything you want to see later: Edge Functions log a single JSON line per invocation (`{fn, user_id, ms, ok, err}`) and the `recommend`/`process-photo` functions write outcome rows (`photo_jobs.error`, `recommendation_jobs.attempts`) so failures are in the DB, not the logs.
- Sentry's Deno SDK in the two Edge Functions is cheap (free tier) and worth it from Phase 2; optional in Phase 1.
- Weekly 5-minute check: `cron.job_run_details` failures, `recommendation_jobs` with `attempts >= 3`, `photo_jobs` errors, `bev_reports` open, dashboard → Reports for egress.
- Dashboard Advisors (Security / Performance) after every schema change: they catch missing RLS and missing FK indexes.

### 8.3 Backups

- Nightly GitHub Actions job: `supabase db dump --linked -f dump.sql` (schema + data; use `--data-only` into a second file so restores are simple), gzip, upload as a workflow artifact (90-day retention) and, for prod, also to a private `bevi-backups` repo or a Google Drive folder via rclone. Encrypt with `age` using a key in GitHub secrets if it goes anywhere but artifacts.
- Storage: seed images are reproducible from `data/catalog/`; user uploads are small. Monthly `supabase storage cp -r ss:///bev-photos ./backup/` (the storage CLI is marked experimental; if it misbehaves, a 20-line script over `storage.list/download` with the service key does the same).
- Restore drill once, in Phase 1, into a fresh local stack: `supabase db reset` then `psql < dump.sql`. Write the two commands into `supabase/README.md`.

### 8.4 Seeding local/dev

- `seed.sql`: categories, `ranking_constants`, catalog (`\i seed/catalog.sql` is not supported by the seeder; concatenate via `sql_paths = ["./seed.sql", "./seed/catalog.sql", "./seed/dev_users.sql"]` in `config.toml`).
- `seed/dev_users.sql` (local only; excluded from the prod `sql_paths`): generated by `scripts/fixtures-to-seed.ts` from Matt's `shared/fixtures/{users,rankings,follows,featured}.json` so the mock and the local DB contain the same world. Add one extra local user `minor_test` with a 2008 birth date for age-gate tests. This is also what `packages/api` tests and Matt's e2e runs use.
- Dev project: run `scripts/catalog/upload-images.ts` + `supabase db push` + `psql $DEV_URL -f supabase/seed/catalog.sql` once; thereafter catalog changes are new migration-like SQL files in `supabase/seed/` applied by the same script. Prod: same, with the prod URL, by hand, once.

---

## 9. Working with Matt

### 9.1 Ownership (verbatim from the brief)

| Path | Owner | What lives there |
|---|---|---|
| `app/` | Matt | Expo RN app: navigation (5 tabs), screens, components, design system/tokens, logo usage, camera/image-picker UI, client state, the dev-only mock API |
| `packages/ranking/` | Matt | Pure TypeScript, zero I/O: pairwise placement state machine (gut-check bucket → binary search), score-from-position, normalization (per-user z-scores, per-category stats definitions), Bayesian leaderboard average, predicted score + recommendations (Layer 1, Layer 2, blend, exploration), onboarding starter-set selection, "rank on Bevi" formula. Unit-tested. |
| `design/` | Matt | Beli reference screenshots, brand, logo, per-screen specs |
| `supabase/` | Arjun | Migrations, RLS policies, SQL functions/RPCs, triggers, views, Edge Functions, cron/scheduled jobs, storage buckets + policies, auth config, `seed.sql` |
| `packages/api/` | Arjun | Typed data-access client wrapping supabase-js that implements the `BeviApi` interface. The ONLY thing the app imports to talk to the backend. |
| `data/catalog/` | Arjun | Seed Bev catalog (names, flavors, categories, price tiers), image sourcing + background-removal pipeline. Matt reviews image style. |
| `shared/` | Both, via `contract/*` PRs | Domain types, enums (buckets, categories, price tiers), the `BeviApi` interface, generated Supabase DB types, fixtures, golden test vectors |
| Root, `CLAUDE.md`, `vision.md`, `.github/`, `.claude/` | Both, via `chore/*` PRs | Workspace config, CI, agent definitions |

Branches: Matt uses `ui/*` (app) and `rank/*` (ranking package); Arjun uses `be/*`; shared uses `contract/*` and `chore/*`. Never push to `main`; PR + CI + integrator review. Contract changes are their own PR, approved by the other owner.

### 9.2 The seams

**Seam 1 — App ↔ backend.** The app imports only `shared/` types and the `BeviApi` interface. `packages/api` implements it on Supabase. Matt builds every screen first against a mock (`app/src/api/mock.ts`, implements `BeviApi`, backed by `shared/fixtures`), so UI work is never blocked on the backend. TypeScript keeps the mock and the real client honest. Swapping mock→real is a one-line change.

- You provide: `packages/api` implementing every `BeviApi` method (including auth; the app never imports supabase-js), `shared/src/db.types.ts` (generated), `shared/fixtures/bevs.sample.json` (≥ 60 Bevs across every category with real dev-bucket image URLs; Matt generates the users/rankings/follows/featured fixtures from it with `packages/ranking`), and `ApiError` codes documented in `shared/`.
- You need: nothing to start; the method list from contract v0 to finish.
- By when: fixtures + types with contract v0 (end of week 1); `packages/api` methods land feature by feature in Phase 1, each PR naming the `BeviApi` methods it completes.

**Seam 2 — Contract v0 is the first joint milestone.** Matt lists the data each screen needs; you turn that into the schema + `BeviApi` methods; both approve one `contract/v0` PR. Nothing else merges into `shared/` before it.

- You provide: §3 schema as migrations on a `be/schema-v0` branch (so the generated types are real), the `BeviApi` method list (§6.1), the vector JSON format (§5.7), enums (`Bucket`, `CategoryId`, `PriceTier`, `FeedEventKind`, `BevStatus`), `ApiError` codes.
- You need: Matt's per-screen data list (Feed, Lists ×3, Add/Search/Create, Bev detail, Leaderboard ×2, Profile, Onboarding, Settings) (auth is decided: Google only). Already agreed: `Bucket = 'LOVED' | 'FINE' | 'DISLIKED'`, `RankingComparison = { winnerBevId, loserBevId, tie }`, the `submitRanking` argument shape with `expectedBucketSize`.
- By when: Matt's list by Tue Oct 13; your draft PR by Wed Oct 14; merged by Fri Oct 16.

**Seam 3 — Ranking write path.** The interactive comparison flow runs in the app using `packages/ranking` (pure state machine). On finish the app calls `api.submitRanking({ bevId, bucket, insertIndex, comparisons, note })`. Your RPC applies it atomically (insert at position, shift others, store raw comparisons, update aggregates). Re-ranking/removing a Bev is the same shape.

- You provide: `submit_ranking`, `rerank_bev`, `remove_ranking` (§5.2–5.3), `listRankings({bucket})` returning the ordered bucket the state machine binary-searches over, the stale-bucket guard (`expectedBucketSize` → `BEVI_STALE_BUCKET` → `conflict`), and the guarantee that `insertIndex` is interpreted as "0 = best, n = append at the bottom, within that bucket".
- Agreed: `insertIndex` 0 = best; `rerankBev` has the same shape as `submitRanking` plus `expectedBucketSize`; `removeRanking(bevId)`; comparison elements are `{ winnerBevId, loserBevId, tie }` and the app sends every comparison (you store all).
- By when: RPC with placeholder scoring in Phase 0 week 2 (Oct 19–23); final once score vectors land.

**Seam 4 — Formulas are Matt's; storage and execution are yours.** Wherever math must run in SQL (score-from-position for aggregates, per-Bev avg/stddev, per-user per-category mean/stddev, Bayesian leaderboard average, streaks, user rank), Matt specifies it in `packages/ranking` and exports golden test vectors to `shared/fixtures/*.vectors.json`; your SQL must pass the same vectors in CI. Changing a formula = `contract/*` PR that regenerates the vectors.

- You provide: `ranking_score`, `bayes_score`, `z_score`, `refresh_user_stats`, `touch_streak`, `user_leaderboard` implementations; the generator `scripts/vectors-to-pgtap.ts`; CI wiring.
- You need: vector files for each formula, with the format in §5.7. The formulas themselves are already agreed (§5.2, §5.10): population stddev, equal-third bands, `C = 3`, `MIN_RATERS = 2`, rank points, profile-timezone streaks.
- By when: score, stats and Bayesian vectors by Oct 23 (Matt's commitment; ahead of your Oct 30 need); streak and user-rank vectors at the start of Phase 2 (Nov 23); prediction vectors when the snapshot freezes (Nov 23).

**Seam 5 — Recommendations.** `packages/ranking` exports pure `predictScore()` / `recommend()` taking an explicit input snapshot type (defined by Matt). Your Edge Function (or scheduled job) assembles that snapshot from the DB, calls Matt's functions, and serves/caches results through `BeviApi`.

- You provide: `recommend` Edge Function, the job queue and cron, `user_bev_predictions` cache, `getRecommendations`/`getBev.predictedScore`, the bundling step (§5.8) and its constraints on `packages/ranking` (ESM, no Node/DOM APIs, no I/O, a `RANKING_VERSION` export).
- You need: the `PredictionSnapshot` type, the `predictScore(snapshot, bevId)` / `recommend(snapshot, { limit, seed })` signatures and the `reason` payload shape, and the `RANKING_VERSION` export. The exploration seed is passed in by you (derive it from `user_id` + date so a day's list is stable and tests are reproducible).
- By when: snapshot type by the start of Phase 2 (Nov 23); function live with Layer 1 by end of Phase 2 week 2 (Dec 4).

### 9.3 Dependency / handoff table

| Who waits | On what | From | Needed by | Until then |
|---|---|---|---|---|
| Matt | `shared/fixtures/bevs.sample.json` (≥ 60 Bevs, every category, real dev-bucket image URLs) | Arjun | Oct 16 | Mock uses placeholder images |
| Matt | `db.types.ts` + `BeviApi` method list in `contract/v0` | Arjun | Oct 16 | Mock typed against hand-written interface |
| Matt | `packages/api` auth + profile + bevs + rankings methods | Arjun | Oct 30 | Mock API |
| Matt | Search, lists, leaderboard, want-to-try methods | Arjun | Nov 6 | Mock API |
| Matt | Feed, follows, featured | Arjun | Nov 20 | Mock API |
| Matt | Recommendations/predicted score served from cache | Arjun | Dec 4 | Mock returns fixture predictions |
| Matt | Catalog image contact sheet to review against `bevi-ui-inspiration/` | Arjun | Oct 23 | — |
| Arjun | Per-screen data needs | Matt | Oct 13 | Draft schema from vision.md (this doc) |
| Arjun | Per-screen additions to the `BeviApi` surface | Matt | Oct 16 | Build from §6.1 |
| Arjun | `scoreFromPosition`, stats (`stddev_pop`, z-score) and `bayesAverage` vectors | Matt | Oct 23 | Agreed formulas implemented from §5.2/§5.10, unverified by CI |
| Arjun | Streak and user-rank vectors | Matt | Nov 23 | Agreed formulas implemented, unverified by CI |
| Arjun | `PredictionSnapshot` type + `predictScore`/`recommend`/`RANKING_VERSION` exports and prediction vectors | Matt | Nov 23 | Function scaffolded, returns category-average placeholder |
| Arjun | Image style sign-off | Matt | Oct 28 | Keep pipeline parameters adjustable (padding, canvas) |
| Arjun | Google OAuth client IDs; Matt supplies bundle ids and Android SHA-1s | Matt | Oct 14 | Decided 2026-10-09: v1 sign-in is Google only (Apple before App Store / external TestFlight, task 3.0) |
| Both | `CLAUDE.md`, `.claude/agents/integrator.md`, CI workflows | chore PRs | Oct 16 | — |

---

## 10. Plan by phase

Tags: model/effort for the Claude Code sub-agent per vision §10. "DoD" = definition of done.

### Phase 0 — Setup (Oct 12–23)

| # | Task | DoD | Agent |
|---|---|---|---|
| 0.1 | Create `bevi-dev` and `bevi-prod` Supabase projects (same org, same region, US West); record refs; enable `pg_cron`, `pg_net`, `pg_trgm`, `unaccent`; note Postgres major version into `config.toml` | Both projects exist; `supabase link` works for dev; extensions page screenshot in PR | Human (you), 30 min |
| 0.2 | `supabase init`; `config.toml` with auth settings, seed paths, functions entries; `supabase start` runs clean | `npx supabase start` green on your Mac; README with the commands | Haiku, low |
| 0.3 | Migration set for §3 (`0001_extensions`, `0002_categories_profiles`, `0003_bevs`, `0004_rankings`, `0005_social`, `0006_stats`, `0007_recs_moderation`, `0008_storage`, `0009_rls`, `0010_rpcs`) | `db reset` green; every table RLS-on; pgTAP RLS test passes | Opus, high (schema review once) then Sonnet, medium (write migrations) |
| 0.4 | `contract/v0` PR: enums, domain types, `BeviApi` interface, vector format, `db.types.ts`, `bevs.sample.json`, `ApiError` codes | Matt approves; merged | Sonnet, medium; you + Matt review |
| 0.5 | Catalog CSV (380 rows) + aliases + price tiers | `catalog:validate` green; Matt skims names | Haiku, low — batches of 25 rows per agent with the category list and price rules only |
| 0.6 | Image sourcing: fill `image_source_url`/license per row (Open Food Facts first, press kits second), download to `raw/` | ≥ 90% of rows have a source; the rest listed for own photos | Haiku, low, in batches; Sonnet, medium for the OFF API fetcher |
| 0.7 | Cutout pipeline (`scripts/catalog/cutout.ts` → Replicate) + contact sheet | 380 WebPs + thumbs; `contact-sheet.html`; Matt signs off style | Sonnet, medium |
| 0.8 | `build-seed.ts`, `upload-images.ts`; seed local and dev | Local `db reset` shows 380 Bevs with images; dev bucket populated | Sonnet, medium |
| 0.9 | CI `backend.yml` + integrator agent adapted from Bev Maps (chore PR with Matt) | PR checks run; integrator comments on a test PR | Sonnet, medium |
| 0.10 | Nightly dump workflow + keep-alive ping workflow | Artifact appears; `ping()` 200 from both projects | Haiku, low |
| 0.11 | Auth: Google provider config (iOS/Android/Web client IDs, authorized client IDs), email + anonymous sign-in disabled, rate limits, `handle_new_user` trigger reading Google name + avatar | Google sign-in from Matt's dev build creates a profile with name and avatar | Sonnet, medium + you in the dashboards |

### Phase 1 — MVP backend (Oct 26 – Nov 20)

| # | Task | DoD | Agent |
|---|---|---|---|
| 1.1 | `packages/api` skeleton: client factory, `ApiError`, paging, mappers, vitest harness with seeded users | `npm test -w packages/api` green against local stack | Sonnet, medium |
| 1.2 | Auth + profile methods; `set_handle`, `set_birth_date`, `delete_my_account` RPCs | pgTAP + vitest; deletion removes all rows and storage objects | Sonnet, medium |
| 1.3 | `submit_ranking` / `rerank_bev` / `remove_ranking` with advisory lock, deferred unique, stale-bucket check, `tie` comparisons, agreed scoring formula | pgTAP: shift, re-space, `BEVI_STALE_BUCKET`, `BEVI_BAD_INDEX`, concurrency test (two sessions) | Opus, high for the function design review; Sonnet, medium to implement |
| 1.4 | Vector generator + first vector files wired (`scoreFromPosition`, stats/z-score, `bayesAverage`; Matt delivers them Oct 23) | CI fails when vectors change and SQL doesn't | Haiku, low–medium |
| 1.5 | `find_similar_bevs`, `search_bevs`, `lookup_bev_by_upc`, `create_bev` with rate limits | Typo tests ("diet cke", "lacroix pample") hit; dup creation returns `conflict` with id | Sonnet, medium |
| 1.6 | `process-photo` Edge Function + `raw-uploads` policies + `photo_jobs` | Upload from the app → active Bev with cutout in < 30 s | Sonnet, medium–high |
| 1.7 | Lists, want-to-try, `get_bev`, Bev leaderboard view + RPC, `global_stats` cron | vitest for each method; leaderboard excludes alcohol for minors | Sonnet, medium |
| 1.8 | Starter candidates + `is_starter` seeds | `getStarterCandidates` returns ≥ 30 | Haiku, low |
| 1.9 | Code review / bug hunt before Phase 1 ships | Review notes addressed | Sonnet, high |
| 1.10 | Restore drill + ops README | Documented, done once | Haiku, low |

### Phase 2 — Social + recommendations backend (Nov 23 – Dec 18)

| # | Task | DoD | Agent |
|---|---|---|---|
| 2.1 | Follows, `feed_events`, `get_feed`, `featured_bevs` + `get_featured`; counts in `user_stats` | Feed shows followees only; keyset paging stable under inserts | Sonnet, medium |
| 2.2 | `refresh_user_stats`, `user_category_stats`, `z_score` with Matt's vectors | Vectors pass | Sonnet, medium |
| 2.3 | Streaks (`touch_streak`, hourly reset) and user rank cron with vectors | Vectors pass; timezone edge cases tested (23:59 PT) | Sonnet, medium |
| 2.4 | `recommend` Edge Function: bundle step, snapshot builder, queue + cron, cache table, `getRecommendations`, `predictedScore` in `get_bev` | For seeded users, Recommended list populates within 1 minute of ranking; CPU < 2 s per invocation (log it) | Opus, high for snapshot/CPU-budget design; Sonnet, medium to implement |
| 2.5 | Moderation: `report_bev`, `moderation_queue`, admin RPCs (`merge_bevs`, `hide_bev`) | Merge test with a user who ranked both | Sonnet, medium |
| 2.6 | Sentry in Edge Functions; weekly ops checklist | Errors visible | Haiku, low |
| 2.7 | Code review / bug hunt before Phase 2 ships | | Sonnet, high |

### Phase 3 — Smarter and bigger (2027 Q1)

| # | Task | DoD | Agent |
|---|---|---|---|
| 3.0 | **Pre-distribution gate: add Sign in with Apple before App Store submission / external TestFlight** (App Store 4.8, because v1 ships Google). Native flow: `expo-apple-authentication` → `signInWithApple(idToken, nonce)` in `packages/api` → `signInWithIdToken({ provider: 'apple' })`. Dashboard → Auth → Apple → Client IDs lists every bundle id (`com.bevi.app`, `com.bevi.app.dev`); native-only needs no Services ID and no 6-monthly secret rotation (add the web OAuth config only if Android ever needs Apple). Apple sends `fullName` only on the first sign-in, so the app calls `updateUser` with it then (Matt's side). Also ship the `delete-account` Edge Function: take the Apple `authorizationCode` from a fresh sign-in, exchange it at `appleid.apple.com/auth/token`, call `/auth/revoke`, then call `delete_my_account()`. Whether beta review enforces revocation I can't confirm; do it anyway. Additive `contract/*` PR for the new method. | Apple sign-in creates a profile; deletion revokes the Apple token (200 in a test); App Review checklist item ticked | Sonnet, medium + you in the Apple developer console |
| 3.1 | Layer 2 inputs in the snapshot (similar-user matrix), blend/exploration seeds; batch sizing for growth | Vectors/goldens for `recommend` outputs on fixture data pass | Sonnet, medium (Opus review of the snapshot cost) |
| 3.2 | Per-category leaderboards, `bev_leaderboard_30d` "hottest this month" | | Sonnet, medium |
| 3.3 | Accept on-device cutouts (`createBev({cutoutPath})`), skip Replicate when present | | Sonnet, medium |
| 3.4 | Performance pass: `explain analyze` on feed/search/leaderboard; materialize if needed; egress review | p95 < 150 ms for feed/search locally | Sonnet, medium |
| 3.5 | Decide on Pro for prod (pausing, backups) | Written decision | Human |
| 3.6 | Realtime feed subscription if Matt wants it; analytics events table | | Sonnet, medium |

---

## 11. First week checklist (Oct 12–16)

1. [ ] Create `bevi-dev` + `bevi-prod`; enable extensions; write refs into a private note and GitHub Environments. Confirm `SHOW server_version` and set `major_version` in `config.toml`.
2. [ ] `supabase init` + `supabase start` locally; commit `config.toml` on `be/init`.
3. [ ] Read Matt's per-screen data list (Tue). Diff it against §3; add columns/methods.
4. [ ] Write migrations `0001`–`0010` from §3–§5 with placeholder formulas (Opus reviews the schema once; Sonnet writes).
5. [ ] pgTAP: RLS-on-every-table test, no-direct-write-policy test, age-gate test. `supabase test db` green.
6. [ ] `supabase gen types` → `shared/src/db.types.ts`; write `BeviApi` interface, enums, `ApiError` codes, vector JSON format; open `contract/v0` (Wed), iterate with Matt, merge (Fri).
7. [ ] Kick off Haiku catalog batches (0.5, 0.6) in parallel worktrees, one category each; `catalog:validate` must pass per batch.
8. [ ] Replicate account + token; run `cutout.ts` on 20 images; generate the contact sheet; send to Matt.
9. [ ] Google provider config (iOS/Android/Web client IDs from Matt's bundle ids and SHA-1s); disable email and anonymous sign-in; profile trigger; confirm one real Google sign-in from Matt's dev build creates a `profiles` row with name and avatar.
10. [ ] `backend.yml` CI + nightly dump + keep-alive ping (chore PR with Matt's app CI).
11. [ ] Adapt `.claude/agents/integrator.md` and a `supabase/CLAUDE.md` pointing agents at this doc's §3–§5 and the "RPC only" rule.

---

## 12. Deliberately not doing

Divergences from the founding conversation, kept brief:

- **Users don't "add a row in the SQL".** All writes go through validated RPCs with rate limits; there are no direct insert policies on content tables.
- **"We don't need no damn privacy page."** We do: App Store 5.1.1(i) requires a privacy policy link in the app and in App Store Connect, and 5.1.1(v) requires in-app account deletion. Both are in scope (privacy page is a static URL; hosting it is a root/`chore` item for both of you).
- **No copying Beli's logo or fonts.** Matt's lane, but the catalog and featured imagery also avoid reproducing trademarks via generated art.
- **No location/IP features.** Nothing stores location; no `geo` columns, no IP logging beyond what Supabase Auth does by default.
- **No Beli-style scraping or "the open-source Beli algorithm".** Matt writes the placement math; your part is just storing positions and re-spacing.
- **No Python worker, no matrix factorization, no realtime** in v1. The Edge Function and Postgres cover Layers 1–2 at this scale.
- **No admin UI.** Moderation and featured Bevs are SQL views and admin RPCs run from Studio or scripts.
- **No email sign-in, SMTP, Resend or Turnstile in v1.** Google-only sign-in (decided 2026-10-09); Apple is added as a pre-distribution gate (task 3.0).
- **No image transformations on the fly** (Pro-only); sizes are pre-rendered.
- **No generated images for real products**; only for featured hero art.

---

## 13. Open questions and proposed vision.md changes

Proposed vision changes (needs both of you; nothing here is applied yet):

1. **§8 Layer 1 "as SQL views/functions"** → run all prediction math in `packages/ranking` inside the `recommend` Edge Function (seam 5); SQL only builds the snapshot and caches results. One implementation, one owner, one test suite.
2. **§8 `users`** → `profiles` (Supabase owns `auth.users`).
3. **§2 Bev model**: add `upc` (barcode) and a **barcode scan** as the primary "snap your drink" lookup for packaged drinks. Photo recognition of a can is unreliable and expensive; barcode scan is instant, works offline for the lookup step, and Open Food Facts gives us UPCs for most seeds. Camera UI is Matt's; `lookupByUpc` is mine.
4. **§2 Categories**: split "Alcoholic" into `beer`, `wine`, `spirits_cocktails` (all 21+). Mixed-alcohol leaderboards are meaningless.
5. **§4 Store both position and score**: note explicitly that inserting into a bucket re-spaces every score in that bucket, so global `avg_score` for many Bevs changes on each ranking. That's by design, but it means aggregates are recomputed per bucket on every submit (cheap now; nightly full refresh as a safety net). Also record the agreed definitions: `score_stddev` is the population stddev (`stddev_pop`, so one rating gives 0), and `SIGMA_FLOOR = 1.0` applies only inside z-score computation.
6. **§6 Feed**: allow an optional user photo on a ranking (the conversation's example of Jack's photo of a boba drink) alongside the canonical Bev icon. Schema has `rankings.photo_path` for it; the UI may ignore it in v1.
7. **§11 Alcohol in v1**: shipping beer/wine/cocktails means a declared-DOB gate and most likely an 18+ App Store rating. Options: (a) ship with gate + 18+ rating (friends-only, fine), (b) hide alcoholic categories behind a feature flag until Phase 3 and rate 13+. Schema supports both; I lean (a) because "arguing about the best Bev" includes beer for this group.
8. **§9 Phase 0** should name the two hosted projects and the nightly dump explicitly, given the free plan has no backups and pauses weekly.

Open questions for Matt (answers go into contract v0 or the first vector PR):

- Settled with Matt (recorded in §5.2/§5.10): `insertIndex` 0 = best; all comparisons sent, with `tie`; equal-third bands and `hi − (hi − lo)(i + 1)/(n + 1)`; `C = 3`, `MIN_RATERS = 2`, category prior at ≥ 30 rankings; profile-timezone streaks that count re-ranks; rank points `bevsRanked + 3·streak + 2·adoptedCreated` with shared ties.
- `reason` payload shape for predictions and the exact `PredictionSnapshot` fields (Nov 23).
- Does the mock need realtime-ish behaviour (e.g. feed updating after your own ranking)? If so `getFeed` after `submitRanking` already includes your own event.
- Should friends' want-to-try lists be visible? Currently private (count public).
- Streak period: daily (vision) or weekly (Beli shows "9 weeks"). Matt's `computeStreak` supports both and picks before the streak vectors land (start of Phase 2); `touch_streak` / `reset_lapsed_streaks` must follow whichever period the vectors pin.

Open questions for you to resolve during Phase 0 (facts I could not verify):

- Whether pg_cron activity alone prevents the free-plan pause (assume no; keep the ping).
- `storage.objects` owner column name on the project's storage version (`owner` vs `owner_id`).
- Whether `@imagemagick/magick-wasm` encoding of a 1024 px WebP fits in the 2 s CPU budget; measure on the first run and fall back to Replicate-side resizing.
- Whether `supabase config push` covers the auth settings we set (Google client ids, email disabled, rate limits); otherwise document the dashboard clicks in `supabase/README.md`.
- Whether external TestFlight beta review enforces 4.8 (Apple sign-in) and token revocation on deletion; task 3.0 is scheduled before external TestFlight regardless.
