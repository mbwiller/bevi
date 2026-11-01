-- S-21 + Stage 4 (20261101000100): the two keys get_prediction_snapshot()
-- gained, `edges` and `userNeighbors`, and that nothing else changed.
--
-- What this file is for, in order: both keys are arrays and `[]` (never null)
-- for a viewer with nothing; `edges` is every bev_edges row touching a Bev the
-- viewer ranked with both endpoints visible, as [src, dst, w] in (src, dst)
-- order, with the hidden-Bev and the age gates applied to the OTHER endpoint;
-- `userNeighbors` is the viewer's own user_neighbors rows as [alias, sim,
-- common], sim desc, aliased exactly as in `users` and `rankings`, with no
-- version filter, a rankingless neighbour dropped, and no neighbour's uuid
-- anywhere in the payload; every pre-existing key is still there; and the
-- grants are unchanged (anon cannot call it, a session without a user cannot).
--
-- Every snapshot is taken as the signed-in user and stored in t_snap; the
-- assertions then read t_snap as the owner, because they need to compare with
-- rankings and bev_edges, which `authenticated` cannot read in full.
--
-- Fixture uuid prefix: ...0000000b21NN ("b21" for S-21). Checked against every
-- other file in supabase/tests/: 02..10 use a1, b1..b2, c1..c3, d1..d6,
-- e1..e3, f1..f4, ff14 and ffff; 09_leaderboard_parity ab001..ab006 and
-- ab011..ab013; 11_graph_tables ed0NN; 12_embed_webhook be001, be002, be0a1;
-- 13_flavor_inference d11a1NN..d11a401; 14_graph_edge_writer ed7a0NN and
-- fffffff; 15_category_hierarchy c1301 and ca0NN; 16_taste_graph a16NN; 15 and
-- 16 also dead. b21NN collides with none (03's b1/b2 are ...0000000000b1/b2).
--
-- The people:
--   b2101  adult (30)  the viewer; ranks A and B
--   b2102  adult (30)  b2101's neighbour (sim 0.8, version 1.6.0); ranks A, B, C;
--                      owns rows of their own (-> b2101, -> b2106)
--   b2103  adult (30)  ranks C and D; nobody's neighbour
--   b2104  minor (16)  ranks A; the age gate on the other endpoint
--   b2105  adult (30)  b2101's neighbour (sim 0.99) with NO rankings: dropped
--   b2106  adult (30)  b2101's neighbour (sim 0.95, version 1.3.0); ranks A, C
--
-- The Bevs (real catalog rows from 20261026000200, picked by id so the choice
-- is the same on every `db reset`): A, B, C, D, E non-alcoholic and active,
-- E then set status 'hidden'; X the first alcoholic one.
--
-- The edges, stored least/greatest as bev_edges requires:
--   A-B 0.75    both ranked by the viewer          -> in
--   A-C 0.9001  one ranked endpoint                -> in, weight checked
--   B-D 0.5     one ranked endpoint                -> in
--   C-D 0.8     touches nothing the viewer ranked  -> out
--   A-E 0.99    other endpoint hidden              -> out
--   A-X 0.97    other endpoint alcoholic           -> in for b2101, out for b2104
begin;
select plan(34);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000b2101', 'pgtaps21a@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b2102', 'pgtaps21b@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b2103', 'pgtaps21c@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b2104', 'pgtaps21d@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b2105', 'pgtaps21e@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000b2106', 'pgtaps21f@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date silently unless the trusted-RPC
-- bypass is on; without it nobody is adult and the age gate passes for the
-- wrong reason.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-0000000b2101',
              '00000000-0000-4000-8000-0000000b2102',
              '00000000-0000-4000-8000-0000000b2103',
              '00000000-0000-4000-8000-0000000b2105',
              '00000000-0000-4000-8000-0000000b2106');
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000b2104';
set local bevi.rpc_bypass = 'false';

create temporary table t_people (label text primary key, id uuid not null) on commit drop;
insert into t_people (label, id) values
  ('viewer', '00000000-0000-4000-8000-0000000b2101'),
  ('nb',     '00000000-0000-4000-8000-0000000b2102'),
  ('loner',  '00000000-0000-4000-8000-0000000b2103'),
  ('minor',  '00000000-0000-4000-8000-0000000b2104'),
  ('ghost',  '00000000-0000-4000-8000-0000000b2105'),
  ('old',    '00000000-0000-4000-8000-0000000b2106');

-- ---------------------------------------------------------------------------
-- Bevs
-- ---------------------------------------------------------------------------

create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;

