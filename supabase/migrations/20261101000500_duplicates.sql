-- S-13 + A-12 (20261101000500): duplicates -- flag one, then merge it by hand.
--
-- THE APPROVED PLAN (TASKS.md S-13 and A-12, approved by Matt and Arjun on
-- 2026-10-19). Three layers, and this migration builds the last two:
--   1. Prevention already exists: the "Did you mean..." step at create
--      (`find_similar_bevs`, pg_trgm over `search_text` and `bev_aliases`) and
--      the exact-match guard (`bevs_natural_uq` -> BEVI_DUPLICATE_BEV).
--   2. Flagging: the "Duplicate of another Bev" report names WHICH Bev, as
--      `bevs.report(id, reason, { duplicateOfId })` (contract 2.9.0) ->
--      `report_bev(..., p_duplicate_of)`. The column and the parameter have
--      existed since 20261009000700/20261011000300; what was missing is the
--      contract and the validation, which is section 1 below.
--   3. Resolution BY HAND: an operator reads `pending_duplicate_reports` in
--      Supabase Studio (section 4) and runs `merge_bev(src, dst)` (section 3)
--      from Studio's SQL editor. Nothing here, and nothing scheduled, ever
--      merges automatically: a wrong merge folds two people's rankings of two
--      different drinks into one, and it cannot be undone mechanically (see
--      "irreversible" under section 3). A human decides every one.
-- `get_bev` (section 2) follows a merge, so an old link, a shared URL or a
-- cached Bev id lands on the surviving Bev instead of on "not found".
--
-- NO NEO4J. `docs/graph.md`'s mirror of `(:Bev)` nodes is A-16's deferred
-- steps 6, 8 and 9, so A-12's "mark the Bev for the next graph sync (A-16
-- removes the node and its edges)" has no sync to mark it for. The Postgres
-- half is what the app reads (`bevs.similarities`/`bevs.similar` read
-- `bev_edges`), so `merge_bev` deletes the merged Bev's `bev_edges` rows
-- itself. The nightly `graph:edges` job only reads `status = 'active'` Bevs
-- (scripts/graph/edges-core.ts, `nearest_bev_embeddings` filters both ends),
-- so the rows never come back. When the Neo4j mirror lands it should drop
-- non-active nodes the same way; that is its concern, not this migration's.
--
-- RE-CREATED HERE, SIGNATURES UNCHANGED: `report_bev` (20261011000300) and
-- `get_bev` (20261011000600). Neither is touched by the four sibling
-- migrations 20261101000100-000400, and this file does not re-create any of
-- the functions they do; it only CALLS `refresh_bev_stats`,
-- `refresh_user_stats` and `respace_bucket`, whose signatures they keep.
-- Push order: after 000100-000400 (timestamp order).
--
-- Errors follow DEVELOPMENT-ARJUN.md section 5.1: BEVI_VALIDATION / 22023 with
-- a bare field name in DETAIL, which packages/api's `validationDetail` turns
-- into `{ field }` (`detail = 'duplicateOfId'` -> `{ field: 'duplicateOfId' }`).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. report_bev: validate p_duplicate_of
-- ---------------------------------------------------------------------------
-- Same signature, return type, language, security and search_path as
-- 20261011000300, so `create or replace` keeps the existing grants; they are
-- re-stated at the end of the section anyway, exactly as that file states them.
--
-- p_duplicate_of stays OPTIONAL, with any reason. Today's app sends
-- `reason = 'duplicate'` with no id and must keep working until M-20 (the
-- "Duplicate of..." picker) ships; making the id mandatory for 'duplicate'
-- would break every installed build the day this is pushed.
--
-- When it is given it must name a Bev the caller can SEE: active, and in an
-- alcoholic category only for an adult. That is `bevs_select`'s predicate
-- minus its two other arms, on purpose:
--   * `pending_photo` (own) is left out because nobody else can see that Bev,
--     and `merge_bev` only merges INTO an active Bev, so a report naming one
--     could never be acted on as written.
--   * `is_admin()` is left out because the target must be active for the same
--     reason, whoever is reporting.
-- Unknown, hidden, merged, pending and age-gated all raise the SAME error,
-- `detail = 'duplicateOfId'`, so a minor cannot use this to probe which
-- alcoholic Bev ids exist (the same reason `similarities` treats an id the
-- caller cannot see as absent rather than as an error). Naming the reported
-- Bev itself raises it too; the client can tell that case apart on its own.
--
-- ONE ADDITION BEYOND THE PLAN, to make the server match the contract it
-- already documents: an unknown p_bev_id now raises BEVI_NOT_FOUND (P0002).
-- Before, it reached the INSERT and failed the foreign key with 23503, which
-- packages/api has no mapping for, so the real API returned 'unknown' where
-- `BevsApi.report` has always promised 'not_found' (and the FakeApi and the
-- conformance suite already assert 'not_found'). It checks existence only, in
-- any status: whether a Bev is visible is not what a report of it needs.
--
-- Order kept from the original: sign-in, then the rate limit, then the new
-- checks, then the insert. A raise rolls the whole call back, including
-- assert_rate's `user_actions` row, so a rejected report costs no budget.

