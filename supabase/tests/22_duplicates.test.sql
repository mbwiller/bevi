-- S-13 + A-12 (20261101000500): report_bev's duplicate target, get_bev
-- following a merge, merge_bev, and the pending_duplicate_reports view.
--
-- What this file is for, in order: the grants (merge_bev and the view are
-- postgres/service_role only, which is the whole access model); report_bev's
-- new validation; the view, before and after a merge; merge_bev's guards; then
-- one merge of a realistic fixture and every table it touches; then get_bev
-- and search_bevs from a signed-in user's side, which is where a merge is
-- supposed to be invisible.
--
-- Fixture uuid prefix: ...0000000d12NN ("d12" for duplicates). Checked against
-- every file in supabase/tests/ on main (a1, b1..b2, c1..c3, d1..d6, e1..e3,
-- f1..f4, ffff, ff01..ff14, a16NN, ab0NN, be0NN, c13NN, ca0NN, ed0NN, 0dead)
-- and on the sibling branches (17_snapshot_edges_neighbours,
-- 18_ranking_events, 21_depth_guard_roots): d12NN collides with none.
--
-- The people:
--   d1201  adult  ranked src, T and dst in one LOVED bucket (src at 0, T at 1,
--                 dst at 2), compared src > dst and T > src
--   d1202  adult  ranked ONLY src (FINE, alone), compared src > T; has the
--                 feed event for it
--   d1203  adult  wants src; holds a cached prediction for src
--   d1204  15     the age case
--   d1205  adult  ranked dst and wants src (the want is dropped, not moved)
--   d1206  adult  wants src and dst (src's is dropped)
--
-- The Bevs: src, dst and T are the first three active seeded `water` Bevs by
-- name (C collation, then id), ALC the first active alcoholic one. This file
-- inserts d1291 (hidden), d1292 (already merged into dst), d1293 (merged into
-- src earlier: the chain merge_bev must flatten) and d1294 <-> d1295 (a cycle
-- made by hand, for get_bev's hop bound). Everything rolls back.
begin;
select plan(87);

-- ---------------------------------------------------------------------------
-- 1. Shape and grants
-- ---------------------------------------------------------------------------

select ok(to_regprocedure('public.merge_bev(uuid, uuid)') is not null,
          'merge_bev(uuid, uuid) exists');
select ok(to_regprocedure('public.report_bev(uuid, text, uuid, text)') is not null,
          'report_bev keeps its signature');
select ok(to_regprocedure('public.get_bev(uuid)') is not null,
          'get_bev keeps its signature');
select ok(to_regclass('public.pending_duplicate_reports') is not null,
          'pending_duplicate_reports exists');

select ok(not has_function_privilege('authenticated', 'public.merge_bev(uuid, uuid)', 'execute'),
          'authenticated cannot execute merge_bev');
select ok(not has_function_privilege('anon', 'public.merge_bev(uuid, uuid)', 'execute'),
          'anon cannot execute merge_bev');
select ok(has_function_privilege('service_role', 'public.merge_bev(uuid, uuid)', 'execute'),
          'service_role can');
select ok(not has_table_privilege('authenticated', 'public.pending_duplicate_reports', 'select'),
          'authenticated cannot select from pending_duplicate_reports');
select ok(not has_table_privilege('anon', 'public.pending_duplicate_reports', 'select'),
          'anon cannot either');
select ok(has_function_privilege('authenticated', 'public.report_bev(uuid, text, uuid, text)', 'execute'),
          'report_bev is still granted to authenticated');

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000d1201', 'pgtapdup1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000d1202', 'pgtapdup2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000d1203', 'pgtapdup3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000d1204', 'pgtapdup4@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000d1205', 'pgtapdup5@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000d1206', 'pgtapdup6@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-0000000d1201', '00000000-0000-4000-8000-0000000d1202',
              '00000000-0000-4000-8000-0000000d1203', '00000000-0000-4000-8000-0000000d1205',
              '00000000-0000-4000-8000-0000000d1206');
update public.profiles set birth_date = (current_date - interval '15 years')::date
 where id = '00000000-0000-4000-8000-0000000d1204';
set local bevi.rpc_bypass = 'false';

create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select case rn when 1 then 'src' when 2 then 'dst' else 'T' end, id
  from (select b.id, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'water' and b.status = 'active') s
 where rn <= 3;
insert into t_bevs (label, id)
select 'ALC', b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where c.is_alcoholic and b.status = 'active'
 order by b.name collate "C", b.id
 limit 1;
-- The authenticated-role sections read it (07_bev_of_period, 09 do the same).
grant select on t_bevs to authenticated;

select is((select count(*)::int from t_bevs), 4,
          'fixture: three active water Bevs and one alcoholic Bev from the seed');

-- `source = 'seed'` lets a Bev be active without a photo and keeps the embed
-- trigger quiet; none of these is active anyway.
insert into public.bevs (id, name, brand, category_id, price_tier, status, source)
values ('00000000-0000-4000-8000-0000000d1291', 'pgTAP Hidden Original', 'pgTAP', 'water', 1, 'hidden', 'seed'),
       ('00000000-0000-4000-8000-0000000d1295', 'pgTAP Cycle B', 'pgTAP', 'water', 1, 'hidden', 'seed');
insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
select '00000000-0000-4000-8000-0000000d1292', 'pgTAP Merged Into Dst', 'pgTAP', 'water', 1, 'merged', id, 'seed'
  from t_bevs where label = 'dst';
insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
select '00000000-0000-4000-8000-0000000d1293', 'pgTAP Merged Into Src', 'pgTAP', 'water', 1, 'merged', id, 'seed'
  from t_bevs where label = 'src';
insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
values ('00000000-0000-4000-8000-0000000d1294', 'pgTAP Cycle A', 'pgTAP', 'water', 1, 'merged',
        '00000000-0000-4000-8000-0000000d1295', 'seed');
update public.bevs
   set status = 'merged', merged_into = '00000000-0000-4000-8000-0000000d1294'
 where id = '00000000-0000-4000-8000-0000000d1295';

-- Rankings, written directly (09_leaderboard_parity does the same) with the
-- scores ranking_score gives each slot.
insert into public.rankings (id, user_id, bev_id, bucket, position, score)
select v.rid::uuid, v.uid::uuid, t.id, v.bucket::smallint, v.pos,
       public.ranking_score(v.bucket::smallint, v.pos, v.n)
  from (values
    ('00000000-0000-4000-8000-0000000d12a1', '00000000-0000-4000-8000-0000000d1201', 'src', 3, 0, 3),
    ('00000000-0000-4000-8000-0000000d12a2', '00000000-0000-4000-8000-0000000d1201', 'T',   3, 1, 3),
    ('00000000-0000-4000-8000-0000000d12a3', '00000000-0000-4000-8000-0000000d1201', 'dst', 3, 2, 3),
    ('00000000-0000-4000-8000-0000000d12b1', '00000000-0000-4000-8000-0000000d1202', 'src', 2, 0, 1),
    ('00000000-0000-4000-8000-0000000d12c1', '00000000-0000-4000-8000-0000000d1205', 'dst', 3, 0, 1)
  ) as v(rid, uid, label, bucket, pos, n)
  join t_bevs t on t.label = v.label;

insert into public.comparisons (user_id, submission_id, winner_bev_id, loser_bev_id)
select v.uid::uuid, gen_random_uuid(), w.id, l.id
  from (values
    ('00000000-0000-4000-8000-0000000d1201', 'src', 'dst'),
    ('00000000-0000-4000-8000-0000000d1201', 'T',   'src'),
    ('00000000-0000-4000-8000-0000000d1202', 'src', 'T')
  ) as v(uid, winner, loser)
  join t_bevs w on w.label = v.winner
  join t_bevs l on l.label = v.loser;

insert into public.want_to_try (user_id, bev_id)
select v.uid::uuid, t.id
  from (values
    ('00000000-0000-4000-8000-0000000d1203', 'src'),
    ('00000000-0000-4000-8000-0000000d1205', 'src'),
    ('00000000-0000-4000-8000-0000000d1206', 'src'),
    ('00000000-0000-4000-8000-0000000d1206', 'dst')
  ) as v(uid, label)
  join t_bevs t on t.label = v.label;

insert into public.feed_events (actor_id, kind, bev_id, ranking_id)
select v.uid::uuid, 'ranked', t.id, v.rid::uuid
  from (values
    ('00000000-0000-4000-8000-0000000d1201', 'src', '00000000-0000-4000-8000-0000000d12a1'),
    ('00000000-0000-4000-8000-0000000d1202', 'src', '00000000-0000-4000-8000-0000000d12b1')
  ) as v(uid, label, rid)
  join t_bevs t on t.label = v.label;

insert into public.user_bev_predictions (user_id, bev_id, predicted_score, model_version)
select '00000000-0000-4000-8000-0000000d1203', id, 7.50, 'pgtap'
  from t_bevs where label = 'src';

insert into public.featured_bevs (id, bev_id, title)
select '00000000-0000-4000-8000-0000000d12f1', id, 'pgTAP Featured'
  from t_bevs where label = 'src';

-- Two edges touching src and one that does not.
insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version)
select least(a.id, b.id), greatest(a.id, b.id), 0.5, '{}'::jsonb, 'pgtap'
  from (values ('src', 'dst'), ('src', 'T'), ('dst', 'T')) as v(x, y)
  join t_bevs a on a.label = v.x
  join t_bevs b on b.label = v.y;

