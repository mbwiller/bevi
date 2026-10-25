-- D-11 (20261023000200): a flavour profile for a user-created Bev.
--
-- Decided 2026-10-19, option 1 (TASKS.md D-11, spelled out under A-16 (1)):
-- a Bev with no profile copies the profile of its most similar SEEDED Bev,
-- marked as inferred. The rule, verbatim from A-16 (1):
--
--   * only seeded Bevs (never inferred ones) IN THE SAME CATEGORY are candidates;
--   * the nearest by embedding cosine wins, with brand match as the tie-break;
--   * it copies that Bev's profile with the flag, the source Bev and the similarity;
--   * below a cosine of 0.6 the profile stays EMPTY and the Bev falls back to
--     category and brand (which is what the tree and content terms of
--     `edgeWeight` already are -- a Bev with no profile gets profile = 0, not a
--     guessed profile, and loses at most the 0.30 that term carries).
--
-- Two callers: `scripts/graph/build-edges.ts`, which calls this for every
-- active Bev without a profile before it computes weights, and (later) the
-- `bevs` write webhook's Edge Function. Both run as the service role, which is
-- the only role granted EXECUTE below.
--
-- 20261014000400 already anticipated this: `bev_flavor_profiles.source` is
-- `check (source in ('catalog', 'inferred'))` with the comment "'inferred' is
-- copied from the nearest seeded Bev by embedding for a Bev a user created
-- (D-11) and relabelled later". So the flag ALREADY EXISTS as a value of
-- `source`, and this migration does not add a second, independently settable
-- boolean beside it -- two columns that can disagree about the same fact is how
-- a relabelling step ends up with half-inferred rows. What it adds is the
-- provenance that `source` cannot carry on its own.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
-- Existing shape (20261014000400): bev_id, base, carbonated, caffeine,
-- sweetness, dairy, alcohol, serve, source, updated_at. Nothing is renamed:
-- those names are the S-14 contract with M-24's `profileSimilarity` and 378
-- hand-labelled rows.

alter table public.bev_flavor_profiles
  -- The source Bev, so a relabelling pass (and a reviewer) can see what the
  -- profile was copied FROM. `on delete set null` rather than cascade: if the
  -- seeded Bev is deleted the copy is still the best label this row has, and
  -- deleting a user's Bev's profile because an unrelated catalog row went away
  -- would be worse than losing the provenance.
  add column inferred_from uuid references public.bevs(id) on delete set null,

  -- The embedding cosine at copy time, in [0, 1] like every similarity in
  -- @bevi/ranking. `numeric` and not `real`: it is reported, compared against
  -- the 0.6 floor and sorted on, and bev_edges.weight is numeric for the same
  -- reason.
  add column inferred_similarity numeric
    check (inferred_similarity is null or (inferred_similarity >= 0 and inferred_similarity <= 1)),

  -- The flag D-11 asks for, derived rather than stored twice. A generated
  -- column is the table's own idiom's nearest neighbour in this schema
  -- (`bevs.search_text`, 20261009000300), and it cannot drift from `source`.
  add column inferred boolean generated always as (source = 'inferred') stored;

-- The provenance belongs to inferred rows and only to them: a hand-labelled
-- catalog row was copied from nothing, and an inferred row that cannot say
-- where it came from is exactly the state this migration exists to prevent.
-- Written against `source` rather than the generated column so the constraint
-- reads in the same terms the check on `source` already does.
alter table public.bev_flavor_profiles
  add constraint bev_flavor_profiles_inferred_provenance check (
    (source = 'inferred' and inferred_from is not null and inferred_similarity is not null)
    or (source = 'catalog' and inferred_from is null and inferred_similarity is null)
  );

comment on column public.bev_flavor_profiles.inferred_from is
  'D-11: the seeded Bev whose profile this row was copied from. Null for hand-labelled catalog rows.';
comment on column public.bev_flavor_profiles.inferred_similarity is
  'D-11: the embedding cosine between this Bev and inferred_from at copy time. Never below 0.6 -- below that no row is written at all.';
comment on column public.bev_flavor_profiles.inferred is
  'D-11: true iff source = ''inferred''. Generated, so it cannot disagree with source when a row is relabelled.';

-- "Which rows still need a human label?" and "what did this seed Bev get
-- copied onto?" are the two queries Matt and Arjun will run while relabelling.
-- Partial, because the 378 catalog rows are not the answer to either.
create index bev_flavor_profiles_inferred_from_idx
  on public.bev_flavor_profiles (inferred_from)
  where source = 'inferred';

