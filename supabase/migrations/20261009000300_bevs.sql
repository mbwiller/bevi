create table public.bevs (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(name) between 1 and 80),
  brand                 text check (char_length(brand) <= 80),
  flavor                text check (char_length(flavor) <= 80),
  category_id           text not null references public.categories(id),
  photo_path            text,
  thumb_path            text,
  nutrition_label_path  text,
  price_tier            smallint not null check (price_tier between 1 and 4),
  price_estimated       boolean not null default true,
  upc                   text check (upc ~ '^[0-9]{8,14}$'),
  is_starter            boolean not null default false,
  status                text not null default 'active'
                        check (status in ('pending_photo','active','merged','hidden')),
  merged_into           uuid references public.bevs(id),
  created_by            uuid references public.profiles(id) on delete set null,
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

create table public.bev_aliases (
  alias       text not null,
  bev_id      uuid not null references public.bevs(id) on delete cascade,
  source      text not null check (source in ('seed','merge','manual')),
  created_at  timestamptz not null default now(),
  primary key (alias)
);
create index bev_aliases_trgm on public.bev_aliases using gin (alias gin_trgm_ops);

create table public.bev_stats (
  bev_id        uuid primary key references public.bevs(id) on delete cascade,
  rating_count  integer not null default 0,
  sum_score     numeric(10,3) not null default 0,
  avg_score     numeric(4,2),
  score_stddev  numeric(4,2),
  bayes_score   numeric(4,2),
  last_ranked_at timestamptz,
  updated_at    timestamptz not null default now()
);