-- The DETAIL of an error, for the two places the test needs more than the
-- SQLSTATE. Called as postgres (a pg_temp function is not something to hand
-- the authenticated role).
create function pg_temp.error_detail(p_sql text) returns text
language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  return '(no error)';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. report_bev
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000d1202", "role": "authenticated"}';

select lives_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'src'), 'duplicate',
                              (select id from t_bevs where label = 'dst'), null) $$,
  'a duplicate report naming a visible active original is accepted'
);
select throws_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'src'), 'other',
                              (select id from t_bevs where label = 'src'), null) $$,
  '22023', 'BEVI_VALIDATION',
  'naming the reported Bev as its own original is rejected'
);
select throws_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'src'), 'other',
                              '00000000-0000-4000-8000-0000000d1291', null) $$,
  '22023', 'BEVI_VALIDATION',
  'naming a hidden Bev is rejected'
);
select throws_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'src'), 'other',
                              '00000000-0000-4000-8000-0000000d1292', null) $$,
  '22023', 'BEVI_VALIDATION',
  'naming a merged Bev is rejected'
);
select throws_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'src'), 'other',
                              '00000000-0000-4000-8000-0000000d12ff', null) $$,
  '22023', 'BEVI_VALIDATION',
  'naming an id that is no Bev is rejected'
);
select throws_ok(
  $$ select public.report_bev('00000000-0000-4000-8000-0000000d12fe', 'other', null, null) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'reporting an id that is no Bev is not_found (it used to fail the FK with 23503)'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000d1201", "role": "authenticated"}';
select lives_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'src'), 'wrong_info', null, null) $$,
  'a report with no original still works (today''s app sends exactly this)'
);
select lives_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'T'), 'duplicate',
                              (select id from t_bevs where label = 'src'), null) $$,
  'd1201 flags T as a duplicate of src'
);
select lives_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'T'), 'other',
                              (select id from t_bevs where label = 'ALC'), null) $$,
  'an adult may name an alcoholic Bev as the original'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000d1204", "role": "authenticated"}';
