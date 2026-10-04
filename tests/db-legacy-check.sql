DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=12001 AND profile_id='00000000-0000-0000-0000-000000000099') THEN RAISE EXCEPTION 'Legacy transaction was not aligned'; END IF;
 RAISE NOTICE 'PASS: legacy transaction keeps its original account/profile ownership';
END $$;
DELETE FROM public.transactions WHERE id=12001;
DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-000000000099';
