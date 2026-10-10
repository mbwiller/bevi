create table public.user_stats (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  rating_count     integer not null default 0,
  mean_score       numeric(5,3),
  stddev_score     numeric(5,3),
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
  stddev_score  numeric(5,3),
  affinity_z    numeric(6,3),
  updated_at    timestamptz not null default now(),
  primary key (user_id, category_id)
);

create table public.streaks (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  current_days    integer not null default 0,
  longest_days    integer not null default 0,
  last_ranked_on  date,
  updated_at      timestamptz not null default now()
);
