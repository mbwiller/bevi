-- Backend follow-ups from #25 (contract v1) review, items 1-13 against the
-- three already-merged migrations below. Migrations are append-only once on
-- main (see supabase/CLAUDE.md), so every fix here is a `drop`/`create or
-- replace` layered on top, never an edit to those files:
--   * 20261011000100_rls_and_core_rpcs.sql  -- auth/profile items
--   * 20261011000200_ranking_rpcs.sql       -- ranking write-path items
--   * 20261011000300_content_rpcs.sql       -- social/feed/create_bev items
--
-- Not done here (explicitly out of scope per the review): packages/api
-- itself (bucket text<->smallint mapping, BEVI_* -> ApiErrorCode, DB kind ->
-- FeedEventKind), since that package doesn't exist yet. Also not done:
-- search_bevs / get_bev_leaderboard / get_user_leaderboard pagination --
-- see the note above section 3 below.

-- =====================================================================
-- 1. Auth / profile fixes (20261011000100_rls_and_core_rpcs.sql)
-- =====================================================================

-- onboarded: the starter screen's `updateMe({ onboarded: true })` needs
-- somewhere to land; the column never existed.
alter table public.profiles add column onboarded boolean not null default false;

-- Tiny config table for the sign-up invite code (Vault would also work;
-- this is simpler for a ~20-person app). RLS with zero policies: invisible
-- to anon/authenticated, readable only from a security-definer function
-- owned by postgres (same pattern as every other RPC in this schema).
-- No row is seeded here on purpose -- an admin must insert the real code
-- (`insert into public.app_secrets (key, value) values ('invite_code',
-- '<the real code>');`) before sign-up can succeed; until then every
-- sign-up fails validation, which is the safe default.
create table public.app_secrets (
  key   text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;

-- Trusted-RPC bypass flag for protect_profile_columns below. set_handle()
-- and set_birth_date() set this for the duration of their own update
-- statement; the trigger allows the otherwise-blocked column through only
-- when it's set. Transaction-local (`is_local = true`), so it can't leak
-- into a caller's next statement.
create or replace function public.protect_profile_columns() returns trigger
language plpgsql as $$
declare
  v_bypass boolean := coalesce(current_setting('bevi.rpc_bypass', true), 'false') = 'true';
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if new.bevi_rank is distinct from old.bevi_rank then
    new.bevi_rank := old.bevi_rank;
  end if;
  if new.handle is distinct from old.handle and not v_bypass then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'handle changes only via set_handle()';
  end if;
  -- PR #25 review: birth_date was writable directly through the own-row
  -- update policy; pin it like bevi_rank so only set_birth_date() (or an
  -- admin, via the bypass flag) can change it.
  if new.birth_date is distinct from old.birth_date and not v_bypass then
    new.birth_date := old.birth_date;
  end if;
  return new;
end $$;

-- PR #25 review: profiles_select (20261011000100) exposes birth_date to
-- every authenticated user, but the contract returns `birthdate` only for
-- the caller (null for everyone else). Masking it at the view layer means
-- no RLS/column-privilege changes on the base table, which every existing
-- security-definer RPC (handle_new_user, viewer_is_adult, ...) still reads
-- directly. Future profile reads for other users go through this view, not
-- the base table, and get birth_date = null unless the row is the caller's.
create or replace view public.profiles_view
  with (security_invoker = true) as
select
  id, handle, display_name, avatar_path,
  case when id = auth.uid() then birth_date else null end as birth_date,
  age_attested_at, timezone, role, bevi_rank, handle_changed_at, onboarded,
  created_at, updated_at
from public.profiles;

grant select on public.profiles_view to authenticated;

-- PR #25 review: `profile.checkHandle` must work signed out and report why
-- a handle is unavailable. Mirrors HANDLE_PATTERN/RESERVED_HANDLES in
-- shared/src/enums.ts exactly -- keep the two in sync by hand.
create or replace function public.check_handle(p_handle text)
returns table (available boolean, reason text)
language sql
stable
security definer
set search_path = public
as $$
  select
    not (
      p_handle !~ '^[a-z0-9_]{3,20}$'
      or p_handle = any(array['admin', 'bevi', 'support', 'null'])
      or exists (select 1 from public.profiles where handle = p_handle)
    ),
    case
      when p_handle !~ '^[a-z0-9_]{3,20}$' then 'invalid'
      when p_handle = any(array['admin', 'bevi', 'support', 'null']) then 'reserved'
      when exists (select 1 from public.profiles where handle = p_handle) then 'taken'
      else null
    end;
$$;

-- PR #25 review: one-way birthdate. Raises on a second call rather than
-- silently overwriting, so nobody flips from under-21 to 21+.
create or replace function public.set_birth_date(p_date date)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  select * into v_row from public.profiles where id = v_uid;

  if v_row.birth_date is not null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'birth_date already set';
  end if;
  if p_date is null or p_date > current_date then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'birth_date';
  end if;

  perform set_config('bevi.rpc_bypass', 'true', true);
  update public.profiles
     set birth_date = p_date, age_attested_at = now(), updated_at = now()
   where id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

-- PR #25 review: updateMe({ handle }) needs an RPC, since the own-row
-- update policy is blocked for handle changes by protect_profile_columns.
-- Also updates the synthetic auth email so the handle keeps working as the
-- sign-in username (decided 2026-10-11: username+password, no SMTP/confirm,
-- so a direct auth.users.email write needs no confirmation round trip --
-- same elevated-access pattern delete_my_account already uses).
create or replace function public.set_handle(p_handle text)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_handle !~ '^[a-z0-9_]{3,20}$' or p_handle = any(array['admin', 'bevi', 'support', 'null']) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'handle';
  end if;

  perform public.assert_rate('set_handle', 1, interval '30 days');

  if exists (select 1 from public.profiles where handle = p_handle and id <> v_uid) then
    raise exception 'BEVI_HANDLE_TAKEN' using errcode = '23505';
  end if;

  perform set_config('bevi.rpc_bypass', 'true', true);
  update public.profiles
     set handle = p_handle, handle_changed_at = now(), updated_at = now()
   where id = v_uid
  returning * into v_row;

  update auth.users set email = p_handle || '@users.bevi.app' where id = v_uid;

  return v_row;
end;
$$;

-- PR #25 review: decided 2026-10-11 sign-up is username + password behind a
-- shared invite code; `packages/api` calls `supabase.auth.signUp` with the
-- synthetic email '<username>@users.bevi.app' and must pass the invite code
-- as sign-up metadata (`options.data = { invite_code }`) so it lands in
-- raw_user_meta_data here. Raising inside this AFTER INSERT trigger rolls
-- back the whole transaction, so a bad invite code or username means the
-- auth.users row never actually exists either -- the option the review
-- explicitly allowed ("the trigger could raise") instead of a separate
-- sign-up RPC or auth hook.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username    text := split_part(new.email, '@', 1);
  v_invite_code text := new.raw_user_meta_data ->> 'invite_code';
  v_required    text;
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'username';
  end if;

  if v_username = any(array['admin', 'bevi', 'support', 'null']) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'username';
  end if;

  select value into v_required from public.app_secrets where key = 'invite_code';
  if v_required is null or v_invite_code is distinct from v_required then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'inviteCode';
  end if;

  if exists (select 1 from public.profiles where handle = v_username) then
    raise exception 'BEVI_HANDLE_TAKEN' using errcode = '23505';
  end if;

  insert into public.profiles (id, handle, display_name) values (new.id, v_username, v_username);
  insert into public.user_stats (user_id) values (new.id);
  insert into public.streaks (user_id) values (new.id);
  return new;
end $$;

revoke execute on function
  public.check_handle(text),
  public.set_birth_date(date),
  public.set_handle(text)
from public, anon;
grant execute on function public.check_handle(text) to anon, authenticated;
grant execute on function public.set_birth_date(date) to authenticated;
grant execute on function public.set_handle(text) to authenticated;

-- =====================================================================
-- 2. Ranking write-path fixes (20261011000200_ranking_rpcs.sql)
-- =====================================================================

drop function if exists public.submit_ranking(uuid, smallint, integer, jsonb, text, text);
drop function if exists public.rerank_bev(uuid, smallint, integer, jsonb);

-- PR #25 review, items against submit_ranking:
--   * p_expected_bucket_size: stale-bucket conflict (BEVI_STALE_BUCKET,
--     matching the name/errcode already used in DEVELOPMENT-ARJUN.md §5.1,
--     not the PR's example BEVI_CONFLICT) and the index bound now checked
--     against it.
--   * BEVI_ALREADY_RANKED already mapped to conflict/23505; unchanged.
--   * removes the Bev from Want to Try and recomputes user_stats.want_count
--     (§6.6: ranking a Bev removes it from Want to Try).
--   * comparisons read winnerBevId/loserBevId (the contract's Comparison
--     shape), not winner/loser.
--   * note capped at 140 chars (UI limit); the column check stays 280 as a
--     DB-level ceiling, enforced here instead of tightening the column.
--   * returns (ranking, bucket_size) so the app gets "#4 of 31" in one call.
create or replace function public.submit_ranking(
  p_bev_id               uuid,
  p_bucket               smallint,
  p_insert_index         integer,
  p_expected_bucket_size integer,
  p_comparisons          jsonb default '[]'::jsonb,
  p_note                 text default null,
  p_photo_path           text default null
)
returns table (ranking public.rankings, bucket_size integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_category_id  text;
  v_is_alcoholic boolean;
  v_count        integer;
  v_row          public.rankings;
  v_submission   uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_note is not null and char_length(p_note) > 140 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'note';
  end if;

  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));
  perform public.assert_rate('submit_ranking', 60, interval '1 hour');

  select b.category_id, c.is_alcoholic
    into v_category_id, v_is_alcoholic
  from public.bevs b
  join public.categories c on c.id = b.category_id
  where b.id = p_bev_id;

  if v_category_id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_is_alcoholic and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  if exists (select 1 from public.rankings where user_id = v_uid and bev_id = p_bev_id) then
    raise exception 'BEVI_ALREADY_RANKED' using errcode = '23505';
  end if;

  select count(*) into v_count
  from public.rankings
  where user_id = v_uid and bucket = p_bucket;

  if v_count <> p_expected_bucket_size then
    raise exception 'BEVI_STALE_BUCKET' using errcode = '23505',
      detail = format('expected=%s actual=%s', p_expected_bucket_size, v_count);
  end if;

  if p_insert_index < 0 or p_insert_index > p_expected_bucket_size then
    raise exception 'BEVI_BAD_INDEX' using errcode = '22023', detail = format('n=%s', p_expected_bucket_size);
  end if;

  update public.rankings
  set position = position + 1, updated_at = now()
  where user_id = v_uid and bucket = p_bucket and position >= p_insert_index;

  insert into public.rankings (user_id, bev_id, bucket, position, score, note, photo_path)
  values (v_uid, p_bev_id, p_bucket, p_insert_index, 0, p_note, p_photo_path)
  returning * into v_row;

  perform public.respace_bucket(v_uid, p_bucket);

  insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id, tie)
  select v_uid, v_submission, (c ->> 'winnerBevId')::uuid, (c ->> 'loserBevId')::uuid, coalesce((c ->> 'tie')::boolean, false)
  from jsonb_array_elements(p_comparisons) c;

  perform public.refresh_bev_stats(
    array(select bev_id from public.rankings where user_id = v_uid and bucket = p_bucket)
  );

  delete from public.want_to_try where user_id = v_uid and bev_id = p_bev_id;
  update public.user_stats
  set want_count = (select count(*) from public.want_to_try where user_id = v_uid),
      updated_at = now()
  where user_id = v_uid;

  insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
  values (v_uid, 'ranked', p_bev_id, v_row.id);

  select * into v_row from public.rankings where id = v_row.id;
  return query select v_row, v_count + 1;
