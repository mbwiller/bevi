-- Profile photos (20261019000300): the avatars storage policy and limits,
-- set_avatar(), and the avatar_path pin in protect_profile_columns.
begin;
select plan(17);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000e1', 'pgtapavatar1@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000e2', 'pgtapavatar2@users.bevi.app',
        '{"invite_code": "local-test-invite-code"}', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- Storage: the policy and the bucket limits
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'storage_avatars_insert'
      and cmd = 'INSERT' and 'authenticated' = any(roles)
      and with_check like '%upload_quota_ok()%'),
  1,
  'authenticated may insert into avatars (own folder only), behind upload_quota_ok()'
);
select ok(
  (select pg_get_functiondef('public.upload_quota_ok()'::regprocedure) like '%''avatars''%'),
  'upload_quota_ok() counts avatars uploads too'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'storage_avatars_%' and cmd <> 'INSERT'),
  0,
  'no select/update/delete policy on avatars objects (the bucket is public; uploads never overwrite)'
);
select is(
  (select file_size_limit from storage.buckets where id = 'avatars'),
  (10 * 1024 * 1024)::bigint,
  'avatars objects are capped at 10 MB'
);
select ok(
  (select allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
     and array_length(allowed_mime_types, 1) = 4
     from storage.buckets where id = 'avatars'),
  'avatars accepts exactly the four image types media.upload allows'
);

-- ---------------------------------------------------------------------------
-- set_avatar grants
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.set_avatar(text)', 'execute'),
  'authenticated may call set_avatar');
select ok(not has_function_privilege('anon', 'public.set_avatar(text)', 'execute'),
  'anon may not call set_avatar');

-- ---------------------------------------------------------------------------
-- Fixture objects, inserted by the owner: the Storage API is not in the
-- picture here, and storage.objects RLS would stop `authenticated` from
-- planting them. e1 owns one avatar and one bev photo; e2 owns an avatar.
-- ---------------------------------------------------------------------------

-- `planted.jpg` sits in e1's folder but was uploaded by e2 (owner_id):
-- the folder rule alone would accept it.
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars',    '00000000-0000-4000-8000-0000000000e1/one.jpg',     '00000000-0000-4000-8000-0000000000e1'),
  ('avatars',    '00000000-0000-4000-8000-0000000000e2/theirs.jpg',  '00000000-0000-4000-8000-0000000000e2'),
  ('avatars',    '00000000-0000-4000-8000-0000000000e1/planted.jpg', '00000000-0000-4000-8000-0000000000e2'),
  ('bev-photos', '00000000-0000-4000-8000-0000000000e1/photo.jpg',   '00000000-0000-4000-8000-0000000000e1');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';

select throws_ok(
  $$ select public.set_avatar('00000000-0000-4000-8000-0000000000e1/missing.jpg') $$,
  '22023', 'BEVI_VALIDATION',
  'set_avatar: an object that does not exist is validation'
);
select throws_ok(
  $$ select public.set_avatar('00000000-0000-4000-8000-0000000000e2/theirs.jpg') $$,
  '22023', 'BEVI_VALIDATION',
  'set_avatar: another user''s object is validation'
);
select throws_ok(
  $$ select public.set_avatar('00000000-0000-4000-8000-0000000000e1/photo.jpg') $$,
  '22023', 'BEVI_VALIDATION',
  'set_avatar: an object in another bucket is validation'
);
select throws_ok(
  $$ select public.set_avatar('00000000-0000-4000-8000-0000000000e1/planted.jpg') $$,
  '22023', 'BEVI_VALIDATION',
  'set_avatar: an object in your folder that someone else uploaded is validation'
);

select is(
  (select avatar_path from public.set_avatar('00000000-0000-4000-8000-0000000000e1/one.jpg')),
  '00000000-0000-4000-8000-0000000000e1/one.jpg',
  'set_avatar points avatar_path at your own upload'
);
select is(
  (select avatar_path from public.profiles_view where id = '00000000-0000-4000-8000-0000000000e1'),
  '00000000-0000-4000-8000-0000000000e1/one.jpg',
  'profiles_view shows the new avatar_path'
);
select is(
  current_setting('bevi.rpc_bypass', true),
  'false',
  'set_avatar clears the bypass flag before it returns'
);

-- The own-row update policy still lets a client update profiles directly;
-- avatar_path must not move that way (it could point at anyone's object).
update public.profiles
   set avatar_path = '00000000-0000-4000-8000-0000000000e2/theirs.jpg', display_name = 'Renamed'
 where id = '00000000-0000-4000-8000-0000000000e1';
select is(
  (select avatar_path || ' / ' || display_name from public.profiles_view
    where id = '00000000-0000-4000-8000-0000000000e1'),
  '00000000-0000-4000-8000-0000000000e1/one.jpg / Renamed',
  'a direct update keeps avatar_path (silently) while the other columns save'
);

select is(
  (select avatar_path from public.set_avatar(null)),
  null::text,
  'set_avatar(null) removes the photo'
);

-- ---------------------------------------------------------------------------
-- Signed out
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$ select public.set_avatar('00000000-0000-4000-8000-0000000000e1/one.jpg') $$,
  '42501', null,
  'anon cannot call set_avatar'
);

select * from finish();
rollback;