select throws_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'src'), 'duplicate',
                              (select id from t_bevs where label = 'ALC'), null) $$,
  '22023', 'BEVI_VALIDATION',
  'an under-21 caller naming an alcoholic Bev gets the same error as for an unknown id'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000d1203", "role": "authenticated"}';
select lives_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'dst'), 'duplicate',
                              (select id from t_bevs where label = 'src'), null) $$,
  'd1203 flags it the other way round: dst as a duplicate of src'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000d1206", "role": "authenticated"}';
select lives_ok(
  $$ select public.report_bev((select id from t_bevs where label = 'src'), 'duplicate', null, null) $$,
  'd1206 flags src as a duplicate without naming the original'
);

-- The view is closed to a signed-in user, whatever they reported.
select throws_ok(
  $$ select count(*) from public.pending_duplicate_reports $$,
  '42501', null,
  'a signed-in user selecting from pending_duplicate_reports gets permission denied'
);
-- And so is merge_bev.
select throws_ok(
  $$ select public.merge_bev((select id from t_bevs where label = 'src'),
                             (select id from t_bevs where label = 'dst')) $$,
  '42501', null,
  'a signed-in user calling merge_bev gets permission denied'
);

reset role;

select is(
  (select r.duplicate_of from public.bev_reports r
    where r.reporter_id = '00000000-0000-4000-8000-0000000d1202' and r.reason = 'duplicate'),
  (select id from t_bevs where label = 'dst'),
  'the original is stored in bev_reports.duplicate_of'
);
select is(
  (select count(*)::int from public.bev_reports r
    where r.reporter_id = '00000000-0000-4000-8000-0000000d1201' and r.reason = 'wrong_info'
      and r.duplicate_of is null),
  1,
  'the report without an original has duplicate_of null'
);

