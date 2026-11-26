-- DELIVERABLE-44: a user's go-to categories, picked in onboarding.
--
-- WHAT THIS FILE ADDS
--
--   public.user_category_picks           table: up to three top-level categories
--                                        per user, rank 1 = favourite
--   public.set_category_picks(text[])    RPC: replaces them, all at once
--
-- Reading is a plain select through RLS (`packages/api` `profile.getCategoryPicks`
-- reads `category_id, rank` ordered by `rank`), the way `want_to_try` is read:
-- an own-row table needs no definer to read it.
--
-- Additive only: two new objects, nothing existing is changed. Contract 3.9.0.
--
-- PRIVATE TO THEIR OWNER. Unlike a ranking, a pick is not shown to anyone else,
-- admin included: a public "beer" pick would tell every reader that the person
-- is 21 or over. So there is one SELECT policy, own rows only, and no other way
-- to read the table from a client.
--
-- SECURITY MODEL, as everywhere since 20261011000100: RLS on, no
-- INSERT/UPDATE/DELETE policy (writes go through set_category_picks), and the
-- table privileges Supabase's default privileges hand out revoked in this same
-- migration, as 20261119152455_hygiene.sql section 2 asks of every new table:
-- `authenticated` keeps SELECT (the policy stands on it) and nothing else,
-- `anon` keeps nothing. 42_table_privileges.test.sql asserts the result for
-- every table in `public`.
--
-- ACCOUNT DELETION. `user_id` cascades from `profiles`, which cascades from
-- `auth.users`, so delete_my_account() (20261011000600) takes the picks with it
-- and needs no change.

set search_path = public, extensions;

-- ============================================================================
-- 1. user_category_picks
-- ============================================================================
-- The PK makes a rank unique per user and the UNIQUE makes a category unique
-- per user, so "the same category twice" and "two favourites" are both
-- structural, not something the RPC alone has to remember. The rank CHECK caps
-- the set at three rows even if a later writer forgets the RPC's own limit.
--
-- `category_id` is a ROOT (`parent_id is null`, 20261026000100). The schema
-- cannot say that without a trigger, and the only writer checks it, so it is
-- enforced there rather than here.

create table public.user_category_picks (
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  rank        smallint    not null check (rank between 1 and 3),
  category_id text        not null references public.categories(id),
  created_at  timestamptz not null default now(),
  primary key (user_id, rank),
  unique (user_id, category_id)
);

alter table public.user_category_picks enable row level security;

-- Own rows only, and nothing for an admin: see the header.
create policy user_category_picks_select on public.user_category_picks
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.user_category_picks from anon, authenticated;
revoke select on public.user_category_picks from anon;

comment on table public.user_category_picks is
  'DELIVERABLE-44: a user''s go-to top-level categories from onboarding, rank 1 = favourite, at most 3. Private to the owner (own-row SELECT only). Written only by set_category_picks().';

-- ============================================================================
-- 2. set_category_picks(p_category_ids text[]) -> the saved picks, in rank order
-- ============================================================================
-- Replaces the caller's picks with `p_category_ids`, favourite first: the
-- array position is the rank. An empty array is valid and clears them.
--
-- BEVI_VALIDATION, detail 'categoryIds', for: a null array, a
-- multi-dimensional one, more than three entries, a null entry, a repeat, an
-- id that is not a category, and a category that is not top-level (a leaf such
-- as 'cola'). Validation runs before the age check, so a minor sending a leaf
-- under 'beer' is told the id is wrong, not that it is restricted.
--
-- BEVI_AGE_RESTRICTED when any pick is an alcoholic category and the caller is
-- not 21+, submit_ranking's idiom. A root's own `is_alcoholic` is the gate's
-- answer (category_is_alcoholic() reads the root for a leaf; there are no
-- leaves left by then).
--
-- ATOMIC. The advisory lock serialises two concurrent calls from one user
-- (a double tap), so the delete-then-insert of one can never interleave with
-- the other's and trip the PK. Any failure leaves the old picks as they were,
-- since every check runs before the delete.
--
-- No assert_rate, like the other small own-row writers (set_avatar,
-- set_bev_location, update_ranking_note, add/remove_want_to_try): a call
-- replaces at most three rows of the caller's own.
--
-- RETURN SHAPE IS FROZEN once shipped (supabase/CLAUDE.md): `category_id,
-- rank`, ordered by rank. A new column may only be added at the end.

create or replace function public.set_category_picks(p_category_ids text[])
returns table (category_id text, rank smallint)
language plpgsql
security definer
set search_path = public
as $$
-- The RETURNS TABLE names are also the table's column names; every reference
-- below means the column.
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'BEVI_UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_category_ids is null or coalesce(array_ndims(p_category_ids), 1) <> 1 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'categoryIds';
  end if;

  v_n := cardinality(p_category_ids);

  if v_n > 3 then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'categoryIds';
  end if;

  if exists (select 1 from unnest(p_category_ids) as t(id) where t.id is null) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'categoryIds';
  end if;

  if (select count(distinct t.id) from unnest(p_category_ids) as t(id)) <> v_n then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'categoryIds';
  end if;

  -- Unknown and not top-level are one test: every id must be a root.
  if exists (
    select 1
      from unnest(p_category_ids) as t(id)
     where not exists (
       select 1 from public.categories c
        where c.id = t.id and c.parent_id is null
     )
  ) then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'categoryIds';
  end if;

  if not public.viewer_is_adult()
     and exists (
       select 1 from public.categories c
        where c.id = any (p_category_ids) and c.is_alcoholic
     ) then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('picks:' || v_uid::text));

  delete from public.user_category_picks p where p.user_id = v_uid;

  insert into public.user_category_picks (user_id, rank, category_id)
  select v_uid, t.ord::smallint, t.id
    from unnest(p_category_ids) with ordinality as t(id, ord);

  return query
    select p.category_id, p.rank
      from public.user_category_picks p
     where p.user_id = v_uid
     order by p.rank;
end;
$$;

-- `from public` strips Postgres's implicit grant to PUBLIC; `anon` and
-- `authenticated` are named as well because Supabase's default privileges lay
-- down a direct EXECUTE grant to both on every new function in this schema
-- (20261019000400). Revoking from all three and granting back makes the final
-- privileges readable here, as 20261125000100_can_rank_bugs.sql does.
alter function public.set_category_picks(text[]) owner to postgres;
revoke execute on function public.set_category_picks(text[]) from public, anon, authenticated;
grant execute on function public.set_category_picks(text[]) to authenticated;

comment on function public.set_category_picks(text[]) is
  'DELIVERABLE-44: replaces the caller''s go-to categories (0 to 3 top-level ids, favourite first; empty clears) and returns them in rank order. BEVI_VALIDATION (detail categoryIds) for a null, over-long, repeating, unknown or non-top-level list; BEVI_AGE_RESTRICTED for an alcoholic category under 21.';
