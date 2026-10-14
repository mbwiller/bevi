-- A-17: flavour profiles for the catalog.
--
-- The hand-labelled signal behind the `profile` term of the Bev-graph edge
-- weight (docs/bevi-ranking-math.tex §10.1 eq. 17, `profileSimilarity` in
-- @bevi/ranking). The 378 rows themselves arrive in the next catalog seed
-- migration, generated from data/catalog/flavor-profiles.csv.
--
-- Column names are fixed by `FlavorProfile` in shared/src/types.ts (S-14) and
-- are the contract with M-24's formula. Renaming one means relabelling 378
-- rows, so do not.

set search_path = public, extensions;

create table public.bev_flavor_profiles (
  bev_id     uuid primary key references public.bevs(id) on delete cascade,

  -- Mirrors FlavorBase in shared/src/enums.ts and FLAVOR_BASES in
  -- scripts/catalog/catalog.ts. Three places, kept in step by hand -- the same
  -- arrangement check_handle already has with HANDLE_PATTERN. The catalog
  -- validator fails on any value outside this list, so the CSV cannot drift
  -- away from the constraint without CI noticing.
  base       text not null check (base in (
    'cola', 'citrus', 'lemon-lime', 'berry', 'tropical', 'apple',
    'grape', 'orange', 'ginger', 'root-beer', 'cream',
    'coffee', 'tea', 'matcha', 'chai', 'chocolate', 'nut',
    'herbal', 'mineral', 'hop', 'wine', 'agave', 'grain', 'other'
  )),

  carbonated boolean not null,

  -- 0 none, 1 low, 2 medium, 3 high. Deliberately a band rather than mg: the
  -- formula compares closeness, and a band is something a human can label
  -- consistently across 378 drinks where a milligram figure is not.
  caffeine   smallint not null check (caffeine between 0 and 3),

  -- Perceived sweetness, not sugar content, which is why a diet cola scores
  -- the same as the full-sugar one. The sugar difference is already carried by
  -- the category (`soda` vs `diet_soda`) and so by the tree term.
  sweetness  smallint not null check (sweetness between 0 and 3),

  -- Animal milk or cream only. Almond, oat and coconut are false.
  dairy      boolean not null,

  -- Must agree with the Bev's category.is_alcoholic; the catalog validator
  -- enforces that, since only it can see both sides at label time.
  alcohol    boolean not null,

  serve      text not null check (serve in ('hot', 'cold', 'either')),

  -- 'catalog' is hand-labelled; 'inferred' is copied from the nearest seeded
  -- Bev by embedding for a Bev a user created (D-11) and relabelled later.
  -- Present from the start so a user-created Bev needs no further migration.
  source     text not null default 'catalog' check (source in ('catalog', 'inferred')),

  updated_at timestamptz not null default now()
);

alter table public.bev_flavor_profiles enable row level security;

-- Catalog data, like bev_stats: readable by any signed-in user. The Bev row
-- behind it carries the age gate, so there is nothing to gate here -- a
-- profile for a Bev the viewer cannot see reveals only that some drink is
-- carbonated.
create policy bev_flavor_profiles_select on public.bev_flavor_profiles
  for select to authenticated using (true);

-- No write policy: the seed migration writes as postgres, and the sync job
-- (A-16) uses the service role.

-- The graph sync builds candidate pairs partly by base family, so that lookup
-- should not be a sequential scan once the catalog grows.
create index bev_flavor_profiles_base_idx on public.bev_flavor_profiles (base);
