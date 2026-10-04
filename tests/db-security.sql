\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.ok(condition boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.denied(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
  RAISE NOTICE 'PASS: %',label; RETURN; END;
 RAISE EXCEPTION 'FAIL: % was allowed',label;
END $$;
CREATE FUNCTION pg_temp.fails(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN raise_exception THEN
  RAISE NOTICE 'PASS: %',label; RETURN; END;
 RAISE EXCEPTION 'FAIL: % was allowed',label;
END $$;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-0000-0000-000000000001','owner@example.test'),
 ('00000000-0000-0000-0000-000000000002','editor@example.test'),
 ('00000000-0000-0000-0000-000000000003','viewer@example.test'),
 ('00000000-0000-0000-0000-000000000004','other@example.test');
INSERT INTO public.profiles(id,user_id,name) SELECT id,id,'Main' FROM auth.users ON CONFLICT(id) DO NOTHING;
INSERT INTO public.profiles(id,user_id,name) VALUES('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','Shared');
INSERT INTO public.profile_members(profile_id,user_id,role,email) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000002','editor','editor@example.test'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000003','viewer','viewer@example.test');
INSERT INTO public.accounts(id,user_id,profile_id,name) VALUES
 (1001,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','Shared account'),
 (1002,'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','Other account');
INSERT INTO public.categories(id,user_id,profile_id,name,icon) VALUES(2001,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','Food','🍴');
INSERT INTO public.subcategories(category_id,name) VALUES(2001,'Lunch');
INSERT INTO public.portfolios(id,user_id,profile_id,name) VALUES
 (3001,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','Shared portfolio'),
 (3002,'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','Other portfolio');
INSERT INTO public.transactions(id,user_id,profile_id,account_id,type,category,amount,date) VALUES
 (4001,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101',1001,'expense','Food',10,'2026-10-01');
INSERT INTO public.orders(user_id,portfolio_id,symbol,quantity,price,order_type,date) VALUES
 ('00000000-0000-0000-0000-000000000001',3001,'FREE',1,0,'buy','2026-10-01');
INSERT INTO public.meals(id,user_id,date,meal_type) VALUES
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000001','2026-10-01','lunch'),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000004','2026-10-01','lunch');
INSERT INTO public.meal_entries(id,meal_id,name) VALUES('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','Owner lunch');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relkind='r' AND NOT t.relrowsecurity),'all public tables have RLS enabled');
SET LOCAL ROLE anon;
SELECT pg_temp.denied($q$SELECT public.is_profile_member('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001')$q$,'anonymous helper access');
SELECT pg_temp.denied($q$SELECT public.get_my_profiles()$q$,'anonymous profile repair');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT set_config('request.jwt.claim.email','viewer@example.test',true);
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.accounts),'viewer sees only shared account');
WITH deleted AS(DELETE FROM public.accounts WHERE id=1001 RETURNING id) SELECT pg_temp.ok((SELECT count(*)=0 FROM deleted),'viewer cannot delete account');
WITH deleted AS(DELETE FROM public.transactions WHERE id=4001 RETURNING id) SELECT pg_temp.ok((SELECT count(*)=0 FROM deleted),'viewer cannot delete transaction');
WITH deleted AS(DELETE FROM public.orders WHERE symbol='FREE' RETURNING id) SELECT pg_temp.ok((SELECT count(*)=0 FROM deleted),'viewer cannot delete free order');
WITH changed AS(UPDATE public.accounts SET profile_id='00000000-0000-0000-0000-000000000003' WHERE id=1001 RETURNING id) SELECT pg_temp.ok((SELECT count(*)=0 FROM changed),'viewer cannot move account into own profile');
SELECT pg_temp.denied($q$INSERT INTO public.accounts(user_id,profile_id,name) VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000101','Forbidden')$q$,'viewer cannot insert');
SELECT pg_temp.denied($q$SELECT public.process_recurring_transactions('00000000-0000-0000-0000-000000000101','2026-10-04')$q$,'viewer cannot run recurrence RPC');
SELECT pg_temp.ok(NOT public.is_profile_member('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001'),'helper identity pinned to caller');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT set_config('request.jwt.claim.email','editor@example.test',true);
WITH changed AS(UPDATE public.accounts SET name='Edited' WHERE id=1001 RETURNING id) SELECT pg_temp.ok((SELECT count(*)=1 FROM changed),'editor can update shared creator row');
SELECT pg_temp.denied($q$INSERT INTO public.transactions(user_id,profile_id,account_id,type,category,amount,date) VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000101',1002,'expense','Food',5,'2026-10-04')$q$,'cross-profile account rejected');
SELECT pg_temp.denied($q$INSERT INTO public.accounts(user_id,profile_id,name) VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','Spoofed')$q$,'creator spoofing rejected');
SELECT pg_temp.denied($q$INSERT INTO public.accounts(user_id,profile_id,name,initial_balance) VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000101','Invalid','NaN')$q$,'nonfinite money rejected');
SELECT public.save_financial_transaction('00000000-0000-0000-0000-000000000101',NULL,'{"account_id":1001,"type":"investment","category":"Shared portfolio","amount":102,"date":"2026-10-04","ticker":"TEST","quantity":2,"price":50,"portfolio_id":3001,"recurrence":"monthly"}') AS saved \gset
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.orders WHERE transaction_id=(:'saved'::jsonb->>'id')::bigint),'investment creates linked order');
SELECT pg_temp.ok((:'saved'::jsonb->>'recurring_id') IS NOT NULL,'investment creates linked recurrence');
SELECT pg_temp.denied($q$SELECT public.save_financial_transaction('00000000-0000-0000-0000-000000000101',NULL,'{"account_id":1001,"type":"investment","category":"Bad","amount":99,"date":"2026-10-04","ticker":"FAIL","quantity":1,"price":99,"portfolio_id":3002,"recurrence":"monthly"}')$q$,'cross-profile order rollback');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM public.transactions WHERE ticker='FAIL') AND NOT EXISTS(SELECT 1 FROM public.recurring_transactions WHERE ticker='FAIL'),'failed order rolls back transaction and recurrence');
SELECT public.save_financial_order('00000000-0000-0000-0000-000000000101',(SELECT id FROM public.orders WHERE transaction_id=(:'saved'::jsonb->>'id')::bigint),'{"quantity":3,"price":20,"commission":2}');
SELECT pg_temp.ok((SELECT amount=62 AND quantity=3 FROM public.transactions WHERE id=(:'saved'::jsonb->>'id')::bigint),'order edit synchronizes transaction');
SELECT public.save_financial_transaction('00000000-0000-0000-0000-000000000101',NULL,'{"account_id":1001,"type":"expense","category":"Food","amount":5,"date":"2026-08-31","recurrence":"monthly"}') AS recurring \gset
SELECT count(*) FROM public.process_recurring_transactions('00000000-0000-0000-0000-000000000101','2026-10-04');
SELECT pg_temp.ok((SELECT count(*)=2 FROM public.transactions WHERE recurring_id=(:'recurring'::jsonb->>'recurring_id')::int),'catch-up creates one missing occurrence');
SELECT pg_temp.ok((SELECT count(*)=0 FROM public.process_recurring_transactions('00000000-0000-0000-0000-000000000101','2026-10-04')),'recurrence retry creates no duplicates');
SELECT pg_temp.ok((SELECT next_due_date='2026-10-31' FROM public.recurring_transactions WHERE id=(:'recurring'::jsonb->>'recurring_id')::int),'recurrence preserves month-end anchor');
SELECT public.export_financial_profile('00000000-0000-0000-0000-000000000101') AS backup \gset
SELECT pg_temp.ok(:'backup'::jsonb->>'version'='2' AND (:'backup'::jsonb->'data') ?& ARRAY['orders','transfers','recurring_transactions','subcategories'],'backup includes all financial entities');
SELECT pg_temp.ok(jsonb_array_length(:'backup'::jsonb->'data'->'orders')=2,'backup includes free and linked orders');
-- Round-trip the complete financial snapshot with database-admin privileges.
-- Auth identities/profile metadata stay in place; their lifecycle is outside this export.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE FUNCTION pg_temp.restore_snapshot(snapshot jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE table_name text; pid uuid:=(snapshot->'profile'->>'id')::uuid; BEGIN
 DELETE FROM public.orders WHERE portfolio_id IN(SELECT id FROM public.portfolios WHERE profile_id=pid);
 DELETE FROM public.transactions WHERE profile_id=pid;
 DELETE FROM public.transfers WHERE profile_id=pid;
 DELETE FROM public.recurring_transactions WHERE profile_id=pid;
 DELETE FROM public.accounts WHERE profile_id=pid;
 DELETE FROM public.categories WHERE profile_id=pid;
 DELETE FROM public.portfolios WHERE profile_id=pid;
 FOREACH table_name IN ARRAY ARRAY['accounts','categories','subcategories','portfolios','recurring_transactions','transactions','transfers','orders'] LOOP
  EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(NULL::public.%I,$1)',table_name,table_name)
   USING snapshot->'data'->table_name;
 END LOOP;
END $$;
SELECT pg_temp.restore_snapshot(:'backup'::jsonb);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.ok(public.export_financial_profile('00000000-0000-0000-0000-000000000101')->'data'=:'backup'::jsonb->'data','complete financial backup round-trip preserves records and relations');
SELECT public.delete_financial_order('00000000-0000-0000-0000-000000000101',(SELECT id FROM public.orders WHERE transaction_id=(:'saved'::jsonb->>'id')::bigint));
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=(:'saved'::jsonb->>'id')::bigint),'order deletion removes linked transaction atomically');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.email','owner@example.test',true);
WITH deleted AS(DELETE FROM public.profiles WHERE id=auth.uid() RETURNING id) SELECT pg_temp.ok((SELECT count(*)=0 FROM deleted),'main profile cannot be deleted');
SELECT pg_temp.denied($q$UPDATE public.profiles SET user_id='00000000-0000-0000-0000-000000000004' WHERE id=auth.uid()$q$,'profile owner immutable');
WITH deleted AS(DELETE FROM public.profile_members WHERE profile_id='00000000-0000-0000-0000-000000000101' AND role='owner' RETURNING user_id) SELECT pg_temp.ok((SELECT count(*)=0 FROM deleted),'owner membership cannot be removed');
SELECT pg_temp.denied($q$INSERT INTO public.profile_share_invitations(profile_id,invited_email,invited_by,role) VALUES('00000000-0000-0000-0000-000000000101','other@example.test',auth.uid(),'editor')$q$,'direct invite insert denied');
SELECT public.create_profile_invitation('00000000-0000-0000-0000-000000000101',' Other@Example.Test ','viewer');
SELECT public.create_profile_invitation('00000000-0000-0000-0000-000000000101','unknown@example.test','viewer');
SELECT pg_temp.ok((SELECT count(*)=2 FROM public.profile_share_invitations),'existing and unknown addresses have same invitation behavior');
SELECT public.cancel_profile_invitation((SELECT id FROM public.profile_share_invitations WHERE invited_email='unknown@example.test'));
SELECT pg_temp.ok((SELECT status='cancelled' FROM public.profile_share_invitations WHERE invited_email='unknown@example.test'),'sender cancels invitation');
SELECT pg_temp.fails($q$SELECT public.import_kakebo_profile_atomic('00000000-0000-0000-0000-000000000101','{}')$q$,'empty import rejected');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM public.accounts WHERE id=1001),'invalid import retains data');
SELECT pg_temp.denied($q$INSERT INTO public.meal_items(meal_id,entry_id,food_name,quantity_g,calories,protein_g,carbs_g,fat_g) VALUES('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000201','Tamper',100,10,1,1,1)$q$,'FitTrackr rejects mismatched meal and entry');
DO $$ DECLARE items jsonb:='[{"food_name":"Apple","quantity_g":100,"calories":50,"protein_g":0,"carbs_g":10,"fat_g":0}]'; BEGIN
 IF to_regprocedure('public.add_meal_entry(uuid,date,text,text,jsonb,uuid)') IS NOT NULL THEN
  PERFORM public.add_meal_entry(auth.uid(),'2026-10-04','breakfast','Valid breakfast',items,NULL);
 ELSE PERFORM public.add_meal_entry(auth.uid(),'2026-10-04','breakfast','Valid breakfast',items);
 END IF;
