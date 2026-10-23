-- A-16 (1) (20261023000300): nearest_bev_embeddings() and replace_bev_edges(),
-- the two service-role RPCs scripts/graph/build-edges.ts writes bev_edges
-- through.
--
-- What this file is for: the grants (neither function is reachable by an end
-- user, and one of them can replace the entire similarity mirror); that
-- `replace_bev_edges` really REPLACES rather than appends; that it rejects a
-- payload before it deletes anything, so a bad run leaves yesterday's edges in
-- place; and that the KNN probe respects its limit, its ordering and the
-- `status = 'active'` filter.
--
-- Fixture uuid prefix: ...00000ed7a0NN ("ed7" for the writer, 20261023000300).
-- Checked against every file in supabase/tests/: 11_graph_tables uses
-- ed001..ed003, 13_flavor_inference uses d11aNNN, 09 uses ab0NN, 10 uses
-- d1..d6 and ff01..ff14, 12_embed_webhook takes its own, and the earlier files
-- use a1, b1..b2, c1..c3, e1..e3, f1..f4 and ffff. ed7a0NN collides with none.
--
-- Ids are chosen so that a001 < a002 < a003, which fixes every canonical
-- orientation below and makes "the wrong way round" a literal.
begin;
select plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.bevs (id, name, brand, flavor, category_id, price_tier, status, source, photo_path)
values
  ('00000000-0000-4000-8000-00000ed7a001', 'pgTAP Writer One',   'Writer Co', null, 'soda', 2, 'active', 'user', 'pgtap/w1.jpg'),
  ('00000000-0000-4000-8000-00000ed7a002', 'pgTAP Writer Two',   'Writer Co', null, 'soda', 2, 'active', 'user', 'pgtap/w2.jpg'),
  ('00000000-0000-4000-8000-00000ed7a003', 'pgTAP Writer Three', 'Writer Co', null, 'soda', 2, 'active', 'user', 'pgtap/w3.jpg'),
  ('00000000-0000-4000-8000-00000ed7a004', 'pgTAP Writer Hidden','Writer Co', null, 'soda', 2, 'hidden', 'user', 'pgtap/w4.jpg');

-- 384-d vectors with two meaningful leading components: a001 is the axis, a002
-- is 3/sqrt(10) = 0.9487 from it, a003 is 1/sqrt(2) = 0.7071, and the hidden
-- Bev sits exactly on the axis so that excluding it is visibly a status filter
-- and not a distance accident.
insert into public.bev_embeddings (bev_id, embedding)
select x.id,
       ('[' || x.a::text || ',' || x.b::text || ',0' ||
        (select string_agg(',0', '') from generate_series(1, 381)) || ']')::extensions.vector(384)
  from (values
    ('00000000-0000-4000-8000-00000ed7a001'::uuid, 1, 0),
    ('00000000-0000-4000-8000-00000ed7a002'::uuid, 3, 1),
    ('00000000-0000-4000-8000-00000ed7a003'::uuid, 1, 1),
    ('00000000-0000-4000-8000-00000ed7a004'::uuid, 1, 0)
  ) x(id, a, b);

create temporary table t_payload (label text primary key, rows jsonb) on commit drop;
insert into t_payload (label, rows) values
  ('good', '[{"src_bev_id": "00000000-0000-4000-8000-00000ed7a001",
              "dst_bev_id": "00000000-0000-4000-8000-00000ed7a002",
              "weight": 0.895,
              "components": {"tree": 1, "content": 0.5, "emb": 0.9, "profile": 1, "cop": 0}},
             {"src_bev_id": "00000000-0000-4000-8000-00000ed7a001",
              "dst_bev_id": "00000000-0000-4000-8000-00000ed7a003",
              "weight": 0.5,
              "components": {"tree": 1, "content": 0.5, "emb": 0.2, "profile": 0.4, "cop": 0}}]'::jsonb),
  ('smaller', '[{"src_bev_id": "00000000-0000-4000-8000-00000ed7a002",
                 "dst_bev_id": "00000000-0000-4000-8000-00000ed7a003",
                 "weight": 0.42,
                 "components": {"tree": 1, "content": 0.3, "emb": 0.1, "profile": 0.2, "cop": 0}}]'::jsonb),
  ('reversed', '[{"src_bev_id": "00000000-0000-4000-8000-00000ed7a003",
                  "dst_bev_id": "00000000-0000-4000-8000-00000ed7a001",
                  "weight": 0.5,
                  "components": {}}]'::jsonb),
  ('duplicate', '[{"src_bev_id": "00000000-0000-4000-8000-00000ed7a001",
                   "dst_bev_id": "00000000-0000-4000-8000-00000ed7a002",
                   "weight": 0.5, "components": {}},
                  {"src_bev_id": "00000000-0000-4000-8000-00000ed7a001",
                   "dst_bev_id": "00000000-0000-4000-8000-00000ed7a002",
                   "weight": 0.6, "components": {}}]'::jsonb),
  ('overweight', '[{"src_bev_id": "00000000-0000-4000-8000-00000ed7a001",
                    "dst_bev_id": "00000000-0000-4000-8000-00000ed7a002",
                    "weight": 1.5, "components": {}}]'::jsonb),
  ('unknown', '[{"src_bev_id": "00000000-0000-4000-8000-00000ed7a001",
                 "dst_bev_id": "00000000-0000-4000-8000-00000fffffff",
                 "weight": 0.5, "components": {}}]'::jsonb);

