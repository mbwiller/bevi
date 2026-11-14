-- Icon paths on every Bev read (20261112000300), contract 2.13.0.
--
-- For each function that migration re-creates: a Bev with a bev_icons row
-- returns that row's path in the new last column (`icon_path`, or
-- `bev_icon_path` where the columns are prefixed; the 14th element of each
-- `bevs` tuple in get_prediction_snapshot), and a Bev without one returns
-- null. Then the state the drops had to restore: the column is last, the
-- grants, owner, definer, pinned search_path and the two comments.
--
-- Fixture uuid prefix: ...0000000034NN (the file number). Checked against
-- every other file in supabase/tests/ and seed.sql: nothing else uses it.
--
-- THE PEOPLE, all adults:
--   me   01  follows ana: ana's posts are me's feed
--   ana  02  ranks both Bevs (a minute ago)
--   bob  03  ranks both Bevs; me does not follow bob, and with fewer than 20
--            profiles Explore's fallback (D-01) shows bob's posts to me
--   cy   04  ranked `plain` ten days ago, the only ranking that old, so
--            bev_of_period_at five days ago has `plain` as both winners
--
-- THE BEVS: three active, non-alcoholic seed Bevs. `icon` has a bev_icons
-- row, `plain` has none, `anchor` is the Bev whose "Bevs like this" lists
-- them both. Both are on one venue's assortment and both are featured. `icon`
-- is ranked 9.5 by ana and bob and `plain` 3.0, so `icon` wins today's day
-- and week.
--
-- bev_icons is written directly as the test's superuser. Whatever rows
-- 20261112000200 may seed, these three Bevs' rows are deleted first, so
-- `plain` and `anchor` have none and `icon` has exactly the one below. Its
-- path satisfies the table's CHECK (slug || '.' || left(sha256, 16) || '.svg');
-- `style_version` and `status` are copied from any other row when there is
-- one, so a value constraint on either holds by construction.
begin;
select plan(32);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create temporary table t_users (label text primary key, id uuid not null unique) on commit drop;
insert into t_users (label, id)
select v.label, ('00000000-0000-4000-8000-0000000034' || v.nn)::uuid
  from (values ('me', '01'), ('ana', '02'), ('bob', '03'), ('cy', '04')) v(label, nn);
grant select on t_users to authenticated;

insert into auth.users (id, email, raw_user_meta_data, aud, role)
select u.id, 'pgtapico' || right(u.id::text, 2) || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb, 'authenticated', 'authenticated'
  from t_users u;

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in (select id from t_users);
set local bevi.rpc_bypass = 'false';

insert into public.follows (follower_id, followee_id)
select a.id, b.id from t_users a, t_users b where a.label = 'me' and b.label = 'ana';

-- ---------------------------------------------------------------------------
-- Bevs and the one icon
-- ---------------------------------------------------------------------------

create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select l, (select b.id from public.bevs b
             join public.categories c on c.id = b.category_id
            where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
            order by b.name collate "C", b.id offset off limit 1)
  from (values ('icon', 0), ('plain', 1), ('anchor', 2)) v(l, off);
grant select on t_bevs to authenticated;

delete from public.bev_icons where bev_id in (select id from t_bevs);

insert into public.bev_icons (bev_id, slug, path, sha256, style_version, status)
select t.id, 'pgtap-icon', 'pgtap-icon.0123456789abcdef.svg',
       '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
       coalesce((select o.style_version from public.bev_icons o limit 1), '1'),
       coalesce((select o.status from public.bev_icons o limit 1), 'published')
  from t_bevs t
 where t.label = 'icon';

-- ---------------------------------------------------------------------------
-- Rankings, posts, stats, featured, edges, a venue
-- ---------------------------------------------------------------------------

insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select u.id, b.id, v.bucket::smallint, 0, v.score, now() - v.age
  from (values
    ('ana', 'icon',  3, 9.50, interval '1 minute'),
    ('ana', 'plain', 1, 3.00, interval '2 minutes'),
    ('bob', 'icon',  3, 9.50, interval '1 minute'),
    ('bob', 'plain', 1, 3.00, interval '2 minutes'),
    ('cy',  'plain', 1, 3.00, interval '10 days')
  ) v(who, bev, bucket, score, age)
  join t_users u on u.label = v.who
  join t_bevs b on b.label = v.bev;

-- A post for each of ana's and bob's rankings; cy's has none.
insert into public.feed_events (actor_id, kind, bev_id, ranking_id, created_at)
select r.user_id, 'ranked', r.bev_id, r.id, r.ranked_at
  from public.rankings r
 where r.user_id in (select id from t_users where label in ('ana', 'bob'))
 order by r.ranked_at, r.user_id;

