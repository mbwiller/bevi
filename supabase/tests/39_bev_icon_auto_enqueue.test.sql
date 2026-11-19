begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data,aud,role) values
 ('00000000-0000-4000-8000-0000000fd0a1','icon_auto@users.bevi.app','{"invite_code":"local-test-invite-code"}','authenticated','authenticated');
insert into storage.objects(bucket_id,name,owner_id) values
 ('bev-photos','00000000-0000-4000-8000-0000000fd0a1/source.jpg','00000000-0000-4000-8000-0000000fd0a1');
select ok(to_regclass('public.icon_credit_ledger') is null,'generation does not depend on a credit ledger');
select ok(to_regprocedure('public.request_bev_icon(uuid,uuid)') is null,'generation does not require a request RPC');
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-0000000fd0a1","role":"authenticated"}';
select lives_ok($q$select public.create_bev('Automatic icon photo','pgTAP auto',null,'coffee',2::smallint,false,null,'00000000-0000-4000-8000-0000000fd0a1/source.jpg',null)$q$,'creating a Bev with a photo succeeds without opting in');
select lives_ok($q$select public.create_bev('Automatic icon no photo','pgTAP auto',null,'coffee',2::smallint,false,null,null,null)$q$,'creating a Bev without a photo succeeds');
reset role;
select is((select count(*)::integer from public.bev_icon_jobs j join public.bevs b on b.id=j.bev_id where b.brand='pgTAP auto'),1,'only the photo-backed Bev creates a job');
select is((select j.source_photo_path from public.bev_icon_jobs j join public.bevs b on b.id=j.bev_id where b.name='Automatic icon photo'),'00000000-0000-4000-8000-0000000fd0a1/source.jpg','job uses the original uploaded photo');
select is((select b.icon_status from public.bevs b where b.name='Automatic icon photo'),'pending','new photo-backed Bev advertises pending generation');
select is((select b.icon_status from public.bevs b where b.name='Automatic icon no photo'),'none','photo-less Bev has no generation state');
create temp table claimed as select * from public.claim_bev_icon_jobs_v2(1);
select is((select count(*)::integer from claimed),1,'worker can claim the automatically queued Bev');
select is((select source_photo_path from claimed),'00000000-0000-4000-8000-0000000fd0a1/source.jpg','worker receives that original photo path');

-- AND FOR NOTHING ELSE. The requirement is a negative as much as a positive:
-- a job exists for a brand-new Bev created WITH a photograph, and for no other
-- event. `enqueue_bev_icon_job` is called only by `create_bev` today, so both
-- cases below hold by construction -- which is exactly why they are asserted
-- rather than assumed. They are the two an `AFTER UPDATE` trigger on
-- `public.bevs` would get wrong, and that is the shape anyone wiring up
-- "generate an icon when a photo appears" would reach for next.
--
-- As the owner: `authenticated` has only `bevs_select` on that table, so a
-- client-side edit matches no row, raises nothing, and would assert nothing.
select lives_ok(
  $q$ update public.bevs set name = 'Automatic icon photo renamed', updated_at = now()
       where name = 'Automatic icon photo' $q$,
  'renaming a Bev succeeds');
select is((select count(*)::integer from public.bevs where name = 'Automatic icon photo renamed'),
          1,'and the rename actually landed, so the count below is about an edit that happened');
select is((select count(*)::integer from public.bev_icon_jobs j
             join public.bevs b on b.id = j.bev_id where b.brand = 'pgTAP auto'),
          1,'a rename queues no further job: an edit is not a creation');

select lives_ok(
  $q$ update public.bevs
         set photo_path = 'fd0a1/added-later.jpg', thumb_path = 'fd0a1/added-later.jpg',
             status = 'active', updated_at = now()
       where name = 'Automatic icon no photo' $q$,
  'a photo can be added to an existing Bev afterwards');
select is((select count(*)::integer from public.bev_icon_jobs j
             join public.bevs b on b.id = j.bev_id where b.name = 'Automatic icon no photo'),
          0,'a photo added after creation queues nothing: only the creation workflow is eligible');
select is((select icon_status from public.bevs where name = 'Automatic icon no photo'),
          'none','and that Bev stays ''none'' rather than becoming pending');

select * from finish();
rollback;