END $$;
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.meal_items),'FitTrackr meal RPC still works');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT set_config('request.jwt.claim.email','other@example.test',true);
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.accounts),'unrelated user cannot read shared finance');
SELECT public.reject_profile_invitation((SELECT id FROM public.profile_share_invitations WHERE invited_email='other@example.test'));
SELECT pg_temp.ok((SELECT status='rejected' FROM public.profile_share_invitations WHERE invited_email='other@example.test'),'recipient rejects invitation');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.email','owner@example.test',true);
SELECT public.create_profile_invitation('00000000-0000-0000-0000-000000000101','other@example.test','editor');
SELECT id FROM public.profile_share_invitations WHERE invited_email='other@example.test' AND status='pending' \gset accepted_
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT set_config('request.jwt.claim.email','other@example.test',true);
SELECT public.accept_profile_invitation(:'accepted_id');
SELECT pg_temp.ok(public.is_profile_member('00000000-0000-0000-0000-000000000101',auth.uid()),'recipient accepts invitation');
SELECT pg_temp.fails(format('SELECT public.accept_profile_invitation(%L)',:'accepted_id'),'accepted invitation cannot be replayed');
-- A manual investment occurrence is saved and advanced atomically, including retries.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT set_config('request.jwt.claim.email','editor@example.test',true);
SELECT public.save_financial_transaction('00000000-0000-0000-0000-000000000101',NULL,
 jsonb_build_object('account_id',1001,'type','investment','category','Shared portfolio','amount',102,'date','2026-10-04','ticker','TEST','quantity',2,'price',50,'portfolio_id',3001,'recurring_id',(:'saved'::jsonb->>'recurring_id')::int),'2026-10-04') AS manual \gset