end;
$$;
alter function public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text) owner to postgres;

-- PR #25 review, items against rerank_bev: same stale-bucket check
-- (p_expected_bucket_size excludes the Bev being moved -- the count below
-- is taken after it's removed from its old slot, which is correct even
-- when the target bucket equals the old one); p_note replaces the note
-- when given, otherwise it carries over; comparisons renamed the same way
-- as submit_ranking; same (ranking, bucket_size) return shape.
create or replace function public.rerank_bev(
  p_bev_id               uuid,
  p_bucket               smallint,
  p_insert_index         integer,
  p_expected_bucket_size integer,
  p_comparisons          jsonb default '[]'::jsonb,
  p_note                 text default null
)
returns table (ranking public.rankings, bucket_size integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_old        public.rankings;
  v_new_count  integer;
  v_row        public.rankings;
  v_submission uuid := gen_random_uuid();
  v_note       text;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_note is not null and char_length(p_note) > 140 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'note';
  end if;

  perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));

  select * into v_old
  from public.rankings
  where user_id = v_uid and bev_id = p_bev_id;

  if v_old.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.rankings where id = v_old.id;

  update public.rankings
  set position = position - 1, updated_at = now()
  where user_id = v_uid and bucket = v_old.bucket and position > v_old.position;

  select count(*) into v_new_count
  from public.rankings
  where user_id = v_uid and bucket = p_bucket;

  if v_new_count <> p_expected_bucket_size then
    raise exception 'BEVI_STALE_BUCKET' using errcode = '23505',
      detail = format('expected=%s actual=%s', p_expected_bucket_size, v_new_count);
  end if;

  if p_insert_index < 0 or p_insert_index > p_expected_bucket_size then
    raise exception 'BEVI_BAD_INDEX' using errcode = '22023', detail = format('n=%s', p_expected_bucket_size);
  end if;

  update public.rankings
  set position = position + 1, updated_at = now()
  where user_id = v_uid and bucket = p_bucket and position >= p_insert_index;

  v_note := coalesce(p_note, v_old.note);

  insert into public.rankings (user_id, bev_id, bucket, position, score, note, photo_path)
  values (v_uid, p_bev_id, p_bucket, p_insert_index, 0, v_note, v_old.photo_path)
  returning * into v_row;

  perform public.respace_bucket(v_uid, v_old.bucket);
  if p_bucket <> v_old.bucket then
    perform public.respace_bucket(v_uid, p_bucket);
  end if;

  insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id, tie)
  select v_uid, v_submission, (c ->> 'winnerBevId')::uuid, (c ->> 'loserBevId')::uuid, coalesce((c ->> 'tie')::boolean, false)
  from jsonb_array_elements(p_comparisons) c;

  perform public.refresh_bev_stats(
    array(
      select distinct bev_id from public.rankings
      where user_id = v_uid and bucket in (v_old.bucket, p_bucket)
    )
  );

  insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
  values (v_uid, 'reranked', p_bev_id, v_row.id);

  select * into v_row from public.rankings where id = v_row.id;
  return query select v_row, v_new_count + 1;
