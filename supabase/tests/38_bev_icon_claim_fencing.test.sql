begin;
select no_plan();
delete from public.bev_icon_jobs;
insert into auth.users(id,email,raw_user_meta_data,aud,role) values
 ('00000000-0000-4000-8000-0000000fc0a1','iconfence@users.bevi.app','{"invite_code":"local-test-invite-code"}','authenticated','authenticated');
insert into public.bevs(id,name,brand,category_id,price_tier,status,source,photo_path,created_by) values
 ('00000000-0000-4000-8000-0000000fc001','Fence fixture','pgTAP fence','soda',2,'active','user','fixture.jpg','00000000-0000-4000-8000-0000000fc0a1');
insert into public.bev_icon_jobs(bev_id,source_photo_path) values('00000000-0000-4000-8000-0000000fc001','source.jpg');
create temp table first_claim as select * from public.claim_bev_icon_jobs_v2(1);
select is((select count(*)::integer from first_claim),1,'first worker gets one job');
select ok((select claim_token is not null from first_claim),'claim has a unique lease');
select is((select count(*)::integer from public.claim_bev_icon_jobs_v2(1)),0,'fresh processing job is not claimed again');
update public.bev_icon_jobs set started_at=now()-interval '6 minutes';
create temp table second_claim as select * from public.claim_bev_icon_jobs_v2(1);
select isnt((select claim_token from first_claim),(select claim_token from second_claim),'stale recovery generates a new token');
select is((select attempt_count from second_claim),2,'recovery counts another attempt');
select is(public.release_bev_icon_job_v2('00000000-0000-4000-8000-0000000fc001',(select claim_token from first_claim),'late'),false,'late release cannot undo a newer claim');
select is(public.finish_bev_icon_job_v2('00000000-0000-4000-8000-0000000fc001',(select claim_token from first_claim),'failed',null,'late'),false,'late failure cannot undo newer work');
select is(public.finish_bev_icon_job_v2('00000000-0000-4000-8000-0000000fc001',(select claim_token from first_claim),'completed','wrong'),false,'late success cannot publish');
select is((select status from public.bev_icon_jobs),'processing','late reports changed no status');
select throws_ok($q$select public.finish_bev_icon_job_v2('00000000-0000-4000-8000-0000000fc001',(select claim_token from second_claim),'completed','another-claim/icon-768.png')$q$,'22023','BEVI_VALIDATION','cannot publish a path outside the current attempt');
select ok(public.release_bev_icon_job_v2('00000000-0000-4000-8000-0000000fc001',(select claim_token from second_claim),'quota'),'current claim can release');
select is((select attempt_count from public.bev_icon_jobs),1,'quota release restores attempt allowance');
select ok((select next_attempt_at > now() from public.bev_icon_jobs),'quota release backs off instead of hammering provider each minute');
select is(public.release_bev_icon_job_v2('00000000-0000-4000-8000-0000000fc001',(select claim_token from second_claim),'duplicate'),false,'duplicate release does not decrement again');
select is((select count(*)::integer from public.claim_bev_icon_jobs_v2(1)),0,'backoff prevents immediate claim');
update public.bev_icon_jobs set next_attempt_at=now();
create temp table third_claim as select * from public.claim_bev_icon_jobs_v2(1);
select isnt((select claim_token from third_claim),(select claim_token from second_claim),'released/reclaimed job has another token');
select ok(public.finish_bev_icon_job_v2('00000000-0000-4000-8000-0000000fc001',(select claim_token from third_claim),'completed',
 '00000000-0000-4000-8000-0000000fc001/'||(select claim_token::text from third_claim)||'/icon-768.png'),'current token may publish its own immutable path');
select is(public.finish_bev_icon_job_v2('00000000-0000-4000-8000-0000000fc001',(select claim_token from third_claim),'failed',null,'duplicate'),false,'duplicate finish cannot change a completed icon');
select is((select icon_status from public.bevs where id='00000000-0000-4000-8000-0000000fc001'),'completed','completed icon preserved');
select is((select count(*)::integer from public.claim_bev_icon_jobs_v2(1)),0,'completed job never regenerated');
select * from finish();
rollback;