-- `icon` has 2 raters and `plain` 3: both reach the leaderboard's floor of 2.
select public.refresh_bev_stats(array(select id from t_bevs));
select public.refresh_global_stats();

insert into public.featured_bevs (id, bev_id, title)
select ('00000000-0000-4000-8000-00000000341' || v.n)::uuid, t.id, 'pgTAP Featured ' || t.label
  from (values ('icon', '1'), ('plain', '2')) v(label, n)
  join t_bevs t on t.label = v.label;

insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version)
select least(a.id, b.id), greatest(a.id, b.id), v.w, '{}'::jsonb, 'pgtap'
  from (values ('icon', 0.9), ('plain', 0.8)) v(label, w)
  join t_bevs b on b.label = v.label
 cross join (select id from t_bevs where label = 'anchor') a;

insert into public.venues (id, name, kind, lat, lng, source)
values ('00000000-0000-4000-8000-000000003421', 'pgTAP Icon Deli', 'craft', 40.7740, -73.9560, 'manual');
insert into public.venue_bevs (venue_id, bev_id, source)
select '00000000-0000-4000-8000-000000003421'::uuid, id, 'menu'
  from t_bevs where label in ('icon', 'plain');

-- ---------------------------------------------------------------------------
-- Shape and the restored state
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.bev_icons where bev_id in (select id from t_bevs)),
  1,
  'fixture: of the three Bevs, only `icon` has a bev_icons row'
);

select is(
  (select count(*)::int
     from (values
       ('public.bev_of_period_at(timestamptz, boolean)', 'bev_icon_path'),
       ('public.get_bev_of_period()',                    'bev_icon_path'),
       ('public.get_bev(uuid)',                          'icon_path'),
       ('public.get_bev_leaderboard(text, int)',         'icon_path'),
       ('public.get_feed(int, bigint)',                  'bev_icon_path'),
       ('public.get_user_feed(uuid, int, bigint)',       'bev_icon_path'),
       ('public.get_explore(int, timestamptz, int)',     'bev_icon_path'),
       ('public.get_featured()',                         'bev_icon_path'),
       ('public.get_similar_bevs(uuid, int)',            'icon_path'),
       ('public.search_bevs(text, text, int)',           'icon_path'),
       ('public.venue_detail(uuid)',                     'bev_icon_path')
     ) v(fn, col)
    where pg_get_function_result(v.fn::regprocedure) ~ (', ' || v.col || ' text\)$')),
  11,
  'each of the eleven table functions ends with its icon column'
);

select ok(
  (select bool_and(has_function_privilege('authenticated', f, 'EXECUTE'))
     from unnest(array[
       'public.get_bev_of_period()', 'public.get_bev(uuid)', 'public.get_bev_leaderboard(text, int)',
       'public.get_feed(int, bigint)', 'public.get_user_feed(uuid, int, bigint)',
       'public.get_explore(int, timestamptz, int)', 'public.get_featured()',
       'public.get_similar_bevs(uuid, int)', 'public.search_bevs(text, text, int)',
       'public.venue_detail(uuid)', 'public.get_prediction_snapshot()']) f),
  'authenticated can still execute all eleven client RPCs'
);

select ok(
  (select bool_and(not has_function_privilege('anon', f, 'EXECUTE'))
     from unnest(array[
       'public.get_bev_of_period()', 'public.get_bev(uuid)', 'public.get_bev_leaderboard(text, int)',
       'public.get_feed(int, bigint)', 'public.get_user_feed(uuid, int, bigint)',
       'public.get_explore(int, timestamptz, int)', 'public.get_featured()',
       'public.get_similar_bevs(uuid, int)', 'public.search_bevs(text, text, int)',
       'public.venue_detail(uuid)', 'public.get_prediction_snapshot()']) f),
  'and anon still cannot execute any of them'
);

select ok(
  not has_function_privilege('authenticated', 'public.bev_of_period_at(timestamptz, boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.bev_of_period_at(timestamptz, boolean)', 'EXECUTE'),
  'bev_of_period_at is still callable by no client role'
);

