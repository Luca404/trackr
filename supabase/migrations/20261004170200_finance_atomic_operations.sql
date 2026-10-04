-- Keep each money movement, order, recurrence and deletion in one DB transaction.
ALTER TABLE public.transactions ADD COLUMN recurring_due_date date;
CREATE UNIQUE INDEX transactions_recurring_occurrence ON public.transactions(recurring_id,recurring_due_date)
 WHERE recurring_id IS NOT NULL AND recurring_due_date IS NOT NULL;
CREATE OR REPLACE FUNCTION trackr_private.next_due_date(d date,frequency text,anchor date) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n date; BEGIN
 IF frequency='weekly' THEN RETURN d+7;
 ELSIF frequency='monthly' THEN n:=(date_trunc('month',d)+interval '1 month')::date;
 ELSIF frequency='yearly' THEN n:=make_date(extract(year FROM d)::int+1,extract(month FROM anchor)::int,1);
 ELSE RAISE EXCEPTION 'invalid_frequency'; END IF;
 RETURN n+least(extract(day FROM anchor)::int,extract(day FROM (n+interval '1 month' - interval '1 day'))::int)-1;
END $$;
REVOKE ALL ON FUNCTION trackr_private.next_due_date(date,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION trackr_private.next_due_date(date,text,date) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.save_financial_transaction(p_profile_id uuid,p_transaction_id bigint,p_payload jsonb,p_due_date date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t public.transactions; old_t public.transactions; r public.recurring_transactions; o public.orders;
 v jsonb:=p_payload; rid integer; BEGIN
 IF NOT trackr_private.can_write_profile(p_profile_id) THEN RAISE EXCEPTION 'not_editor' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:'||p_profile_id::text,0));
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR octet_length(v::text)>32768 THEN RAISE EXCEPTION 'invalid_payload'; END IF;
 -- Serialize edits to the same transaction and retain omitted fields.
 IF p_transaction_id IS NOT NULL THEN
  SELECT * INTO old_t FROM public.transactions WHERE id=p_transaction_id AND profile_id=p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found'; END IF;
  SELECT * INTO o FROM public.orders WHERE transaction_id=p_transaction_id FOR UPDATE;
  v:=to_jsonb(old_t)||CASE WHEN o.id IS NULL THEN '{}'::jsonb ELSE
   to_jsonb(o)||jsonb_build_object('ticker',o.symbol,'instrument_name',o.name) END||v;
 END IF;
 rid:=coalesce(old_t.recurring_id,(p_payload->>'recurring_id')::integer);
 IF rid IS NOT NULL THEN
  SELECT * INTO r FROM public.recurring_transactions WHERE id=rid AND profile_id=p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'recurrence_not_found'; END IF;
 END IF;
 IF p_due_date IS NOT NULL THEN
  IF rid IS NULL OR p_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'invalid_occurrence'; END IF;
  SELECT * INTO t FROM public.transactions WHERE recurring_id=rid AND
   (recurring_due_date=p_due_date OR (recurring_due_date IS NULL AND date=p_due_date));
  IF FOUND THEN RETURN to_jsonb(t); END IF;
  IF r.next_due_date<>p_due_date THEN RAISE EXCEPTION 'stale_occurrence'; END IF;
 END IF;
 IF p_payload ? 'recurrence' THEN
  IF p_payload->>'recurrence' IS NOT NULL THEN
   r:=jsonb_populate_record(r,v||jsonb_build_object('frequency',v->>'recurrence','start_date',v->>'date',
    'instrument_name',v->>'instrument_name','user_id',coalesce(r.user_id,auth.uid()),'profile_id',p_profile_id));
   r.next_due_date:=trackr_private.next_due_date(r.start_date,r.frequency,r.start_date);
   IF rid IS NULL THEN
    INSERT INTO public.recurring_transactions(user_id,profile_id,account_id,type,category,subcategory,amount,description,frequency,start_date,next_due_date,ticker,quantity,price,portfolio_id,isin,instrument_name,exchange,instrument_type,order_type,currency)
    VALUES(auth.uid(),p_profile_id,r.account_id,r.type,r.category,r.subcategory,r.amount,r.description,r.frequency,r.start_date,r.next_due_date,r.ticker,r.quantity,r.price,r.portfolio_id,r.isin,r.instrument_name,r.exchange,r.instrument_type,coalesce(r.order_type,'buy'),'EUR') RETURNING id INTO rid;
   ELSE
    UPDATE public.recurring_transactions SET account_id=r.account_id,type=r.type,category=r.category,subcategory=r.subcategory,amount=r.amount,description=r.description,frequency=r.frequency,start_date=r.start_date,next_due_date=r.next_due_date,ticker=r.ticker,quantity=r.quantity,price=r.price,portfolio_id=r.portfolio_id,isin=r.isin,instrument_name=r.instrument_name,exchange=r.exchange,instrument_type=r.instrument_type,order_type=coalesce(r.order_type,'buy') WHERE id=rid;
   END IF;
  ELSIF rid IS NOT NULL THEN
   DELETE FROM public.recurring_transactions WHERE id=rid; rid:=NULL;
  END IF;
 END IF;
 t:=jsonb_populate_record(NULL::public.transactions,v);
 IF p_transaction_id IS NULL THEN
  INSERT INTO public.transactions(user_id,profile_id,account_id,type,category,subcategory,amount,description,date,ticker,quantity,price,recurring_id,recurring_due_date)
  VALUES(auth.uid(),p_profile_id,t.account_id,t.type,t.category,t.subcategory,t.amount,t.description,t.date,t.ticker,t.quantity,t.price,rid,p_due_date) RETURNING * INTO t;
 ELSE
  UPDATE public.transactions SET account_id=t.account_id,type=t.type,category=t.category,subcategory=t.subcategory,amount=t.amount,description=t.description,date=t.date,ticker=t.ticker,quantity=t.quantity,price=t.price,recurring_id=rid WHERE id=p_transaction_id RETURNING * INTO t;
 END IF;
 IF t.type='investment' THEN
  IF (coalesce(v->>'order_type','buy')='sell' AND t.amount>=0) OR (coalesce(v->>'order_type','buy')='buy' AND t.amount<=0) THEN RAISE EXCEPTION 'invalid_investment_sign'; END IF;
  IF nullif(v->>'ticker','') IS NULL OR v->>'portfolio_id' IS NULL OR t.quantity IS NULL OR t.quantity<=0 OR t.price IS NULL OR t.price<0 THEN RAISE EXCEPTION 'invalid_investment'; END IF;
  IF o.id IS NULL THEN
   INSERT INTO public.orders(user_id,portfolio_id,symbol,isin,name,exchange,currency,quantity,price,commission,instrument_type,order_type,date,ter,transaction_id,description)
   VALUES(auth.uid(),(v->>'portfolio_id')::integer,t.ticker,v->>'isin',v->>'instrument_name',v->>'exchange','EUR',t.quantity,t.price,greatest(0,abs(t.amount)-t.quantity*t.price),v->>'instrument_type',coalesce(v->>'order_type','buy'),t.date,(v->>'ter')::numeric,t.id,t.description);
  ELSE
   UPDATE public.orders SET portfolio_id=(v->>'portfolio_id')::integer,symbol=t.ticker,isin=v->>'isin',name=v->>'instrument_name',exchange=v->>'exchange',quantity=t.quantity,price=t.price,commission=greatest(0,abs(t.amount)-t.quantity*t.price),instrument_type=v->>'instrument_type',order_type=coalesce(v->>'order_type','buy'),date=t.date,ter=(v->>'ter')::numeric,description=t.description WHERE id=o.id;
  END IF;
 ELSE DELETE FROM public.orders WHERE transaction_id=t.id;
 END IF;
 IF p_due_date IS NOT NULL THEN UPDATE public.recurring_transactions SET next_due_date=trackr_private.next_due_date(p_due_date,r.frequency,r.start_date) WHERE id=rid; END IF;
 RETURN to_jsonb(t);
END $$;
CREATE OR REPLACE FUNCTION public.process_recurring_transactions(p_profile_id uuid,p_today date) RETURNS SETOF public.transactions
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.recurring_transactions; d date; t public.transactions; n integer:=0; BEGIN
 IF NOT trackr_private.can_write_profile(p_profile_id) THEN RAISE EXCEPTION 'not_editor' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:'||p_profile_id::text,0));
 IF p_today IS NULL OR p_today>CURRENT_DATE+2 THEN RAISE EXCEPTION 'invalid_date'; END IF;
 FOR r IN SELECT * FROM public.recurring_transactions WHERE profile_id=p_profile_id AND type IN ('expense','income') AND next_due_date<=p_today ORDER BY id FOR UPDATE LOOP
  d:=r.next_due_date;
  WHILE d<=p_today LOOP
   n:=n+1; IF n>1000 THEN RAISE EXCEPTION 'too_many_occurrences'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.transactions WHERE recurring_id=r.id AND (recurring_due_date=d OR (recurring_due_date IS NULL AND date=d))) THEN
    INSERT INTO public.transactions(user_id,profile_id,account_id,type,category,subcategory,amount,description,date,recurring_id,recurring_due_date)
    VALUES(auth.uid(),p_profile_id,r.account_id,r.type,r.category,r.subcategory,r.amount,r.description,d,r.id,d) RETURNING * INTO t;
    RETURN NEXT t;
   END IF;
   d:=trackr_private.next_due_date(d,r.frequency,r.start_date);
  END LOOP;
  UPDATE public.recurring_transactions SET next_due_date=d WHERE id=r.id;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.delete_financial_transaction(p_profile_id uuid,p_transaction_id bigint) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t public.transactions; BEGIN
 IF NOT trackr_private.can_write_profile(p_profile_id) THEN RAISE EXCEPTION 'not_editor' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:'||p_profile_id::text,0));
 SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id AND profile_id=p_profile_id;
 IF NOT FOUND THEN RETURN; END IF;
 -- Use recurrence -> transaction -> order lock order consistently with save/process.
 PERFORM 1 FROM public.recurring_transactions WHERE id=t.recurring_id FOR UPDATE;
 PERFORM 1 FROM public.transactions WHERE id=t.id FOR UPDATE;
 DELETE FROM public.orders WHERE transaction_id=t.id;
 DELETE FROM public.transactions WHERE id=t.id;
 UPDATE public.recurring_transactions SET next_due_date=least(next_due_date,coalesce(t.recurring_due_date,t.date)) WHERE id=t.recurring_id;
END $$;
CREATE OR REPLACE FUNCTION public.delete_financial_order(p_profile_id uuid,p_order_id bigint) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE tid bigint; BEGIN
 IF NOT trackr_private.can_write_profile(p_profile_id) THEN RAISE EXCEPTION 'not_editor' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:'||p_profile_id::text,0));
 SELECT o.transaction_id INTO tid FROM public.orders o JOIN public.portfolios p ON p.id=o.portfolio_id WHERE o.id=p_order_id AND p.profile_id=p_profile_id;
 IF NOT FOUND THEN RETURN; END IF;
 IF tid IS NOT NULL THEN PERFORM public.delete_financial_transaction(p_profile_id,tid);
 ELSE DELETE FROM public.orders WHERE id=p_order_id; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.delete_financial_portfolio(p_profile_id uuid,p_portfolio_id bigint) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE tids bigint[]; BEGIN
 IF NOT trackr_private.can_write_profile(p_profile_id) THEN RAISE EXCEPTION 'not_editor' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:'||p_profile_id::text,0));
 PERFORM 1 FROM public.portfolios WHERE id=p_portfolio_id AND profile_id=p_profile_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT array_agg(transaction_id) INTO tids FROM public.orders WHERE portfolio_id=p_portfolio_id;
 DELETE FROM public.recurring_transactions WHERE portfolio_id=p_portfolio_id AND profile_id=p_profile_id;
 DELETE FROM public.orders WHERE portfolio_id=p_portfolio_id;
 DELETE FROM public.transactions WHERE id=ANY(tids) AND profile_id=p_profile_id;
 DELETE FROM public.portfolios WHERE id=p_portfolio_id;
END $$;
CREATE OR REPLACE FUNCTION public.export_financial_profile(p_profile_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version',2,'exportDate',now(),'scope','profile','profile',to_jsonb(p),'data',jsonb_build_object(
 'accounts',(SELECT coalesce(jsonb_agg(a ORDER BY a.id),'[]') FROM public.accounts a WHERE profile_id=p.id),
 'categories',(SELECT coalesce(jsonb_agg(c ORDER BY c.id),'[]') FROM public.categories c WHERE profile_id=p.id),
 'subcategories',(SELECT coalesce(jsonb_agg(s ORDER BY s.id),'[]') FROM public.subcategories s JOIN public.categories c ON c.id=s.category_id WHERE c.profile_id=p.id),
 'transactions',(SELECT coalesce(jsonb_agg(t ORDER BY t.id),'[]') FROM public.transactions t WHERE profile_id=p.id),
 'transfers',(SELECT coalesce(jsonb_agg(t ORDER BY t.id),'[]') FROM public.transfers t WHERE profile_id=p.id),
 'recurring_transactions',(SELECT coalesce(jsonb_agg(r ORDER BY r.id),'[]') FROM public.recurring_transactions r WHERE profile_id=p.id),
 'portfolios',(SELECT coalesce(jsonb_agg(f ORDER BY f.id),'[]') FROM public.portfolios f WHERE profile_id=p.id),
 'orders',(SELECT coalesce(jsonb_agg(o ORDER BY o.id),'[]') FROM public.orders o JOIN public.portfolios f ON f.id=o.portfolio_id WHERE f.profile_id=p.id)))
 FROM public.profiles p WHERE p.id=p_profile_id AND public.is_profile_member(p.id,auth.uid());
$$;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('save_financial_transaction','process_recurring_transactions','delete_financial_transaction','delete_financial_order','delete_financial_portfolio','export_financial_profile') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