end;
$$;
alter function public.rerank_bev(uuid, smallint, integer, integer, jsonb, text) owner to postgres;

-- remove_ranking is unchanged (review item: "fine as is").

revoke execute on function
  public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text),
  public.rerank_bev(uuid, smallint, integer, integer, jsonb, text)
from public, anon;
grant execute on function
  public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text),
  public.rerank_bev(uuid, smallint, integer, integer, jsonb, text)
to authenticated;

-- =====================================================================
-- 3. Content RPC fixes (20261011000300_content_rpcs.sql)
--
-- Deliberately not done here: search_bevs / get_bev_leaderboard /
-- get_user_leaderboard pagination. The contract types their results as
-- `Page<T>`, but they're ordered by similarity/bayes_score/bevi_rank, not a
-- stable monotonic key, so a real keyset cursor is its own ticket.
-- `packages/api` returns `nextCursor: null` for all three until it lands.
-- =====================================================================

drop function if exists public.find_similar_bevs(text, text, text, int);
drop function if exists public.create_bev(text, text, text, text, smallint, boolean, text, text);
drop function if exists public.add_want_to_try(uuid, uuid);
drop function if exists public.get_feed(int);

set search_path = public, extensions;

-- PR #25 review: the contract's findLikelyDuplicates also sends flavor;
-- fold it into the match text so e.g. "Coke Zero" vs "Coke Cherry" don't
-- collide just on name+brand.
create or replace function public.find_similar_bevs(
  p_name text,
  p_brand text default null,
  p_category_id text default null,
  p_flavor text default null,
  p_limit int default 5
)
returns table (
  bev_id     uuid,
  name       text,
  brand      text,
  flavor     text,
  thumb_path text,
  similarity real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (select lower(unaccent(coalesce(p_brand, '') || ' ' || p_name || ' ' || coalesce(p_flavor, ''))) as text)
  select b.id, b.name, b.brand, b.flavor, b.thumb_path,
         greatest(
           similarity(q.text, unaccent(b.search_text)),
           coalesce((select max(similarity(q.text, a.alias))
                       from public.bev_aliases a where a.bev_id = b.id), 0)
         )::real as sim
    from public.bevs b, q
   where b.status in ('active', 'pending_photo')
     and (p_category_id is null or b.category_id = p_category_id)
     and (unaccent(b.search_text) % q.text
          or exists (select 1 from public.bev_aliases a
                      where a.bev_id = b.id and a.alias % q.text))
   order by sim desc
   limit p_limit;
$$;

-- PR #25 review: p_price_tier may arrive null (user didn't know the
-- price). bevs.price_tier is `not null`, so a null tier is filled with the
-- category's active-Bev median and price_estimated is forced true; an
-- explicit tier always wins and keeps the caller's price_estimated as
-- given. p_photo_asset_id/p_label_asset_id are the ids `media.upload`
-- returns; there is no separate assets table yet, so they're stored
-- directly as the existing photo_path/nutrition_label_path strings, same
-- forward-compat placeholder the old p_raw_photo_path param documented.
create or replace function public.create_bev(
  p_name             text,
  p_brand            text,
  p_flavor           text,
  p_category_id      text,
  p_price_tier       smallint default null,
  p_price_estimated  boolean default true,
  p_upc              text default null,
  p_photo_asset_id   text default null,
  p_label_asset_id   text default null
)
returns public.bevs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid             uuid := auth.uid();
  v_is_alcoholic    boolean;
  v_existing        public.bevs;
  v_row             public.bevs;
  v_price_tier      smallint;
  v_price_estimated boolean;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  perform public.assert_rate('create_bev', 5, interval '1 hour');
  perform public.assert_rate('create_bev', 20, interval '1 day');

  select is_alcoholic into v_is_alcoholic from public.categories where id = p_category_id;
  if coalesce(v_is_alcoholic, false) and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  if p_price_tier is null then
    select percentile_disc(0.5) within group (order by price_tier)
      into v_price_tier
      from public.bevs
     where category_id = p_category_id and status = 'active';
    v_price_tier := coalesce(v_price_tier, 2);
    v_price_estimated := true;
  else
    v_price_tier := p_price_tier;
    v_price_estimated := p_price_estimated;
  end if;

  if p_upc is not null then
    select * into v_existing from public.bevs
     where upc = p_upc and status <> 'merged'
     limit 1;
    if found then
      return v_existing;
    end if;
  end if;

  begin
    insert into public.bevs (
      name, brand, flavor, category_id, price_tier, price_estimated,
      upc, photo_path, nutrition_label_path, status, created_by, source
    )
    values (
      p_name, p_brand, p_flavor, p_category_id, v_price_tier, v_price_estimated,
      p_upc, p_photo_asset_id, p_label_asset_id, 'pending_photo', v_uid, 'user'
    )
    returning * into v_row;
  exception when unique_violation then
    select * into v_existing from public.bevs
     where status in ('pending_photo', 'active')
       and (
         (category_id = p_category_id
          and lower(coalesce(brand, '')) = lower(coalesce(p_brand, ''))
          and lower(name) = lower(p_name)
          and lower(coalesce(flavor, '')) = lower(coalesce(p_flavor, '')))
         or (p_upc is not null and upc = p_upc)
       )
     limit 1;
    raise exception 'BEVI_DUPLICATE_BEV' using errcode = '23505', detail = coalesce(v_existing.id::text, '');
  end;

  return v_row;