create or replace function public.report_bev(
  p_bev_id        uuid,
  p_reason        text,
  p_duplicate_of  uuid default null,
  p_note          text default null
)
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

  perform public.assert_rate('report_bev', 20, interval '1 day');

  if not exists (select 1 from public.bevs b where b.id = p_bev_id) then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_duplicate_of is not null then
    if p_duplicate_of = p_bev_id then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'duplicateOfId';
    end if;

    if not exists (
      select 1
        from public.bevs b
        join public.categories c on c.id = b.category_id
       where b.id = p_duplicate_of
         and b.status = 'active'
         and (not c.is_alcoholic or public.viewer_is_adult())
    ) then
      raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'duplicateOfId';
    end if;
  end if;

  insert into public.bev_reports (reporter_id, bev_id, reason, duplicate_of, note)
  values (v_uid, p_bev_id, p_reason, p_duplicate_of, p_note);
end;
$$;

revoke execute on function public.report_bev(uuid, text, uuid, text) from public, anon;
grant execute on function public.report_bev(uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_bev: an old link to a merged Bev lands on the surviving one
-- ---------------------------------------------------------------------------
-- Same signature and the same 18 return columns as 20261011000600, so
-- `create or replace` is legal and the grant survives (re-stated below).
--
-- The only change is the loop before the original SELECT. If the requested
-- row is `merged`, follow `merged_into` until the first row that is not, and
-- run the ORIGINAL select -- the same status predicate, the same age check,
-- the same raises -- against that row instead. So:
--   * the surviving Bev comes back under exactly the rules a direct request
--     for it would meet (a minor following a link to a Bev that was merged
--     into an alcoholic one gets 'age_restricted', as they would going there
--     directly; a survivor that was later hidden is 'not_found');
--   * the returned `id` is the SURVIVOR's, which is how a caller can tell it
--     was redirected (packages/api's `get` keys its follow-up reads off the
--     returned id for that reason).
-- Admins are redirected too. Before, `is_admin()` let an admin open a merged
-- row as itself; Studio is the place to look at a merged row, and the app
-- showing an admin a Bev nobody else can reach was never useful.
--
-- At most 8 hops. `merge_bev` keeps every chain one hop long (it re-points
-- earlier merges into `src` at `dst`, section 3 step 9) and refuses to merge
-- into a merged Bev, so a well-formed chain is length 1; the bound exists for
-- rows edited by hand in Studio, where a cycle (A -> B -> A) would otherwise
-- spin forever inside a STABLE function. A chain that does not end within 8
-- hops is BEVI_NOT_FOUND, the same answer an unknown id gets. `merged_into`
-- is a foreign key with no ON DELETE, so a chain cannot point at a row that
-- does not exist; if it ever did, the SELECT INTO leaves the status null, the
-- loop stops, and the original select finds no row -> BEVI_NOT_FOUND.

create or replace function public.get_bev(p_bev_id uuid)
returns table (
  id                   uuid,
  name                 text,
  brand                text,
  flavor               text,
  category_id          text,
  photo_path           text,
  nutrition_label_path text,
  price_tier           smallint,
  price_estimated      boolean,
  status               text,
  is_starter           boolean,
  created_at           timestamptz,
  created_by_id        uuid,
  created_by_handle    text,
  rating_count         integer,
  avg_score            numeric(4,2),
  score_stddev         numeric(4,2),
  bayes_score          numeric(4,2)
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row    record;
  v_id     uuid := p_bev_id;
  v_status text;
  v_next   uuid;
  v_hops   integer := 0;
begin
  select b.status, b.merged_into into v_status, v_next
    from public.bevs b
   where b.id = v_id;

  while v_status = 'merged' loop
    v_hops := v_hops + 1;
    if v_hops > 8 or v_next is null then
      raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_id := v_next;
    select b.status, b.merged_into into v_status, v_next
      from public.bevs b
     where b.id = v_id;
  end loop;

  select b.id, b.name, b.brand, b.flavor, b.category_id,
         b.photo_path, b.nutrition_label_path, b.price_tier, b.price_estimated,
         b.status, b.is_starter, b.created_at,
         p.id as creator_id, p.handle as creator_handle,
         c.is_alcoholic,
         coalesce(s.rating_count, 0) as rating_count, s.avg_score, s.score_stddev, s.bayes_score
    into v_row
  from public.bevs b
  join public.categories c on c.id = b.category_id
  left join public.profiles p on p.id = b.created_by
  left join public.bev_stats s on s.bev_id = b.id
  where b.id = v_id
    and (b.status = 'active' or (b.status = 'pending_photo' and b.created_by = auth.uid()) or public.is_admin());

  if v_row.id is null then
    raise exception 'BEVI_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.is_alcoholic and not public.viewer_is_adult() then
    raise exception 'BEVI_AGE_RESTRICTED' using errcode = '42501';
  end if;

  return query select
    v_row.id, v_row.name, v_row.brand, v_row.flavor, v_row.category_id,
    v_row.photo_path, v_row.nutrition_label_path, v_row.price_tier, v_row.price_estimated,
    v_row.status, v_row.is_starter, v_row.created_at,
    v_row.creator_id, v_row.creator_handle,
    v_row.rating_count, v_row.avg_score, v_row.score_stddev, v_row.bayes_score;
end;
$$;

revoke execute on function public.get_bev(uuid) from public, anon;
grant execute on function public.get_bev(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. merge_bev(p_src, p_dst): fold a duplicate into the Bev it duplicates
-- ---------------------------------------------------------------------------
-- WHO CAN RUN IT: postgres and the service role only. Run it from Studio's SQL
-- editor, usually by pasting `merge_sql` from section 4's view:
--     select public.merge_bev('<duplicate id>', '<original id>');
-- DEVELOPMENT-ARJUN.md section 7.6 sketched this as an `is_admin()` RPC.
-- It is not one, deliberately: nothing in the app calls it (no admin UI is in
-- scope), an RPC granted to `authenticated` is reachable by every signed-in
-- account with a JWT and curl, and the only guard would then be one
-- `profiles.role` value. Revoking it from `authenticated` makes the guard the
-- database role instead. If an in-app admin screen is ever built, it gets a
-- thin `is_admin()` wrapper then.
--
-- WHICH WAY ROUND. `src` is the one that goes away (status 'merged'); `dst`
-- keeps its id, name, category, photo, flavour profile and embedding. Merge
-- the user-created duplicate INTO the catalog Bev, not the other way: the
-- catalog row is the one the seed migrations keep updating and the one with
-- the hand-labelled flavour profile.
--
-- IRREVERSIBLE in practice. The `src` row is kept (old links redirect, and
-- old reports keep their foreign key), but which rankings, wants and
-- comparisons used to point at it is not recorded anywhere, and a ranking
-- dropped in step 3 takes its feed post's likes and comments with it (ON
-- DELETE CASCADE from feed_events). Check the pair before running it.
--
-- One transaction (a function call is one), in this order:
--
--  1. VALIDATE, after taking a global `merge_bev` advisory lock so two merges
--     never interleave (two operators, or one double-click: the second sees
--     `src` already merged and stops). src <> dst; both exist; src is not
--     already merged; dst is active. If dst is itself merged the error names
--     ITS target, and the HINT is the call to run instead.
--
--  2. LOCK every user with a ranking on either Bev, with the same
--     `pg_advisory_xact_lock(hashtext('rank:' || user_id))` that
--     submit_ranking, rerank_bev and remove_ranking take, so none of them can
--     move a position in one of these users' buckets while this closes gaps
--     and respaces. Users are locked in uuid order, and the set is re-read
--     after locking until it stops growing, so someone who ranks src or dst
--     while the locks are being taken is caught too. No row has been written
--     yet at this point, so a ranking RPC blocked on one of these locks is not
--     holding anything this function waits for: no deadlock.
--
--  3. RANKINGS. A user who ranked BOTH keeps their ranking of dst and loses
--     the one of src (S-13's wording of the approved plan; A-12's "keep the
--     better-positioned one" is the older draft, and S-13 is what both
--     approved). The deletion is remove_ranking's, step for step: delete,
--     shift `position - 1` above the old slot to close the gap, then
--     `respace_bucket` -- `ranking_score` raises on a position >= n, so the
--     shift must come first. Respacing moves the scores of every other Bev in
--     that bucket, so those Bevs are collected for the stats refresh in step
--     11 (remove_ranking refreshes the same set).
--     A user who ranked ONLY src has the row re-pointed: `bev_id = dst`. It
--     keeps its id, so `feed_events.ranking_id` and
--     `want_to_try.source_ranking_id` stay valid and the post keeps its likes
--     and comments; its bucket, position, score, note and ranked_at are
--     untouched, so its bucket needs no respace. `unique (user_id, bev_id)`
--     cannot fire, because everyone with a dst row was handled just before.
--
--  4. COMPARISONS. Rows between src and dst are deleted -- re-pointed they
--     would be dst-vs-dst, which `check (winner_bev_id <> loser_bev_id)`
--     forbids, and they carry no information once the two are one drink.
--     Every other src endpoint is re-pointed to dst.
--
--  5. WANT TO TRY. A src want moves to dst unless the user already wants dst
--     or has ranked it (submit_ranking deletes the want when you rank, so "a
--     want on a Bev you have ranked" is a state the app never produces; this
--     keeps that true -- including for a user whose src ranking became a dst
--     ranking in step 3). The rest are deleted, and `user_stats.want_count`
--     is recomputed for the users who lost one.
--
--  6. FEED EVENTS. `bev_id` re-pointed. The events of rankings deleted in
--     step 3 are already gone (ON DELETE CASCADE on ranking_id).
--
--  7. ALIASES. src's aliases move to dst (source 'merge'), and src's own name
--     is added as one more alias of dst, in exactly the form the search sides
--     compare aliases against: `find_similar_bevs` builds its query as
--     lower(unaccent(coalesce(brand,'') || ' ' || name || ' ' ||
--     coalesce(flavor,''))) and tests `alias % query` (20261012000700), and
--     `search_bevs` lower(unaccent())s the typed text the same way. Trimmed,
--     because a null brand or flavour leaves an edge space that trigram
--     matching ignores but the alias primary key would not. `on conflict
--     (alias) do nothing`: if that text is already someone's alias, the
--     existing row wins. So typing the old name finds dst, the "Did you
--     mean..." step offers dst, and a seed alias of src keeps working.
--
--  8. REPORTS. Open reports on src (any reason -- they were about a row that
--     no longer exists as itself) and open reports on dst that name src as
--     its original (the merge answered them too) are resolved, with
--     `resolved_by = auth.uid()` (null from Studio, which is fine: the column
--     is nullable and the operator is known from Studio's logs). Every other
--     report naming src as the original (open or closed, on any Bev but dst)
--     now names dst, so an open one stays actionable in section 4's view
--     with a merge_sql that will run. Reports on dst that named src keep
--     saying so: re-pointed they would read "dst duplicates dst".
--
--  9. EVERY OTHER REFERENCE TO public.bevs(id) (`git grep -n 'references
--     public.bevs(id)' -- supabase/migrations` lists 17 on main, plus one in
--     the in-flight sibling 20261101000200; steps 3-8 cover rankings,
--     comparisons x2, want_to_try, feed_events, bev_aliases and
--     bev_reports.duplicate_of; step 11 covers bev_stats):
--       * featured_bevs.bev_id: re-pointed (no unique key on bev_id, so it
--         can be), unless dst already has a featured row, in which case src's
--         are deleted rather than showing the same Bev twice in the carousel.
--       * user_bev_predictions: src's rows deleted. They are a cache of
--         recommendations; dst's own rows are already there or come with the
--         next job, and a recommendation must never name a merged Bev.
--       * bev_edges: every row touching src deleted (see "NO NEO4J" above),
--         so `bevs.similarities` and `bevs.similar` never surface a merged Bev.
--       * bevs.merged_into: earlier merges INTO src are re-pointed at dst, so
--         every redirect stays one hop (see get_bev).
--       * bev_reports.bev_id: left on src. Closed history keeps its subject;
--         open ones were resolved in step 8.
--       * bev_embeddings, bev_flavor_profiles: left alone. Harmless (nothing
--         on a request path reads them for a non-active Bev), and the nightly
--         jobs skip non-active Bevs. dst keeps its own; copying src's over
--         would make dst's profile depend on which row the operator picked.
--       * bev_flavor_profiles.inferred_from: left alone. src still exists, so
--         the foreign key holds; re-pointing it would claim a profile was
--         copied from a Bev it was not copied from, and nulling it is
--         forbidden by `bev_flavor_profiles_inferred_provenance`.
--       * ranking_events.bev_id (20261101000200, a sibling PR, not on main
--         yet): left alone, and deliberately not named in the body, so this
--         function works whether or not that table exists. It is an
--         append-only log that no code path updates; its bev_id is
--         diagnostics only ("what they ranked that day"), src still exists so
--         the foreign key holds, and the streak is computed from it -- which
--         is the other reason a merge must not touch it.
--
-- 10. THE ROWS THEMSELVES. src -> `status = 'merged', merged_into = dst` in
--     one UPDATE (`check ((status = 'merged') = (merged_into is not null))`
--     needs both at once). THEN, if dst has no UPC and src has one, dst takes
--     it: `bevs_upc_uq` is partial (`status <> 'merged'`), so src must leave
--     the index first or the copy would collide with it. If dst has no photo
--     (only a seeded Bev can be active without one) and src has one, dst takes
--     src's photo_path and thumb_path as a pair; and dst takes src's
--     nutrition label if it has none. Paths only: the storage objects stay
--     where they are, under src's creator's folder, which the public bucket
--     URL (`bev-photos` and `nutrition-labels` are public buckets) does not
--     care about. None of these columns is in the embed
--     trigger's column list (20261023000100) or the leaf-category guard's, so
--     neither fires.
--
-- 11. STATS. `refresh_bev_stats` over src, dst and every Bev whose score a
--     respace in step 3 moved (src ends with rating_count 0). Then, per user
--     locked in step 2, `refresh_user_stats`, which since 20261019000100 also
--     runs `refresh_user_category_stats` (a re-pointed ranking can change
--     category if the pair straddled two). `bayes_score` and `global_stats`
--     are left to the 15-minute `refresh-global-stats` cron, as every ranking
--     RPC leaves them.
--     NOT `touch_streak`, deliberately. A merge only ever removes rankings or
--     re-points them with their `ranked_at` intact, and DEVELOPMENT-ARJUN.md
--     section 5.10 is explicit that removals never break a streak --
--     remove_ranking does not call it for that reason. On main today
--     `touch_streak` still derives the days from `rankings.ranked_at`, so
--     calling it here could take a day away from someone whose dropped src
--     ranking was their only one that day. Once 20261101000200 lands it reads
--     `ranking_events`, which a merge does not touch, and the call would be a
--     no-op; either way there is nothing for it to do.
--
-- 12. RETURN a jsonb summary for the Studio result pane:
--     { src, dst, rankingsMoved, rankingsDropped, wantToTryMoved,
--       aliasesAdded (moved from src + the new name alias, if it was new),
--       reportsResolved, edgesDeleted }.
--
-- DELIBERATELY LEFT ALONE: automatic merging of any kind; UPC scanning;
-- copying a dropped ranking's note onto the kept one; moving storage objects;
-- `submit_ranking` and `add_want_to_try` accepting a merged Bev's id from a
-- stale client (a sibling PR re-creates submit_ranking; once both land, a
-- follow-up can make them reject or redirect a merged id the way get_bev
-- now does); removing a merged SEEDED Bev from data/catalog (the regenerated
-- seed's upsert never touches `status`, so it keeps updating the merged row
-- harmlessly until someone takes it out of the CSV).

create or replace function public.merge_bev(p_src uuid, p_dst uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_src            public.bevs;
  v_dst            public.bevs;
  v_users          uuid[] := '{}';
  v_uid            uuid;
  v_grew           boolean;
  r                record;
  v_respaced_bevs  uuid[] := '{}';
  v_want_users     uuid[];
  v_alias          text;
  v_n              integer;
  v_moved          integer := 0;
  v_dropped        integer := 0;
  v_wants_moved    integer := 0;
  v_aliases_added  integer := 0;
  v_reports        integer := 0;
  v_edges          integer := 0;
begin
  -- 1. Validate --------------------------------------------------------------
  if p_src is null or p_dst is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = 'merge_bev: both p_src and p_dst are required';
  end if;
  if p_src = p_dst then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: p_src and p_dst are the same Bev (%s)', p_src);
  end if;

  perform pg_advisory_xact_lock(hashtext('merge_bev'));

  select * into v_src from public.bevs where id = p_src;
  if not found then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: no Bev %s (p_src)', p_src);
  end if;
  select * into v_dst from public.bevs where id = p_dst;
  if not found then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: no Bev %s (p_dst)', p_dst);
  end if;
  if v_src.status = 'merged' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: %s is already merged into %s', p_src, v_src.merged_into);
  end if;
  if v_dst.status = 'merged' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: %s is itself merged into %s; merge into %s instead',
                      p_dst, v_dst.merged_into, v_dst.merged_into),
      hint = format('select public.merge_bev(%L, %L);', p_src, v_dst.merged_into);
  end if;
  if v_dst.status <> 'active' then
    raise exception 'BEVI_VALIDATION' using errcode = '22023',
      detail = format('merge_bev: %s is %s, and only an active Bev can absorb another',
                      p_dst, v_dst.status);
  end if;

  -- 2. Lock every affected user's ranking path ------------------------------
  loop
    v_grew := false;
    for v_uid in
      select distinct rk.user_id
        from public.rankings rk
       where rk.bev_id in (p_src, p_dst)
         and not (rk.user_id = any (v_users))
       order by rk.user_id
    loop
      perform pg_advisory_xact_lock(hashtext('rank:' || v_uid::text));
      v_users := v_users || v_uid;
      v_grew := true;
    end loop;
    exit when not v_grew;
  end loop;

  -- 3. Rankings --------------------------------------------------------------
  -- Ranked both: drop the src ranking exactly as remove_ranking does.
  for r in
    select s.id, s.user_id, s.bucket, s.position
      from public.rankings s
     where s.bev_id = p_src
       and exists (select 1 from public.rankings d
                    where d.user_id = s.user_id and d.bev_id = p_dst)
     order by s.user_id
  loop
    delete from public.rankings where id = r.id;

    update public.rankings
       set position = position - 1, updated_at = now()
     where user_id = r.user_id and bucket = r.bucket and position > r.position;

    perform public.respace_bucket(r.user_id, r.bucket);

    v_respaced_bevs := v_respaced_bevs
      || array(select rk.bev_id from public.rankings rk
                where rk.user_id = r.user_id and rk.bucket = r.bucket);
    v_dropped := v_dropped + 1;
  end loop;

  -- Ranked only src: the same row now ranks dst.
  update public.rankings
     set bev_id = p_dst, updated_at = now()
   where bev_id = p_src;
  get diagnostics v_moved = row_count;

  -- 4. Comparisons -----------------------------------------------------------
  delete from public.comparisons
   where (winner_bev_id = p_src and loser_bev_id = p_dst)
      or (winner_bev_id = p_dst and loser_bev_id = p_src);
  update public.comparisons set winner_bev_id = p_dst where winner_bev_id = p_src;
  update public.comparisons set loser_bev_id  = p_dst where loser_bev_id  = p_src;

  -- 5. Want to Try -----------------------------------------------------------
  with moved as (
    update public.want_to_try w
       set bev_id = p_dst
     where w.bev_id = p_src
       and not exists (select 1 from public.want_to_try w2
                        where w2.user_id = w.user_id and w2.bev_id = p_dst)
       and not exists (select 1 from public.rankings rk
                        where rk.user_id = w.user_id and rk.bev_id = p_dst)
    returning w.user_id
  )
  select count(*)::int into v_wants_moved from moved;

  with dropped as (
    delete from public.want_to_try where bev_id = p_src returning user_id
  )
  select coalesce(array_agg(dropped.user_id), '{}') into v_want_users from dropped;

  update public.user_stats us
     set want_count = (select count(*) from public.want_to_try w where w.user_id = us.user_id),
         updated_at = now()
   where us.user_id = any (v_want_users);

  -- 6. Feed events -----------------------------------------------------------
  update public.feed_events set bev_id = p_dst where bev_id = p_src;

  -- 7. Aliases ---------------------------------------------------------------
  update public.bev_aliases
     set bev_id = p_dst, source = 'merge'
   where bev_id = p_src;
  get diagnostics v_n = row_count;
  v_aliases_added := v_n;

  v_alias := btrim(lower(unaccent(
    coalesce(v_src.brand, '') || ' ' || v_src.name || ' ' || coalesce(v_src.flavor, '')
  )));
  if v_alias <> '' then
    insert into public.bev_aliases (alias, bev_id, source)
    values (v_alias, p_dst, 'merge')
    on conflict (alias) do nothing;
    get diagnostics v_n = row_count;
    v_aliases_added := v_aliases_added + v_n;
  end if;

  -- 8. Reports ---------------------------------------------------------------
  update public.bev_reports
     set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
   where status = 'open'
     and (bev_id = p_src or (bev_id = p_dst and duplicate_of = p_src));
  get diagnostics v_reports = row_count;

  update public.bev_reports
     set duplicate_of = p_dst
   where duplicate_of = p_src
     and bev_id <> p_dst;

  -- 9. Every other reference -------------------------------------------------
  if exists (select 1 from public.featured_bevs where bev_id = p_dst) then
    delete from public.featured_bevs where bev_id = p_src;
  else
    update public.featured_bevs set bev_id = p_dst where bev_id = p_src;
  end if;

  delete from public.user_bev_predictions where bev_id = p_src;

  delete from public.bev_edges where src_bev_id = p_src or dst_bev_id = p_src;
  get diagnostics v_edges = row_count;

  update public.bevs
     set merged_into = p_dst, updated_at = now()
   where merged_into = p_src;

  -- 10. The rows themselves --------------------------------------------------
  update public.bevs
     set status = 'merged', merged_into = p_dst, updated_at = now()
   where id = p_src;

  if v_dst.upc is null and v_src.upc is not null then
    update public.bevs set upc = v_src.upc, updated_at = now() where id = p_dst;
  end if;
  if v_dst.photo_path is null and v_src.photo_path is not null then
    update public.bevs
       set photo_path = v_src.photo_path, thumb_path = v_src.thumb_path, updated_at = now()
     where id = p_dst;
  end if;
  if v_dst.nutrition_label_path is null and v_src.nutrition_label_path is not null then
    update public.bevs
       set nutrition_label_path = v_src.nutrition_label_path, updated_at = now()
     where id = p_dst;
  end if;

  -- 11. Stats ----------------------------------------------------------------
  perform public.refresh_bev_stats(array[p_src, p_dst] || v_respaced_bevs);

  foreach v_uid in array v_users loop
    perform public.refresh_user_stats(v_uid);
  end loop;

  -- 12. Summary --------------------------------------------------------------
  return jsonb_build_object(
    'src',             p_src,
    'dst',             p_dst,
    'rankingsMoved',   v_moved,
    'rankingsDropped', v_dropped,
    'wantToTryMoved',  v_wants_moved,
    'aliasesAdded',    v_aliases_added,
    'reportsResolved', v_reports,
    'edgesDeleted',    v_edges
  );
end;
$$;

comment on function public.merge_bev(uuid, uuid) is
  'S-13/A-12: folds Bev p_src into active Bev p_dst (rankings, comparisons, Want to Try, feed, aliases, reports, featured, edges, UPC/photo) and marks p_src merged. Never automatic: run by hand from Studio, usually by pasting pending_duplicate_reports.merge_sql. postgres/service_role only.';

-- `anon` and `authenticated` are named as well as PUBLIC because Supabase's
-- default privileges grant EXECUTE on every new function in `public` to anon,
-- authenticated and service_role directly, which a revoke from PUBLIC does
-- not touch (20261019000500 and 20261023000100 learned this). service_role
-- keeps its grant, stated explicitly so the intent is in the file.
alter function public.merge_bev(uuid, uuid) owner to postgres;
revoke execute on function public.merge_bev(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_bev(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. pending_duplicate_reports: the Studio queue
-- ---------------------------------------------------------------------------
-- Open `duplicate` reports, the pair the most people flagged first (then the
-- oldest), with both Bevs side by side and the call to paste. `merge_sql` is null when
-- the report names no original (every report from an app build before M-20):
-- the operator finds the original by hand, or dismisses the report.
--
-- Columns: report_id, reported_at, reporter_handle; bev_id, bev_name,
-- bev_brand, bev_flavor, bev_status (the reported Bev, the one that would go
-- away); original_id, original_name, original_brand, original_flavor,
-- original_status (null when the report names none); open_reports_for_pair
-- (open duplicate reports with the same (bev_id, duplicate_of), so three
-- people flagging one pair reads as one decision with weight 3); note;
-- merge_sql.
--
-- WHO CAN READ IT: postgres and the service role (Studio) only. Two locks,
-- either of which is enough on its own:
--   * `revoke all ... from public, anon, authenticated`, so PostgREST answers
--     a client's `from('pending_duplicate_reports')` with permission denied.
--     Supabase's default privileges grant every new relation in `public` to
--     anon and authenticated, so the revoke is not optional.
--   * `security_invoker = true`. A view runs with its OWNER's rights by
--     default, and the owner here owns bev_reports, so it would read every
--     row past RLS; with security_invoker it reads with the CALLER's rights,
--     so even a grant added by mistake later would only ever show a user
--     their own reports (bev_reports_select). It is also what Supabase's
--     database linter asks of every view in `public` (lint 0010). Postgres 17
--     (supabase/config.toml), so the option exists. Studio connects as
--     postgres, which owns the tables, so it still sees every row.

create view public.pending_duplicate_reports
with (security_invoker = true)
as
select r.id                                                  as report_id,
       r.created_at                                          as reported_at,
       p.handle                                              as reporter_handle,
       r.bev_id                                              as bev_id,
       b.name                                                as bev_name,
       b.brand                                               as bev_brand,
       b.flavor                                              as bev_flavor,
       b.status                                              as bev_status,
       r.duplicate_of                                        as original_id,
       o.name                                                as original_name,
       o.brand                                               as original_brand,
       o.flavor                                              as original_flavor,
       o.status                                              as original_status,
       (count(*) over (partition by r.bev_id, r.duplicate_of))::int
                                                             as open_reports_for_pair,
       r.note                                                as note,
       case
         when r.duplicate_of is not null
         then format('select public.merge_bev(%L, %L);', r.bev_id, r.duplicate_of)
       end                                                   as merge_sql
  from public.bev_reports r
  join public.profiles p on p.id = r.reporter_id
  join public.bevs b     on b.id = r.bev_id
  left join public.bevs o on o.id = r.duplicate_of
 where r.status = 'open'
   and r.reason = 'duplicate'
 order by open_reports_for_pair desc, r.created_at, r.id;

comment on view public.pending_duplicate_reports is
  'S-13/A-12: open duplicate reports for Studio, with a ready-to-paste merge_bev call. Readable by postgres/service_role only (revoked from anon and authenticated; security_invoker).';

revoke all on public.pending_duplicate_reports from public, anon, authenticated;