-- ---------------------------------------------------------------------------
-- 1. Grants. One of these replaces the whole mirror; neither is a user action.
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.replace_bev_edges(jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'public.replace_bev_edges(jsonb, text)', 'execute'),
  'neither authenticated nor anon can execute replace_bev_edges'
);
select ok(
  not has_function_privilege('authenticated', 'public.nearest_bev_embeddings(int)', 'execute')
  and not has_function_privilege('anon', 'public.nearest_bev_embeddings(int)', 'execute'),
  'nor nearest_bev_embeddings, which would hand out the embedding neighbourhood of every Bev'
);
select ok(
  has_function_privilege('service_role', 'public.replace_bev_edges(jsonb, text)', 'execute')
  and has_function_privilege('service_role', 'public.nearest_bev_embeddings(int)', 'execute'),
  'the service role can execute both: it is the nightly job'
);

-- ---------------------------------------------------------------------------
-- 2. replace_bev_edges writes, stamps and replaces
-- ---------------------------------------------------------------------------

select is(
  (select public.replace_bev_edges((select rows from t_payload where label = 'good'), '1.2.0')),
  2,
  'the row count comes back, so the job can compare it with what it sent'
);
select is(
  (select version from public.bev_edges
    where src_bev_id = '00000000-0000-4000-8000-00000ed7a001'
      and dst_bev_id = '00000000-0000-4000-8000-00000ed7a002'),
  '1.2.0',
  'p_version is stamped on every row: RANKING_VERSION at compute time'
);
select is(
  (select components->>'emb' from public.bev_edges
    where src_bev_id = '00000000-0000-4000-8000-00000ed7a001'
      and dst_bev_id = '00000000-0000-4000-8000-00000ed7a002'),
  '0.9',
  'and the per-term components survive the round trip'
);
-- The point of "replace": the second call must not leave the first call's rows
-- behind. A nightly rebuild that appended would grow bev_edges without bound
-- and keep edges that dropped out of every top-20.
select is(
  (select public.replace_bev_edges((select rows from t_payload where label = 'smaller'), '1.2.0')),
  1,
  'a second call with fewer rows returns the smaller count'
);
select is(
  (select array_agg(src_bev_id::text || '|' || dst_bev_id::text order by src_bev_id, dst_bev_id) from public.bev_edges),
  array['00000000-0000-4000-8000-00000ed7a002|00000000-0000-4000-8000-00000ed7a003'],
  'and the table holds only the second payload: it is replaced, not appended to'
);

-- ---------------------------------------------------------------------------
-- 3. Validation, all of it before the delete
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.replace_bev_edges((select rows from t_payload where label = 'reversed'), '1.2.0') $$,
  '22023', 'BEVI_VALIDATION',
  'a row stored dst-first is rejected rather than silently reoriented'
);
-- The decisive assertion: the rejected call above must not have emptied the
-- table on its way to failing. That is the difference between "the job failed
-- and the app read yesterday's edges" and "the job failed and the app has none".
select is(
  (select count(*)::int from public.bev_edges),
  1,
  'and the previous generation is still there: nothing is deleted before the payload passes'
);
select throws_ok(
  $$ select public.replace_bev_edges('[]'::jsonb, '1.2.0') $$,
  '22023', 'BEVI_VALIDATION',
  'an empty array is refused: wiping the mirror is never a legitimate result'
);
select throws_ok(
  $$ select public.replace_bev_edges((select rows from t_payload where label = 'duplicate'), '1.2.0') $$,
  '22023', 'BEVI_VALIDATION',
  'two rows for the same unordered pair are a bug in the caller, named as one'
);
select throws_ok(
  $$ select public.replace_bev_edges((select rows from t_payload where label = 'overweight'), '1.2.0') $$,
  '22023', 'BEVI_VALIDATION',
  'a weight outside [0, 1] is rejected before the table''s CHECK can report it anonymously'
);
select throws_ok(
  $$ select public.replace_bev_edges((select rows from t_payload where label = 'unknown'), '1.2.0') $$,
  '22023', 'BEVI_VALIDATION',
  'an id that is not a Bev is rejected before the delete, not by the foreign key after it'
);

-- ---------------------------------------------------------------------------
-- 4. The KNN probe
-- ---------------------------------------------------------------------------
-- a001's neighbours, nearest first, are a002 (0.9487) then a003 (0.7071). The
-- hidden Bev sits on a001's own axis -- cosine 1, the nearest of all -- so its
-- absence is the status filter and nothing else. Self is excluded.

select is(
  (select array_agg(neighbour_id order by distance)
     from public.nearest_bev_embeddings(10)
    where bev_id = '00000000-0000-4000-8000-00000ed7a001'),
  array['00000000-0000-4000-8000-00000ed7a002'::uuid,
        '00000000-0000-4000-8000-00000ed7a003'::uuid],
  'nearest first, no self, and the hidden Bev is excluded despite being the closest'
);
select ok(
  (select bool_and(n = 1) from (
     select count(*) as n from public.nearest_bev_embeddings(1) group by bev_id
   ) c),
  'p_limit bounds the neighbours per Bev, not the result as a whole'
);

select * from finish();
rollback;