-- Numbered OUTSIDE the offset/limit subquery: inside it, row_number() runs
-- before OFFSET and would number these 21..25.
insert into t_bevs (label, id)
select (array['A', 'B', 'C', 'D', 'E'])[y.rn], y.id
  from (
    select x.id, (row_number() over (order by x.id))::int as rn
      from (
        select b.id
          from public.bevs b
          join public.categories c on c.id = b.category_id
         where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
         order by b.id
         offset 20 limit 5
      ) x
  ) y;

insert into t_bevs (label, id)
select 'X', b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and c.is_alcoholic
 order by b.id limit 1;

-- Snapshots, written as the signed-in user, read back as the owner.
create temporary table t_snap (label text primary key, j jsonb not null) on commit drop;
grant insert, select on t_snap to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Nothing yet: no rankings, no neighbour rows. Both keys exist, are arrays
--    and are `[]`, never null.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2101", "role": "authenticated"}';
insert into t_snap (label, j) values ('empty', public.get_prediction_snapshot());
reset role;

select is((select jsonb_typeof(j -> 'edges') from t_snap where label = 'empty'), 'array',
          'edges is a JSON array for a viewer with no rankings');
select is((select jsonb_typeof(j -> 'userNeighbors') from t_snap where label = 'empty'), 'array',
          'userNeighbors is a JSON array for a viewer with no neighbour rows');
select is((select j -> 'edges' from t_snap where label = 'empty'), '[]'::jsonb,
          'and edges is [] (coalesced, not null)');
select is((select j -> 'userNeighbors' from t_snap where label = 'empty'), '[]'::jsonb,
          'and userNeighbors is [] (coalesced, not null)');
select ok((select j ?& array['generatedAt', 'viewer', 'global', 'users', 'categoryStats', 'bevs', 'rankings']
             from t_snap where label = 'empty'),
          'every pre-existing key is still present in the empty snapshot');

-- ---------------------------------------------------------------------------
-- The data, written as the owner (the nightly jobs write as the service role)
-- ---------------------------------------------------------------------------

update public.bevs set status = 'hidden' where id = (select id from t_bevs where label = 'E');

insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
select p.id, b.id, v.bucket::smallint, v.pos, v.score::numeric(4,2), now()
  from (values ('viewer', 'A', 3, 0, 8.00), ('viewer', 'B', 2, 0, 6.00),
               ('nb',     'A', 3, 0, 8.50), ('nb',     'B', 3, 1, 7.50), ('nb', 'C', 2, 0, 5.00),
               ('loner',  'C', 3, 0, 9.00), ('loner',  'D', 1, 0, 2.00),
               ('minor',  'A', 3, 0, 7.00),
               ('old',    'A', 3, 0, 9.00), ('old',    'C', 1, 0, 3.00)) v(who, bev, bucket, pos, score)
  join t_people p on p.label = v.who
  join t_bevs b on b.label = v.bev;

insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version)
select least(a.id, b.id), greatest(a.id, b.id), v.w::numeric,
       '{"tree": 1, "content": 0.8, "emb": 0.9, "profile": 1, "cop": 0}'::jsonb, '1.6.0'
  from (values ('A', 'B', 0.75), ('A', 'C', 0.9001), ('B', 'D', 0.5),
               ('C', 'D', 0.8),  ('A', 'E', 0.99),   ('A', 'X', 0.97)) v(l1, l2, w)
  join t_bevs a on a.label = v.l1
  join t_bevs b on b.label = v.l2;

insert into public.user_neighbors (user_id, neighbor_id, sim, common, shared_attrs, method, version)
select u.id, n.id, v.sim::numeric(5,4), v.common::smallint, v.attrs::smallint, v.method, v.version
  from (values ('viewer', 'nb',     0.8,  2, 0, 'pearson', '1.6.0'),
               ('viewer', 'old',    0.95, 1, 2, 'blend',   '1.3.0'),
               ('viewer', 'ghost',  0.99, 0, 3, 'attr',    '1.6.0'),
               ('nb',     'viewer', 0.8,  2, 0, 'pearson', '1.6.0'),
               ('nb',     'old',    0.4,  1, 2, 'blend',   '1.6.0'))
       v(owner, neighbour, sim, common, attrs, method, version)
  join t_people u on u.label = v.owner
  join t_people n on n.label = v.neighbour;

-- The aliasing rule of the function, restated: everyone with a ranking plus
-- the viewer, numbered by user id. Only the non-viewer entries are read.
create temporary table t_alias (id uuid primary key, alias text not null) on commit drop;
insert into t_alias (id, alias)
select r.user_id, 'u' || row_number() over (order by r.user_id)
  from (select distinct user_id from public.rankings
        union
        select '00000000-0000-4000-8000-0000000b2101'::uuid) r;