-- ---------------------------------------------------------------------------
-- 2. RLS: columns added to an existing table, so the question is whether the
--    existing policy still makes sense
-- ---------------------------------------------------------------------------
-- It does, and the reasoning is worth writing down rather than assumed.
--
-- `bev_flavor_profiles_select` (20261014000400) is `for select to authenticated
-- using (true)`, justified as: "The Bev row behind it carries the age gate, so
-- there is nothing to gate here -- a profile for a Bev the viewer cannot see
-- reveals only that some drink is carbonated."
--
-- The three new columns do not weaken that:
--   * `inferred` and `inferred_similarity` are statements about THIS row's
--     labelling quality. They say nothing about any other Bev.
--   * `inferred_from` is the id of a SEEDED Bev in the same category. It is new
--     information in form -- "this Bev's profile was copied from that one" --
--     but not in substance: under `using (true)` the same caller can already
--     read every profile row, including each one's `alcohol` flag, for every
--     Bev in the catalog. A uuid it could already enumerate, paired with a
--     category it already knows, discloses nothing `bevs_select` withholds.
--   * The age gate is unaffected either way: it lives on `bevs` and
--     `categories`, and nothing here joins to a Bev the caller cannot see in
--     order to decide what to show.
--
-- There is still no insert/update/delete policy, which is the supabase/CLAUDE.md
-- rule for a content table: the seed migration writes as postgres and this
-- migration's function writes as a definer. `authenticated` has no write path
-- to a flavour profile, inferred or not, and 13_flavor_inference.test.sql
-- asserts it cannot even execute the function.
--
-- Deliberately NOT narrowed to hide `inferred_from` behind the age gate. That
-- would mean a column-level grant or a view, and it would buy nothing while the
-- table it protects is already `using (true)` -- a policy that looks protective
-- and is not is worse than one that is honest about its scope (the lesson
-- 20261019000500 wrote out at length about fail-open `not exists` predicates).

-- ---------------------------------------------------------------------------
-- 3. infer_bev_flavor_profile(p_bev_id)
-- ---------------------------------------------------------------------------
-- Exactly one row out, always, so a caller can log what happened per Bev:
--
--   outcome          meaning
--   ---------------  -------------------------------------------------------
--   'has_profile'    the Bev already has a row; nothing written (idempotent)
--   'no_embedding'   this Bev has no row in bev_embeddings yet
--   'no_candidate'   no seeded, catalog-labelled Bev in the same category has
--                    an embedding
--   'below_floor'    the nearest such Bev is below 0.6 cosine; NOTHING written,
--                    the profile stays empty, and the Bev falls back to the
--                    category and brand terms
--   'inferred'       a row was written; inferred_from and similarity are set
--
-- `search_path` is pinned and includes `extensions`, because the `vector` type
-- and the `<=>` operator live there (20261019000500 pins the extension's schema
-- for exactly this reason) -- without it this function cannot even parse.
--
-- security definer: it writes a content table that has no write policy, which
-- is the supabase/CLAUDE.md pattern. It is NOT callable by `authenticated`:
-- inferring a profile is a pipeline step, not a user action, and letting a user
-- trigger it would let them write a row into a catalog table.

