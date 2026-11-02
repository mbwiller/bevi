-- A-12 follow-up (20261102000100): resolve_bev_id, and the five write RPCs
-- that now follow a merge, plus the finished refresh_bev_stats revoke.
--
-- In order: (1) the shape and the grants -- resolve_bev_id is internal, and
-- refresh_bev_stats is no longer executable by `authenticated`, which is the
-- point of the first half of the migration; (2) resolve_bev_id itself, as
-- postgres: one hop, two hops, an id that does not exist, a cycle, and both
-- sides of the 8-hop bound; (3) get_bev, to show the refactor kept its
-- behaviour (22_duplicates covers it in full; these two assertions are the
-- ones the refactor could have broken); (4) the writes, from a signed-in user
-- holding a stale merged id -- the case the follow-up was raised for.
--
-- Section 4 is the whole reason for the migration: before it, a client that
-- had not refetched could rank, want or unwant the row `merge_bev` retired,
-- and the write succeeded against a Bev no read would ever show.
--
-- Fixture uuid prefix: ...0000000r23NN is not valid hex, so this file uses
-- ...000000023NN ("23" for the file). Checked against every other file in
-- supabase/tests/: a1, b1..b2, c1..c3, d1..d6, e1..e3, f1..f4, ffff,
-- ff01..ff14, dead, a14NN, a16NN, ab0NN, be0NN, c13NN, ca0NN, d11aNNN,
-- d12NN, ed0NN, ed7aNNN. 23NN collides with none.
--
-- The people:
--   2301  adult  holds a stale merged id for a Bev he has not ranked
--   2302  adult  ranked dst already (the re-rank, the remove and the
--                already-ranked guard)
--   2304  15     the age gate, which must still fire on the RESOLVED Bev
--
-- The Bevs: dst and T are the first two active seeded `water` Bevs by name
-- (C collation, then id), ALC the first active alcoholic one. This file
-- inserts M1 (merged into dst), M2 (merged into M1), MALC (merged into ALC),
-- C1 <-> C2 (a cycle), and H1..H9 (a chain of nine, H1 into dst). Everything
-- rolls back.
begin;
select plan(33);

-- ---------------------------------------------------------------------------
-- 1. Shape and grants
-- ---------------------------------------------------------------------------

select ok(to_regprocedure('public.resolve_bev_id(uuid)') is not null,
          'resolve_bev_id(uuid) exists');

select ok(
  not has_function_privilege('authenticated', 'public.resolve_bev_id(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.resolve_bev_id(uuid)', 'EXECUTE'),
  'resolve_bev_id is internal: neither anon nor authenticated can execute it'
);

select ok(
  not has_function_privilege('authenticated', 'public.refresh_bev_stats(uuid[])', 'EXECUTE'),
  'refresh_bev_stats is no longer executable by authenticated (the grant 20261101000300 left behind)'
);

select ok(
  not has_function_privilege('anon', 'public.refresh_bev_stats(uuid[])', 'EXECUTE'),
  'nor by anon'
);

select ok(
  to_regprocedure('public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text)') is not null
  and to_regprocedure('public.rerank_bev(uuid, smallint, integer, integer, jsonb, text)') is not null
  and to_regprocedure('public.add_want_to_try(uuid, uuid, uuid)') is not null
  and to_regprocedure('public.remove_ranking(uuid)') is not null
  and to_regprocedure('public.remove_want_to_try(uuid)') is not null
  and to_regprocedure('public.get_bev(uuid)') is not null,
  'the five write RPCs and get_bev keep their signatures'
);

select ok(
  has_function_privilege('authenticated', 'public.submit_ranking(uuid, smallint, integer, integer, jsonb, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.rerank_bev(uuid, smallint, integer, integer, jsonb, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.add_want_to_try(uuid, uuid, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.remove_ranking(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.remove_want_to_try(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_bev(uuid)', 'EXECUTE'),
  'and keep their grant to authenticated'
);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-000000002301', 'pgtapres1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-000000002302', 'pgtapres2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-000000002304', 'pgtapres4@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date unless the trusted-RPC bypass is on.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-000000002301', '00000000-0000-4000-8000-000000002302');
update public.profiles set birth_date = (current_date - interval '15 years')::date
 where id = '00000000-0000-4000-8000-000000002304';
set local bevi.rpc_bypass = 'false';

create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select case rn when 1 then 'dst' else 'T' end, id
  from (select b.id, row_number() over (order by b.name collate "C", b.id) as rn
          from public.bevs b
         where b.category_id = 'water' and b.status = 'active') s
 where rn <= 2;
