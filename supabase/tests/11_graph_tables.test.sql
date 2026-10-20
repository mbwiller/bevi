-- A-16 (1) + S-14 part 2 (20261019000500): bev_embeddings, bev_edges and the
-- three read RPCs over them.
--
-- What this file is for, in order: the table shapes and the canonical
-- orientation CHECK; RLS (select allowed, no write path for `authenticated`);
-- that each RPC returns zero rows rather than raising while the mirror is
-- empty (which is its state until the sync job lands); the both-direction
-- lookup, since one row covers an unordered pair; the `status = 'active'`
-- filter (#113's bug); the server-side limit clamp; `list_bucket_bevs`
-- returning only the caller's own rows; and the age gate on all three for an
-- under-21 caller.
--
-- Fixture uuid prefix: ...0000000ed0NN ("ed" for edges). Checked against every
-- other file in supabase/tests/ -- 09_leaderboard_parity uses ab001..ab006 and
-- ab011..ab013, 10_explore uses d1..d6 and ff01..ff14, and the earlier files
-- use a1, b1..b2, c1..c3, e1..e3, f1..f4 and ffff. ed0NN collides with none.
--
-- The people:
--   ed001  adult (30)   ranks three Bevs, one of them alcoholic
--   ed002  minor (16)   ranks the alcoholic one too: the gate, not the data
--   ed003  adult (30)   ranks a Bev ed001 never touched (own-rows-only)
--
-- The edges, all incident to `anchor` (a non-alcoholic active seed Bev):
--   hidden  0.99   heaviest, but its Bev is set status 'hidden'
--   booze   0.97   alcoholic: adults only
--   upper   0.95   the Bev whose id sorts just above anchor's
--   lower   0.90   the Bev whose id sorts just below anchor's
--   60 fillers at 0.42 each, so the 50-row clamp has something to clamp and
--   the weight tie-break has a tie to break.
-- `upper` and `lower` exist so one labelled edge is stored with anchor as
-- src_bev_id and the other with anchor as dst_bev_id: every lookup below has
-- to find both.
begin;
select plan(57);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000ed001', 'pgtapedge1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ed002', 'pgtapedge2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000ed003', 'pgtapedge3@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- protect_profile_columns pins birth_date silently unless the trusted-RPC
-- bypass is on, so without this every age is null (nobody adult) and the
-- age-gate assertions would pass for the wrong reason.
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date = (current_date - interval '30 years')::date
 where id in ('00000000-0000-4000-8000-0000000ed001',
              '00000000-0000-4000-8000-0000000ed003');
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000ed002';
set local bevi.rpc_bypass = 'false';

-- ---------------------------------------------------------------------------
-- Bevs. Seed ids are deterministic (20261014000500 inserts literal uuids), so
-- "the Bev whose id sorts just above the anchor's" is the same Bev on every
-- `db reset` and the two stored orientations are reproducible.
-- ---------------------------------------------------------------------------

create temporary table t_bevs (label text primary key, id uuid not null) on commit drop;
grant select on t_bevs to authenticated;

insert into t_bevs (label, id)
select 'anchor', b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
 order by b.id
 offset 50 limit 1;

insert into t_bevs (label, id)
select 'lower', b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
   and b.id < (select id from t_bevs where label = 'anchor')
 order by b.id desc limit 1;

insert into t_bevs (label, id)
select 'upper', b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
   and b.id > (select id from t_bevs where label = 'anchor')
 order by b.id limit 1;

-- Two more non-alcoholic seed Bevs: one that gets a heavy edge and then
-- status 'hidden', one that never gets an edge at all.
insert into t_bevs (label, id)
select case when x.rn = 1 then 'hidden' else 'unlinked' end, x.id
  from (
    select b.id, row_number() over (order by b.id) as rn
      from public.bevs b
      join public.categories c on c.id = b.category_id
     where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
       and b.id not in (select id from t_bevs)
     order by b.id limit 2
  ) x;

insert into t_bevs (label, id)
select 'booze', b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and c.is_alcoholic
 order by b.id limit 1;

-- Brand-key fixtures: source 'user' so the filler query (source 'seed') never
-- picks them up. '  Dr   Pepper  ' must normalise to 'dr pepper' and a
-- whitespace-only brand to null, matching normaliseBrand() in @bevi/ranking.
with ins as (
  insert into public.bevs (name, brand, flavor, category_id, price_tier, status, source, photo_path)
  values ('pgTAP Edge Brand', '  Dr   Pepper  ', null, 'soda', 2, 'active', 'user', 'pgtap/edge-brand.jpg')
  returning id
)
insert into t_bevs (label, id) select 'brandy', id from ins;

with ins as (
  insert into public.bevs (name, brand, flavor, category_id, price_tier, status, source, photo_path)
  values ('pgTAP Edge Blank Brand', '   ', null, 'soda', 2, 'active', 'user', 'pgtap/edge-blank.jpg')
  returning id
)
insert into t_bevs (label, id) select 'blank', id from ins;

create temporary table t_filler (id uuid primary key) on commit drop;
grant select on t_filler to authenticated;
insert into t_filler (id)
select b.id
  from public.bevs b
  join public.categories c on c.id = b.category_id
 where b.source = 'seed' and b.status = 'active' and not c.is_alcoholic
   and b.id not in (select id from t_bevs)
 order by b.id limit 60;

-- ---------------------------------------------------------------------------
-- 1. Table shape, the orientation CHECK, RLS policies and grants
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.bev_embeddings'::regclass),
  'bev_embeddings has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.bev_edges'::regclass),
  'bev_edges has RLS enabled'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'bev_embeddings'
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'no direct write policy for authenticated on bev_embeddings'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'bev_edges'
      and 'authenticated' = any(roles)
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'no direct write policy for authenticated on bev_edges'
);
-- format_type renders the schema only when it is off the search_path, so match
-- the suffix rather than the whole name.
select ok(
  (select format_type(a.atttypid, a.atttypmod)
     from pg_attribute a
    where a.attrelid = 'public.bev_embeddings'::regclass and a.attname = 'embedding')
    like '%vector(384)',
  'bev_embeddings.embedding is a 384-dimensional pgvector column (gte-small)'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'bev_embeddings'
       and indexdef ilike '%using hnsw%' and indexdef ilike '%vector_cosine_ops%'
  ),
  'bev_embeddings has an HNSW index for cosine distance'
);
-- One per column, so a Bev''s neighbours are a bounded index scan whichever
-- side of the stored pair it is on.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'bev_edges'
      and indexdef ilike '%weight desc%'),
  2,
  'bev_edges has a weight-ordered index on each endpoint column'
);
-- `upper`'s id sorts above the anchor's and `lower`'s below it, so
-- (upper, lower) is always the wrong way round.
select throws_ok(
  $$ insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version)
     select u.id, l.id, 0.5, '{}'::jsonb, '1.2.0'
       from (select id from t_bevs where label = 'upper') u,
            (select id from t_bevs where label = 'lower') l $$,
  '23514',
  null,
  'the orientation CHECK rejects a row stored dst-first'
);
select throws_ok(
  $$ insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version)
     select id, id, 0.5, '{}'::jsonb, '1.2.0' from t_bevs where label = 'anchor' $$,
  '23514',
  null,
  'and the same CHECK forbids a self-edge'
);
select ok(
  not has_function_privilege('anon', 'public.get_bev_similarities(uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.get_similar_bevs(uuid, int)', 'execute')
  and not has_function_privilege('anon', 'public.list_bucket_bevs(smallint)', 'execute'),
  'anon cannot execute any of the three RPCs'
);
select ok(
  has_function_privilege('authenticated', 'public.get_bev_similarities(uuid, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.get_similar_bevs(uuid, int)', 'execute')
  and has_function_privilege('authenticated', 'public.list_bucket_bevs(smallint)', 'execute'),
  'authenticated can execute all three'
);

