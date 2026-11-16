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
select * from finish();
rollback;
