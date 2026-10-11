create table public.featured_bevs (
  id          uuid primary key default gen_random_uuid(),
  bev_id      uuid not null references public.bevs(id) on delete cascade,
  title       text not null,
  blurb       text,
  image_path  text,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  sort_order  smallint not null default 0,
  created_by  uuid references public.profiles(id) on delete set null
);

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

create table public.user_bev_predictions (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  bev_id           uuid not null references public.bevs(id) on delete cascade,
  predicted_score  numeric(4,2) not null,
  rec_rank         integer,
  reason           jsonb,
  model_version    text not null,
  computed_at      timestamptz not null default now(),
  primary key (user_id, bev_id)
);
create index predictions_rec_idx on public.user_bev_predictions (user_id, rec_rank) where rec_rank is not null;

create table public.recommendation_jobs (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  requested_at  timestamptz not null default now(),
  attempts      smallint not null default 0
);

create table public.user_actions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  action      text not null,
  created_at  timestamptz not null default now()
);
create index user_actions_idx on public.user_actions (user_id, action, created_at desc);

create table public.global_stats (
  id             boolean primary key default true check (id),
  mean_score     numeric(5,3),
  rating_count   integer,
  updated_at     timestamptz not null default now()
);