-- packages/api turns DETAIL 'duplicateOfId' into { field: 'duplicateOfId' }.
-- Run as postgres with d1202's claims still in place, so auth.uid() is set.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000d1202", "role": "authenticated"}';
select is(
  pg_temp.error_detail($$ select public.report_bev((select id from t_bevs where label = 'src'), 'other',
                                                   (select id from t_bevs where label = 'src'), null) $$),
  'duplicateOfId',
  'the self case carries detail duplicateOfId'
);
select is(
  pg_temp.error_detail($$ select public.report_bev((select id from t_bevs where label = 'src'), 'other',
                                                   '00000000-0000-4000-8000-0000000d1291', null) $$),
  'duplicateOfId',
  'and so does the not-visible case'
);

-- ---------------------------------------------------------------------------
-- 3. pending_duplicate_reports, before the merge (as postgres = Studio)
-- ---------------------------------------------------------------------------

select is(
  (select v.merge_sql from public.pending_duplicate_reports v
    where v.bev_id = (select id from t_bevs where label = 'src')
      and v.original_id = (select id from t_bevs where label = 'dst')),
  format('select public.merge_bev(%L, %L);',
         (select id from t_bevs where label = 'src'), (select id from t_bevs where label = 'dst')),
  'the view lists the open duplicate report with a ready-to-paste merge_bev call'
);
select is(
  (select v.reporter_handle from public.pending_duplicate_reports v
    where v.bev_id = (select id from t_bevs where label = 'src')
      and v.original_id = (select id from t_bevs where label = 'dst')),
  (select handle from public.profiles where id = '00000000-0000-4000-8000-0000000d1202'),
  'with the reporter''s handle'
);
select is(
  (select v.open_reports_for_pair from public.pending_duplicate_reports v
    where v.bev_id = (select id from t_bevs where label = 'src')
      and v.original_id = (select id from t_bevs where label = 'dst')),
  1,
  'and the number of open reports for that pair'
);
select ok(
  (select v.merge_sql is null and v.original_id is null and v.original_name is null
     from public.pending_duplicate_reports v
    where v.reporter_handle = (select handle from public.profiles
                                where id = '00000000-0000-4000-8000-0000000d1206')),
  'a report with no original is listed with a null merge_sql'
);
select is(
  (select count(*)::int from public.pending_duplicate_reports v
    where v.reporter_handle = (select handle from public.profiles
                                where id = '00000000-0000-4000-8000-0000000d1201')),
  1,
  'only duplicate reports are listed (d1201''s wrong_info and other reports are not)'
);

-- ---------------------------------------------------------------------------
-- 4. merge_bev's guards (as postgres, with no JWT, as from Studio)
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{}';

select throws_ok(
  $$ select public.merge_bev((select id from t_bevs where label = 'src'),
                             (select id from t_bevs where label = 'src')) $$,
  '22023', 'BEVI_VALIDATION',
  'merging a Bev into itself is rejected'
);
select throws_ok(
  $$ select public.merge_bev((select id from t_bevs where label = 'src'),
                             '00000000-0000-4000-8000-0000000d1292') $$,
  '22023', 'BEVI_VALIDATION',
  'merging into a merged Bev is rejected'
);
select ok(
  strpos(pg_temp.error_detail($$ select public.merge_bev((select id from t_bevs where label = 'src'),
                                                         '00000000-0000-4000-8000-0000000d1292') $$),
         (select id from t_bevs where label = 'dst')::text) > 0,
  'and the error names the Bev it was merged into, so the operator merges into that instead'
);
select throws_ok(
  $$ select public.merge_bev((select id from t_bevs where label = 'src'),
                             '00000000-0000-4000-8000-0000000d1291') $$,
  '22023', 'BEVI_VALIDATION',
  'merging into a hidden Bev is rejected'
);
select throws_ok(
  $$ select public.merge_bev('00000000-0000-4000-8000-0000000d12fe',
                             (select id from t_bevs where label = 'dst')) $$,
  '22023', 'BEVI_VALIDATION',
  'merging an id that is no Bev is rejected'
);

