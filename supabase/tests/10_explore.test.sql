-- A-04 + S-04 (20261019000400): get_explore -- two-hop scope, D-01's global
-- fallback, the §10.4 decay order, the age gate, and D-15 (no like or comment
-- data in the rows).
--
-- The graph:
--   d1 -> d2 -> d3 -> d4          d5 is unconnected; d6 -> d2 (d6 is 16)
-- so from d1: d2 is one hop (feed, never Explore), d3 is two hops (Explore),
-- d4 is three hops and d5 is nobody -- both only visible under the fallback.
--
-- The posts, with the hotness each one gets from (likes + 1)/(age_h + 2)^1.5:
--   A mid_hot      d3   9 likes   3h     0.894
--   B new_quiet    d3   0 likes   1min   0.349
--   C old_popular  d3  12 likes  24h     0.098
--   D booze        d3   0 likes   5h     0.054   (wine: hidden from d6)
--   E hop3         d4   3 likes   1h     0.770
--   F stranger     d5   0 likes  48h     0.003
--   G followed     d2  13 likes   1h     2.692   (d1 follows d2: never shown)
--   H mine         d1  13 likes   1h     2.692   (d1's own: never shown)
-- so for d1 the order is A, B, C, D -- which is neither newest-first
-- (B, A, D, C) nor most-liked-first (C, A, then the zeros). ff01..ff13 are the
-- likers; ff14 exists only to move the profile count across D-01's 20.
begin;
select plan(30);

-- ---------------------------------------------------------------------------
-- Users. Twenty profiles to start, so the fallback is OFF for the first half
-- of the file; one of them (ff14) is dropped later to cross back under 20.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000d1', 'pgtapexp1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d2', 'pgtapexp2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d3', 'pgtapexp3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d4', 'pgtapexp4@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d5', 'pgtapexp5@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000d6', 'pgtapexp6@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

insert into auth.users (id, email, raw_user_meta_data, aud, role)
select ('00000000-0000-4000-8000-00000000ff' || lpad(i::text, 2, '0'))::uuid,
       'pgtapexpf' || lpad(i::text, 2, '0') || '@users.bevi.app',
       '{"invite_code": "local-test-invite-code"}'::jsonb,
       'authenticated', 'authenticated'
  from generate_series(1, 14) i;

-- protect_profile_columns silently pins birth_date unless the trusted-RPC
-- bypass flag is on, so a bare update would leave every age null (nobody
-- adult) and the age-gate assertions below would pass for the wrong reason.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2',
              '00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000d4',
              '00000000-0000-4000-8000-0000000000d5');
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000000d6';
set local bevi.rpc_bypass = 'false';

insert into public.follows (follower_id, followee_id)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2'),
       ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3'),
       ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000d4'),
       ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000d2');

-- ---------------------------------------------------------------------------
-- Seed Bevs, in a stable order: seven non-alcoholic plus one alcoholic.
-- ---------------------------------------------------------------------------

create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
insert into t_bevs (label, id)
select l, (select b.id from public.bevs b
             join public.categories c on c.id = b.category_id
            where b.source = 'seed' and b.status = 'active' and c.is_alcoholic = alc
            order by b.name collate "C", b.id offset off limit 1)
  from (values ('mid_hot', false, 0), ('new_quiet', false, 1), ('old_popular', false, 2),
               ('hop3', false, 3), ('stranger', false, 4), ('followed', false, 5),
               ('mine', false, 6), ('later', false, 7), ('booze', true, 0)) v(l, alc, off);
grant select on t_bevs to authenticated;

-- ---------------------------------------------------------------------------
-- The posts. Written straight into rankings/feed_events rather than through
-- submit_ranking, which would stamp every created_at with now(): the decay
-- order needs backdated posts. Likes go straight into post_likes for the same
-- reason like_post cannot be used -- it refuses a post the liker cannot see,
-- and these likers are strangers to the authors on purpose.
-- ---------------------------------------------------------------------------

create temporary table t_posts (label text primary key, id bigint not null) on commit drop;
grant select on t_posts to authenticated;

do $$
declare
  v         record;
  v_bev     uuid;
  v_ranking uuid;
  v_event   bigint;
  v_at      timestamptz;