-- ---------------------------------------------------------------------------
-- 2. The empty mirror. Nothing has written bev_edges or rankings yet, which is
-- production's state until the sync job lands: every RPC must be zero rows,
-- not an error.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ed001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.get_bev_similarities(
     (select id from t_bevs where label = 'anchor'),
     (select array_agg(id) from t_bevs))),
  0,
  'get_bev_similarities over an empty bev_edges is zero rows, not an error'
);
select is(
  (select count(*)::int from public.get_similar_bevs(
     (select id from t_bevs where label = 'anchor'), 10)),
  0,
  'get_similar_bevs over an empty bev_edges is zero rows, not an error'
);
select is(
  (select count(*)::int from public.list_bucket_bevs(3::smallint)),
  0,
  'list_bucket_bevs with no rankings is zero rows, not an error'
);

-- ---------------------------------------------------------------------------
-- 3. No session
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"role": "authenticated"}';
select throws_ok(
  $$ select * from public.get_bev_similarities('00000000-0000-4000-8000-0000000ed001', null::uuid[]) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'get_bev_similarities without a session is unauthorized'
);
select throws_ok(
  $$ select * from public.get_similar_bevs('00000000-0000-4000-8000-0000000ed001', 10) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'get_similar_bevs without a session is unauthorized'
);
select throws_ok(
  $$ select * from public.list_bucket_bevs(3::smallint) $$,
  '42501', 'BEVI_UNAUTHORIZED',
  'list_bucket_bevs without a session is unauthorized'
);