end;
$$;

-- PR #25 review: a missing target user is not_found, not an FK error; a
-- feed event posts only when the follow was actually new (FOUND reflects
-- whether the preceding INSERT ... ON CONFLICT DO NOTHING affected a row).
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

  if found then
    insert into public.feed_events (actor_id, kind, target_user_id) values (v_uid, 'followed', p_user_id);
  end if;

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

-- PR #25 review: takes p_via_user_id (want_to_try.source_user_id, the
-- contract's viaUserId), age-gates alcoholic Bevs, not_found for an
-- unknown Bev, and posts a 'want_to_try' feed event only on the first
-- insert (same FOUND pattern as follow_user).
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

    insert into public.feed_events (actor_id, kind, bev_id) values (v_uid, 'want_to_try', p_bev_id);
  end if;
end;
$$;

-- PR #25 review: dropped 'followed' (not a feed post -- FeedEventKind is
-- only RANKING | SAVED), added a p_before_id keyset cursor, and joined in
-- the ranking's score/bucket/note plus the Bev-card fields the app needs
-- to render a card without a second round trip. A re-rank posts as a new
-- feed item rather than replacing the old one -- simplest, and consistent
-- with rerank_bev always inserting a fresh 'reranked' event.
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
   where e.kind in ('ranked', 'reranked', 'want_to_try')
     and (e.actor_id = auth.uid()
          or e.actor_id in (select followee_id from public.follows where follower_id = auth.uid()))
     and (b.id is null or not c.is_alcoholic or public.viewer_is_adult())
     and (p_before_id is null or e.id < p_before_id)
   order by e.id desc
   limit p_limit;
$$;

revoke execute on function
  public.find_similar_bevs(text, text, text, text, int),
  public.create_bev(text, text, text, text, smallint, boolean, text, text, text),
  public.add_want_to_try(uuid, uuid, uuid),
  public.get_feed(int, bigint)
from public, anon;
grant execute on function
  public.find_similar_bevs(text, text, text, text, int),
  public.create_bev(text, text, text, text, smallint, boolean, text, text, text),
  public.add_want_to_try(uuid, uuid, uuid),
  public.get_feed(int, bigint)
to authenticated;
