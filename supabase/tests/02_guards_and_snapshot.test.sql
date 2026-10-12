-- The timezone guard (20261012000900) and the prediction snapshot's age gate
-- (20261012000600), as a signed-in under-21 user.
begin;
select plan(5);

-- A throwaway user (handle_new_user creates the profile; seed.sql's local invite code).
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000a1', 'pgtapminor@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');
update public.profiles set birth_date = (current_date - interval '16 years')::date
 where id = '00000000-0000-4000-8000-0000000000a1';

select throws_ok(
  $$ update public.profiles set timezone = 'Not/AZone' where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '22023', 'BEVI_VALIDATION',
  'an unknown timezone is rejected'
);
select lives_ok(
  $$ update public.profiles set timezone = 'Asia/Kolkata' where id = '00000000-0000-4000-8000-0000000000a1' $$,
  'a real timezone is accepted'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';

select is(
  (select count(*)::int
     from jsonb_array_elements(public.get_prediction_snapshot() -> 'bevs') b
    where (b ->> 8)::boolean),
  0,
  'an under-21 snapshot has no alcoholic Bevs'
);
select ok(
  not exists (
    select 1 from jsonb_object_keys(public.get_prediction_snapshot() -> 'global' -> 'byCategoryMean') k
     where k in ('beer', 'wine', 'spirits_cocktails')
  ),
  'nor alcoholic category means'
);
select is(
  (public.get_prediction_snapshot() -> 'viewer' ->> 'canSeeAlcohol')::boolean, false,
  'the viewer flag says so'
);

reset role;
select * from finish();
rollback;