-- ---------------------------------------------------------------------------
-- 5. The merge
-- ---------------------------------------------------------------------------

-- What depends on the seed rather than on this file, captured first.
-- src_form is the alias merge_bev should add: the same expression as the
-- query side of find_similar_bevs (20261012000700).
create temporary table t_before on commit drop as
with f as (
  select b.id, b.upc,
         btrim(lower(unaccent(coalesce(b.brand, '') || ' ' || b.name || ' ' || coalesce(b.flavor, ''))))
           as src_form
    from public.bevs b
   where b.id = (select id from t_bevs where label = 'src')
)
select f.src_form,
       (select count(*)::int from public.bev_aliases a where a.bev_id = f.id)        as src_aliases,
       (select count(*)::int from public.bev_aliases a where a.alias = f.src_form)   as form_taken,
       f.upc                                                                          as src_upc,
       (select d.upc from public.bevs d
         where d.id = (select id from t_bevs where label = 'dst'))                    as dst_upc
  from f;
grant select on t_before to authenticated;

select is(
  (select count(*)::int from public.bev_aliases a, t_before t
    where a.alias = t.src_form
      and a.bev_id <> (select id from t_bevs where label = 'src')),
  0,
  'precondition: src''s search form is not already some other Bev''s alias'
);
select is(
  (select count(*)::int from public.featured_bevs f
    where f.bev_id = (select id from t_bevs where label = 'dst')),
  0,
  'precondition: dst is not featured, so src''s featured row should move'
);

create temporary table t_merge on commit drop as
select public.merge_bev((select id from t_bevs where label = 'src'),
                        (select id from t_bevs where label = 'dst')) as summary;

select is(
  (select summary from t_merge),
  jsonb_build_object(
    'src',             (select id from t_bevs where label = 'src'),
    'dst',             (select id from t_bevs where label = 'dst'),
    'rankingsMoved',   1,   -- d1202
    'rankingsDropped', 1,   -- d1201
    'wantToTryMoved',  1,   -- d1203
    -- src's own aliases move; its name adds one more unless it already was one of them
    'aliasesAdded',    (select src_aliases + case when form_taken = 0 then 1 else 0 end from t_before),
    'reportsResolved', 4,   -- d1202, d1201 (wrong_info), d1206 on src; d1203 on dst naming src
    'edgesDeleted',    2
  ),
  'the summary counts what moved'
);

-- Rankings: d1201 ranked both.
select is(
  (select count(*)::int from public.rankings
    where user_id = '00000000-0000-4000-8000-0000000d1201'
      and bev_id = (select id from t_bevs where label = 'src')),
  0,
  'd1201 no longer ranks src'
);
select is(
  (select count(*)::int from public.rankings
    where user_id = '00000000-0000-4000-8000-0000000d1201'
      and bev_id = (select id from t_bevs where label = 'dst')),
  1,
  'd1201 still ranks dst, once'
);
select is(
  (select array_agg(r.position order by r.position) from public.rankings r
    where r.user_id = '00000000-0000-4000-8000-0000000d1201' and r.bucket = 3),
  array[0, 1],
  'd1201''s bucket closed the gap: positions 0..n-1'
);
select is(
  (select array_agg(r.bev_id order by r.position) from public.rankings r
    where r.user_id = '00000000-0000-4000-8000-0000000d1201' and r.bucket = 3),
  array[(select id from t_bevs where label = 'T'), (select id from t_bevs where label = 'dst')],
  'in the same order as before, T then dst'
);
select is(
  (select count(*)::int from public.rankings r
    where r.user_id = '00000000-0000-4000-8000-0000000d1201' and r.bucket = 3
      and r.score <> public.ranking_score(r.bucket, r.position,
                       (select count(*)::int from public.rankings r2
                         where r2.user_id = r.user_id and r2.bucket = r.bucket))),
  0,
  'and every score is ranking_score(bucket, position, n) again'
);

-- Rankings: d1202 ranked only src.
select is(
  (select bev_id from public.rankings where id = '00000000-0000-4000-8000-0000000d12b1'),
  (select id from t_bevs where label = 'dst'),
  'd1202''s ranking keeps its id and now ranks dst'
);
select ok(
  (select bucket = 2 and position = 0 and score = public.ranking_score(2::smallint, 0, 1)
     from public.rankings where id = '00000000-0000-4000-8000-0000000d12b1'),
  'with its bucket, position and score untouched'
);
select is(
  (select count(*)::int from public.rankings where bev_id = (select id from t_bevs where label = 'src')),
  0,
  'nobody ranks src any more'
);

