INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000099','legacy@example.test');
INSERT INTO public.profiles(id,user_id,name) VALUES('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000099','Legacy');
INSERT INTO public.accounts(id,user_id,profile_id,name) VALUES(12001,'00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000099','Legacy');
INSERT INTO public.transactions(id,user_id,profile_id,account_id,type,category,amount,date) VALUES(12001,'00000000-0000-0000-0000-000000000099',NULL,12001,'expense','Legacy',1,'2026-10-01');