-- ---------------------------------------------------------------------------
-- The data: edges, embeddings, rankings. Written as the owner, the way the
-- sync job's service role will.
-- ---------------------------------------------------------------------------

reset role;

do $$
declare
  v     record;
  v_a   uuid;
  v_b   uuid;
  v_cmp jsonb := '{"tree": 1, "content": 0.8, "emb": 0.9, "profile": 1, "cop": 0}'::jsonb;
begin
  select id into v_a from t_bevs where label = 'anchor';
  for v in select * from (values ('hidden', 0.99), ('booze', 0.97),
                                 ('upper', 0.95), ('lower', 0.90)) t(label, w)
  loop
    select id into v_b from t_bevs where label = v.label;
    insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version)
    values (least(v_a, v_b), greatest(v_a, v_b), v.w::numeric, v_cmp, '1.2.0');
  end loop;

  -- One edge that does not touch the anchor, so the alcoholic Bev has a
  -- neighbour of its own: an adult asking for it gets a row and the minor's
  -- empty answer is the gate rather than an empty table.
  select id into v_a from t_bevs where label = 'booze';
  select id into v_b from t_bevs where label = 'upper';
  insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version)
  values (least(v_a, v_b), greatest(v_a, v_b), 0.55, v_cmp, '1.2.0');
end $$;

insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version)
select least(a.id, f.id), greatest(a.id, f.id), 0.42,
       '{"tree": 1, "content": 0.5, "emb": 0.4, "profile": 0.5, "cop": 0}'::jsonb, '1.2.0'
  from (select id from t_bevs where label = 'anchor') a
 cross join t_filler f;

-- The heaviest edge leads to a Bev moderation has hidden.
update public.bevs set status = 'hidden'
 where id = (select id from t_bevs where label = 'hidden');

insert into public.bev_embeddings (bev_id, embedding)
select t.id,
       ('[' || (select string_agg('0.05', ',') from generate_series(1, 384)) || ']')::extensions.vector(384)
  from t_bevs t
 where t.label in ('anchor', 'booze');

insert into public.rankings (user_id, bev_id, bucket, position, score)
values ('00000000-0000-4000-8000-0000000ed001', (select id from t_bevs where label = 'brandy'), 3, 0, 9.50),
       ('00000000-0000-4000-8000-0000000ed001', (select id from t_bevs where label = 'blank'),  3, 1, 9.00),
       ('00000000-0000-4000-8000-0000000ed001', (select id from t_bevs where label = 'booze'),  3, 2, 8.50),
       ('00000000-0000-4000-8000-0000000ed002', (select id from t_bevs where label = 'booze'),  3, 0, 7.50),
       ('00000000-0000-4000-8000-0000000ed003', (select id from t_bevs where label = 'anchor'), 3, 0, 9.50);

-- ---------------------------------------------------------------------------
-- 4. get_bev_similarities: both stored orientations, one PK probe each
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ed001", "role": "authenticated"}';