-- Comparisons.
select is(
  (select count(*)::int from public.comparisons c
    where (select id from t_bevs where label = 'src') in (c.winner_bev_id, c.loser_bev_id)),
  0,
  'no comparison names src'
);
select is(
  (select count(*)::int from public.comparisons where winner_bev_id = loser_bev_id),
  0,
  'and none compares a Bev with itself'
);
select is(
  (select count(*)::int from public.comparisons c
    where c.user_id = '00000000-0000-4000-8000-0000000d1201'),
  1,
  'd1201''s src-vs-dst comparison is gone, the T-vs-src one survives'
);
select ok(
  exists (select 1 from public.comparisons c
           where c.user_id = '00000000-0000-4000-8000-0000000d1202'
             and c.winner_bev_id = (select id from t_bevs where label = 'dst')
             and c.loser_bev_id  = (select id from t_bevs where label = 'T')),
  'd1202''s src > T is now dst > T'
);

-- Want to Try.
select is(
  (select array_agg(w.bev_id) from public.want_to_try w
    where w.user_id = '00000000-0000-4000-8000-0000000d1203'),
  array[(select id from t_bevs where label = 'dst')],
  'd1203''s want moved from src to dst'
);
select is(
  (select count(*)::int from public.want_to_try w
    where w.user_id = '00000000-0000-4000-8000-0000000d1205'),
  0,
  'd1205 ranked dst, so their src want is dropped rather than moved'
);
select is(
  (select count(*)::int from public.want_to_try w
    where w.user_id = '00000000-0000-4000-8000-0000000d1201'),
  0,
  'd1201 gained no want'
);
select is(
  (select array_agg(w.bev_id) from public.want_to_try w
    where w.user_id = '00000000-0000-4000-8000-0000000d1206'),
  array[(select id from t_bevs where label = 'dst')],
  'd1206 keeps one want, on dst'
);
select is(
  (select want_count from public.user_stats where user_id = '00000000-0000-4000-8000-0000000d1206'),
  1,
  'and their want_count is recomputed'
);

-- Feed, predictions, featured, edges.
select is(
  (select count(*)::int from public.feed_events where bev_id = (select id from t_bevs where label = 'src')),
  0,
  'no feed event names src'
);
select is(
  (select bev_id from public.feed_events
    where ranking_id = '00000000-0000-4000-8000-0000000d12b1'),
  (select id from t_bevs where label = 'dst'),
  'd1202''s post now shows dst'
);
select is(
  (select count(*)::int from public.feed_events
    where ranking_id = '00000000-0000-4000-8000-0000000d12a1'),
  0,
  'd1201''s post of the dropped ranking went with it'
);
select is(
  (select count(*)::int from public.user_bev_predictions
    where bev_id = (select id from t_bevs where label = 'src')),
  0,
  'cached predictions for src are gone'
);
select is(
  (select bev_id from public.featured_bevs where id = '00000000-0000-4000-8000-0000000d12f1'),
  (select id from t_bevs where label = 'dst'),
  'src''s featured row now features dst'
);
select is(
  (select count(*)::int from public.bev_edges e
    where (select id from t_bevs where label = 'src') in (e.src_bev_id, e.dst_bev_id)),
  0,
  'bev_edges has no row touching src'
);
select is(
  (select count(*)::int from public.bev_edges e
    where e.src_bev_id = least((select id from t_bevs where label = 'dst'), (select id from t_bevs where label = 'T'))
      and e.dst_bev_id = greatest((select id from t_bevs where label = 'dst'), (select id from t_bevs where label = 'T'))),
  1,
  'and the dst-T edge is untouched'
);

-- Aliases.
select ok(
  exists (select 1 from public.bev_aliases a, t_before t
           where a.alias = t.src_form
             and a.bev_id = (select id from t_bevs where label = 'dst')
             and a.source = 'merge'),
  'src''s search form is now an alias of dst, source merge'
);
select is(
  (select count(*)::int from public.bev_aliases a
    where a.bev_id = (select id from t_bevs where label = 'src')),
  0,
  'src keeps no alias (its seed aliases moved to dst)'
);

