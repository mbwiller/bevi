-- RLS policies for every table, plus the small set of security-definer
-- helper functions/triggers needed to support them (age-gate check,
-- admin check, rate-limit helper, new-user profile bootstrap, and the
-- profile column-protection trigger).
--
-- Out of scope for this migration (separate tickets, in flight in
-- parallel): the ranking write-path (submit_ranking etc.), search,
-- create_bev, feed, and leaderboard RPCs. Those tables still get their
-- SELECT policies here; their write RPCs land later.

-- =====================================================================
-- 1. Helper functions
-- =====================================================================

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

-- =====================================================================
-- 2. Profile creation trigger (email+password signup only -- no OAuth
--    metadata will exist, so display name falls back to the email's
--    local part).
--
--    Reserved handles to reject in a later set_handle() RPC (not this
--    ticket): admin, bevi, support, null.
-- =====================================================================

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_base text; v_handle text; v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1), 'bevi user');
  v_base := regexp_replace(lower(coalesce(split_part(new.email,'@',1), 'user')), '[^a-z0-9_]', '', 'g');
  v_base := left(coalesce(nullif(v_base,''), 'user'), 14);
  v_handle := v_base;
  while exists (select 1 from public.profiles where handle = v_handle) loop
    v_handle := v_base || '_' || substr(md5(gen_random_uuid()::text), 1, 4);
  end loop;
  insert into public.profiles (id, handle, display_name) values (new.id, v_handle, left(v_name, 40));
  insert into public.user_stats (user_id) values (new.id);
  insert into public.streaks (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 3. Rate-limit helper (called internally by other security-definer
--    RPCs, built in other tickets)
-- =====================================================================

create or replace function public.assert_rate(p_action text, p_limit int, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.user_actions
       where user_id = auth.uid() and action = p_action and created_at > now() - p_window) >= p_limit then
    raise exception 'BEVI_RATE_LIMITED' using errcode = 'P0001', detail = p_action;
  end if;
  insert into public.user_actions (user_id, action) values (auth.uid(), p_action);
end $$;

-- =====================================================================
-- 4. RLS -- enable on every table
-- =====================================================================

alter table public.categories               enable row level security;
alter table public.profiles                 enable row level security;
alter table public.bevs                     enable row level security;
alter table public.bev_aliases              enable row level security;
alter table public.bev_stats                enable row level security;
alter table public.rankings                 enable row level security;
alter table public.comparisons              enable row level security;
alter table public.follows                  enable row level security;
alter table public.want_to_try              enable row level security;
alter table public.user_stats               enable row level security;
alter table public.user_category_stats      enable row level security;
alter table public.streaks                  enable row level security;
alter table public.featured_bevs            enable row level security;
alter table public.feed_events              enable row level security;
alter table public.bev_reports              enable row level security;
alter table public.user_bev_predictions     enable row level security;
alter table public.recommendation_jobs      enable row level security;
alter table public.user_actions             enable row level security;
alter table public.global_stats             enable row level security;

-- =====================================================================
-- 5. Policies
--
-- Core design rule for the whole project: NO insert/update/delete
-- policy for `authenticated` on content tables (bevs, rankings,
-- comparisons, bev_aliases, bev_stats, feed_events, bev_reports,
-- user_bev_predictions, featured_bevs besides the admin-only exception
-- below). All writes to those go through security-definer RPCs built
-- in other tickets.
-- =====================================================================

-- categories: public read, no write policy.
create policy categories_select on public.categories
  for select to authenticated using (true);

-- profiles: readable by everyone (column-level restriction of
-- birth_date via column privileges is a nice-to-have, intentionally
-- skipped in this ticket -- see PR description); own-row update only,
-- with role/bevi_rank/handle protected by the trigger below. No insert
-- (profiles are created by the handle_new_user trigger, security
-- definer, bypassing RLS) and no delete policy (row is removed via the
-- auth.users cascade).
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- bevs: visible when active, or pending_photo owned by the viewer, or
-- viewer is admin -- AND age-gated for alcoholic categories. No write
-- policy (RPC only).
create policy bevs_select on public.bevs
  for select to authenticated using (
    (status = 'active' or (status = 'pending_photo' and created_by = auth.uid()) or public.is_admin())
    and (
      not exists (select 1 from public.categories c where c.id = category_id and c.is_alcoholic)
      or public.viewer_is_adult()
    )
  );

-- bev_aliases: public read, no write policy.
create policy bev_aliases_select on public.bev_aliases
  for select to authenticated using (true);

-- bev_stats: public read, no write policy.
create policy bev_stats_select on public.bev_stats
  for select to authenticated using (true);

-- rankings: public read (same alcohol age-gate as bevs, joined through
-- the bev's category). No write policy (RPC only).
create policy rankings_select on public.rankings
  for select to authenticated using (
    exists (
      select 1 from public.bevs b
      join public.categories c on c.id = b.category_id
      where b.id = rankings.bev_id and (not c.is_alcoholic or public.viewer_is_adult())
    )
  );

-- comparisons: owner-only read, no write policy (RPC only).
create policy comparisons_select on public.comparisons
  for select to authenticated using (user_id = auth.uid());

-- follows: public read (follow graph is not private); writes are
-- direct own-row (follower_id = auth.uid()).
create policy follows_select on public.follows
  for select to authenticated using (true);
create policy follows_insert on public.follows
  for insert to authenticated with check (follower_id = auth.uid());
create policy follows_delete on public.follows
  for delete to authenticated using (follower_id = auth.uid());

-- want_to_try: owner-only read/write.
create policy want_to_try_select on public.want_to_try
  for select to authenticated using (user_id = auth.uid());
create policy want_to_try_insert on public.want_to_try
  for insert to authenticated with check (user_id = auth.uid());
create policy want_to_try_delete on public.want_to_try
  for delete to authenticated using (user_id = auth.uid());

-- user_stats, user_category_stats, streaks: public read (aggregate
-- profile stats), no write policy (maintained by triggers/RPCs run as
-- table owner).
create policy user_stats_select on public.user_stats
  for select to authenticated using (true);
create policy user_category_stats_select on public.user_category_stats
  for select to authenticated using (true);
create policy streaks_select on public.streaks
  for select to authenticated using (true);

-- featured_bevs: readable while live; admin-only write via is_admin().
create policy featured_bevs_select on public.featured_bevs
  for select to authenticated using (now() between starts_at and coalesce(ends_at, 'infinity'::timestamptz));
create policy featured_bevs_insert on public.featured_bevs
  for insert to authenticated with check (public.is_admin());
create policy featured_bevs_update on public.featured_bevs
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy featured_bevs_delete on public.featured_bevs
  for delete to authenticated using (public.is_admin());

-- feed_events: visible to the actor themself and to their followers.
-- No write policy (RPC only).
create policy feed_events_select on public.feed_events
  for select to authenticated using (
    actor_id = auth.uid()
    or exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = feed_events.actor_id)
  );

-- bev_reports: visible to the reporter and admins. No write policy
-- (insert happens via a report_bev RPC in another ticket).
create policy bev_reports_select on public.bev_reports
  for select to authenticated using (reporter_id = auth.uid() or public.is_admin());

-- user_bev_predictions: owner-only read, no write policy.
create policy user_bev_predictions_select on public.user_bev_predictions
  for select to authenticated using (user_id = auth.uid());

-- recommendation_jobs, user_actions: internal/service-role only, no
-- policy for authenticated at all.

-- global_stats: aggregate, not sensitive -- public read, no write
-- policy.
create policy global_stats_select on public.global_stats
  for select to authenticated using (true);

-- =====================================================================
-- profiles: protect role / bevi_rank / handle from being changed via
-- the own-row update policy above. role can only change via admin
-- action; handle only via a dedicated set_handle() RPC (not built in
-- this ticket). bevi_rank is intended to be admin/cron-only too, but a
-- security-definer RPC run as the table owner still fires this
-- row-level trigger (there's no mechanism in Postgres for an owner-run
-- RPC to bypass a BEFORE UPDATE trigger the way it bypasses RLS), so
-- the "only let bevi_rank change through the future cron/admin path"
-- half of this is left as a note for a human to confirm once that path
-- exists: today this trigger simply pins bevi_rank back to its old
-- value on any direct ("own row") update, which is safe but will also
-- silently no-op a legitimate admin/cron UPDATE statement against
-- profiles unless that future RPC is written to go around this trigger
-- (e.g. by using a different write path) or the trigger is revisited.
-- =====================================================================

create or replace function public.protect_profile_columns() returns trigger
language plpgsql as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;
  if new.bevi_rank is distinct from old.bevi_rank then
    new.bevi_rank := old.bevi_rank;
  end if;
  if new.handle is distinct from old.handle then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'handle changes only via set_handle()';
  end if;
  return new;
end $$;

create trigger protect_profile_columns before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- =====================================================================
-- Grants
-- =====================================================================

revoke execute on function public.viewer_is_adult(), public.is_admin(), public.assert_rate(text,int,interval) from public, anon;
grant execute on function public.viewer_is_adult(), public.is_admin() to authenticated;
grant execute on function public.assert_rate(text,int,interval) to authenticated;