begin
  for v in
    select * from (values
      ('mid_hot',     '00000000-0000-4000-8000-0000000000d3', 'mid_hot',     3, 0, 9.00, interval '3 hours',   9),
      ('new_quiet',   '00000000-0000-4000-8000-0000000000d3', 'new_quiet',   3, 1, 8.00, interval '1 minute',  0),
      ('old_popular', '00000000-0000-4000-8000-0000000000d3', 'old_popular', 2, 0, 5.00, interval '24 hours', 12),
      ('booze',       '00000000-0000-4000-8000-0000000000d3', 'booze',       1, 0, 2.00, interval '5 hours',   0),
      ('hop3',        '00000000-0000-4000-8000-0000000000d4', 'hop3',        3, 0, 9.00, interval '1 hour',    3),
      ('stranger',    '00000000-0000-4000-8000-0000000000d5', 'stranger',    3, 0, 9.00, interval '48 hours',  0),
      ('followed',    '00000000-0000-4000-8000-0000000000d2', 'followed',    3, 0, 9.00, interval '1 hour',   13),
      ('mine',        '00000000-0000-4000-8000-0000000000d1', 'mine',        3, 0, 9.00, interval '1 hour',   13)
    ) t(label, actor, bev_label, bucket, pos, score, age, likes)
  loop
    select id into v_bev from t_bevs where label = v.bev_label;
    v_at := now() - v.age;

    insert into public.rankings (user_id, bev_id, bucket, position, score, ranked_at)
    values (v.actor::uuid, v_bev, v.bucket::smallint, v.pos, v.score, v_at)
    returning id into v_ranking;

    insert into public.feed_events (actor_id, kind, bev_id, ranking_id, created_at)
    values (v.actor::uuid, 'ranked', v_bev, v_ranking, v_at)
    returning id into v_event;

    insert into t_posts (label, id) values (v.label, v_event);

    insert into public.post_likes (user_id, feed_event_id)
    select ('00000000-0000-4000-8000-00000000ff' || lpad(i::text, 2, '0'))::uuid, v_event
      from generate_series(1, v.likes) i;
  end loop;
end $$;

-- d1 has mid_hot's Bev on their Want to Try list: in_my_want_to_try is the
-- caller's own bookmark, which Explore does still carry.
insert into public.want_to_try (user_id, bev_id)
values ('00000000-0000-4000-8000-0000000000d1', (select id from t_bevs where label = 'mid_hot'));

-- ---------------------------------------------------------------------------
-- Shape, grants, and the formula itself.
-- ---------------------------------------------------------------------------

-- get_explore's TABLE(...) is get_feed's with the last four columns cut, so
-- dropping its closing paren leaves a prefix of get_feed's.
select ok(
  starts_with(
    pg_get_function_result('public.get_feed(int, bigint)'::regprocedure),
    left(pg_get_function_result('public.get_explore(int, timestamptz, int)'::regprocedure), -1)
  ),
  'get_explore returns get_feed''s columns, in order, up to in_my_want_to_try'
);
select ok(
  pg_get_function_result('public.get_explore(int, timestamptz, int)'::regprocedure)
    !~ '(like_count|liked_by_me|comment_count|comments)',
  'D-15: no like_count, liked_by_me, comment_count or comments column'
);
select ok(
  not has_function_privilege('anon', 'public.get_explore(int, timestamptz, int)', 'execute'),
  'anon cannot execute get_explore'
);
select ok(
  has_function_privilege('authenticated', 'public.get_explore(int, timestamptz, int)', 'execute'),
  'authenticated can execute get_explore'
);
select is(
  round(public.explore_hotness(9, 3), 5),
  0.89443::numeric,
  'explore_hotness is §10.4: (9 + 1)/(3 + 2)^1.5'
);
select ok(
  not has_function_privilege('anon', 'public.explore_hotness(bigint, numeric)', 'execute'),
  'anon cannot execute explore_hotness'
);
-- The half that used to be missing. Supabase's default privileges grant
-- EXECUTE on every new public function directly to authenticated, so without
-- an explicit revoke this passes only by accident of the grant block.
select ok(
  not has_function_privilege('authenticated', 'public.explore_hotness(bigint, numeric)', 'execute'),
  'authenticated cannot execute explore_hotness either'
);

-- ---------------------------------------------------------------------------
-- Twenty profiles: the two-hop scope, with the fallback off.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';