-- The three snapshots under test.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2101", "role": "authenticated"}';
insert into t_snap (label, j) values ('adult', public.get_prediction_snapshot());
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2104", "role": "authenticated"}';
insert into t_snap (label, j) values ('minor', public.get_prediction_snapshot());
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000b2102", "role": "authenticated"}';
insert into t_snap (label, j) values ('nb', public.get_prediction_snapshot());
reset role;

select is((select j -> 'viewer' ->> 'id' from t_snap where label = 'adult'),
          '00000000-0000-4000-8000-0000000b2101',
          'the adult snapshot is b2101''s');
select ok((select j ?& array['generatedAt', 'viewer', 'global', 'users', 'categoryStats', 'bevs', 'rankings',
                             'edges', 'userNeighbors']
             from t_snap where label = 'adult'),
          'with data, every pre-existing key and both new ones are present');

-- ---------------------------------------------------------------------------
-- 2. edges
-- ---------------------------------------------------------------------------

select is(
  (select j -> 'edges' from t_snap where label = 'adult'),
  (select jsonb_agg(jsonb_build_array(least(a.id, b.id), greatest(a.id, b.id), v.w::numeric)
                    order by least(a.id, b.id), greatest(a.id, b.id))
     from (values ('A', 'B', 0.75), ('A', 'C', 0.9001), ('B', 'D', 0.5), ('A', 'X', 0.97)) v(l1, l2, w)
     join t_bevs a on a.label = v.l1
     join t_bevs b on b.label = v.l2),
  'edges is exactly A-B, A-C, B-D and A-X as [src, dst, w], ordered by (src, dst)'
);
select is((select jsonb_array_length(j -> 'edges') from t_snap where label = 'adult'), 4,
          'four edges for the adult viewer');
select ok(
  not exists (select 1 from t_snap s, jsonb_array_elements(s.j -> 'edges') x
               where s.label = 'adult' and (jsonb_typeof(x) <> 'array' or jsonb_array_length(x) <> 3)),
  'every edge is a 3-element array'
);
select is(
  (select (x ->> 2)::numeric
     from t_snap s, jsonb_array_elements(s.j -> 'edges') x
    where s.label = 'adult'
      and (x ->> 0)::uuid = (select least(a.id, c.id) from t_bevs a, t_bevs c where a.label = 'A' and c.label = 'C')
      and (x ->> 1)::uuid = (select greatest(a.id, c.id) from t_bevs a, t_bevs c where a.label = 'A' and c.label = 'C')),
  0.9001::numeric,
  'w is the stored weight (A-C 0.9001)'
);
select is(
  (select j -> 'edges' from t_snap where label = 'adult'),
  (select jsonb_agg(x order by (x ->> 0)::uuid, (x ->> 1)::uuid)
     from t_snap s, jsonb_array_elements(s.j -> 'edges') x where s.label = 'adult'),
  'edges come back sorted by (src, dst)'
);
select ok(
  not exists (select 1 from t_snap s, jsonb_array_elements(s.j -> 'edges') x
               where s.label = 'adult'
                 and (x ->> 0)::uuid in (select id from t_bevs where label in ('C', 'D'))
                 and (x ->> 1)::uuid in (select id from t_bevs where label in ('C', 'D'))),
  'an edge touching none of the viewer''s ranked Bevs (C-D) is absent'
);
select is(
  (select position((select id::text from t_bevs where label = 'E') in (j -> 'edges')::text)
     from t_snap where label = 'adult'),
  0,
  'an edge whose other endpoint is hidden (A-E, the heaviest) is absent'
);
select ok(
  (select position((select id::text from t_bevs where label = 'X') in (j -> 'edges')::text) > 0
     from t_snap where label = 'adult'),
  'an adult gets the edge to an alcoholic Bev (A-X): the control for the next test'
);
select is(
  (select position((select id::text from t_bevs where label = 'X') in (j -> 'edges')::text)
     from t_snap where label = 'minor'),
  0,
  'an under-21 viewer does not get the edge to the alcoholic Bev'
);
select is(
  (select j -> 'edges' from t_snap where label = 'minor'),
  (select jsonb_agg(jsonb_build_array(least(a.id, b.id), greatest(a.id, b.id), v.w::numeric)
                    order by least(a.id, b.id), greatest(a.id, b.id))
     from (values ('A', 'B', 0.75), ('A', 'C', 0.9001)) v(l1, l2, w)
     join t_bevs a on a.label = v.l1
     join t_bevs b on b.label = v.l2),
  'the minor (who ranked only A) gets exactly A-B and A-C'
);

-- ---------------------------------------------------------------------------
-- 3. userNeighbors
-- ---------------------------------------------------------------------------

