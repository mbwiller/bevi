create table public.categories (
  id            text primary key,
  name          text not null,
  sort_order    smallint not null,
  is_alcoholic  boolean not null default false,
  emoji         text
);

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  handle           text not null unique
                   check (handle = lower(handle) and handle ~ '^[a-z0-9_]{3,20}$'),
  display_name     text not null check (char_length(display_name) between 1 and 40),
  avatar_path      text,
  birth_date       date,
  age_attested_at  timestamptz,
  timezone         text not null default 'America/Los_Angeles',
  role             text not null default 'user' check (role in ('user','admin')),
  bevi_rank        integer,
  handle_changed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index profiles_handle_trgm on public.profiles using gin (handle extensions.gin_trgm_ops);
