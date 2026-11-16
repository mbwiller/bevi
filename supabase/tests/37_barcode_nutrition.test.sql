begin;
select plan(23);
insert into auth.users (id,email,raw_user_meta_data,aud,role) values
 ('00000000-0000-4000-8000-0000000fb0a1','pgtapnutrition1@users.bevi.app','{"invite_code":"local-test-invite-code"}','authenticated','authenticated'),
 ('00000000-0000-4000-8000-0000000fb0a2','pgtapnutrition2@users.bevi.app','{"invite_code":"local-test-invite-code"}','authenticated','authenticated');
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date='1990-01-01' where id='00000000-0000-4000-8000-0000000fb0a1';
update public.profiles set birth_date='2010-01-01' where id='00000000-0000-4000-8000-0000000fb0a2';
set local bevi.rpc_bypass = 'false';
set local test.nutrition = '{"barcode":"012345678901","productName":"Test water","basis":"Per serving (355 ml)","sourceUrl":"https://world.openfoodfacts.org/product/012345678901","calories":0,"fatGrams":null,"carbohydrateGrams":0,"sugarGrams":0,"proteinGrams":null,"sodiumMg":4}';
select has_table('public','bev_nutrition','nutrition table exists');
select ok((select relrowsecurity from pg_class where oid='public.bev_nutrition'::regclass),'RLS enabled');
select ok(not has_function_privilege('anon','public.create_bev_with_nutrition(text,text,text,text,smallint,boolean,text,text,jsonb)','execute'),'anonymous callers cannot create');
select ok(has_function_privilege('authenticated','public.create_bev_with_nutrition(text,text,text,text,smallint,boolean,text,text,jsonb)','execute'),'authenticated callers can create');
select ok(not has_table_privilege('authenticated','public.bev_nutrition','INSERT,UPDATE,DELETE'),'no direct nutrition writes');
select throws_ok($$ select public.create_bev_with_nutrition('No user',null,null,'soda',2::smallint,false,null,null,current_setting('test.nutrition')::jsonb) $$,'42501','BEVI_UNAUTHORIZED','no auth uid is rejected');
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-0000000fb0a1","role":"authenticated"}';
select lives_ok($$ select public.create_bev_with_nutrition('pgTAP Nutrition Water','pgTAP Nutrition',null,'soda',2::smallint,false,null,null,current_setting('test.nutrition')::jsonb) $$,'creates Bev and nutrition atomically');
select is((select count(*)::int from public.bev_nutrition),1,'creator sees nutrition on their pending-photo Bev');
select is((select nutrition->>'calories' from public.bev_nutrition),'0','zero remains zero');
select is((select nutrition->'fatGrams' from public.bev_nutrition),'null'::jsonb,'missing nutrient remains null');
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-0000000fb0a2","role":"authenticated"}';
select is((select count(*)::int from public.bev_nutrition),0,'another user cannot read pending-photo nutrition');
reset role;
update public.bevs set status='active', photo_path='nutrition-test/photo.jpg' where name='pgTAP Nutrition Water';
set local role authenticated;
select is((select count(*)::int from public.bev_nutrition),1,'visible active Bev nutrition is readable');
reset role;
update public.bevs set status='hidden' where name='pgTAP Nutrition Water';
set local role authenticated;
select is((select count(*)::int from public.bev_nutrition),0,'hidden Bev nutrition is hidden');
reset role;
update public.bevs set status='active', category_id='beer' where name='pgTAP Nutrition Water';
set local role authenticated;
select is((select count(*)::int from public.bev_nutrition),0,'minor cannot read alcohol nutrition');
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-0000000fb0a1","role":"authenticated"}';
select throws_ok($$ select public.create_bev_with_nutrition('Invalid negative',null,null,'soda',2::smallint,false,null,null,current_setting('test.nutrition')::jsonb || '{"calories":-1}') $$,'22023','BEVI_VALIDATION','negative amounts rejected');
select throws_ok($$ select public.create_bev_with_nutrition('Invalid string',null,null,'soda',2::smallint,false,null,null,current_setting('test.nutrition')::jsonb || '{"sugarGrams":"12"}') $$,'22023','BEVI_VALIDATION','wrong numeric types rejected');
select throws_ok($$ select public.create_bev_with_nutrition('Invalid link',null,null,'soda',2::smallint,false,null,null,current_setting('test.nutrition')::jsonb || '{"sourceUrl":"javascript:alert(1)"}') $$,'22023','BEVI_VALIDATION','untrusted source URLs rejected');
select throws_ok($$ select public.create_bev_with_nutrition('Missing keys',null,null,'soda',2::smallint,false,null,null,current_setting('test.nutrition')::jsonb - 'basis') $$,'22023','BEVI_VALIDATION','incomplete snapshots rejected');
select throws_ok($$ select public.create_bev_with_nutrition('Extra keys',null,null,'soda',2::smallint,false,null,null,current_setting('test.nutrition')::jsonb || '{"extra":"bad"}') $$,'22023','BEVI_VALIDATION','unrecognized fields rejected');
select throws_ok($$ select public.create_bev_with_nutrition('Invalid asset',null,null,'soda',2::smallint,false,'someone-elses-photo',null,current_setting('test.nutrition')::jsonb) $$,'22023','BEVI_VALIDATION','original create asset ownership checks still run');
reset role;
select is((select count(*)::int from public.bevs where name in ('Invalid negative','Invalid string','Invalid link','Missing keys','Extra keys','Invalid asset')),0,'failed submissions never leave orphan Bevs');
-- Merging a scanned duplicate carries its snapshot to a destination with none,
-- while retaining the destination's own snapshot when both sides have one.
insert into public.bevs (id, name, category_id, photo_path, price_tier, status, source) values
 ('00000000-0000-4000-8000-0000000fb101','Nutrition Merge Source','water','nutrition/source.jpg',1,'active','seed'),
 ('00000000-0000-4000-8000-0000000fb102','Nutrition Merge Empty','water','nutrition/empty.jpg',1,'active','seed'),
 ('00000000-0000-4000-8000-0000000fb103','Nutrition Merge Source Two','water','nutrition/source-two.jpg',1,'active','seed'),
 ('00000000-0000-4000-8000-0000000fb104','Nutrition Merge Destination Two','water','nutrition/destination-two.jpg',1,'active','seed');