insert into t_bevs (label, id)
select 'ALC', b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where c.is_alcoholic and b.status = 'active'
 order by b.name collate "C", b.id
 limit 1;
grant select on t_bevs to authenticated;

select is((select count(*)::int from t_bevs), 3,
          'fixture: two active water Bevs and one alcoholic Bev from the seed');

-- `source = 'seed'` lets a Bev exist without a photo and keeps the embed
-- trigger quiet; none of these is active anyway.
insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
select '00000000-0000-4000-8000-000000002391', 'pgTAP Resolve M1', 'pgTAP', 'water', 1, 'merged', id, 'seed'
  from t_bevs where label = 'dst';
insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
values ('00000000-0000-4000-8000-000000002392', 'pgTAP Resolve M2', 'pgTAP', 'water', 1, 'merged',
        '00000000-0000-4000-8000-000000002391', 'seed');
insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
select '00000000-0000-4000-8000-000000002393', 'pgTAP Resolve MALC', 'pgTAP', b.category_id, 1, 'merged', b.id, 'seed'
  from public.bevs b where b.id = (select id from t_bevs where label = 'ALC');

-- A cycle, which only a hand-written UPDATE can make.
insert into public.bevs (id, name, brand, category_id, price_tier, status, source)
values ('00000000-0000-4000-8000-000000002395', 'pgTAP Resolve Cycle B', 'pgTAP', 'water', 1, 'hidden', 'seed');
insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
values ('00000000-0000-4000-8000-000000002394', 'pgTAP Resolve Cycle A', 'pgTAP', 'water', 1, 'merged',
        '00000000-0000-4000-8000-000000002395', 'seed');
update public.bevs
   set status = 'merged', merged_into = '00000000-0000-4000-8000-000000002394'
 where id = '00000000-0000-4000-8000-000000002395';

-- H1..H9: a chain of nine, H1 merged into dst. Sequential because
-- `merged_into` is a foreign key, so each row needs its target to exist.
do $$
declare
  v_prev uuid := (select id from t_bevs where label = 'dst');
  v_id   uuid;
  i      integer;
begin
  for i in 1..9 loop
    v_id := ('00000000-0000-4000-8000-0000000023' || lpad((50 + i)::text, 2, '0'))::uuid;
    insert into public.bevs (id, name, brand, category_id, price_tier, status, merged_into, source)
    values (v_id, 'pgTAP Resolve H' || i, 'pgTAP', 'water', 1, 'merged', v_prev, 'seed');
    v_prev := v_id;
  end loop;
end $$;

-- 2302 has ranked dst already (written directly, as 09 and 22 do).
insert into public.rankings (id, user_id, bev_id, bucket, position, score)
select '00000000-0000-4000-8000-0000000023a1', '00000000-0000-4000-8000-000000002302',
       id, 3::smallint, 0, public.ranking_score(3::smallint, 0, 1)
  from t_bevs where label = 'dst';

-- ---------------------------------------------------------------------------
-- 2. resolve_bev_id (as postgres: no client role can call it)
-- ---------------------------------------------------------------------------

select is(
  public.resolve_bev_id((select id from t_bevs where label = 'T')),
  (select id from t_bevs where label = 'T'),
  'an active Bev resolves to itself'
);

select is(
  public.resolve_bev_id('00000000-0000-4000-8000-000000002391'),
  (select id from t_bevs where label = 'dst'),
  'one hop: a merged Bev resolves to the Bev it was merged into'
);

select is(
  public.resolve_bev_id('00000000-0000-4000-8000-000000002392'),
  (select id from t_bevs where label = 'dst'),
  'two hops: a chain is followed to the end, not one step'
);

select is(
  public.resolve_bev_id('00000000-0000-4000-8000-00000000dead'),
  '00000000-0000-4000-8000-00000000dead'::uuid,
  'an id that does not exist comes back unchanged, so each caller still raises its own BEVI_NOT_FOUND'
);

select throws_ok(
  $$ select public.resolve_bev_id('00000000-0000-4000-8000-000000002394') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'a cycle is not_found, not an endless loop'
);

select is(
  public.resolve_bev_id('00000000-0000-4000-8000-000000002358'),
  (select id from t_bevs where label = 'dst'),
  'eight hops is still inside the bound'
);

select throws_ok(
  $$ select public.resolve_bev_id('00000000-0000-4000-8000-000000002359') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'nine hops is not: the bound is 8, as 20261101000500 set it'
);

-- ---------------------------------------------------------------------------
-- 3. get_bev: the refactor changed the code, not the behaviour
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000002301", "role": "authenticated"}';

