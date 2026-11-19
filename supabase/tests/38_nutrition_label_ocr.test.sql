-- Nutrition read off a label photo (20261119153337): the widened
-- bev_nutrition.source constraint and
-- create_bev_with_nutrition_v2(). v1's own behaviour stays in 37.
begin;
select plan(17);
insert into auth.users (id,email,raw_user_meta_data,aud,role) values
 ('00000000-0000-4000-8000-0000000fc0a1','pgtapocr1@users.bevi.app','{"invite_code":"local-test-invite-code"}','authenticated','authenticated'),
 ('00000000-0000-4000-8000-0000000fc0a2','pgtapocr2@users.bevi.app','{"invite_code":"local-test-invite-code"}','authenticated','authenticated');
set local bevi.rpc_bypass = 'true';
update public.profiles set birth_date='1990-01-01' where id in
 ('00000000-0000-4000-8000-0000000fc0a1','00000000-0000-4000-8000-0000000fc0a2');
set local bevi.rpc_bypass = 'false';

-- Label photos, planted directly: the Storage API is not in the picture and
-- storage.objects RLS would stop `authenticated` from inserting them.
insert into storage.objects (bucket_id, name, owner_id) values
 ('nutrition-labels','00000000-0000-4000-8000-0000000fc0a1/label.jpg','00000000-0000-4000-8000-0000000fc0a1'),
 ('nutrition-labels','00000000-0000-4000-8000-0000000fc0a2/theirs.jpg','00000000-0000-4000-8000-0000000fc0a2');

-- A label read: no barcode, no third-party page, sodium in milligrams.
set local test.ocr = '{"barcode":null,"productName":"pgTAP OCR Dew","basis":"Per serving (12 fl oz (355 mL))","calories":170,"fatGrams":0,"carbohydrateGrams":46,"sugarGrams":46,"proteinGrams":null,"sodiumMg":60,"sourceUrl":null,"source":"label-ocr"}';
-- What a client built before 2.16.0 sends: no `source` key at all.
set local test.nosource = '{"barcode":"012345678905","productName":"pgTAP OCR Water","basis":"Per serving (355 ml)","sourceUrl":"https://world.openfoodfacts.org/product/012345678905","calories":0,"fatGrams":null,"carbohydrateGrams":0,"sugarGrams":0,"proteinGrams":null,"sodiumMg":4}';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated','public.create_bev_with_nutrition_v2(text,text,text,text,smallint,boolean,text,text,jsonb)','execute'),'authenticated callers can create with a sourced snapshot');
select ok(not has_function_privilege('anon','public.create_bev_with_nutrition_v2(text,text,text,text,smallint,boolean,text,text,jsonb)','execute'),'anonymous callers cannot create with a sourced snapshot');

-- ---------------------------------------------------------------------------
-- The widened source constraint accepts both readings and nothing else
-- ---------------------------------------------------------------------------
insert into public.bevs (id, name, category_id, photo_path, price_tier, status, source) values
 ('00000000-0000-4000-8000-0000000fc101','pgTAP OCR Constraint One','water','ocr/one.jpg',1,'active','seed'),
 ('00000000-0000-4000-8000-0000000fc102','pgTAP OCR Constraint Two','water','ocr/two.jpg',1,'active','seed'),
 ('00000000-0000-4000-8000-0000000fc103','pgTAP OCR Constraint Three','water','ocr/three.jpg',1,'active','seed');
select lives_ok($$ insert into public.bev_nutrition (bev_id, nutrition, source) values ('00000000-0000-4000-8000-0000000fc101', current_setting('test.ocr')::jsonb, 'label-ocr') $$,'bev_nutrition.source accepts label-ocr');
select lives_ok($$ insert into public.bev_nutrition (bev_id, nutrition, source) values ('00000000-0000-4000-8000-0000000fc102', current_setting('test.nosource')::jsonb, 'openfoodfacts') $$,'bev_nutrition.source still accepts openfoodfacts');
select throws_ok($$ insert into public.bev_nutrition (bev_id, nutrition, source) values ('00000000-0000-4000-8000-0000000fc103', current_setting('test.ocr')::jsonb, 'guesswork') $$,'23514',null,'bev_nutrition.source accepts no other reading');