select is(
  (select weight from public.get_bev_similarities(
     (select id from t_bevs where label = 'anchor'),
     array[(select id from t_bevs where label = 'upper')])),
  0.95::numeric,
  'the pair stored with the anchor as src_bev_id is found'
);
select is(
  (select weight from public.get_bev_similarities(
     (select id from t_bevs where label = 'anchor'),
     array[(select id from t_bevs where label = 'lower')])),
  0.90::numeric,
  'and so is the pair stored with the anchor as dst_bev_id: the lookup is not one-sided'
);
-- The same call from the other end of each pair: a weight is symmetric, so the
-- orientation the row happens to be stored in must not be observable.
select is(
  (select weight from public.get_bev_similarities(
     (select id from t_bevs where label = 'lower'),
     array[(select id from t_bevs where label = 'anchor')])),
  0.90::numeric,
  'asking from the other end of the pair gives the same weight'
);
select is(
  (select array_agg(s.bev_id order by s.weight desc)
     from public.get_bev_similarities(
       (select id from t_bevs where label = 'anchor'),
       array[(select id from t_bevs where label = 'upper'),
             (select id from t_bevs where label = 'lower'),
             (select id from t_bevs where label = 'unlinked'),
             (select id from t_bevs where label = 'anchor')]) s),
  array[(select id from t_bevs where label = 'upper'),
        (select id from t_bevs where label = 'lower')],
  'one call covers both directions; a Bev with no edge and the anchor itself are absent'
);
select is(
  (select count(*)::int from public.get_bev_similarities(
     (select id from t_bevs where label = 'anchor'),
     array[(select id from t_bevs where label = 'hidden')])),
  0,
  'a pair whose other end is not active is dropped, heavy edge and all'
);
select is(
  (select count(*)::int from public.get_bev_similarities(
     (select id from t_bevs where label = 'anchor'), '{}'::uuid[])),
  0,
  'an empty p_other_ids is zero rows'
);
select throws_ok(
  $$ select * from public.get_bev_similarities(
       (select id from t_bevs where label = 'anchor'),
       (select array_agg(gen_random_uuid()) from generate_series(1, 501))) $$,
  '22023', 'BEVI_VALIDATION',
  'more ids than a bucket could hold is a validation error, not an unbounded scan'
);
-- The cap counts elements, not dimensions. array_length(arr, 1) measures the
-- first dimension only, so a nested array -- which is what PostgREST builds
-- from a nested JSON array -- would slip 2x, 10x or 1000x the cap past a
-- guard written that way, bounded only by the request body size.
select throws_ok(
  $$ select * from public.get_bev_similarities(
       (select id from t_bevs where label = 'anchor'),
       (select array_agg(a) from (
          select array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                       gen_random_uuid(), gen_random_uuid(), gen_random_uuid()] as a
            from generate_series(1, 100)) s)) $$,
  '22023', 'BEVI_VALIDATION',
  'a nested array is measured by cardinality, so 600 ids in 100 rows is still rejected'
);

-- ---------------------------------------------------------------------------
-- 5. get_similar_bevs: order, the status filter, the clamp
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(t.id order by t.ordinality)
     from public.get_similar_bevs((select id from t_bevs where label = 'anchor'), 3)
          with ordinality t),
  array[(select id from t_bevs where label = 'booze'),
        (select id from t_bevs where label = 'upper'),
        (select id from t_bevs where label = 'lower')],
  'heaviest first, across both stored orientations'
);
select is(
  (select count(*)::int from public.get_similar_bevs(
     (select id from t_bevs where label = 'anchor'), 50)
    where id = (select id from t_bevs where label = 'hidden')),
  0,
  'the heaviest neighbour is withheld because its Bev is not active (#113)'
);
-- The 60 fillers all weigh 0.42, so their relative order is the tie-break
-- alone. `topEdges` breaks ties on bevId in code-unit order, and for a
-- canonical lowercase-hex uuid that is byte order, so `order by b.id` agrees.
select ok(
  (select bool_and(d.id > d.prev)
     from (
       select t.id, lag(t.id) over (order by t.ordinality) as prev
         from public.get_similar_bevs((select id from t_bevs where label = 'anchor'), 50)
              with ordinality t
        where t.id in (select id from t_filler)
     ) d
    where d.prev is not null),
  'ties on weight break by ascending Bev id, as topEdges does'
);
select is(
  (select count(*)::int from public.get_similar_bevs(
     (select id from t_bevs where label = 'anchor'), null::int)),
  10,
  'p_limit null falls back to 10'
);
select lives_ok(
  $$ select * from public.get_similar_bevs((select id from t_bevs where label = 'anchor'), 0) $$,
  'p_limit 0 is clamped up instead of raising'
);
select is(
  (select count(*)::int from public.get_similar_bevs(
     (select id from t_bevs where label = 'anchor'), -5)),
  1,
  'a negative p_limit clamps to 1'
);
select is(
  (select count(*)::int from public.get_similar_bevs(
     (select id from t_bevs where label = 'anchor'), 2147483647)),
  50,
  'p_limit is clamped to 50 server-side, though 63 neighbours are visible'
);
select is(
  (select count(*)::int from public.get_similar_bevs(
     (select id from t_bevs where label = 'unlinked'), 10)),
  0,
  'a Bev with no edges is zero rows'
);