select is(
  (select j -> 'userNeighbors' from t_snap where label = 'adult'),
  jsonb_build_array(
    jsonb_build_array((select alias from t_alias where id = '00000000-0000-4000-8000-0000000b2106'), 0.95::numeric, 1),
    jsonb_build_array((select alias from t_alias where id = '00000000-0000-4000-8000-0000000b2102'), 0.8::numeric, 2)),
  'userNeighbors is [[alias, sim, common], ...] for the viewer''s ranked neighbours, sim desc'
);
select ok(
  not exists (select 1 from t_snap s, jsonb_array_elements(s.j -> 'userNeighbors') x
               where s.label = 'adult' and (jsonb_typeof(x) <> 'array' or jsonb_array_length(x) <> 3)),
  'every neighbour is a 3-element array'
);
select ok(
  (select (j -> 'userNeighbors' -> 0 ->> 1)::numeric > (j -> 'userNeighbors' -> 1 ->> 1)::numeric
     from t_snap where label = 'adult'),
  'ordered by sim desc, not by neighbour id (b2106 sorts after b2102)'
);
select is(
  (select j -> 'userNeighbors' -> 0 ->> 0 from t_snap where label = 'adult'),
  (select alias from t_alias where id = '00000000-0000-4000-8000-0000000b2106'),
  'a row stamped with a different version (1.3.0) is still returned: no version filter'
);
-- The alias the neighbour key gives b2102 must be the one `users` gives it:
-- b2102 is the only user with exactly three rankings in this fixture.
select is(
  (select u ->> 0
     from t_snap s, jsonb_array_elements(s.j -> 'users') u
    where s.label = 'adult' and u ->> 0 = s.j -> 'userNeighbors' -> 1 ->> 0),
  (select alias from t_alias where id = '00000000-0000-4000-8000-0000000b2102'),
  'the neighbour''s alias is the alias `users` gives b2102'
);
select is(
  (select (u ->> 1)::int
     from t_snap s, jsonb_array_elements(s.j -> 'users') u
    where s.label = 'adult' and u ->> 0 = s.j -> 'userNeighbors' -> 1 ->> 0),
  3,
  'and that `users` entry is b2102''s (n = 3)'
);
select is(
  (select count(*)::int
     from t_snap s, jsonb_array_elements(s.j -> 'rankings') r
    where s.label = 'adult' and r ->> 0 = s.j -> 'userNeighbors' -> 1 ->> 0),
  3,
  'and `rankings` carries b2102''s three rankings under the same alias'
);
select ok(
  not exists (select 1 from t_snap s, jsonb_array_elements(s.j -> 'userNeighbors') x
               where s.label = 'adult' and (x ->> 1)::numeric in (0.99, 0.4)),
  'neither the rankingless neighbour (0.99) nor another user''s row (b2102 -> b2106, 0.4) is returned'
);
select is(
  (select position('00000000-0000-4000-8000-0000000b2102' in j::text) from t_snap where label = 'adult'),
  0,
  'the neighbour b2102''s uuid appears nowhere in the payload'
);
select is(
  (select position('00000000-0000-4000-8000-0000000b2106' in j::text) from t_snap where label = 'adult'),
  0,
  'nor does the neighbour b2106''s'
);
select is(
  (select position('00000000-0000-4000-8000-0000000b2105' in j::text) from t_snap where label = 'adult'),
  0,
  'nor the rankingless neighbour b2105''s (dropped by the alias join)'
);
select is(
  (select position('00000000-0000-4000-8000-0000000b2103' in j::text) from t_snap where label = 'adult'),
  0,
  'nor b2103''s, who has rankings but is nobody''s neighbour'
);
select is(
  (select j -> 'userNeighbors' from t_snap where label = 'minor'),
  '[]'::jsonb,
  'a viewer with no neighbour rows gets [] even when others have rows'
);
-- The filter is per viewer, not "first viewer only": b2102 sees their own two
-- rows, and the viewer b2101 only as an alias.
select is(
  (select jsonb_agg((x ->> 1)::numeric order by ord)
     from t_snap s, jsonb_array_elements(s.j -> 'userNeighbors') with ordinality t(x, ord)
    where s.label = 'nb'),
  '[0.8, 0.4]'::jsonb,
  'b2102''s own snapshot carries b2102''s rows (0.8 then 0.4)'
);
select is(
  (select position('00000000-0000-4000-8000-0000000b2101' in j::text) from t_snap where label = 'nb'),
  0,
  'and b2101''s uuid appears nowhere in b2102''s payload'
);

-- ---------------------------------------------------------------------------
-- 4. Grants and the session guard, unchanged
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$ select public.get_prediction_snapshot() $$,
  '42501', null,
  'anon cannot call get_prediction_snapshot'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok(
  $$ select public.get_prediction_snapshot() $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'a session without a user is unauthorized'
);
reset role;

select * from finish();
rollback;
