create table public.rankings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  bev_id      uuid not null references public.bevs(id) on delete cascade,
  bucket      smallint not null check (bucket in (1,2,3)),
  position    integer not null check (position >= 0),
  score       numeric(4,2) not null check (score >= 0 and score <= 10),
  note        text check (char_length(note) <= 280),
  photo_path  text,
  ranked_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, bev_id),
  unique (user_id, bucket, position) deferrable initially deferred
);
create index rankings_bev_idx  on public.rankings (bev_id);
create index rankings_user_recent_idx on public.rankings (user_id, ranked_at desc);

create table public.comparisons (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  submission_id  uuid not null,
  winner_bev_id  uuid not null references public.bevs(id) on delete cascade,
  loser_bev_id   uuid not null references public.bevs(id) on delete cascade,
  created_at     timestamptz not null default now(),
  check (winner_bev_id <> loser_bev_id)
);
create index comparisons_user_idx on public.comparisons (user_id, created_at desc);