-- Reports.
select is(
  (select count(*)::int from public.bev_reports r
    where r.bev_id = (select id from t_bevs where label = 'src') and r.status = 'open'),
  0,
  'every open report on src is resolved'
);
select ok(
  (select r.status = 'resolved' and r.resolved_at is not null and r.resolved_by is null
     from public.bev_reports r
    where r.reporter_id = '00000000-0000-4000-8000-0000000d1203'),
  'the report of dst naming src is resolved too (resolved_by null: no JWT, as from Studio)'
);
select ok(
  (select r.status = 'open' and r.duplicate_of = (select id from t_bevs where label = 'dst')
     from public.bev_reports r
    where r.reporter_id = '00000000-0000-4000-8000-0000000d1201' and r.reason = 'duplicate'),
  'the report of T naming src now names dst, and stays open'
);

-- The rows.
select ok(
  (select b.status = 'merged' and b.merged_into = (select id from t_bevs where label = 'dst')
     from public.bevs b where b.id = (select id from t_bevs where label = 'src')),
  'src is merged into dst'
);
select is(
  (select merged_into from public.bevs where id = '00000000-0000-4000-8000-0000000d1293'),
  (select id from t_bevs where label = 'dst'),
  'an earlier merge into src is re-pointed at dst, so every redirect stays one hop'
);
select is(
  (select upc from public.bevs where id = (select id from t_bevs where label = 'dst')),
  (select coalesce(dst_upc, src_upc) from t_before),
  'dst keeps its UPC, or takes src''s if it had none'
);

-- Stats.
select is(
  (select rating_count from public.bev_stats where bev_id = (select id from t_bevs where label = 'src')),
  0,
  'src''s stats are refreshed to no ratings'
);
select is(
  (select rating_count from public.bev_stats where bev_id = (select id from t_bevs where label = 'dst')),
  (select count(*)::int from public.rankings where bev_id = (select id from t_bevs where label = 'dst')),
  'dst''s stats count every ranking it now has'
);
select is(
  (select rating_count from public.user_stats where user_id = '00000000-0000-4000-8000-0000000d1201'),
  2,
  'd1201''s user_stats are refreshed'
);

-- The deferred unique (user_id, bucket, position) is only checked at commit,
-- and this file rolls back, so force the check now.
select lives_ok($$ set constraints all immediate $$,
                'every deferred constraint holds after the merge');

select throws_ok(
  $$ select public.merge_bev((select id from t_bevs where label = 'src'),
                             (select id from t_bevs where label = 'dst')) $$,
  '22023', 'BEVI_VALIDATION',
  'running the same merge twice is rejected: src is already merged'
);

-- The view after the merge.
select is(
  (select count(*)::int from public.pending_duplicate_reports v
    where (select id from t_bevs where label = 'src') in (v.bev_id, v.original_id)),
  0,
  'the view no longer lists anything involving src'
);
select is(
  (select v.merge_sql from public.pending_duplicate_reports v
    where v.bev_id = (select id from t_bevs where label = 'T')),
  format('select public.merge_bev(%L, %L);',
         (select id from t_bevs where label = 'T'), (select id from t_bevs where label = 'dst')),
  'T''s report now offers merging T into dst'
);

-- ---------------------------------------------------------------------------
-- 6. What a signed-in user sees
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000d1201", "role": "authenticated"}';

select is(
  (select g.id from public.get_bev((select id from t_bevs where label = 'src')) g),
  (select id from t_bevs where label = 'dst'),
  'get_bev(src) returns dst: an old link lands on the surviving Bev'
);
select is(
  (select g.status from public.get_bev((select id from t_bevs where label = 'src')) g),
  'active',
  'as an active Bev'
);
select is(
  (select g.id from public.get_bev('00000000-0000-4000-8000-0000000d1293') g),
  (select id from t_bevs where label = 'dst'),
  'a Bev merged into src earlier lands on dst too'
);
select throws_ok(
  $$ select * from public.get_bev('00000000-0000-4000-8000-0000000d1294') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'a merge cycle made by hand is not_found, not an endless loop'
);
select ok(
  exists (select 1 from public.search_bevs((select src_form from t_before), null, 50) s
           where s.id = (select id from t_bevs where label = 'dst')),
  'searching src''s name finds dst'
);
select ok(
  not exists (select 1 from public.search_bevs((select src_form from t_before), null, 50) s
               where s.id = (select id from t_bevs where label = 'src')),
  'and never src'
);

reset role;

select * from finish();
rollback;