select is(
  (select count(*)::int
     from pg_proc p
    where p.oid in ('public.get_bev_of_period()'::regprocedure,
                    'public.get_bev(uuid)'::regprocedure,
                    'public.get_bev_leaderboard(text, int)'::regprocedure,
                    'public.get_feed(int, bigint)'::regprocedure,
                    'public.get_user_feed(uuid, int, bigint)'::regprocedure,
                    'public.get_explore(int, timestamptz, int)'::regprocedure,
                    'public.get_featured()'::regprocedure,
                    'public.get_similar_bevs(uuid, int)'::regprocedure,
                    'public.search_bevs(text, text, int)'::regprocedure,
                    'public.venue_detail(uuid)'::regprocedure,
                    'public.get_prediction_snapshot()'::regprocedure)
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
      and exists (select 1 from unnest(p.proconfig) c(setting) where c.setting like 'search_path=%')),
  11,
  'all eleven are security definer, owned by postgres, with a pinned search_path'
);

select ok(
  (select not p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
     from pg_proc p where p.oid = 'public.bev_of_period_at(timestamptz, boolean)'::regprocedure),
  'bev_of_period_at is still security invoker, owned by postgres'
);

select ok(
  obj_description('public.get_explore(int, timestamptz, int)'::regprocedure, 'pg_proc') like 'Explore (A-04):%'
    and obj_description('public.get_similar_bevs(uuid, int)'::regprocedure, 'pg_proc') like 'S-14:%',
  'get_explore and get_similar_bevs kept their comments through the drop'
);

-- ---------------------------------------------------------------------------
-- bev_of_period_at, called directly as the superuser (07_bev_of_period does)
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(array[(bev_id = (select id from t_bevs where label = 'icon'))::text, bev_icon_path]
                    order by period)
     from public.bev_of_period_at(now(), true)),
  array[array['true', 'pgtap-icon.0123456789abcdef.svg'], array['true', 'pgtap-icon.0123456789abcdef.svg']],
  'bev_of_period_at: today''s day and week winner is `icon`, with its path'
);

select is(
  (select array_agg(array[(bev_id = (select id from t_bevs where label = 'plain'))::text,
                          coalesce(bev_icon_path, '<null>')]
                    order by period)
     from public.bev_of_period_at(now() - interval '5 days', true)),
  array[array['true', '<null>'], array['true', '<null>']],
  'bev_of_period_at: five days ago the winner is `plain`, with a null path'
);

-- ---------------------------------------------------------------------------
-- The client RPCs, as me
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003401", "role": "authenticated"}';

-- get_bev
select is((select icon_path from public.get_bev((select id from t_bevs where label = 'icon'))),
          'pgtap-icon.0123456789abcdef.svg', 'get_bev: a Bev with an icon returns its path');
select is((select icon_path from public.get_bev((select id from t_bevs where label = 'plain'))),
          null, 'get_bev: a Bev without one returns null');

-- search_bevs, by each Bev's own name
select is(
  (select s.icon_path
     from public.search_bevs((select b.name from public.bevs b join t_bevs t on t.id = b.id where t.label = 'icon'), null, 50) s
    where s.id = (select id from t_bevs where label = 'icon')),
  'pgtap-icon.0123456789abcdef.svg',
  'search_bevs: the Bev with an icon carries its path'
);
select is(
  (select count(*)::int
     from public.search_bevs((select b.name from public.bevs b join t_bevs t on t.id = b.id where t.label = 'plain'), null, 50) s
    where s.id = (select id from t_bevs where label = 'plain') and s.icon_path is null),
  1,
  'search_bevs: the Bev without one is found, with a null path'
);

-- get_similar_bevs, from the anchor
select is(
  (select s.icon_path from public.get_similar_bevs((select id from t_bevs where label = 'anchor'), 10) s
    where s.id = (select id from t_bevs where label = 'icon')),
  'pgtap-icon.0123456789abcdef.svg',
  'get_similar_bevs: the neighbour with an icon carries its path'
);
select is(
  (select count(*)::int from public.get_similar_bevs((select id from t_bevs where label = 'anchor'), 10) s
    where s.id = (select id from t_bevs where label = 'plain') and s.icon_path is null),
  1,
  'get_similar_bevs: the neighbour without one is listed, with a null path'
);

-- get_bev_leaderboard
select is(
  (select l.icon_path from public.get_bev_leaderboard(null, 50) l
    where l.id = (select id from t_bevs where label = 'icon')),
  'pgtap-icon.0123456789abcdef.svg',
  'get_bev_leaderboard: the Bev with an icon carries its path'
);
select is(
  (select count(*)::int from public.get_bev_leaderboard(null, 50) l
    where l.id = (select id from t_bevs where label = 'plain') and l.icon_path is null),
  1,
  'get_bev_leaderboard: the Bev without one is on the board, with a null path'
);