select is(
  (select count(*)::int from public.profiles), 20,
  'the fixture has exactly 20 profiles, so D-01''s fallback is off'
);
select is(
  (select array_agg(t.id order by t.ordinality)
     from public.get_explore(20, null::timestamptz, 0) with ordinality t),
  array[(select id from t_posts where label = 'mid_hot'),
        (select id from t_posts where label = 'new_quiet'),
        (select id from t_posts where label = 'old_popular'),
        (select id from t_posts where label = 'booze')],
  'two hops only, hottest first: d3''s four posts in §10.4 order'
);
select is(
  (select array_agg(t.id order by t.ordinality)
     from public.get_explore(20, null::timestamptz, 0) with ordinality t
    where t.id in (select id from t_posts
                    where label in ('mine', 'followed', 'hop3', 'stranger'))),
  null::bigint[],
  'no own post, no followed user''s post, nothing three hops out or unconnected'
);
select ok(
  (select bool_and(e.actor_id = '00000000-0000-4000-8000-0000000000d3')
     from public.get_explore(20, null::timestamptz, 0) e),
  'every row is by the two-hop stranger d3'
);
select is(
  (select t.id from public.get_explore(20, null::timestamptz, 0) with ordinality t
    where t.ordinality = 1),
  (select id from t_posts where label = 'mid_hot'),
  'the top post is the hottest, not the newest (new_quiet) nor the most liked (old_popular)'
);
select is(
  (select in_my_want_to_try from public.get_explore(20, null::timestamptz, 0)
    where id = (select id from t_posts where label = 'mid_hot')),
  true,
  'in_my_want_to_try is the caller''s own bookmark'
);
select is(
  (select count(*)::int from public.get_explore(2, null::timestamptz, 0)),
  2,
  'p_limit caps the page'
);
select lives_ok(
  $$ select * from public.get_explore(0, null::timestamptz, -5) $$,
  'p_limit 0 and a negative offset are clamped instead of raising'
);

-- ---------------------------------------------------------------------------
-- The age gate, from d6 (16), who also reaches d3 in two hops.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d6", "role": "authenticated"}';

select is(
  (select array_agg(t.id order by t.ordinality)
     from public.get_explore(20, null::timestamptz, 0) with ordinality t),
  array[(select id from t_posts where label = 'mid_hot'),
        (select id from t_posts where label = 'new_quiet'),
        (select id from t_posts where label = 'old_popular')],
  'a caller under 21 sees the same posts without the alcoholic one'
);
select ok(
  not exists (
    select 1 from public.get_explore(20, null::timestamptz, 0)
     where id = (select id from t_posts where label = 'booze')
  ),
  'the alcoholic Bev''s post is age-gated exactly as in get_feed'
);

set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok(
  $$ select * from public.get_explore(20, null::timestamptz, 0) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'no session is unauthorized'
);

-- ---------------------------------------------------------------------------
-- D-01's fallback: drop to 19 profiles and the scope widens to everyone,
-- minus the caller and the people they follow.
-- ---------------------------------------------------------------------------

reset role;
delete from auth.users where id = '00000000-0000-4000-8000-00000000ff14';

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';

select is(
  (select count(*)::int from public.profiles), 19,
  '19 profiles: under D-01''s threshold'
);
select is(
  (select array_agg(t.id order by t.ordinality)
     from public.get_explore(20, null::timestamptz, 0) with ordinality t),
  array[(select id from t_posts where label = 'mid_hot'),
        (select id from t_posts where label = 'hop3'),
        (select id from t_posts where label = 'new_quiet'),
        (select id from t_posts where label = 'old_popular'),
        (select id from t_posts where label = 'booze'),
        (select id from t_posts where label = 'stranger')],
  'under 20 users Explore falls back to everyone, still hottest first'
);
select is(
  (select count(*)::int from public.get_explore(20, null::timestamptz, 0)
    where actor_id in ('00000000-0000-4000-8000-0000000000d1',
                       '00000000-0000-4000-8000-0000000000d2')),
  0,
  'the fallback still excludes the caller and the people they follow'
);

reset role;
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-00000000ff14', 'pgtapexpf14@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_explore(20, null::timestamptz, 0)), 4,
  'back at 20 profiles the fallback switches off again: d3''s four posts'
);

-- ---------------------------------------------------------------------------
-- Paging: offset paging over an ordering frozen by p_before. now() is the
-- transaction's timestamp here, so a post stamped now() counts as "arriving"
-- after a snapshot taken at now() - 30 seconds.
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(t.id order by t.ordinality)
     from public.get_explore(2, now() - interval '30 seconds', 0) with ordinality t),
  array[(select id from t_posts where label = 'mid_hot'),
        (select id from t_posts where label = 'new_quiet')],
  'page 1 of the frozen ordering'
);

