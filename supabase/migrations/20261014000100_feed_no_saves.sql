-- A-01: saving a Bev is not a feed event.
--
-- TASKS.md decision 1: "When you're saving a beverage, it should not be on the
-- feed." The only signal a save leaves in public is the filled bookmark on a
-- post for a Bev the viewer has saved (`get_feed.in_my_want_to_try`), which is
-- unchanged here.
--
-- 'followed' goes at the same time. TASKS.md calls it "also dead", and it is
-- dead on the *read* side -- get_feed has filtered it out since
-- 20261011000400. It was not dead on the write side: follow_user still
-- inserted it (20261011000400 line 638), so tightening the kind check without
-- touching follow_user would make every new follow fail with 23514. Both
-- change together below.
--
-- Migrations are append-only (supabase/CLAUDE.md), so the three functions are
-- `create or replace`d. All three keep their existing signature, so their
-- grants carry over and no revoke/grant block is needed -- unlike a `drop` +
-- recreate, which would silently drop execute from authenticated.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. add_want_to_try: no feed event.
-- ---------------------------------------------------------------------------
-- Body is 20261011000400's minus the feed_events insert. The want_count
-- refresh stays inside `if found` so a repeat save still costs nothing.

create or replace function public.add_want_to_try(
  p_bev_id uuid,
  p_source_ranking_id uuid default null,
  p_via_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid          uuid := auth.uid();
  v_is_alcoholic boolean;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  select c.is_alcoholic into v_is_alcoholic
    from public.bevs b
    join public.categories c on c.id = b.category_id
   where b.id = p_bev_id;

  if v_is_alcoholic is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_is_alcoholic and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  insert into public.want_to_try (user_id, bev_id, source_ranking_id, source_user_id)
  values (v_uid, p_bev_id, p_source_ranking_id, p_via_user_id)
  on conflict (user_id, bev_id) do nothing;

  if found then
    update public.user_stats
       set want_count = (select count(*) from public.want_to_try where user_id = v_uid),
           updated_at = now()
     where user_id = v_uid;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. follow_user: no feed event.
-- ---------------------------------------------------------------------------
-- Body is 20261011000400's minus the 'followed' insert. A follow is not a
-- post; the Explore surface (A-04) is where discovering people will live.

create or replace function public.follow_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'cannot follow self';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.assert_rate('follow', 100, interval '1 day');

  insert into public.follows (follower_id, followee_id)
  values (v_uid, p_user_id)
  on conflict (follower_id, followee_id) do nothing;

  update public.user_stats
     set follower_count = (select count(*) from public.follows where followee_id = p_user_id),
         updated_at = now()
   where user_id = p_user_id;
  update public.user_stats
     set following_count = (select count(*) from public.follows where follower_id = v_uid),
         updated_at = now()
   where user_id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Drop the rows the two kinds already produced, then narrow the domain.
-- ---------------------------------------------------------------------------
-- This deletes real rows in production: every save and every follow since the
-- app went live has one. They are not recoverable from elsewhere -- want_to_try
-- and follows keep their own rows, but the event timestamps go. Take a
-- `feed_events` backup before pushing this migration.

delete from public.feed_events where kind in ('want_to_try', 'followed');

-- The 20261009000700 inline check is auto-named feed_events_kind_check. The
-- replacement is named explicitly so a later migration can rely on the name.
alter table public.feed_events
  drop constraint if exists feed_events_kind_check;
alter table public.feed_events
  add constraint feed_events_kind_check check (kind in ('ranked', 'reranked'));

-- ---------------------------------------------------------------------------
-- 4. get_feed: rankings only.
-- ---------------------------------------------------------------------------
-- Identical to 20261011000400's definition apart from the `kind in (...)`
-- filter. The return type is unchanged, so `create or replace` is legal here
-- and the existing grant to authenticated survives.
--
-- The alcohol predicate is still spelled out inline. DEVELOPMENT-ARJUN.md
-- §4.1 wants it to live once in a `bev_cards` view, but that view was never
-- built (the only mention in supabase/ is a comment in 20261011000300), and
-- building it is a bigger change than this task. A-02/A-03 reuse the same
-- predicate through a `feed_event_visible()` helper instead.

create or replace function public.get_feed(p_limit int default 20, p_before_id bigint default null)
returns table (
  id                   bigint,
  kind                 text,
  created_at           timestamptz,
  actor_id             uuid,
  actor_handle         text,
  actor_display_name   text,
  actor_avatar_path    text,
  bev_id               uuid,
  bev_name             text,
  bev_brand            text,
  bev_flavor           text,
  bev_category_id      text,
  bev_thumb_path       text,
  bev_price_tier       smallint,
  bev_price_estimated  boolean,
  bev_status           text,
  bev_rating_count     integer,
  bev_bayes_score      numeric,
  ranking_id           uuid,
  score                numeric(4,2),
  bucket               smallint,
  note                 text,
  target_user_id       uuid,
  in_my_want_to_try    boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.id, e.kind, e.created_at,
         e.actor_id, p.handle, p.display_name, p.avatar_path,
         e.bev_id, b.name, b.brand, b.flavor, b.category_id, b.thumb_path,
         b.price_tier, b.price_estimated, b.status,
         s.rating_count,
         public.bayes_score(
           s.sum_score, s.rating_count,
           coalesce((select mean_score from public.global_stats limit 1), 0),
           3
         )::numeric,
         e.ranking_id, r.score, r.bucket, r.note,
         e.target_user_id,
         exists (
           select 1 from public.want_to_try w
            where w.user_id = auth.uid() and w.bev_id = e.bev_id
         )
    from public.feed_events e
    join public.profiles p on p.id = e.actor_id
    left join public.bevs b on b.id = e.bev_id
    left join public.categories c on c.id = b.category_id
    left join public.bev_stats s on s.bev_id = b.id
    left join public.rankings r on r.id = e.ranking_id
   where e.kind in ('ranked', 'reranked')
     and (e.actor_id = auth.uid()
          or e.actor_id in (select followee_id from public.follows where follower_id = auth.uid()))
     and (b.id is null or not c.is_alcoholic or public.viewer_is_adult())
     and (p_before_id is null or e.id < p_before_id)
   order by e.id desc
   limit p_limit;
$$;
