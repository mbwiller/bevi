-- Automatic generation: photo-backed creation queues one durable job.
begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data,aud,role) values
 ('00000000-0000-4000-8000-0000000fb0a1','iconv4@users.bevi.app','{"invite_code":"local-test-invite-code"}','authenticated','authenticated');
insert into storage.objects(bucket_id,name,owner_id) values
 ('bev-photos','00000000-0000-4000-8000-0000000fb0a1/source.jpg','00000000-0000-4000-8000-0000000fb0a1');
select ok((select relrowsecurity from pg_class where oid='public.bev_icon_jobs'::regclass),'job ledger has RLS');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='bev_icon_jobs'),0,'no client job policies');
select ok(not has_table_privilege('authenticated','public.bev_icon_jobs','SELECT'),'clients cannot read provider diagnostics');
select ok(not has_function_privilege('service_role','public.claim_bev_icon_jobs(integer)','EXECUTE'),'old unfenced claim RPC disabled');
select ok(not has_function_privilege('service_role','public.finish_bev_icon_job(uuid,text,text,text,jsonb)','EXECUTE'),'old unfenced finish RPC disabled');
select ok(not has_function_privilege('service_role','public.release_bev_icon_job(uuid,text)','EXECUTE'),'old unfenced release RPC disabled');
select ok(has_function_privilege('service_role','public.claim_bev_icon_jobs_v2(integer)','EXECUTE'),'service role can claim with a lease');
select ok(not has_function_privilege('authenticated','public.claim_bev_icon_jobs_v2(integer)','EXECUTE'),'users cannot claim worker jobs');
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-0000000fb0a1","role":"authenticated"}';
select lives_ok($q$select public.create_bev('Icon v4 Photo','pgTAP v4',null,'coffee',2::smallint,false,null,'00000000-0000-4000-8000-0000000fb0a1/source.jpg',null)$q$,'photo-backed creation succeeds');
select lives_ok($q$select public.create_bev('Icon v4 No Photo','pgTAP v4',null,'coffee',2::smallint,false,null,null,null)$q$,'photo-less creation succeeds');
reset role;
select is((select count(*)::integer from public.bev_icon_jobs j join public.bevs b on b.id=j.bev_id where b.brand='pgTAP v4'),1,'photo-backed create automatically queues exactly one job');
select is((select source_photo_path from public.bev_icon_jobs j join public.bevs b on b.id=j.bev_id where b.name='Icon v4 Photo'),'00000000-0000-4000-8000-0000000fb0a1/source.jpg','job captures the uploaded creation photo');
select is((select j.status from public.bev_icon_jobs j join public.bevs b on b.id=j.bev_id where b.name='Icon v4 Photo'),'pending','new job is durably pending');
select is((select icon_status from public.bevs where name='Icon v4 Photo'),'pending','photo-backed Bev displays generation pending');
set local role authenticated;
select is((select count(*)::integer from public.get_bev_icons(array[(select id from public.bevs where name='Icon v4 Photo')])) ,1,'icon status read still returns the visible Bev');
reset role;
select is((select count(*)::integer from public.bev_icon_jobs j join public.bevs b on b.id=j.bev_id where b.brand='pgTAP v4'),1,'reading status does not enqueue duplicate work');
-- Preserve the generated-art merge behavior while changing who may enqueue it.
insert into public.bevs(id,name,brand,category_id,price_tier,status,source,photo_path,created_by,generated_icon_path,icon_status)
values ('00000000-0000-4000-8000-0000000fb021','Merge v4 source','pgTAP v4','coffee',2,'active','user','fixture.jpg','00000000-0000-4000-8000-0000000fb0a1','source/icon.png','completed'),
       ('00000000-0000-4000-8000-0000000fb022','Merge v4 target','pgTAP v4','coffee',2,'active','user','fixture.jpg','00000000-0000-4000-8000-0000000fb0a1',null,'none');
update public.bevs set status='merged',merged_into='00000000-0000-4000-8000-0000000fb022' where id='00000000-0000-4000-8000-0000000fb021';
select is((select generated_icon_path from public.bevs where id='00000000-0000-4000-8000-0000000fb022'),'source/icon.png','merge still transfers generated art to a survivor without it');
set local role authenticated;
select is((select generated_icon_path from public.get_bev_icons(array['00000000-0000-4000-8000-0000000fb022'::uuid])),'source/icon.png','generated-art read path still returns the stored object path');
reset role;
select * from finish();
rollback;
