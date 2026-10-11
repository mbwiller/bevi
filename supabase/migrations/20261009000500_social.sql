create table public.follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  followee_id  uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);

create table public.want_to_try (
  user_id            uuid not null references public.profiles(id) on delete cascade,
  bev_id             uuid not null references public.bevs(id) on delete cascade,
  source_user_id     uuid references public.profiles(id) on delete set null,
  source_ranking_id  uuid references public.rankings(id) on delete set null,
  created_at         timestamptz not null default now(),
  primary key (user_id, bev_id)
);