select is(
  (select g.id from public.get_bev('00000000-0000-4000-8000-000000002392') g),
  (select id from t_bevs where label = 'dst'),
  'get_bev still follows a chain to the surviving Bev'
);

select throws_ok(
  $$ select * from public.get_bev('00000000-0000-4000-8000-000000002394') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'and still refuses a cycle'
);

-- ---------------------------------------------------------------------------
-- 4. The writes, from a client holding a stale merged id (2301)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.add_want_to_try('00000000-0000-4000-8000-000000002392') $$,
  'add_want_to_try accepts a merged id instead of writing a row nothing reads'
);

select ok(
  exists (select 1 from public.want_to_try w
           where w.user_id = '00000000-0000-4000-8000-000000002301'
             and w.bev_id = (select id from t_bevs where label = 'dst')),
  'and the want is on the surviving Bev'
);

select ok(
  not exists (select 1 from public.want_to_try w
               where w.user_id = '00000000-0000-4000-8000-000000002301'
                 and w.bev_id in ('00000000-0000-4000-8000-000000002391',
                                  '00000000-0000-4000-8000-000000002392')),
  'never on a merged id'
);

select lives_ok(
  $$ select public.remove_want_to_try('00000000-0000-4000-8000-000000002391') $$,
  'remove_want_to_try takes the other merged id in the same chain'
);

select is(
  (select count(*)::int from public.want_to_try w
    where w.user_id = '00000000-0000-4000-8000-000000002301'),
  0,
  'and removes the row it wrote: before this, the DELETE missed silently and the bookmark stayed on'
);

select lives_ok(
  $$ select public.submit_ranking('00000000-0000-4000-8000-000000002391', 3::smallint, 0, 0) $$,
  'submit_ranking accepts a merged id'
);

select is(
  (select r.bev_id from public.rankings r
    where r.user_id = '00000000-0000-4000-8000-000000002301'),
  (select id from t_bevs where label = 'dst'),
  'and the ranking is of the surviving Bev'
);

select throws_ok(
  $$ select public.submit_ranking('00000000-0000-4000-8000-000000002392', 3::smallint, 1, 1) $$,
  '23505', 'BEVI_ALREADY_RANKED',
  'a second merged id in the same chain hits the already-ranked guard, now that it resolves'
);

select throws_ok(
  $$ select public.submit_ranking('00000000-0000-4000-8000-00000000dead', 3::smallint, 1, 1) $$,
  'P0002', 'BEVI_NOT_FOUND',
  'an id that is merely unknown still raises BEVI_NOT_FOUND'
);

select lives_ok(
  $$ select public.remove_want_to_try('00000000-0000-4000-8000-00000000dead') $$,
  'remove_want_to_try keeps its silence on an unknown id (its DELETE never raised)'
);

-- 2302, who ranked dst before the merge was ever run
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000002302", "role": "authenticated"}';

select lives_ok(
  $$ select public.rerank_bev('00000000-0000-4000-8000-000000002391', 3::smallint, 0, 0) $$,
  'rerank_bev finds the ranking merge_bev moved; before this it raised BEVI_NOT_FOUND on a ranking that existed'
);

select is(
  (select r.bev_id from public.rankings r
    where r.user_id = '00000000-0000-4000-8000-000000002302'),
  (select id from t_bevs where label = 'dst'),
  'and leaves it on the surviving Bev'
);

select lives_ok(
  $$ select public.remove_ranking('00000000-0000-4000-8000-000000002392') $$,
  'remove_ranking takes a merged id too'
);

select is(
  (select count(*)::int from public.rankings r
    where r.user_id = '00000000-0000-4000-8000-000000002302'),
  0,
  'and removes the ranking it resolves to'
);

select throws_ok(
  $$ select public.remove_ranking('00000000-0000-4000-8000-00000000dead') $$,
  'P0002', 'BEVI_NOT_FOUND',
  'remove_ranking still raises on an unknown id'
);

-- 2304 is 15: the age gate is checked on the RESOLVED Bev, so a merged id
-- cannot be used to get around it.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000002304", "role": "authenticated"}';

select throws_ok(
  $$ select public.submit_ranking('00000000-0000-4000-8000-000000002393', 3::smallint, 0, 0) $$,
  '42501', 'BEVI_AGE_RESTRICTED',
  'a merged id whose survivor is alcoholic is still age-restricted'
);

select throws_ok(
  $$ select public.add_want_to_try('00000000-0000-4000-8000-000000002393') $$,
  '42501', 'BEVI_AGE_RESTRICTED',
  'and so is wanting it'
);

reset role;

select * from finish();
rollback;