-- get_feed: ana's two posts
select is(
  (select f.bev_icon_path from public.get_feed(50, null) f
    where f.bev_id = (select id from t_bevs where label = 'icon')),
  'pgtap-icon.0123456789abcdef.svg',
  'get_feed: a post of the Bev with an icon carries its path'
);
select is(
  (select count(*)::int from public.get_feed(50, null) f
    where f.bev_id = (select id from t_bevs where label = 'plain') and f.bev_icon_path is null),
  1,
  'get_feed: a post of the Bev without one has a null path'
);

-- get_user_feed: ana's profile
select is(
  (select f.bev_icon_path from public.get_user_feed((select id from t_users where label = 'ana'), 50, null) f
    where f.bev_id = (select id from t_bevs where label = 'icon')),
  'pgtap-icon.0123456789abcdef.svg',
  'get_user_feed: a post of the Bev with an icon carries its path'
);
select is(
  (select count(*)::int from public.get_user_feed((select id from t_users where label = 'ana'), 50, null) f
    where f.bev_id = (select id from t_bevs where label = 'plain') and f.bev_icon_path is null),
  1,
  'get_user_feed: a post of the Bev without one has a null path'
);

-- get_explore: bob's two posts
select is(
  (select e.bev_icon_path from public.get_explore(50, null::timestamptz, 0) e
    where e.bev_id = (select id from t_bevs where label = 'icon')),
  'pgtap-icon.0123456789abcdef.svg',
  'get_explore: a post of the Bev with an icon carries its path'
);
select is(
  (select count(*)::int from public.get_explore(50, null::timestamptz, 0) e
    where e.bev_id = (select id from t_bevs where label = 'plain') and e.bev_icon_path is null),
  1,
  'get_explore: a post of the Bev without one has a null path'
);

-- get_featured
select is(
  (select f.bev_icon_path from public.get_featured() f
    where f.bev_id = (select id from t_bevs where label = 'icon')),
  'pgtap-icon.0123456789abcdef.svg',
  'get_featured: the featured Bev with an icon carries its path'
);
select is(
  (select count(*)::int from public.get_featured() f
    where f.bev_id = (select id from t_bevs where label = 'plain') and f.bev_icon_path is null),
  1,
  'get_featured: the featured Bev without one has a null path'
);

-- venue_detail
select is(
  (select v.bev_icon_path from public.venue_detail('00000000-0000-4000-8000-000000003421') v
    where v.bev_id = (select id from t_bevs where label = 'icon')),
  'pgtap-icon.0123456789abcdef.svg',
  'venue_detail: the Bev with an icon carries its path'
);
select is(
  (select count(*)::int from public.venue_detail('00000000-0000-4000-8000-000000003421') v
    where v.bev_id = (select id from t_bevs where label = 'plain') and v.bev_icon_path is null),
  1,
  'venue_detail: the Bev without one has a null path'
);

-- get_prediction_snapshot: the 14th element of each `bevs` tuple
select is(
  (select b ->> 13 from jsonb_array_elements(public.get_prediction_snapshot() -> 'bevs') b
    where b ->> 0 = (select id::text from t_bevs where label = 'icon')),
  'pgtap-icon.0123456789abcdef.svg',
  'get_prediction_snapshot: the tuple of the Bev with an icon ends with its path'
);
select is(
  (select jsonb_array_length(b)::text || ':' || (b -> 13)::text
     from jsonb_array_elements(public.get_prediction_snapshot() -> 'bevs') b
    where b ->> 0 = (select id::text from t_bevs where label = 'plain')),
  '14:null',
  'get_prediction_snapshot: the tuple of the Bev without one has 14 elements, the last a JSON null'
);

-- get_bev_of_period: today's winners are `icon`
select is(
  (select array_agg(bev_icon_path order by period) from public.get_bev_of_period()),
  array['pgtap-icon.0123456789abcdef.svg', 'pgtap-icon.0123456789abcdef.svg'],
  'get_bev_of_period: today''s winner carries its path, day and week'
);

-- Take the icon away (as the superuser: no client may write bev_icons) and
-- the same winner reads null: the column is read live, not cached anywhere.
reset role;
delete from public.bev_icons where bev_id = (select id from t_bevs where label = 'icon');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000003401", "role": "authenticated"}';

select is(
  (select array_agg(coalesce(bev_icon_path, '<null>') order by period)
     from public.get_bev_of_period()
    where bev_id = (select id from t_bevs where label = 'icon')),
  array['<null>', '<null>'],
  'get_bev_of_period: with no bev_icons row the same winner has a null path'
);

reset role;

select * from finish();
rollback;