reset role;
do $$
declare
  v_bev     uuid;
  v_ranking uuid;
  v_event   bigint;
begin
  select id into v_bev from t_bevs where label = 'later';
  insert into public.rankings (user_id, bev_id, bucket, position, score)
  values ('00000000-0000-4000-8000-0000000000d3', v_bev, 2, 1, 6.00)
  returning id into v_ranking;
  insert into public.feed_events (actor_id, kind, bev_id, ranking_id, created_at)
  values ('00000000-0000-4000-8000-0000000000d3', 'ranked', v_bev, v_ranking, now())
  returning id into v_event;
  insert into t_posts (label, id) values ('later', v_event);
  insert into public.post_likes (user_id, feed_event_id)
  select ('00000000-0000-4000-8000-00000000ff' || lpad(i::text, 2, '0'))::uuid, v_event
    from generate_series(1, 13) i;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';

select is(
  (select array_agg(t.id order by t.ordinality)
     from public.get_explore(2, now() - interval '30 seconds', 2) with ordinality t),
  array[(select id from t_posts where label = 'old_popular'),
        (select id from t_posts where label = 'booze')],
  'page 2 continues the same ordering: a hotter post added mid-paging neither repeats nor skips a row'
);
select is(
  (select count(*)::int from public.get_explore(20, now() - interval '30 seconds', 0)
    where id = (select id from t_posts where label = 'later')),
  0,
  'the post that arrived after the snapshot is not in it'
);
select is(
  (select t.id from public.get_explore(20, null::timestamptz, 0) with ordinality t
    where t.ordinality = 1),
  (select id from t_posts where label = 'later'),
  'and an unfrozen call does rank it first, so it was the snapshot holding it back'
);
select is(
  (select count(*)::int from public.get_explore(20, now() - interval '30 seconds', 99)),
  0,
  'an offset past the end is an empty page, not an error'
);

-- p_before is the paging cut, NOT the decay clock. If a future edit wires it
-- back into the hotness term, these two calls -- same cut, both wide enough to
-- hold every eligible post -- stop agreeing on the order, which is the signal
-- that the like-count oracle is back.
select is(
  (select array_agg(t.id order by t.ordinality)
     from public.get_explore(20, now(), 0) with ordinality t),
  (select array_agg(t.id order by t.ordinality)
     from public.get_explore(20, now() + interval '4 minutes', 0) with ordinality t),
  'moving p_before within the clamp does not reorder the page: it is the cut, not the clock'
);

-- p_offset is capped at 1000, so an absurd offset is an empty page rather than
-- a full sort of the candidate set (nodeLimit passes offset + count as the
-- sort bound, which defeats the bounded top-N heapsort).
select is(
  (select count(*)::int from public.get_explore(20, now(), 2147483647)),
  0,
  'an out-of-range p_offset is clamped, not passed to the sort'
);

reset role;

-- A Bev only its creator may see (bevs_select: status 'pending_photo' is
-- visible to created_by alone) must not reach a stranger through Explore. d3
-- creates one with free text in every displayed column, ranks it, and the
-- post is hot enough -- no likes, but brand new -- to be on page 1 if the
-- status filter were missing.
do $$
declare
  v_bev     uuid;
  v_ranking uuid;
  v_event   bigint;
begin
  insert into public.bevs (name, brand, flavor, category_id, price_tier, status, source, created_by)
  values ('pgTAP Not Yours', 'pgTAP Leak', 'pgTAP Leak', 'soda', 2, 'pending_photo', 'user',
          '00000000-0000-4000-8000-0000000000d3')
  returning id into v_bev;
  insert into public.rankings (user_id, bev_id, bucket, position, score)
  values ('00000000-0000-4000-8000-0000000000d3', v_bev, 3, 2, 9.50)
  returning id into v_ranking;
  insert into public.feed_events (actor_id, kind, bev_id, ranking_id, created_at)
  values ('00000000-0000-4000-8000-0000000000d3', 'ranked', v_bev, v_ranking, now())
  returning id into v_event;
  insert into t_posts (label, id) values ('pending', v_event);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d1", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_explore(50, null::timestamptz, 0)
    where id = (select id from t_posts where label = 'pending')),
  0,
  'a post whose Bev is not active is withheld, as bevs_select withholds the Bev'
);

reset role;
select * from finish();
rollback;
