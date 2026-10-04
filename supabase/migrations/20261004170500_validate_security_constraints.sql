-- Validate our new constraints only when historical rows already comply.
-- Report counts, never rewrite or discard historical user data.
DO $$ DECLARE c record; n bigint; BEGIN
 FOR c IN SELECT t.relname,con.conname,pg_get_expr(con.conbin,con.conrelid) AS expression
  FROM pg_constraint con JOIN pg_class t ON t.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
  WHERE ns.nspname='public' AND con.conname IN ('transactions_finite_values','accounts_finite_balance',
  'orders_valid_values','transfers_finite_amount','recurring_finite_amount','portfolios_finite_capital') LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE NOT (%s)',c.relname,c.expression) INTO n;
  IF n=0 THEN EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',c.relname,c.conname);
  ELSE RAISE WARNING '%: % historical invalid rows retained; new writes are protected',c.conname,n; END IF;
 END LOOP;
 SELECT count(*) INTO n FROM public.meal_items i LEFT JOIN public.meal_entries e ON e.id=i.entry_id
 WHERE e.id IS NULL OR e.meal_id IS DISTINCT FROM i.meal_id;
 IF n=0 THEN ALTER TABLE public.meal_items VALIDATE CONSTRAINT meal_items_entry_meal_fk;
 ELSE RAISE WARNING 'meal_items: % historical inconsistent parent references retained',n; END IF;
END $$;
-- Avoid default anonymous access and non-CRUD privileges for future tables.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE,REFERENCES,TRIGGER ON TABLES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