SELECT public.save_financial_transaction('00000000-0000-0000-0000-000000000101',NULL,
 jsonb_build_object('account_id',1001,'type','investment','category','Shared portfolio','amount',102,'date','2026-10-04','ticker','TEST','quantity',2,'price',50,'portfolio_id',3001,'recurring_id',(:'saved'::jsonb->>'recurring_id')::int),'2026-10-04') AS retried \gset
SELECT pg_temp.ok(:'manual'::jsonb->>'id'=:'retried'::jsonb->>'id','manual recurrence retry returns same transaction');
SELECT public.delete_financial_portfolio('00000000-0000-0000-0000-000000000101',3001);
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM public.portfolios WHERE id=3001) AND NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=(:'manual'::jsonb->>'id')::bigint),'portfolio deletion removes related money movements');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claim.email','owner@example.test',true);
SELECT public.create_profile_invitation('00000000-0000-0000-0000-000000000101','unknown-'||g||'@example.test','viewer') FROM generate_series(1,7) g;
SELECT pg_temp.fails($q$SELECT public.create_profile_invitation('00000000-0000-0000-0000-000000000101','over-limit@example.test','viewer')$q$,'unknown addresses count toward invitation rate limit');
-- Invalid content fails after the reset statements, but the RPC rolls them all back.
SELECT pg_temp.denied($q$SELECT public.import_kakebo_profile_atomic('00000000-0000-0000-0000-000000000101','{"accounts":[{"source_conto_id":1,"name":"Invalid","initial_balance":"NaN"}],"categories":[],"portfolios":[],"transactions":[],"transfers":[],"orders":[],"recurring_transactions":[]}')$q$,'invalid import numeric rollback');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM public.accounts WHERE id=1001),'failed import rollback preserves existing account');
SELECT public.import_kakebo_profile_atomic('00000000-0000-0000-0000-000000000101','{"accounts":[{"source_conto_id":1,"name":"Imported","initial_balance":10}],"categories":[],"portfolios":[],"transactions":[],"transfers":[],"orders":[],"recurring_transactions":[]}');
SELECT pg_temp.ok((SELECT name='Imported' FROM public.accounts WHERE profile_id='00000000-0000-0000-0000-000000000101'),'valid import still succeeds with fixed permissions and search path');
RESET ROLE;
ROLLBACK;