-- ---------------------------------------------------------------------------
-- create_bev_with_nutrition_v2
--
-- From here on the tests run as a signed-in caller: the RPC refuses outright
-- without an auth.uid().
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-0000000fc0a1","role":"authenticated"}';
select lives_ok($$ select public.create_bev_with_nutrition_v2('pgTAP OCR Dew','pgTAP OCR',null,'soda',2::smallint,false,null,'00000000-0000-4000-8000-0000000fc0a1/label.jpg',current_setting('test.ocr')::jsonb) $$,'a label reading creates a Bev and its snapshot');
select throws_ok($$ select public.create_bev_with_nutrition_v2('pgTAP OCR Barcode',null,null,'soda',2::smallint,false,null,'00000000-0000-4000-8000-0000000fc0a1/label.jpg',current_setting('test.ocr')::jsonb || '{"barcode":"012345678905"}') $$,'22023','BEVI_VALIDATION','a label reading carrying a barcode is rejected');
select throws_ok($$ select public.create_bev_with_nutrition_v2('pgTAP OCR Link',null,null,'soda',2::smallint,false,null,'00000000-0000-4000-8000-0000000fc0a1/label.jpg',current_setting('test.ocr')::jsonb || '{"sourceUrl":"https://world.openfoodfacts.org/product/012345678905"}') $$,'22023','BEVI_VALIDATION','a label reading carrying a source URL is rejected');
select throws_ok($$ select public.create_bev_with_nutrition_v2('pgTAP OCR No Label',null,null,'soda',2::smallint,false,null,null,current_setting('test.ocr')::jsonb) $$,'22023','BEVI_VALIDATION','a label reading with no label photo is rejected');
select throws_ok($$ select public.create_bev_with_nutrition_v2('pgTAP OCR Bad Source',null,null,'soda',2::smallint,false,null,'00000000-0000-4000-8000-0000000fc0a1/label.jpg',current_setting('test.ocr')::jsonb || '{"source":"guesswork"}') $$,'22023','BEVI_VALIDATION','an unknown reading source is rejected');
select lives_ok($$ select public.create_bev_with_nutrition_v2('pgTAP OCR Water','pgTAP OCR',null,'soda',2::smallint,false,null,null,current_setting('test.nosource')::jsonb) $$,'a snapshot with no source key is accepted');
reset role;

select is((select n.source from public.bev_nutrition n join public.bevs b on b.id=n.bev_id where b.name='pgTAP OCR Dew'),'label-ocr','a label reading is stored as label-ocr');
-- Counted rather than compared: a missing row would also read as a null upc.
select is((select count(*)::int from public.bevs b where b.name='pgTAP OCR Dew' and b.upc is null),1,'a label reading never claims a UPC');
select ok((select n.nutrition->'barcode' = 'null'::jsonb and n.nutrition->'sourceUrl' = 'null'::jsonb and n.nutrition->>'source' = 'label-ocr'
             from public.bev_nutrition n join public.bevs b on b.id=n.bev_id where b.name='pgTAP OCR Dew'),
          'the stored snapshot keeps its null barcode, null source URL and its source');
select is((select n.source from public.bev_nutrition n join public.bevs b on b.id=n.bev_id where b.name='pgTAP OCR Water'),'openfoodfacts','a snapshot with no source key is recorded as openfoodfacts');
select is((select b.upc from public.bevs b where b.name='pgTAP OCR Water'),'012345678905','an openfoodfacts snapshot still persists the barcode as the Bev UPC');
select is((select count(*)::int from public.bevs where name in ('pgTAP OCR Barcode','pgTAP OCR Link','pgTAP OCR No Label','pgTAP OCR Bad Source')),0,'rejected label readings never leave orphan Bevs');
select * from finish();
rollback;