-- ---------------------------------------------------------------------------
-- 6. The age gate, from ed002 (16). Same data, narrower answers.
-- ---------------------------------------------------------------------------

-- First as the adult, so each "absent" below is the gate and not an empty set.
-- booze has two visible neighbours: anchor at 0.97 from the loop above, and
-- upper at 0.55 from the edge that does not touch the anchor.
select is(
  (select count(*)::int from public.get_similar_bevs(
     (select id from t_bevs where label = 'booze'), 10)),
  2,
  'an adult does see the alcoholic Bev''s own neighbours'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ed002", "role": "authenticated"}';

select is(
  (select array_agg(s.bev_id)
     from public.get_bev_similarities(
       (select id from t_bevs where label = 'anchor'),
       array[(select id from t_bevs where label = 'upper'),
             (select id from t_bevs where label = 'booze')]) s),
  array[(select id from t_bevs where label = 'upper')],
  'get_bev_similarities hides the alcoholic pair from an under-21 caller'
);
select is(
  (select count(*)::int from public.get_similar_bevs(
     (select id from t_bevs where label = 'anchor'), 50)
    where id = (select id from t_bevs where label = 'booze')),
  0,
  'get_similar_bevs hides the alcoholic neighbour from an under-21 caller'
);
select is(
  (select count(*)::int from public.get_bev_similarities(
     (select id from t_bevs where label = 'booze'),
     array[(select id from t_bevs where label = 'upper')])),
  0,
  'an alcoholic ANCHOR is zero rows for an under-21 caller (get_bev_similarities)'
);
select is(
  (select count(*)::int from public.get_similar_bevs(
     (select id from t_bevs where label = 'booze'), 10)),
  0,
  'and zero rows for get_similar_bevs: the anchor is gated too, not just the neighbours'
);
select is(
  (select count(*)::int from public.list_bucket_bevs(3::smallint)),
  0,
  'list_bucket_bevs hides the caller''s own alcoholic ranking from them at 16'
);

-- ---------------------------------------------------------------------------
-- 7. list_bucket_bevs: own rows, best first, normalised brand key
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ed001", "role": "authenticated"}';

select is(
  (select array_agg(t.id order by t.ordinality)
     from public.list_bucket_bevs(3::smallint) with ordinality t),
  array[(select id from t_bevs where label = 'brandy'),
        (select id from t_bevs where label = 'blank'),
        (select id from t_bevs where label = 'booze')],
  'the caller''s own bucket in position order, best first, like rankings.listBucket'
);
select is(
  (select brand_key from public.list_bucket_bevs(3::smallint)
    where id = (select id from t_bevs where label = 'brandy')),
  'dr pepper',
  'brand_key lowercases, trims and collapses inner whitespace, as normaliseBrand() does'
);
select is(
  (select brand_key from public.list_bucket_bevs(3::smallint)
    where id = (select id from t_bevs where label = 'blank')),
  null::text,
  'a whitespace-only brand is a null brand_key, not an empty string'
);
select is(
  (select category_id from public.list_bucket_bevs(3::smallint)
    where id = (select id from t_bevs where label = 'brandy')),
  'soda',
  'and the row carries the category the tree term needs'
);
select is(
  (select count(*)::int from public.list_bucket_bevs(3::smallint)
    where id = (select id from t_bevs where label = 'anchor')),
  0,
  'another user''s ranking of a Bev the caller never ranked is not in the caller''s bucket'
);
select is(
  (select count(*)::int from public.list_bucket_bevs(2::smallint)),
  0,
  'a bucket the caller has nothing in is zero rows'
);
select lives_ok(
  $$ select * from public.list_bucket_bevs(9::smallint) $$,
  'a bucket value no Bucket maps to is zero rows, not an error'
);

-- The status filter is what makes this function agree with rankings.listBucket,
-- not what breaks the agreement. rankings_select carries no status condition of
-- its own, but its positive `exists` reads public.bevs under bevs_select, which
-- requires 'active' -- so listBucket already drops a hidden Bev, and a definer
-- without the filter would be the one keeping it. Both reads are asserted here,
-- against the same bucket, so a future edit cannot move one without the other.
reset role;
update public.bevs set status = 'hidden'
 where id = (select id from t_bevs where label = 'booze');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ed001", "role": "authenticated"}';

select is(
  (select array_agg(t.id order by t.ordinality)
     from public.list_bucket_bevs(3::smallint) with ordinality t),
  array[(select id from t_bevs where label = 'brandy'),
        (select id from t_bevs where label = 'blank')],
  'a Bev moderation hid leaves the caller''s bucket list'
);
select is(
  (select count(*)::int from public.rankings r
    where r.user_id = '00000000-0000-4000-8000-0000000ed001' and r.bucket = 3),
  2,
  'and rankings.listBucket''s own read agrees, so expectedBucketSize cannot drift'
);

reset role;
update public.bevs set status = 'active'
 where id = (select id from t_bevs where label = 'booze');
set local role authenticated;

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ed003", "role": "authenticated"}';
select is(
  (select array_agg(id) from public.list_bucket_bevs(3::smallint)),
  array[(select id from t_bevs where label = 'anchor')],
  'and the other user sees only their own row, not ed001''s three'
);

-- ---------------------------------------------------------------------------
-- 8. Direct table access under RLS. The RPCs above are the app's only path,
-- but the policies are what stands behind them.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ed001", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.bev_edges (src_bev_id, dst_bev_id, weight, components, version)
     select least(a.id, b.id), greatest(a.id, b.id), 0.5, '{}'::jsonb, '1.2.0'
       from (select id from t_bevs where label = 'anchor') a,
            (select id from t_bevs where label = 'unlinked') b $$,
  '42501',
  null,
  'authenticated has no write path to bev_edges: the sync job writes as the service role'
);
select throws_ok(
  $$ insert into public.bev_embeddings (bev_id, embedding)
     select id, ('[' || (select string_agg('0.05', ',') from generate_series(1, 384)) || ']')::extensions.vector(384)
       from t_bevs where label = 'unlinked' $$,
  '42501',
  null,
  'nor to bev_embeddings'
);
select is(
  (select count(*)::int from public.bev_edges
    where src_bev_id = (select id from t_bevs where label = 'anchor')
       or dst_bev_id = (select id from t_bevs where label = 'anchor')),
  63,
  'select on bev_edges is allowed: an adult reads the anchor''s 63 visible edges'
);
-- The heaviest edge (0.99) leads to the Bev moderation hid. The policy must
-- withhold it from everyone, adult or not: bevs_select stops serving that row
-- the moment status changes, while the edge survives until the nightly sync,
-- so without the status half of the predicate this is a moderation bypass --
-- the id, the weight and the per-term components of a Bev that was taken down.
select is(
  (select count(*)::int from public.bev_edges
    where src_bev_id = (select id from t_bevs where label = 'hidden')
       or dst_bev_id = (select id from t_bevs where label = 'hidden')),
  0,
  'an edge to a non-active Bev is invisible even to an adult'
);
select is(
  (select count(*)::int from public.bev_embeddings), 2,
  'and both embedding rows (anchor and booze are both still active)'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000ed002", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bev_edges
    where src_bev_id = (select id from t_bevs where label = 'booze')
       or dst_bev_id = (select id from t_bevs where label = 'booze')),
  0,
  'an edge that touches an alcoholic Bev is invisible to an under-21 caller'
);
select is(
  (select count(*)::int from public.bev_edges
    where src_bev_id = (select id from t_bevs where label = 'anchor')
       or dst_bev_id = (select id from t_bevs where label = 'anchor')),
  62,
  'the same caller still reads every edge between two Bevs they may see'
);
select is(
  (select count(*)::int from public.bev_embeddings), 1,
  'and only the non-alcoholic Bev''s embedding'
);

reset role;
select * from finish();
rollback;