create or replace function public.infer_bev_flavor_profile(p_bev_id uuid)
returns table (
  bev_id        uuid,
  outcome       text,
  inferred_from uuid,
  similarity    numeric
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  -- The floor from D-11. A cosine below this means the nearest seeded Bev in
  -- the category is not actually similar, and a copied profile would be a
  -- confident wrong answer -- worse than no answer, because `profileSimilarity`
  -- weights `base` at 0.40 and would then push the Bev towards the wrong family.
  v_floor      constant numeric := 0.6;
  -- Explicitly typed rather than a `record`, so `<=>` is resolved against a
  -- declared `extensions.vector(384)` instead of a runtime row descriptor.
  v_category   text;
  v_brand      text;
  v_embedding  extensions.vector(384);
  v_best       record;
begin
  if p_bev_id is null then
    raise exception 'BEVI_VALIDATION' using errcode = '22023', detail = 'bevId';
  end if;

  if exists (select 1 from public.bev_flavor_profiles p where p.bev_id = p_bev_id) then
    return query select p_bev_id, 'has_profile'::text, null::uuid, null::numeric;
    return;
  end if;

  select b.category_id, b.brand, e.embedding
    into v_category, v_brand, v_embedding
    from public.bevs b
    join public.bev_embeddings e on e.bev_id = b.id
   where b.id = p_bev_id;

  if not found then
    return query select p_bev_id, 'no_embedding'::text, null::uuid, null::numeric;
    return;
  end if;

  -- The candidate rule, and the whole of D-11's choice:
  --   * `b.source = 'seed'` -- only seeded Bevs.
  --   * `p.source = 'catalog'` -- never an inferred profile, so one bad copy
  --     cannot propagate down a chain of user-created Bevs.
  --   * same category. Not "same category subtree": there is no subtree until
  --     A-13 adds categories.parent_id, and when it does, this is the one
  --     predicate that has to widen.
  --   * order: cosine distance ascending (pgvector's `<=>`), then BRAND MATCH
  --     as the tie-break, then `b.id` so the order is total and the result is
  --     the same on every run -- `b.id` is a `uuid`, whose byte order matches
  --     the code-unit order of its lowercase-hex text form, so this agrees with
  --     the tie-break `topEdges` uses (M-24's note about `collate "C"`). The brand
  --     comparison uses the same expression as `list_bucket_bevs.brand_key`,
  --     which matches `normaliseBrand()` in @bevi/ranking -- collapse inner
  --     whitespace BEFORE trimming, null when empty -- so "same brand" means
  --     the same thing here as it does in `contentSimilarity`.
  --   * `is not distinct from` rather than `=`, so two unbranded Bevs do not
  --     count as a brand match (null = null is null, which would sort as
  --     "unknown" and make the tie-break depend on the plan).
  --
  -- 1 - (a <=> b) is the cosine: `vector_cosine_ops` defines `<=>` as cosine
  -- DISTANCE. It is clamped into [0, 1] to satisfy the column's CHECK against
  -- float error at the extremes, and because `embeddingSimilarity` in
  -- @bevi/ranking clamps the same way (negative cosine means "no similarity",
  -- not a negative one).
  --
  -- This is deliberately an EXACT search, not an approximate one. The three
  -- equality filters are not something an HNSW scan can apply, so an index-
  -- ordered plan would fetch its `ef_search` neighbours, discard the ones in
  -- the wrong category, and could return a worse match than the real nearest
  -- -- or none at all. At 378 Bevs a filtered sequential scan with exact
  -- distances costs microseconds and cannot be wrong, and being right is what
  -- matters for a label that then drives 0.30 of every edge weight. The HNSW
  -- index earns its keep in `nearest_bev_embeddings` (20261023000300), where
  -- the probe is unfiltered.
  select p.*,
         b.id as src_id,
         greatest(0, least(1, 1 - (e.embedding <=> v_embedding)))::numeric as cosine
    into v_best
    from public.bevs b
    join public.bev_embeddings e on e.bev_id = b.id
    join public.bev_flavor_profiles p on p.bev_id = b.id
   where b.id <> p_bev_id
     and b.category_id = v_category
     and b.source = 'seed'
     and p.source = 'catalog'
   order by e.embedding <=> v_embedding asc,
            (nullif(btrim(regexp_replace(lower(b.brand), '\s+', ' ', 'g')), '')
               is not distinct from
             nullif(btrim(regexp_replace(lower(v_brand), '\s+', ' ', 'g')), '')) desc,
            b.id asc
   limit 1;

  if not found then
    return query select p_bev_id, 'no_candidate'::text, null::uuid, null::numeric;
    return;
  end if;

  if v_best.cosine < v_floor then
    return query select p_bev_id, 'below_floor'::text, v_best.src_id, v_best.cosine;
    return;
  end if;

  insert into public.bev_flavor_profiles
    (bev_id, base, carbonated, caffeine, sweetness, dairy, alcohol, serve,
     source, inferred_from, inferred_similarity)
  values
    (p_bev_id, v_best.base, v_best.carbonated, v_best.caffeine, v_best.sweetness,
     v_best.dairy, v_best.alcohol, v_best.serve,
     'inferred', v_best.src_id, v_best.cosine)
  -- Idempotent under a concurrent caller: the nightly job and the write webhook
  -- can both reach the same new Bev, and the second one should be a no-op
  -- rather than a unique violation that fails a whole run.
  on conflict (bev_id) do nothing;

  -- `found` is false when the conflict clause swallowed the row, i.e. another
  -- caller got there first. Reporting 'inferred' then would be a small lie in
  -- the one log a human reads to judge a run.
  if not found then
    return query select p_bev_id, 'has_profile'::text, null::uuid, null::numeric;
    return;
  end if;

  return query select p_bev_id, 'inferred'::text, v_best.src_id, v_best.cosine;
end;
$$;

comment on function public.infer_bev_flavor_profile(uuid) is
  'D-11: copies the nearest seeded, catalog-labelled Bev''s flavour profile onto p_bev_id (same category, embedding cosine, brand tie-break), marked source=''inferred''. Writes nothing below 0.6 cosine. Service role only.';

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- Supabase's default privileges lay down a direct EXECUTE grant to anon,
-- authenticated and service_role on every new function in `public`, and a
-- revoke from PUBLIC does not touch those (20261019000400 learned this the hard
-- way, 20261019000500 repeats the lesson). So anon and authenticated are named
-- explicitly, and service_role's grant is written out rather than relied upon.
--
-- Who may execute it: the service role, and nobody else. The builder
-- (`scripts/graph/build-edges.ts`) and the `bevs` write webhook are both
-- service-role callers. No end user has any reason to write a catalog row, and
-- an RPC that inserts into a table with no insert policy is precisely the thing
-- supabase/CLAUDE.md says must validate its caller -- here the validation is
-- that there is no end-user caller at all.

alter function public.infer_bev_flavor_profile(uuid) owner to postgres;

revoke execute on function public.infer_bev_flavor_profile(uuid) from public, anon, authenticated;

grant execute on function public.infer_bev_flavor_profile(uuid) to service_role;