insert into public.bev_nutrition (bev_id, nutrition, source, created_at) values
 ('00000000-0000-4000-8000-0000000fb101',
  '{"barcode":"012345678901","productName":"Carry source","basis":"Per serving (355 ml)","sourceUrl":"https://world.openfoodfacts.org/product/012345678901","calories":20,"fatGrams":null,"carbohydrateGrams":5,"sugarGrams":4,"proteinGrams":null,"sodiumMg":10}',
  'openfoodfacts','2025-01-02T03:04:05Z'),
 ('00000000-0000-4000-8000-0000000fb103',
  '{"barcode":"111111111111","productName":"Discarded source","basis":"Per 100 g / 100 ml (as listed)","sourceUrl":"https://world.openfoodfacts.org/product/111111111111","calories":40,"fatGrams":null,"carbohydrateGrams":10,"sugarGrams":8,"proteinGrams":null,"sodiumMg":20}',
  'openfoodfacts','2025-02-03T04:05:06Z'),
 ('00000000-0000-4000-8000-0000000fb104',
  '{"barcode":"222222222222","productName":"Keep destination","basis":"Per 100 g / 100 ml (as listed)","sourceUrl":"https://world.openfoodfacts.org/product/222222222222","calories":60,"fatGrams":null,"carbohydrateGrams":15,"sugarGrams":12,"proteinGrams":null,"sodiumMg":30}',
  'openfoodfacts','2025-03-04T05:06:07Z');
select public.merge_bev('00000000-0000-4000-8000-0000000fb101','00000000-0000-4000-8000-0000000fb102');
select ok((select n.nutrition = '{"barcode":"012345678901","productName":"Carry source","basis":"Per serving (355 ml)","sourceUrl":"https://world.openfoodfacts.org/product/012345678901","calories":20,"fatGrams":null,"carbohydrateGrams":5,"sugarGrams":4,"proteinGrams":null,"sodiumMg":10}'::jsonb
                  and n.source = 'openfoodfacts'
                  and n.created_at = '2025-01-02T03:04:05Z'::timestamptz
             from public.bev_nutrition n where n.bev_id = '00000000-0000-4000-8000-0000000fb102'),
          'merge carries the full nutrition snapshot, source and created_at');
select public.merge_bev('00000000-0000-4000-8000-0000000fb103','00000000-0000-4000-8000-0000000fb104');
select ok((select n.nutrition = '{"barcode":"222222222222","productName":"Keep destination","basis":"Per 100 g / 100 ml (as listed)","sourceUrl":"https://world.openfoodfacts.org/product/222222222222","calories":60,"fatGrams":null,"carbohydrateGrams":15,"sugarGrams":12,"proteinGrams":null,"sodiumMg":30}'::jsonb
                  and n.source = 'openfoodfacts'
                  and n.created_at = '2025-03-04T05:06:07Z'::timestamptz
             from public.bev_nutrition n where n.bev_id = '00000000-0000-4000-8000-0000000fb104'),
          'merge keeps the full destination snapshot when both Bevs have nutrition');
select * from finish();
rollback;
